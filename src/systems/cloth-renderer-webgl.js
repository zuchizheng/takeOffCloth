/**
 * WebGL 批量渲染器 - 替代慢速的 Canvas 2D 绘制
 * 将所有约束和粒子一次性提交到 GPU 渲染
 */
export class ClothRendererWebGL {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: false,
        });

        if (!this.gl) {
            console.warn('WebGL2 不支持，回退到 Canvas 2D');
            return;
        }

        this.lineProgram = null;
        this.pointProgram = null;
        this.faceProgram = null;

        this.lineVAO = null;
        this.pointVAO = null;
        this.faceVAO = null;

        this.lineBuffer = null;
        this.pointBuffer = null;
        this.faceBuffer = null;

        this.maxLines = 50000;
        this.maxPoints = 10000;
        this.maxFaces = 20000;

        this.initShaders();
        this.initBuffers();
    }

    initShaders() {
        const gl = this.gl;

        // ===== 线段渲染（约束） =====
        const lineVert = `#version 300 es
            precision highp float;

            in vec2 a_position;
            in vec4 a_color;

            uniform mat3 u_matrix;

            out vec4 v_color;

            void main() {
                vec3 pos = u_matrix * vec3(a_position, 1.0);
                gl_Position = vec4(pos.xy, 0.0, 1.0);
                v_color = a_color;
            }
        `;

        const lineFrag = `#version 300 es
            precision highp float;

            in vec4 v_color;
            out vec4 fragColor;

            void main() {
                fragColor = v_color;
            }
        `;

        this.lineProgram = this.createProgram(lineVert, lineFrag);

        // ===== 粒子渲染（点） =====
        const pointVert = `#version 300 es
            precision highp float;

            in vec2 a_position;
            in vec4 a_color;
            in float a_size;

            uniform mat3 u_matrix;

            out vec4 v_color;

            void main() {
                vec3 pos = u_matrix * vec3(a_position, 1.0);
                gl_Position = vec4(pos.xy, 0.0, 1.0);
                gl_PointSize = a_size;
                v_color = a_color;
            }
        `;

        const pointFrag = `#version 300 es
            precision highp float;

            in vec4 v_color;
            out vec4 fragColor;

            void main() {
                // 圆形点（抗锯齿）
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;

                float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
                fragColor = vec4(v_color.rgb, v_color.a * alpha);
            }
        `;

        this.pointProgram = this.createProgram(pointVert, pointFrag);

        // ===== 面片渲染（带纹理） =====
        const faceVert = `#version 300 es
            precision highp float;

            in vec2 a_position;
            in vec2 a_texCoord;
            in vec4 a_color;

            uniform mat3 u_matrix;

            out vec2 v_texCoord;
            out vec4 v_color;

            void main() {
                vec3 pos = u_matrix * vec3(a_position, 1.0);
                gl_Position = vec4(pos.xy, 0.0, 1.0);
                v_texCoord = a_texCoord;
                v_color = a_color;
            }
        `;

        const faceFrag = `#version 300 es
            precision highp float;

            in vec2 v_texCoord;
            in vec4 v_color;

            uniform sampler2D u_texture;
            uniform bool u_hasTexture;

            out vec4 fragColor;

            void main() {
                if (u_hasTexture) {
                    vec4 texColor = texture(u_texture, v_texCoord);
                    fragColor = texColor * v_color;
                } else {
                    fragColor = v_color;
                }
            }
        `;

        this.faceProgram = this.createProgram(faceVert, faceFrag);
    }

    createProgram(vertSource, fragSource) {
        const gl = this.gl;

        const vertShader = this.compileShader(gl.VERTEX_SHADER, vertSource);
        const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fragSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }

        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);

        return program;
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            return null;
        }

        return shader;
    }

    initBuffers() {
        const gl = this.gl;

        // 线段缓冲区（每条线 2 个顶点，每个顶点 6 个 float：x, y, r, g, b, a）
        this.lineBuffer = gl.createBuffer();
        this.lineVAO = gl.createVertexArray();
        gl.bindVertexArray(this.lineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.maxLines * 2 * 6 * 4, gl.DYNAMIC_DRAW);

        const posLoc = gl.getAttribLocation(this.lineProgram, 'a_position');
        const colorLoc = gl.getAttribLocation(this.lineProgram, 'a_color');

        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 6 * 4, 0);

        gl.enableVertexAttribArray(colorLoc);
        gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 6 * 4, 2 * 4);

        // 粒子缓冲区（每个点 7 个 float：x, y, r, g, b, a, size）
        this.pointBuffer = gl.createBuffer();
        this.pointVAO = gl.createVertexArray();
        gl.bindVertexArray(this.pointVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.maxPoints * 7 * 4, gl.DYNAMIC_DRAW);

        const pointPosLoc = gl.getAttribLocation(this.pointProgram, 'a_position');
        const pointColorLoc = gl.getAttribLocation(this.pointProgram, 'a_color');
        const pointSizeLoc = gl.getAttribLocation(this.pointProgram, 'a_size');

        gl.enableVertexAttribArray(pointPosLoc);
        gl.vertexAttribPointer(pointPosLoc, 2, gl.FLOAT, false, 7 * 4, 0);

        gl.enableVertexAttribArray(pointColorLoc);
        gl.vertexAttribPointer(pointColorLoc, 4, gl.FLOAT, false, 7 * 4, 2 * 4);

        gl.enableVertexAttribArray(pointSizeLoc);
        gl.vertexAttribPointer(pointSizeLoc, 1, gl.FLOAT, false, 7 * 4, 6 * 4);

        // 面片缓冲区（每个四边形 6 个顶点，每个顶点 8 个 float：x, y, u, v, r, g, b, a）
        this.faceBuffer = gl.createBuffer();
        this.faceVAO = gl.createVertexArray();
        gl.bindVertexArray(this.faceVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.faceBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.maxFaces * 6 * 8 * 4, gl.DYNAMIC_DRAW);

        const facePosLoc = gl.getAttribLocation(this.faceProgram, 'a_position');
        const faceTexLoc = gl.getAttribLocation(this.faceProgram, 'a_texCoord');
        const faceColorLoc = gl.getAttribLocation(this.faceProgram, 'a_color');

        gl.enableVertexAttribArray(facePosLoc);
        gl.vertexAttribPointer(facePosLoc, 2, gl.FLOAT, false, 8 * 4, 0);

        gl.enableVertexAttribArray(faceTexLoc);
        gl.vertexAttribPointer(faceTexLoc, 2, gl.FLOAT, false, 8 * 4, 2 * 4);

        gl.enableVertexAttribArray(faceColorLoc);
        gl.vertexAttribPointer(faceColorLoc, 4, gl.FLOAT, false, 8 * 4, 4 * 4);

        gl.bindVertexArray(null);
    }

    beginFrame() {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0.1, 0.1, 0.1, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    getProjectionMatrix() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // 正交投影：屏幕坐标 -> NDC [-1, 1]
        return [
            2 / w, 0, 0,
            0, -2 / h, 0,
            -1, 1, 1
        ];
    }

    renderConstraints(constraints) {
        const gl = this.gl;
        if (!constraints || constraints.length === 0) return;

        const lineData = [];

        constraints.forEach(c => {
            if (c.broken) return;

            const color = [0.5, 0.5, 0.5, 0.8];

            // 顶点 1
            lineData.push(
                c.p1.pos.x, c.p1.pos.y,
                color[0], color[1], color[2], color[3]
            );

            // 顶点 2
            lineData.push(
                c.p2.pos.x, c.p2.pos.y,
                color[0], color[1], color[2], color[3]
            );
        });

        if (lineData.length === 0) return;

        const buffer = new Float32Array(lineData);

        gl.useProgram(this.lineProgram);
        gl.bindVertexArray(this.lineVAO);

        const matrixLoc = gl.getUniformLocation(this.lineProgram, 'u_matrix');
        gl.uniformMatrix3fv(matrixLoc, false, this.getProjectionMatrix());

        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer);

        gl.drawArrays(gl.LINES, 0, lineData.length / 6);
    }

    renderParticles(particles) {
        const gl = this.gl;
        if (!particles || particles.length === 0) return;

        const pointData = [];

        particles.forEach(p => {
            let color, size;

            if (p.pinned) {
                color = [1.0, 0.0, 0.0, 1.0];
                size = 10.0;
            } else if (p.track) {
                color = [0.2, 0.6, 1.0, 1.0];
                size = 8.0;
            } else {
                color = [1.0, 1.0, 1.0, 0.8];
                size = 4.0;
            }

            pointData.push(
                p.pos.x, p.pos.y,
                color[0], color[1], color[2], color[3],
                size
            );
        });

        const buffer = new Float32Array(pointData);

        gl.useProgram(this.pointProgram);
        gl.bindVertexArray(this.pointVAO);

        const matrixLoc = gl.getUniformLocation(this.pointProgram, 'u_matrix');
        gl.uniformMatrix3fv(matrixLoc, false, this.getProjectionMatrix());

        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer);

        gl.drawArrays(gl.POINTS, 0, particles.length);
    }

    renderFaces(faces, texture = null) {
        const gl = this.gl;
        if (!faces || faces.length === 0) return;

        const faceData = [];

        faces.forEach(face => {
            // 检查面片是否被切断
            if (face.edges.some(e => !e || e.broken)) return;

            const [p0, p1, p2, p3] = face.p;
            const [uv0, uv1, uv2, uv3] = face.uv;

            const color = [1.0, 1.0, 1.0, 0.9];

            // 四边形拆成两个三角形
            // 三角形 1: p0, p1, p2
            faceData.push(
                p0.pos.x, p0.pos.y, uv0.u, uv0.v, ...color,
                p1.pos.x, p1.pos.y, uv1.u, uv1.v, ...color,
                p2.pos.x, p2.pos.y, uv2.u, uv2.v, ...color
            );

            // 三角形 2: p0, p2, p3
            faceData.push(
                p0.pos.x, p0.pos.y, uv0.u, uv0.v, ...color,
                p2.pos.x, p2.pos.y, uv2.u, uv2.v, ...color,
                p3.pos.x, p3.pos.y, uv3.u, uv3.v, ...color
            );
        });

        if (faceData.length === 0) return;

        const buffer = new Float32Array(faceData);

        gl.useProgram(this.faceProgram);
        gl.bindVertexArray(this.faceVAO);

        const matrixLoc = gl.getUniformLocation(this.faceProgram, 'u_matrix');
        gl.uniformMatrix3fv(matrixLoc, false, this.getProjectionMatrix());

        const hasTexLoc = gl.getUniformLocation(this.faceProgram, 'u_hasTexture');
        gl.uniform1i(hasTexLoc, texture ? 1 : 0);

        if (texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            const texLoc = gl.getUniformLocation(this.faceProgram, 'u_texture');
            gl.uniform1i(texLoc, 0);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.faceBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer);

        gl.drawArrays(gl.TRIANGLES, 0, faceData.length / 8);
    }

    dispose() {
        const gl = this.gl;
        if (!gl) return;

        gl.deleteProgram(this.lineProgram);
        gl.deleteProgram(this.pointProgram);
        gl.deleteProgram(this.faceProgram);

        gl.deleteBuffer(this.lineBuffer);
        gl.deleteBuffer(this.pointBuffer);
        gl.deleteBuffer(this.faceBuffer);

        gl.deleteVertexArray(this.lineVAO);
        gl.deleteVertexArray(this.pointVAO);
        gl.deleteVertexArray(this.faceVAO);
    }
}
