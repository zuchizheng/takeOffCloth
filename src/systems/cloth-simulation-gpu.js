import { Vector2D } from '../utils/vector2d.js';

/**
 * GPU 加速的布料模拟系统
 * 使用 WebGL 计算着色器（通过 Transform Feedback 或纹理反馈）进行粒子物理计算
 */
export class ClothSimulationGPU {
    constructor(gl) {
        this.gl = gl;
        this.particles = [];
        this.constraints = [];
        this.faces = [];

        // GPU 资源
        this.particleBuffer = null;
        this.velocityBuffer = null;
        this.constraintBuffer = null;

        // 着色器程序
        this.computeProgram = null;
        this.constraintProgram = null;
        this.renderProgram = null;

        // 纹理用于 GPU 计算（如果不支持 Transform Feedback）
        this.particleTexture = null;
        this.velocityTexture = null;
        this.useTextureCompute = false;

        this.initShaders();
    }

    initShaders() {
        const gl = this.gl;

        // 顶点着色器 - 粒子更新（Verlet 积分）
        const particleUpdateVert = `#version 300 es
            precision highp float;

            // 输入：当前状态
            in vec2 a_position;      // 当前位置
            in vec2 a_oldPosition;   // 上一帧位置
            in vec2 a_force;         // 累积力
            in float a_mass;         // 质量
            in float a_pinned;       // 是否固定 (0 或 1)

            // 输出到下一个阶段
            out vec2 v_newPosition;
            out vec2 v_newOldPosition;

            uniform float u_dt;           // 时间步长
            uniform float u_damping;      // 阻尼系数
            uniform vec2 u_gravity;       // 重力加速度
            uniform vec2 u_bounds;        // 边界 (width, height)

            void main() {
                if (a_pinned > 0.5) {
                    // 固定点不移动
                    v_newPosition = a_position;
                    v_newOldPosition = a_position;
                } else {
                    // Verlet 积分
                    vec2 velocity = (a_position - a_oldPosition) * u_damping;
                    vec2 acceleration = (a_force + u_gravity * a_mass) / a_mass;

                    vec2 newPos = a_position + velocity + acceleration * u_dt * u_dt;

                    // 边界约束
                    if (newPos.y > u_bounds.y) {
                        newPos.y = u_bounds.y;
                    }

                    v_newPosition = newPos;
                    v_newOldPosition = a_position;
                }
            }
        `;

        // 片段着色器（Transform Feedback 模式下不需要，但必须提供）
        const dummyFrag = `#version 300 es
            precision highp float;
            out vec4 fragColor;
            void main() {
                fragColor = vec4(1.0);
            }
        `;

        // 约束求解（需要多次迭代，可能需要分离的 pass）
        const constraintVert = `#version 300 es
            precision highp float;

            in vec2 a_position;
            in float a_pinned;

            // 约束信息（通过 uniform 或纹理传递）
            uniform sampler2D u_constraintTex;
            uniform int u_constraintCount;

            out vec2 v_correctedPosition;

            void main() {
                // 这里简化处理，实际需要更复杂的约束求解
                v_correctedPosition = a_position;
            }
        `;

        // 检查是否支持 Transform Feedback
        const ext = gl.getExtension('EXT_transform_feedback');
        if (!ext) {
            console.warn('Transform Feedback 不支持，使用纹理反馈方式');
            this.useTextureCompute = true;
        }

        // 创建着色器程序
        this.computeProgram = this.createProgram(particleUpdateVert, dummyFrag,
            ['v_newPosition', 'v_newOldPosition']);
    }

    createProgram(vertSource, fragSource, transformFeedbackVaryings = null) {
        const gl = this.gl;

        const vertShader = this.compileShader(gl.VERTEX_SHADER, vertSource);
        const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fragSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);

        // 设置 Transform Feedback 输出
        if (transformFeedbackVaryings && !this.useTextureCompute) {
            gl.transformFeedbackVaryings(program, transformFeedbackVaryings, gl.INTERLEAVED_ATTRIBS);
        }

        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }

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

    // 从 CPU 布料系统迁移数据到 GPU
    uploadFromCPU(clothSystem) {
        const gl = this.gl;
        this.particles = clothSystem.particles;
        this.constraints = clothSystem.constraints;
        this.faces = clothSystem.faces;

        // 准备粒子数据
        const particleData = new Float32Array(this.particles.length * 6);
        this.particles.forEach((p, i) => {
            const offset = i * 6;
            particleData[offset + 0] = p.pos.x;
            particleData[offset + 1] = p.pos.y;
            particleData[offset + 2] = p.oldPos.x;
            particleData[offset + 3] = p.oldPos.y;
            particleData[offset + 4] = p.mass;
            particleData[offset + 5] = p.pinned ? 1.0 : 0.0;
        });

        // 创建 GPU 缓冲区
        this.particleBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, particleData, gl.DYNAMIC_DRAW);

        // 约束数据
        const constraintData = new Float32Array(this.constraints.length * 4);
        this.constraints.forEach((c, i) => {
            const offset = i * 4;
            const p1Index = this.particles.indexOf(c.p1);
            const p2Index = this.particles.indexOf(c.p2);
            constraintData[offset + 0] = p1Index;
            constraintData[offset + 1] = p2Index;
            constraintData[offset + 2] = c.restLength;
            constraintData[offset + 3] = c.broken ? 0.0 : c.stiffness;
        });

        this.constraintBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.constraintBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, constraintData, gl.STATIC_DRAW);
    }

    // GPU 更新一步
    updateGPU(dt, gravity, damping) {
        if (!this.computeProgram || !this.particleBuffer) return;

        const gl = this.gl;
        gl.useProgram(this.computeProgram);

        // 设置 uniforms
        const dtLoc = gl.getUniformLocation(this.computeProgram, 'u_dt');
        const dampingLoc = gl.getUniformLocation(this.computeProgram, 'u_damping');
        const gravityLoc = gl.getUniformLocation(this.computeProgram, 'u_gravity');
        const boundsLoc = gl.getUniformLocation(this.computeProgram, 'u_bounds');

        gl.uniform1f(dtLoc, dt);
        gl.uniform1f(dampingLoc, damping);
        gl.uniform2f(gravityLoc, 0, gravity);
        gl.uniform2f(boundsLoc, 800, 800);

        // 绑定输入属性
        // ... (需要详细的 VAO 设置)

        // 执行计算
        // gl.beginTransformFeedback(gl.POINTS);
        // gl.drawArrays(gl.POINTS, 0, this.particles.length);
        // gl.endTransformFeedback();
    }

    // 从 GPU 读回数据到 CPU（用于调试或混合渲染）
    readbackToCPU() {
        const gl = this.gl;
        const particleData = new Float32Array(this.particles.length * 6);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffer);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, particleData);

        this.particles.forEach((p, i) => {
            const offset = i * 6;
            p.pos.x = particleData[offset + 0];
            p.pos.y = particleData[offset + 1];
            p.oldPos.x = particleData[offset + 2];
            p.oldPos.y = particleData[offset + 3];
        });
    }
}
