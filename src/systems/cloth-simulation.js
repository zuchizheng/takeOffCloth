import { Vector2D } from '../utils/vector2d.js';

class ClothParticle {
    constructor(x, y, mass = 0.3) {
        this.pos = new Vector2D(x, y);
        this.oldPos = new Vector2D(x, y);
        this.force = new Vector2D(0, 0);
        this.mass = mass; // 进一步降低质量
        this.pinned = false;
        this.track = null; // 绑定的滑轨，非空时粒子只能沿轨迹移动
        this.radius = 3;
        // 贴图坐标，在建网格时按栅格位置写入。粒子形变时 UV 不变，
        // 所以贴图会跟着布料一起拉伸/折叠
        this.u = 0;
        this.v = 0;
    }

    update(dt, damping = 0.98) {
        if (this.pinned) return;

        const vel = this.pos.sub(this.oldPos).mul(damping);
        const acc = this.force.div(this.mass);

        this.oldPos = this.pos.clone();
        this.pos = this.pos.add(vel).add(acc.mul(dt * dt));

        this.force.set(0, 0);
    }

    applyForce(force) {
        this.force = this.force.add(force);
    }
}

class ClothConstraint {
    constructor(p1, p2, stiffness = 1.0) {
        this.p1 = p1;
        this.p2 = p2;
        this.restLength = p1.pos.distance(p2.pos);
        this.stiffness = stiffness;
        this.broken = false;
        this.tearable = false; // 默认不可撕裂，只有小刀能切开
    }

    solve() {
        if (this.broken) return;

        const delta = this.p2.pos.sub(this.p1.pos);
        const dist = delta.length();

        if (dist < 0.01) return; // 避免除零

        // 只在拉伸时施加约束，压缩时不管（布料不能被压缩但可以折叠）
        if (dist > this.restLength) {
            const diff = (dist - this.restLength) / dist;
            // 拉伸约束用较强的力，让布料结实
            const offset = delta.mul(diff * 0.5 * Math.max(this.stiffness, 0.8));

            if (!this.p1.pinned) {
                this.p1.pos = this.p1.pos.add(offset);
            }
            if (!this.p2.pinned) {
                this.p2.pos = this.p2.pos.sub(offset);
            }
        }
    }
}

export class ClothSystem {
    constructor() {
        this.particles = [];
        this.constraints = [];
        this.faces = [];       // 四边形面片，供材质系统着色用
        // 约束 -> 共享它的面片。用来判断某条边是不是轮廓边（只剩1个存活邻面）
        this.edgeFaces = new Map();
        // 拓扑版本号。只有建/删布料或切断约束时才变，用于缓存轮廓环
        this.topologyVersion = 0;
        this.clothPieces = []; // 每件衣服是一个粒子和约束的集合
        this.currentDrawing = [];
        this.stiffness = 0.5; // 稍微提高刚度保持形状
        this.gravity = 600; // 降低重力，避免布料被拉得太长
        this.resolution = 8; // 网格间距，越小越密（渲染更细腻但更吃性能）
    }

    startDrawing() {
        this.currentDrawing = [];
    }

    addDrawingPoint(point) {
        this.currentDrawing.push(point.clone());
    }

    finishDrawing() {
        if (this.currentDrawing.length < 3) {
            this.currentDrawing = [];
            return null;
        }

        // 创建衣服网格
        const cloth = this.createClothFromOutline(this.currentDrawing);
        this.clothPieces.push(cloth);
        this.currentDrawing = [];
        this.topologyVersion++;
        return cloth;
    }

    // 从外部轮廓创建布料（用于导入图片）
    createFromOutline(outline, resolution = null, customFilter = null) {
        const oldRes = this.resolution;
        if (resolution !== null) this.resolution = resolution;

        const cloth = this.createClothFromOutline(outline, customFilter);
        this.clothPieces.push(cloth);
        this.topologyVersion++;

        this.resolution = oldRes;
        return cloth;
    }

    createClothFromOutline(outline, customFilter = null) {
        // 计算边界框
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        outline.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        // 创建网格
        const width = maxX - minX;
        const height = maxY - minY;
        const cols = Math.max(3, Math.floor(width / this.resolution));
        const rows = Math.max(3, Math.floor(height / this.resolution));

        const particles = [];
        const particleGrid = [];

        // 记录实际落在轮廓内的网格范围。pointInPolygon 对边界是排他的，
        // 直接用 j/cols 当 UV 会让贴图的右侧和底部永远显示不出来
        let usedMinI = Infinity, usedMaxI = -Infinity;
        let usedMinJ = Infinity, usedMaxJ = -Infinity;

        // 创建粒子网格
        for (let i = 0; i <= rows; i++) {
            particleGrid[i] = [];
            for (let j = 0; j <= cols; j++) {
                const x = minX + (j / cols) * width;
                const y = minY + (i / rows) * height;
                const point = new Vector2D(x, y);

                // 使用自定义过滤器（图片遮罩）或默认的轮廓检测
                const isInside = customFilter
                    ? customFilter(x, y)
                    : this.pointInPolygon(point, outline);

                if (isInside) {
                    const particle = new ClothParticle(x, y);
                    // 先存网格下标，等占用范围确定后再归一化成 UV
                    particle._gi = i;
                    particle._gj = j;

                    if (i < usedMinI) usedMinI = i;
                    if (i > usedMaxI) usedMaxI = i;
                    if (j < usedMinJ) usedMinJ = j;
                    if (j > usedMaxJ) usedMaxJ = j;

                    // 默认不固定任何点，让用户自己选择
                    // 用户可以在"固定点模式"中手动固定

                    particles.push(particle);
                    this.particles.push(particle);
                    particleGrid[i][j] = particle;
                } else {
                    particleGrid[i][j] = null;
                }
            }
        }

        // UV 在建网格时烘死，之后布料怎么形变贴图都跟着走
        const spanJ = Math.max(1, usedMaxJ - usedMinJ);
        const spanI = Math.max(1, usedMaxI - usedMinI);
        particles.forEach(p => {
            p.u = (p._gj - usedMinJ) / spanJ;
            p.v = (p._gi - usedMinI) / spanI;
            delete p._gi;
            delete p._gj;
        });

        // 创建约束，同时记下每条边的引用，供面片判断是否被切断
        const constraints = [];
        const hEdge = []; // hEdge[i][j] = (i,j)-(i,j+1) 水平边
        const vEdge = []; // vEdge[i][j] = (i,j)-(i+1,j) 垂直边

        for (let i = 0; i <= rows; i++) {
            hEdge[i] = [];
            vEdge[i] = [];
            for (let j = 0; j <= cols; j++) {
                hEdge[i][j] = null;
                vEdge[i][j] = null;
            }
        }

        for (let i = 0; i <= rows; i++) {
            for (let j = 0; j <= cols; j++) {
                const p = particleGrid[i][j];
                if (!p) continue;

                // 水平约束
                if (j < cols && particleGrid[i][j + 1]) {
                    const c = new ClothConstraint(p, particleGrid[i][j + 1], this.stiffness);
                    constraints.push(c);
                    this.constraints.push(c);
                    hEdge[i][j] = c;
                }

                // 垂直约束
                if (i < rows && particleGrid[i + 1][j]) {
                    const c = new ClothConstraint(p, particleGrid[i + 1][j], this.stiffness);
                    constraints.push(c);
                    this.constraints.push(c);
                    vEdge[i][j] = c;
                }

                // 不添加对角约束和弯曲约束，让布料更自由下垂
            }
        }

        // 构建面片：四角粒子齐全才成面，并挂上四条边用于切割判定
        const faces = [];
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const a = particleGrid[i][j];
                const b = particleGrid[i][j + 1];
                const c = particleGrid[i + 1][j + 1];
                const d = particleGrid[i + 1][j];
                if (!a || !b || !c || !d) continue;

                const face = {
                    p: [a, b, c, d],
                    uv: [
                        { u: a.u, v: a.v },
                        { u: b.u, v: b.v },
                        { u: c.u, v: c.v },
                        { u: d.u, v: d.v },
                    ],
                    // 中心 UV，快速模式取一次色用
                    uc: (a.u + b.u + c.u + d.u) / 4,
                    vc: (a.v + b.v + c.v + d.v) / 4,
                    edges: [hEdge[i][j], vEdge[i][j + 1], hEdge[i + 1][j], vEdge[i][j]],
                    restArea: 0,
                    _texToken: -1,
                    _sampled: null,
                };
                face.restArea = quadArea(a.pos, b.pos, c.pos, d.pos);
                faces.push(face);
                this.faces.push(face);

                // 登记每条边被哪些面片共用
                for (const e of face.edges) {
                    if (!e) continue;
                    let list = this.edgeFaces.get(e);
                    if (!list) {
                        list = [];
                        this.edgeFaces.set(e, list);
                    }
                    list.push(face);
                }
            }
        }

        return {
            particles,
            constraints,
            faces,
            outline: outline.map(p => p.clone())
        };
    }

    pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    update(dt, bodySystem) {
        const subSteps = 5; // 增加子步数，提高稳定性
        const subDt = dt / subSteps;

        for (let step = 0; step < subSteps; step++) {
            // 应用重力
            this.particles.forEach(p => {
                if (!p.pinned) {
                    p.applyForce(new Vector2D(0, this.gravity * p.mass));
                }
            });

            // 更新粒子 - 提高阻尼防止过度拉伸
            this.particles.forEach(p => p.update(subDt, 0.99));

            // 求解约束 - 增加迭代次数，保持布料形状
            for (let i = 0; i < 3; i++) {
                this.constraints.forEach(c => c.solve());
            }

            // 碰撞检测（与身体胶囊体）
            this.particles.forEach(p => {
                if (!p.pinned) {
                    bodySystem.constrainPointGentle(p.pos, p.radius);
                }
            });

            // 边界约束
            this.particles.forEach(p => {
                if (p.pos.y > 800) {
                    p.pos.y = 800;
                    p.oldPos.y = p.pos.y;
                }
            });

            // 滑轨约束 - 最后执行，确保滑轨节点严格贴合轨迹
            this.particles.forEach(p => {
                if (p.track && !p.pinned) {
                    p.track.constrainParticle(p);
                }
            });
        }
    }

    // 面片的四条边任意一条被切断，就不再渲染这个面（切口处会露出缺口）
    isFaceBroken(face) {
        const e = face.edges;
        for (let i = 0; i < 4; i++) {
            if (!e[i] || e[i].broken) return true;
        }
        return false;
    }

    /**
     * 提取布料的轮廓环（顺着边界首尾相接的粒子序列）。
     * 判据：一条边如果只被 1 个存活面片共用，它就在轮廓上。
     * 拓扑只在建布料/切割时变，所以结果按 topologyVersion 缓存，
     * 每帧只是拿着同一批粒子读新坐标，不重新走图。
     */
    getBoundaryLoops() {
        if (this._loopCache && this._loopCacheVersion === this.topologyVersion) {
            return this._loopCache;
        }

        // 收集轮廓边
        const adj = new Map(); // particle -> [neighbour particles]
        const link = (a, b) => {
            let l = adj.get(a);
            if (!l) { l = []; adj.set(a, l); }
            l.push(b);
        };

        for (const [edge, sharers] of this.edgeFaces) {
            if (edge.broken) continue;
            let alive = 0;
            for (const f of sharers) {
                if (!this.isFaceBroken(f)) alive++;
            }
            if (alive === 1) {
                link(edge.p1, edge.p2);
                link(edge.p2, edge.p1);
            }
        }

        // 把轮廓边串成环。正常情况每个粒子度为 2；
        // 撕裂后可能出现度 1 或 3，用贪心走法兜住，不追求完美
        const loops = [];
        const visited = new Set();

        for (const start of adj.keys()) {
            if (visited.has(start)) continue;

            const loop = [];
            let cur = start;
            let prev = null;

            while (cur && !visited.has(cur)) {
                visited.add(cur);
                loop.push(cur);

                const nbrs = adj.get(cur) || [];
                let next = null;
                for (const n of nbrs) {
                    if (n !== prev && !visited.has(n)) { next = n; break; }
                }
                prev = cur;
                cur = next;
            }

            // 少于3点连不成面，丢掉
            if (loop.length >= 3) loops.push(loop);
        }

        this._loopCache = loops;
        this._loopCacheVersion = this.topologyVersion;
        return loops;
    }

    // 布料整体包围盒，材质系统画高光渐变时需要
    getBounds() {
        if (this.particles.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of this.particles) {
            if (p.pos.x < minX) minX = p.pos.x;
            if (p.pos.y < minY) minY = p.pos.y;
            if (p.pos.x > maxX) maxX = p.pos.x;
            if (p.pos.y > maxY) maxY = p.pos.y;
        }
        return { minX, minY, maxX, maxY };
    }

    // 完整绘制（无材质系统时的回退路径）
    draw(ctx) {
        this.drawWireframe(ctx);
        this.drawHandles(ctx);
        this.drawOutlinePreview(ctx);
    }

    drawWireframe(ctx, overlay = false) {
        ctx.save();
        ctx.strokeStyle = overlay ? 'rgba(255,255,255,0.25)' : '#888';
        ctx.lineWidth = 1;
        this.constraints.forEach(c => {
            if (!c.broken) {
                ctx.beginPath();
                ctx.moveTo(c.p1.pos.x, c.p1.pos.y);
                ctx.lineTo(c.p2.pos.x, c.p2.pos.y);
                ctx.stroke();
            }
        });
        ctx.restore();
    }

    // 固定点 / 滑轨节点的可视标记。有材质时自由点不再画，避免糊在布面上
    drawHandles(ctx, showFreeNodes = true) {
        this.particles.forEach(p => {
            if (p.pinned) {
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(p.pos.x, p.pos.y, 5, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.track) {
                // 滑轨节点用蓝色方块区分
                ctx.fillStyle = '#3399ff';
                ctx.fillRect(p.pos.x - 4, p.pos.y - 4, 8, 8);
                ctx.strokeStyle = '#aaddff';
                ctx.lineWidth = 1;
                ctx.strokeRect(p.pos.x - 4, p.pos.y - 4, 8, 8);
            } else if (showFreeNodes) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(p.pos.x, p.pos.y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        });
    }

    // 正在绘制中的衣服轮廓
    drawOutlinePreview(ctx) {
        if (this.currentDrawing.length === 0) return;

        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.currentDrawing[0].x, this.currentDrawing[0].y);
        this.currentDrawing.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();

        ctx.fillStyle = '#ffff00';
        this.currentDrawing.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    clear() {
        this.particles = [];
        this.constraints = [];
        this.faces = [];
        this.edgeFaces = new Map();
        this.clothPieces = [];
        this.currentDrawing = [];
        this.topologyVersion++;
    }

    /**
     * 序列化整个布料状态，含形变后的位置和切割痕迹
     * 引用关系（面片->约束、粒子->滑轨）全部转成索引，读取时再接回去
     * @param {Track[]} tracks 滑轨数组，用于把 particle.track 转成下标
     */
    toJSON(tracks = []) {
        const pIndex = new Map();
        this.particles.forEach((p, i) => pIndex.set(p, i));
        const cIndex = new Map();
        this.constraints.forEach((c, i) => cIndex.set(c, i));

        // 位置保留一位小数：够精确，文件小很多
        const r = n => Math.round(n * 10) / 10;

        return {
            stiffness: this.stiffness,
            gravity: this.gravity,
            resolution: this.resolution,
            particles: this.particles.map(p => ({
                // pos 和 oldPos 都存，速度才能延续，读档不会突然静止或抽一下
                p: [r(p.pos.x), r(p.pos.y)],
                o: [r(p.oldPos.x), r(p.oldPos.y)],
                m: p.mass,
                pin: p.pinned ? 1 : 0,
                uv: [Math.round(p.u * 1e4) / 1e4, Math.round(p.v * 1e4) / 1e4],
                tk: p.track ? tracks.indexOf(p.track) : -1,
            })),
            constraints: this.constraints.map(c => ({
                a: pIndex.get(c.p1),
                b: pIndex.get(c.p2),
                r: Math.round(c.restLength * 100) / 100,
                s: c.stiffness,
                brk: c.broken ? 1 : 0,
                t: c.tearable ? 1 : 0,
            })),
            faces: this.faces.map(f => ({
                p: f.p.map(p => pIndex.get(p)),
                uv: f.uv.map(t => [Math.round(t.u * 1e4) / 1e4, Math.round(t.v * 1e4) / 1e4]),
                uc: Math.round(f.uc * 1e4) / 1e4,
                vc: Math.round(f.vc * 1e4) / 1e4,
                // 缺边（网格边界）存 -1
                e: f.edges.map(e => (e ? cIndex.get(e) : -1)),
                ra: Math.round(f.restArea * 100) / 100,
            })),
            // 每件衣服只存成员下标，重建后再映射回对象
            pieces: this.clothPieces.map(piece => ({
                particles: piece.particles.map(p => pIndex.get(p)),
                constraints: piece.constraints.map(c => cIndex.get(c)),
                faces: piece.faces.map(f => this.faces.indexOf(f)),
                outline: piece.outline.map(p => [r(p.x), r(p.y)]),
            })),
        };
    }

    fromJSON(data, tracks = []) {
        this.clear();
        if (!data) return;

        if (typeof data.stiffness === 'number') this.stiffness = data.stiffness;
        if (typeof data.gravity === 'number') this.gravity = data.gravity;
        if (typeof data.resolution === 'number') this.resolution = data.resolution;

        for (const d of data.particles || []) {
            const p = new ClothParticle(d.p[0], d.p[1], d.m);
            p.oldPos = new Vector2D(d.o[0], d.o[1]);
            p.pinned = !!d.pin;
            p.u = d.uv[0];
            p.v = d.uv[1];
            p.track = d.tk >= 0 && d.tk < tracks.length ? tracks[d.tk] : null;
            this.particles.push(p);
        }

        for (const d of data.constraints || []) {
            const c = new ClothConstraint(this.particles[d.a], this.particles[d.b], d.s);
            // restLength 用存档值，不重算：布料存档时是形变状态，
            // 重算会把当前拉伸长度当成静止长度，布料就永久变形了
            c.restLength = d.r;
            c.broken = !!d.brk;
            c.tearable = !!d.t;
            this.constraints.push(c);
        }

        for (const d of data.faces || []) {
            const face = {
                p: d.p.map(i => this.particles[i]),
                uv: d.uv.map(t => ({ u: t[0], v: t[1] })),
                uc: d.uc,
                vc: d.vc,
                edges: d.e.map(i => (i >= 0 ? this.constraints[i] : null)),
                restArea: d.ra,
                _texToken: -1,
                _sampled: null,
            };
            this.faces.push(face);

            for (const e of face.edges) {
                if (!e) continue;
                let list = this.edgeFaces.get(e);
                if (!list) {
                    list = [];
                    this.edgeFaces.set(e, list);
                }
                list.push(face);
            }
        }

        this.clothPieces = (data.pieces || []).map(d => ({
            particles: d.particles.map(i => this.particles[i]),
            constraints: d.constraints.map(i => this.constraints[i]),
            faces: d.faces.map(i => this.faces[i]),
            outline: d.outline.map(p => new Vector2D(p[0], p[1])),
        }));

        this.topologyVersion++;
    }

    findParticleAt(point, threshold = 10) {
        for (const p of this.particles) {
            if (p.pos.distance(point) < threshold) {
                return p;
            }
        }
        return null;
    }

    cutCloth(start, end) {
        // 切割布料 - 断开与切割线相交的约束
        let cut = 0;
        this.constraints.forEach(c => {
            if (c.broken) return;

            if (this.lineSegmentsIntersect(
                start, end,
                c.p1.pos, c.p2.pos
            )) {
                c.broken = true;
                cut++;
            }
        });
        // 切断了边就意味着轮廓变了，让缓存失效
        if (cut > 0) this.topologyVersion++;
    }

    lineSegmentsIntersect(a1, a2, b1, b2) {
        const det = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
        if (Math.abs(det) < 0.001) return false;

        const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / det;
        const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / det;

        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }
}

// 四边形面积（拆两个三角取叉积，绝对值以免翻面时变负）
function quadArea(a, b, c, d) {
    const cross = (p, q, r) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return (Math.abs(cross(a, b, c)) + Math.abs(cross(a, c, d))) * 0.5;
}
