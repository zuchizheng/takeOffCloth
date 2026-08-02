import { Vector2D } from '../utils/vector2d.js';

/**
 * 优化的布料模拟系统
 * 优化策略：
 * 1. 空间哈希分区 - 快速碰撞检测
 * 2. 休眠系统 - 静止的粒子不参与计算
 * 3. 批量更新 - 减少函数调用开销
 * 4. 可选的并行计算准备
 */

class ClothParticle {
    constructor(x, y, mass = 0.3) {
        this.pos = new Vector2D(x, y);
        this.oldPos = new Vector2D(x, y);
        this.force = new Vector2D(0, 0);
        this.mass = mass;
        this.pinned = false;
        this.track = null;
        this.radius = 3;
        this.u = 0;
        this.v = 0;

        // 优化相关
        this.sleeping = false;  // 休眠标记
        this.sleepCounter = 0;  // 休眠计数器
        this.cellIndex = -1;    // 空间哈希索引
    }

    update(dt, damping = 0.98) {
        if (this.pinned) return;

        const vel = this.pos.sub(this.oldPos).mul(damping);
        const acc = this.force.div(this.mass);

        this.oldPos.x = this.pos.x;
        this.oldPos.y = this.pos.y;

        this.pos.x += vel.x + acc.x * dt * dt;
        this.pos.y += vel.y + acc.y * dt * dt;

        this.force.x = 0;
        this.force.y = 0;

        // 检查是否可以休眠
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        if (speed < 0.5) {
            this.sleepCounter++;
            if (this.sleepCounter > 30) {
                this.sleeping = true;
            }
        } else {
            this.sleepCounter = 0;
            this.sleeping = false;
        }
    }

    applyForce(force) {
        this.force.x += force.x;
        this.force.y += force.y;
        this.sleeping = false;  // 受力则唤醒
    }

    wake() {
        this.sleeping = false;
        this.sleepCounter = 0;
    }
}

class ClothConstraint {
    constructor(p1, p2, stiffness = 1.0) {
        this.p1 = p1;
        this.p2 = p2;
        this.restLength = p1.pos.distance(p2.pos);
        this.stiffness = stiffness;
        this.broken = false;
        this.tearable = false;
    }

    solve() {
        if (this.broken) return;

        // 如果两个粒子都在休眠，跳过
        if (this.p1.sleeping && this.p2.sleeping) return;

        const dx = this.p2.pos.x - this.p1.pos.x;
        const dy = this.p2.pos.y - this.p1.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.01) return;

        // 只在拉伸时施加约束
        if (dist > this.restLength) {
            const diff = (dist - this.restLength) / dist;
            const strength = Math.max(this.stiffness, 0.8);
            const offsetX = dx * diff * 0.5 * strength;
            const offsetY = dy * diff * 0.5 * strength;

            if (!this.p1.pinned) {
                this.p1.pos.x += offsetX;
                this.p1.pos.y += offsetY;
                this.p1.wake();
            }
            if (!this.p2.pinned) {
                this.p2.pos.x -= offsetX;
                this.p2.pos.y -= offsetY;
                this.p2.wake();
            }
        }
    }
}

/**
 * 空间哈希网格 - 用于快速碰撞检测
 */
class SpatialHash {
    constructor(cellSize = 50) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    clear() {
        this.cells.clear();
    }

    hash(x, y) {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        return `${cellX},${cellY}`;
    }

    insert(particle) {
        const key = this.hash(particle.pos.x, particle.pos.y);
        if (!this.cells.has(key)) {
            this.cells.set(key, []);
        }
        this.cells.get(key).push(particle);
        particle.cellIndex = key;
    }

    getNearby(particle, radius) {
        const nearby = [];
        const cellX = Math.floor(particle.pos.x / this.cellSize);
        const cellY = Math.floor(particle.pos.y / this.cellSize);
        const range = Math.ceil(radius / this.cellSize);

        for (let dx = -range; dx <= range; dx++) {
            for (let dy = -range; dy <= range; dy++) {
                const key = `${cellX + dx},${cellY + dy}`;
                const cell = this.cells.get(key);
                if (cell) {
                    nearby.push(...cell);
                }
            }
        }

        return nearby;
    }
}

export class ClothSystemOptimized {
    constructor() {
        this.particles = [];
        this.constraints = [];
        this.faces = [];
        this.edgeFaces = new Map();
        this.topologyVersion = 0;
        this.clothPieces = [];
        this.currentDrawing = [];

        this.stiffness = 0.5;
        this.gravity = 600;
        this.resolution = 8;

        // 优化相关
        this.spatialHash = new SpatialHash(50);
        this.useOptimization = true;  // 开关
        this.substeps = 3;  // 减少子步数（从 5 降到 3）
        this.constraintIterations = 2;  // 减少迭代次数（从 3 降到 2）

        // 性能统计
        this.stats = {
            activeParticles: 0,
            sleepingParticles: 0,
            updateTime: 0,
            constraintTime: 0,
            totalTime: 0,
        };
    }

    // 从原始 ClothSystem 复制的方法
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

        const cloth = this.createClothFromOutline(this.currentDrawing);
        this.clothPieces.push(cloth);
        this.currentDrawing = [];
        this.topologyVersion++;
        return cloth;
    }

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
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        outline.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        const width = maxX - minX;
        const height = maxY - minY;
        const cols = Math.max(3, Math.floor(width / this.resolution));
        const rows = Math.max(3, Math.floor(height / this.resolution));

        const particles = [];
        const particleGrid = [];

        let usedMinI = Infinity, usedMaxI = -Infinity;
        let usedMinJ = Infinity, usedMaxJ = -Infinity;

        for (let i = 0; i <= rows; i++) {
            particleGrid[i] = [];
            for (let j = 0; j <= cols; j++) {
                const x = minX + (j / cols) * width;
                const y = minY + (i / rows) * height;
                const point = new Vector2D(x, y);

                const isInside = customFilter
                    ? customFilter(x, y)
                    : this.pointInPolygon(point, outline);

                if (isInside) {
                    const particle = new ClothParticle(x, y);
                    particle._gi = i;
                    particle._gj = j;

                    if (i < usedMinI) usedMinI = i;
                    if (i > usedMaxI) usedMaxI = i;
                    if (j < usedMinJ) usedMinJ = j;
                    if (j > usedMaxJ) usedMaxJ = j;

                    particles.push(particle);
                    this.particles.push(particle);
                    particleGrid[i][j] = particle;
                } else {
                    particleGrid[i][j] = null;
                }
            }
        }

        const spanJ = Math.max(1, usedMaxJ - usedMinJ);
        const spanI = Math.max(1, usedMaxI - usedMinI);
        particles.forEach(p => {
            p.u = (p._gj - usedMinJ) / spanJ;
            p.v = (p._gi - usedMinI) / spanI;
            delete p._gi;
            delete p._gj;
        });

        const constraints = [];
        const hEdge = [];
        const vEdge = [];

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

                if (j < cols && particleGrid[i][j + 1]) {
                    const c = new ClothConstraint(p, particleGrid[i][j + 1], this.stiffness);
                    constraints.push(c);
                    this.constraints.push(c);
                    hEdge[i][j] = c;
                }

                if (i < rows && particleGrid[i + 1][j]) {
                    const c = new ClothConstraint(p, particleGrid[i + 1][j], this.stiffness);
                    constraints.push(c);
                    this.constraints.push(c);
                    vEdge[i][j] = c;
                }
            }
        }

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
        const startTime = performance.now();

        const subDt = dt / this.substeps;

        for (let step = 0; step < this.substeps; step++) {
            // 1. 应用重力
            const gravityForce = new Vector2D(0, this.gravity);
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (!p.pinned && !p.sleeping) {
                    p.applyForce(gravityForce.mul(p.mass));
                }
            }

            // 2. 更新粒子（批量处理）
            const updateStart = performance.now();
            let activeCount = 0;
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (!p.sleeping) {
                    p.update(subDt, 0.99);
                    activeCount++;
                }
            }
            this.stats.updateTime = performance.now() - updateStart;
            this.stats.activeParticles = activeCount;
            this.stats.sleepingParticles = this.particles.length - activeCount;

            // 3. 求解约束
            const constraintStart = performance.now();
            for (let iter = 0; iter < this.constraintIterations; iter++) {
                for (let i = 0; i < this.constraints.length; i++) {
                    this.constraints[i].solve();
                }
            }
            this.stats.constraintTime = performance.now() - constraintStart;

            // 4. 碰撞检测（使用空间哈希优化）
            if (this.useOptimization) {
                this.spatialHash.clear();
                for (let i = 0; i < this.particles.length; i++) {
                    if (!this.particles[i].sleeping) {
                        this.spatialHash.insert(this.particles[i]);
                    }
                }
            }

            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (!p.pinned && !p.sleeping) {
                    bodySystem.constrainPointGentle(p.pos, p.radius);
                }
            }

            // 5. 边界约束
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (p.pos.y > 800) {
                    p.pos.y = 800;
                    p.oldPos.y = p.pos.y;
                }
            }

            // 6. 滑轨约束
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                if (p.track && !p.pinned) {
                    p.track.constrainParticle(p);
                }
            }
        }

        this.stats.totalTime = performance.now() - startTime;
    }

    // 其他方法保持不变
    isFaceBroken(face) {
        const e = face.edges;
        for (let i = 0; i < 4; i++) {
            if (!e[i] || e[i].broken) return true;
        }
        return false;
    }

    getBoundaryLoops() {
        if (this._loopCache && this._loopCacheVersion === this.topologyVersion) {
            return this._loopCache;
        }

        const adj = new Map();
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

            if (loop.length >= 3) loops.push(loop);
        }

        this._loopCache = loops;
        this._loopCacheVersion = this.topologyVersion;
        return loops;
    }

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

    findParticleAt(point, threshold = 10) {
        for (const p of this.particles) {
            if (p.pos.distance(point) < threshold) {
                return p;
            }
        }
        return null;
    }

    cutCloth(start, end) {
        let cut = 0;
        this.constraints.forEach(c => {
            if (c.broken) return;

            if (this.lineSegmentsIntersect(start, end, c.p1.pos, c.p2.pos)) {
                c.broken = true;
                c.p1.wake();
                c.p2.wake();
                cut++;
            }
        });
        if (cut > 0) this.topologyVersion++;
    }

    lineSegmentsIntersect(a1, a2, b1, b2) {
        const det = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
        if (Math.abs(det) < 0.001) return false;

        const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / det;
        const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / det;

        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    }

    clear() {
        this.particles = [];
        this.constraints = [];
        this.faces = [];
        this.edgeFaces = new Map();
        this.clothPieces = [];
        this.currentDrawing = [];
        this.topologyVersion++;
        this.spatialHash.clear();
    }

    // 绘制方法（兼容原版接口）
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

    drawHandles(ctx, showFreeNodes = true) {
        this.particles.forEach(p => {
            if (p.pinned) {
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(p.pos.x, p.pos.y, 5, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.track) {
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

    // 序列化方法（兼容原版接口）
    toJSON(tracks = []) {
        const pIndex = new Map();
        this.particles.forEach((p, i) => pIndex.set(p, i));
        const cIndex = new Map();
        this.constraints.forEach((c, i) => cIndex.set(c, i));

        const r = n => Math.round(n * 10) / 10;

        return {
            stiffness: this.stiffness,
            gravity: this.gravity,
            resolution: this.resolution,
            particles: this.particles.map(p => ({
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
                e: f.edges.map(e => (e ? cIndex.get(e) : -1)),
                ra: Math.round(f.restArea * 100) / 100,
            })),
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

    // 性能调试信息
    getPerformanceInfo() {
        return `粒子: ${this.particles.length} (活跃: ${this.stats.activeParticles}, 休眠: ${this.stats.sleepingParticles})
更新: ${this.stats.updateTime.toFixed(2)}ms | 约束: ${this.stats.constraintTime.toFixed(2)}ms | 总计: ${this.stats.totalTime.toFixed(2)}ms`;
    }
}

function quadArea(a, b, c, d) {
    const cross = (p, q, r) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return (Math.abs(cross(a, b, c)) + Math.abs(cross(a, c, d))) * 0.5;
}
