// 材质系统：只负责布料外观渲染，不修改任何物理状态
// 读取 ClothSystem 的 faces（四边形面片 + UV + 静止面积）来着色

export const MATERIAL_PRESETS = {
    silk:    { label: '丝绸', baseColor: '#c94f7c', opacity: 0.95, sheen: 0.55, fold: 0.45 },
    cotton:  { label: '棉布', baseColor: '#e8e2d5', opacity: 1.00, sheen: 0.12, fold: 0.35 },
    denim:   { label: '牛仔', baseColor: '#3b5a7a', opacity: 1.00, sheen: 0.08, fold: 0.55 },
    leather: { label: '皮革', baseColor: '#4a2f23', opacity: 1.00, sheen: 0.40, fold: 0.50 },
    lace:    { label: '蕾丝', baseColor: '#f5f0f5', opacity: 0.45, sheen: 0.25, fold: 0.30 },
};

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return { r: 220, g: 220, b: 220 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export class MaterialSystem {
    constructor() {
        this.preset = 'cotton';
        this.baseColor = MATERIAL_PRESETS.cotton.baseColor;
        this.opacity = MATERIAL_PRESETS.cotton.opacity;
        this.sheen = MATERIAL_PRESETS.cotton.sheen;
        this.fold = MATERIAL_PRESETS.cotton.fold;

        this.texture = null;      // 原始 Image，精细模式直接采样
        this.texCanvas = null;    // 缩放后的离屏画布
        this.texData = null;      // ImageData，快速模式取色用
        this.texMode = 'fast';    // 'fast' = 每面片一个采样色 | 'fine' = 逐三角仿射贴图
        this.texToken = 0;        // 贴图变更计数，用于失效面片缓存

        this.renderMode = 'material'; // 'material' | 'wireframe' | 'both'
        this.showNodes = true;

        // 消除方格感：blur 抹平面片之间的色阶，smooth 拟合平滑轮廓
        this.blur = 3;    // 内部模糊半径(px)，轮廓不受影响
        this.smooth = 1;  // 轮廓样条张力，0=折线 1=Catmull-Rom

        // 厚度模拟：在正面下方绘制一层暗色偏移层，模拟布料边缘的厚度
        this.thickness = 2.5;      // 厚度偏移(px)
        this.thicknessDarken = 0.6; // 背面变暗系数 (0~1)

        this._rgb = hexToRgb(this.baseColor);
        this._buf = null; // 离屏缓冲区，惰性创建
    }

    setPreset(name) {
        const p = MATERIAL_PRESETS[name];
        if (!p) return;
        this.preset = name;
        this.baseColor = p.baseColor;
        this.opacity = p.opacity;
        this.sheen = p.sheen;
        this.fold = p.fold;
        this._rgb = hexToRgb(this.baseColor);
    }

    setBaseColor(hex) {
        this.baseColor = hex;
        this._rgb = hexToRgb(hex);
    }

    // 载入贴图。缩放到 512 以内做离屏副本，避免大图逐帧采样过慢
    loadTexture(img) {
        const MAX = 512;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const c = cv.getContext('2d');
        c.drawImage(img, 0, 0, w, h);

        this.texture = img;
        this.texCanvas = cv;
        this.texData = c.getImageData(0, 0, w, h);
        this.texToken++;
    }

    clearTexture() {
        this.texture = null;
        this.texCanvas = null;
        this.texData = null;
        this.texToken++;
    }

    toJSON() {
        return {
            preset: this.preset,
            baseColor: this.baseColor,
            opacity: this.opacity,
            sheen: this.sheen,
            fold: this.fold,
            blur: this.blur,
            smooth: this.smooth,
            thickness: this.thickness,
            thicknessDarken: this.thicknessDarken,
            texMode: this.texMode,
            renderMode: this.renderMode,
            showNodes: this.showNodes,
            // 存已缩放的副本（≤512）而不是原图，存档体积可控
            texture: this.texCanvas ? this.texCanvas.toDataURL('image/png') : null,
        };
    }

    // 贴图要等 Image 解码，所以是异步的
    async fromJSON(data) {
        if (!data) return;

        if (data.preset && MATERIAL_PRESETS[data.preset]) this.preset = data.preset;
        if (typeof data.baseColor === 'string') this.setBaseColor(data.baseColor);
        if (typeof data.opacity === 'number') this.opacity = data.opacity;
        if (typeof data.sheen === 'number') this.sheen = data.sheen;
        if (typeof data.fold === 'number') this.fold = data.fold;
        if (typeof data.blur === 'number') this.blur = data.blur;
        if (typeof data.smooth === 'number') this.smooth = data.smooth;
        if (typeof data.thickness === 'number') this.thickness = data.thickness;
        if (typeof data.thicknessDarken === 'number') this.thicknessDarken = data.thicknessDarken;
        if (data.texMode) this.texMode = data.texMode;
        if (data.renderMode) this.renderMode = data.renderMode;
        if (typeof data.showNodes === 'boolean') this.showNodes = data.showNodes;

        if (data.texture) {
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => { this.loadTexture(img); resolve(); };
                // 贴图坏了不该让整个读档失败，跳过就是纯色布料
                img.onerror = () => { this.clearTexture(); resolve(); };
                img.src = data.texture;
            });
        } else {
            this.clearTexture();
        }
    }

    // UV (0..1) 采样贴图像素
    sampleTexel(u, v) {
        const d = this.texData;
        if (!d) return this._rgb;
        const x = Math.min(d.width - 1, Math.max(0, Math.round(u * (d.width - 1))));
        const y = Math.min(d.height - 1, Math.max(0, Math.round(v * (d.height - 1))));
        const i = (y * d.width + x) * 4;
        return { r: d.data[i], g: d.data[i + 1], b: d.data[i + 2] };
    }

    /**
     * 根据面片当前形变算明暗系数。
     * 面积被压缩 => 这里堆叠出褶皱 => 压暗；被拉开 => 略微提亮。
     * 这是让布料看起来有体积感的关键，比真实光照便宜得多。
     */
    shadeFactor(areaRatio) {
        // areaRatio: 当前面积 / 初始面积
        const d = (areaRatio - 1) * this.fold;
        return clamp(1 + d, 1 - this.fold, 1 + this.sheen * 0.5);
    }

    // ---- 渲染入口 ----

    /**
     * @param opts.forceWireframe 编辑态下强制叠加网格，方便选节点，
     *        不改 renderMode 本身（切回游戏模式时用户设置还在）
     */
    render(ctx, clothSystem, opts = {}) {
        const showMaterial = this.renderMode === 'material' || this.renderMode === 'both';
        const showWire = this.renderMode === 'wireframe' || this.renderMode === 'both'
            || opts.forceWireframe;
        // 纯材质预览要保持干净：不露固定点红点、滑轨蓝点，也不画轨道
        const showRig = showWire || !!opts.forceWireframe;

        if (showMaterial) {
            this.renderFaces(ctx, clothSystem);
        }
        if (showWire) {
            // 材质之上叠网格时用半透明，免得盖住布面
            clothSystem.drawWireframe(ctx, showMaterial);
        }
        if (showRig && this.showNodes) {
            clothSystem.drawHandles(ctx, !showMaterial || !!opts.forceWireframe);
        }
        clothSystem.drawOutlinePreview(ctx);
    }

    // 轨道是否该画，由 main.js 询问后决定
    shouldShowRig(editing) {
        return this.renderMode === 'wireframe' || this.renderMode === 'both' || editing;
    }

    /**
     * 布料着色。
     * 直接逐面片平涂会看到一格一格的色块，所以改成两步：
     *   1. 用轮廓环拟合出平滑外形，作为 clip 区域（消掉锯齿边缘）
     *   2. 明暗/贴图画进离屏画布，合成时统一上一次模糊（消掉内部方格感）
     * 模糊只在合成那一步做一次，比逐面片加 filter 便宜得多。
     *
     * 厚度渲染：先画一层暗色偏移层（背面），再画正常的正面，模拟布料边缘厚度
     */
    renderFaces(ctx, clothSystem) {
        const faces = clothSystem.faces;
        if (!faces || faces.length === 0) return;

        const bb = clothSystem.getBounds();
        if (!bb) return;

        const loops = clothSystem.getBoundaryLoops();
        if (loops.length === 0) return;

        // thickness 偏移要算进包围盒，避免背面层被裁掉
        const thickPad = Math.ceil(this.thickness);
        const pad = 24 + thickPad; // 留出模糊扩散、描边和厚度偏移的余量
        const bx = Math.floor(bb.minX - pad);
        const by = Math.floor(bb.minY - pad);
        const bw = Math.ceil(bb.maxX - bb.minX + pad * 2);
        const bh = Math.ceil(bb.maxY - bb.minY + pad * 2);
        if (bw <= 0 || bh <= 0) return;

        const buf = this._ensureBuffer(bw, bh);
        if (!buf) return;
        const bctx = buf.ctx;

        bctx.setTransform(1, 0, 0, 1, 0, 0);
        bctx.clearRect(0, 0, buf.canvas.width, buf.canvas.height);
        // 之后都用世界坐标画，省得每处减一遍偏移
        bctx.setTransform(1, 0, 0, 1, -bx, -by);

        // 缓冲区里不裁剪，让颜色铺满整块。这样合成时的模糊在轮廓附近
        // 采到的是真实颜色，而不是把透明背景吸进来导致边缘发虚

        // 1. 先画背面层（厚度模拟）：整体偏移 + 变暗
        if (this.thickness > 0.1) {
            bctx.save();
            bctx.translate(this.thickness, this.thickness);
            this._paintFaces(bctx, clothSystem, faces, bb, this.thicknessDarken);
            bctx.restore();
        }

        // 2. 再画正面层（正常亮度）
        this._paintFaces(bctx, clothSystem, faces, bb, 1.0);

        ctx.save();
        ctx.globalAlpha = this.opacity;

        // 裁剪放在主画布：模糊只抹平布料内部的色阶，轮廓由 clip 保持锐利。
        // 之前把模糊加在整张缓冲的合成上，连边缘一起糊了，整体像失焦。
        // nonzero：多层布料重叠时正常遮挡，不会镂空；
        // 只有切出洞时才需要 evenodd（内外环相反缠绕）
        ctx.beginPath();
        for (const loop of loops) {
            traceSmooth(ctx, loop, this.smooth);
        }
        ctx.clip('nonzero');

        if (this.blur > 0.01 && typeof ctx.filter === 'string') {
            ctx.filter = `blur(${this.blur}px)`;
        }
        ctx.drawImage(buf.canvas, bx, by);
        ctx.restore(); // filter 属于画布状态，restore 会一起还原
    }

    // 把明暗和贴图画进缓冲区（调用方已设好坐标偏移，裁剪在主画布上做）
    // darkenFactor: 1.0=正常亮度，<1.0=变暗（用于背面层）
    _paintFaces(bctx, clothSystem, faces, bb, darkenFactor = 1.0) {
        const fine = this.texData && this.texMode === 'fine';
        const spanY = Math.max(1, bb.maxY - bb.minY);

        // 先铺一层底，避免面片缝隙露出透明
        const baseSample = this.texData
            ? this.sampleTexel(0.5, 0.5)
            : this._rgb;
        bctx.fillStyle = shadeToCss(baseSample, darkenFactor);
        bctx.fillRect(bb.minX - 24, bb.minY - 24,
            bb.maxX - bb.minX + 48, bb.maxY - bb.minY + 48);

        // 分离正面和背面，并计算深度（Y坐标的平均值）
        const backFaces = [];
        const frontFaces = [];

        for (const f of faces) {
            if (clothSystem.isFaceBroken(f)) continue;

            const [a, b, c, d] = f.p;
            const signedArea = quadAreaSigned(a.pos, b.pos, c.pos, d.pos);
            const area = Math.abs(signedArea);
            if (area < 0.5) continue; // 完全折叠，跳过

            const avgY = (a.pos.y + b.pos.y + c.pos.y + d.pos.y) / 4;
            const faceData = { face: f, signedArea, area, avgY };

            if (signedArea < 0) {
                backFaces.push(faceData);
            } else {
                frontFaces.push(faceData);
            }
        }

        // 先画背面（从后往前），再画正面（从后往前）
        // Y 值小的在上面，应该后画（覆盖下面的）
        backFaces.sort((a, b) => b.avgY - a.avgY); // 后面的先画
        frontFaces.sort((a, b) => b.avgY - a.avgY);

        // 渲染背面
        for (const fd of backFaces) {
            this._renderSingleFace(bctx, fd.face, fd.signedArea, fd.area, bb, spanY, darkenFactor, fine, 0.7);
        }

        // 渲染正面
        for (const fd of frontFaces) {
            this._renderSingleFace(bctx, fd.face, fd.signedArea, fd.area, bb, spanY, darkenFactor, fine, 1.0);
        }
    }

    // 渲染单个面片
    _renderSingleFace(bctx, f, signedArea, area, bb, spanY, darkenFactor, fine, backfaceFactor) {
        const [a, b, c, d] = f.p;

    // 渲染单个面片
    _renderSingleFace(bctx, f, signedArea, area, bb, spanY, darkenFactor, fine, backfaceFactor) {
        const [a, b, c, d] = f.p;

        let shade = this.shadeFactor(f.restArea > 0.01 ? area / f.restArea : 1);

        // 应用背面变暗系数
        shade *= backfaceFactor;

        // 光泽：上亮下暗的竖向渐变，逐面片算，避免整体叠加染到背景
        if (this.sheen > 0.01) {
            const cy = (a.pos.y + b.pos.y + c.pos.y + d.pos.y) / 4;
            const ny = (cy - bb.minY) / spanY; // 0=顶 1=底
            shade *= 1 + this.sheen * 0.22 * (1 - 2 * ny);
        }

        // 应用变暗系数（背面层用）
        shade *= darkenFactor;

        if (fine) {
            this.drawTexturedQuad(bctx, f, shade);
        } else {
            let col;
            if (this.texData) {
                // 面片中心 UV 采一次色，缓存起来（贴图不变则不重采）
                if (f._texToken !== this.texToken) {
                    f._sampled = this.sampleTexel(f.uc, f.vc);
                    f._texToken = this.texToken;
                }
                col = f._sampled;
            } else {
                col = this._rgb;
            }
            bctx.fillStyle = shadeToCss(col, shade);
            bctx.beginPath();
            bctx.moveTo(a.pos.x, a.pos.y);
            bctx.lineTo(b.pos.x, b.pos.y);
            bctx.lineTo(c.pos.x, c.pos.y);
            bctx.lineTo(d.pos.x, d.pos.y);
            bctx.closePath();
            bctx.fill();
            // 描边填掉面片之间的抗锯齿缝隙
            bctx.strokeStyle = bctx.fillStyle;
            bctx.lineWidth = 1;
            bctx.stroke();
        }
    }

    // 离屏缓冲区，按需扩容后复用，避免每帧新建 canvas
    _ensureBuffer(w, h) {
        if (typeof document === 'undefined') return null;
        if (!this._buf) {
            this._buf = { canvas: document.createElement('canvas'), ctx: null };
            this._buf.ctx = this._buf.canvas.getContext('2d');
        }
        const cv = this._buf.canvas;
        if (cv.width < w || cv.height < h) {
            cv.width = Math.max(cv.width, w);
            cv.height = Math.max(cv.height, h);
        }
        return this._buf;
    }

    // 精细模式：把四边形拆成两个三角形，各自做仿射贴图
    drawTexturedQuad(ctx, f, shade) {
        const [a, b, c, d] = f.p;
        this.drawTexturedTriangle(ctx,
            a.pos, b.pos, c.pos,
            f.uv[0], f.uv[1], f.uv[2], shade);
        this.drawTexturedTriangle(ctx,
            a.pos, c.pos, d.pos,
            f.uv[0], f.uv[2], f.uv[3], shade);
    }

    /**
     * 单个三角形仿射贴图。
     * 解出把 UV 三角映射到屏幕三角的 2x3 矩阵，clip 后 drawImage。
     */
    drawTexturedTriangle(ctx, p0, p1, p2, uv0, uv1, uv2, shade) {
        const tex = this.texCanvas;
        if (!tex) return;

        const tw = tex.width, th = tex.height;
        const x0 = uv0.u * tw, y0 = uv0.v * th;
        const x1 = uv1.u * tw, y1 = uv1.v * th;
        const x2 = uv2.u * tw, y2 = uv2.v * th;

        const den = x0 * (y2 - y1) - x1 * y2 + x2 * y1 + (x1 - x2) * y0;
        if (Math.abs(den) < 1e-6) return;

        // 屏幕 x 行和 y 行共用同一个 3x3 系数矩阵，只换右端项，
        // 所以两行写成完全同构的形式（.x <-> .y），避免符号写错
        const m11 = -(y0 * (p2.x - p1.x) - y1 * p2.x + y2 * p1.x + (y1 - y2) * p0.x) / den;
        const m12 = -(y0 * (p2.y - p1.y) - y1 * p2.y + y2 * p1.y + (y1 - y2) * p0.y) / den;
        const m21 = (x0 * (p2.x - p1.x) - x1 * p2.x + x2 * p1.x + (x1 - x2) * p0.x) / den;
        const m22 = (x0 * (p2.y - p1.y) - x1 * p2.y + x2 * p1.y + (x1 - x2) * p0.y) / den;
        const dx = (x0 * (y2 * p1.x - y1 * p2.x) + y0 * (x1 * p2.x - x2 * p1.x)
                    + (x2 * y1 - x1 * y2) * p0.x) / den;
        const dy = (x0 * (y2 * p1.y - y1 * p2.y) + y0 * (x1 * p2.y - x2 * p1.y)
                    + (x2 * y1 - x1 * y2) * p0.y) / den;

        ctx.save();
        // clip 路径从重心外扩 0.4px：相邻三角共享边的抗锯齿会露出发丝缝，
        // 让它们轻微重叠即可盖住
        const gx = (p0.x + p1.x + p2.x) / 3;
        const gy = (p0.y + p1.y + p2.y) / 3;
        const grow = (p) => {
            const dx0 = p.x - gx, dy0 = p.y - gy;
            const len = Math.hypot(dx0, dy0) || 1;
            const k = (len + 0.4) / len;
            return { x: gx + dx0 * k, y: gy + dy0 * k };
        };
        const e0 = grow(p0), e1 = grow(p1), e2 = grow(p2);

        ctx.beginPath();
        ctx.moveTo(e0.x, e0.y);
        ctx.lineTo(e1.x, e1.y);
        ctx.lineTo(e2.x, e2.y);
        ctx.closePath();
        ctx.clip();
        ctx.transform(m11, m12, m21, m22, dx, dy);
        ctx.drawImage(tex, 0, 0);

        // 明暗叠加在贴图之上
        if (shade < 0.995) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = `rgba(0,0,0,${clamp(1 - shade, 0, 0.85)})`;
            ctx.fillRect(
                Math.min(p0.x, p1.x, p2.x) - 1, Math.min(p0.y, p1.y, p2.y) - 1,
                Math.max(p0.x, p1.x, p2.x) - Math.min(p0.x, p1.x, p2.x) + 2,
                Math.max(p0.y, p1.y, p2.y) - Math.min(p0.y, p1.y, p2.y) + 2
            );
        } else if (shade > 1.005) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = `rgba(255,255,255,${clamp(shade - 1, 0, 0.5)})`;
            ctx.fillRect(
                Math.min(p0.x, p1.x, p2.x) - 1, Math.min(p0.y, p1.y, p2.y) - 1,
                Math.max(p0.x, p1.x, p2.x) - Math.min(p0.x, p1.x, p2.x) + 2,
                Math.max(p0.y, p1.y, p2.y) - Math.min(p0.y, p1.y, p2.y) + 2
            );
        }
        ctx.restore();
    }
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function shadeToCss(rgb, shade) {
    const r = clamp(Math.round(rgb.r * shade), 0, 255);
    const g = clamp(Math.round(rgb.g * shade), 0, 255);
    const b = clamp(Math.round(rgb.b * shade), 0, 255);
    return `rgb(${r},${g},${b})`;
}

/**
 * 用 Catmull-Rom 样条把轮廓粒子串成平滑闭合路径。
 * 直接 lineTo 相邻粒子的话，边缘就是一段段折线，看起来全是锯齿。
 * tension=0 退化为直连折线，=1 为标准 Catmull-Rom。
 */
function traceSmooth(ctx, loop, tension = 1) {
    const n = loop.length;
    if (n < 3) return;

    const P = (i) => loop[((i % n) + n) % n].pos;

    ctx.moveTo(P(0).x, P(0).y);

    if (tension <= 0.001) {
        for (let i = 1; i <= n; i++) ctx.lineTo(P(i).x, P(i).y);
        return;
    }

    // Catmull-Rom -> 三次贝塞尔：控制点为 p1 ± (p2-p0)/6 * tension
    const k = tension / 6;
    for (let i = 0; i < n; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        ctx.bezierCurveTo(
            p1.x + (p2.x - p0.x) * k, p1.y + (p2.y - p0.y) * k,
            p2.x - (p3.x - p1.x) * k, p2.y - (p3.y - p1.y) * k,
            p2.x, p2.y
        );
    }
    ctx.closePath();
}

// 四边形面积（叉积法，取绝对值以免翻面时变负）
function quadArea(a, b, c, d) {
    const cross = (p, q, r) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return (Math.abs(cross(a, b, c)) + Math.abs(cross(a, c, d))) * 0.5;
}

// 四边形带符号面积（用于判断正反面）
function quadAreaSigned(a, b, c, d) {
    const cross = (p, q, r) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return (cross(a, b, c) + cross(a, c, d)) * 0.5;
}
