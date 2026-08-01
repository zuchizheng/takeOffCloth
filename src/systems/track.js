import { Vector2D } from '../utils/vector2d.js';

/**
 * 滑轨 - 由一条折线定义的轨迹
 * 绑定到滑轨上的布料节点只能沿着折线移动，不能离开轨迹
 */
export class Track {
    constructor(points, friction = 0) {
        this.points = points.map(p => p.clone());
        this.friction = friction; // 0=顺滑无阻力，1=完全卡住
    }

    /**
     * 把一个点投影到折线上最近的位置
     * @returns {Vector2D} 折线上的最近点
     */
    projectPoint(point) {
        let best = this.points[0].clone();
        let bestDistSq = Infinity;

        for (let i = 0; i < this.points.length - 1; i++) {
            const a = this.points[i];
            const b = this.points[i + 1];
            const ab = b.sub(a);
            const lengthSq = ab.lengthSq();

            let t = 0;
            if (lengthSq > 0.0001) {
                t = point.sub(a).dot(ab) / lengthSq;
                t = Math.max(0, Math.min(1, t));
            }

            const projection = a.add(ab.mul(t));
            const distSq = point.distanceSq(projection);

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = projection;
            }
        }

        return best;
    }

    /**
     * 约束一个粒子到滑轨上
     * 同时投影当前位置和上一帧位置，这样残余速度是沿轨迹切线方向的，
     * 滑动才会顺滑，而不是被反复截断
     */
    constrainParticle(particle) {
        particle.pos = this.projectPoint(particle.pos);
        particle.oldPos = this.projectPoint(particle.oldPos);

        // 摩擦力：把 oldPos 朝 pos 拉近，等效于削减沿轨迹的速度
        // Verlet 积分用两帧位置差表示速度，缩短这个差值就是减速
        if (this.friction > 0) {
            const delta = particle.pos.sub(particle.oldPos);
            particle.oldPos = particle.pos.sub(delta.mul(1 - this.friction));
        }
    }

    draw(ctx) {
        if (this.points.length < 2) return;

        ctx.save();

        // 轨道底色（较粗的暗线）
        ctx.strokeStyle = 'rgba(120, 180, 255, 0.35)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length; i++) {
            ctx.lineTo(this.points[i].x, this.points[i].y);
        }
        ctx.stroke();

        // 轨道中心线
        ctx.strokeStyle = '#66aaff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < this.points.length; i++) {
            ctx.lineTo(this.points[i].x, this.points[i].y);
        }
        ctx.stroke();

        // 折点标记
        ctx.fillStyle = '#66aaff';
        this.points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.restore();
    }
}

/**
 * 滑轨系统 - 管理所有滑轨的创建和绘制
 */
export class TrackSystem {
    constructor() {
        this.tracks = [];
        this.currentDrawing = [];
        this.friction = 0.1; // 所有滑轨共用的摩擦力，可在 UI 中调节
    }

    /**
     * 统一设置所有滑轨的摩擦力（含之后新建的）
     */
    setFriction(friction) {
        this.friction = friction;
        this.tracks.forEach(track => { track.friction = friction; });
    }

    startDrawing() {
        this.currentDrawing = [];
    }

    addDrawingPoint(point) {
        this.currentDrawing.push(point.clone());
    }

    cancelDrawing() {
        this.currentDrawing = [];
    }

    finishDrawing() {
        // 滑轨至少需要两个点才能构成一段轨迹
        if (this.currentDrawing.length < 2) {
            this.currentDrawing = [];
            return null;
        }

        const track = new Track(this.currentDrawing, this.friction);
        this.tracks.push(track);
        this.currentDrawing = [];
        return track;
    }

    /**
     * 找到离指定点最近的滑轨
     */
    findNearestTrack(point, maxDistance = Infinity) {
        let nearest = null;
        let nearestDist = maxDistance;

        for (const track of this.tracks) {
            const dist = point.distance(track.projectPoint(point));
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = track;
            }
        }

        return nearest;
    }

    clear() {
        this.tracks = [];
        this.currentDrawing = [];
    }

    toJSON() {
        const r = n => Math.round(n * 10) / 10;
        return {
            friction: this.friction,
            tracks: this.tracks.map(t => ({
                points: t.points.map(p => [r(p.x), r(p.y)]),
                friction: t.friction,
            })),
        };
    }

    fromJSON(data) {
        this.tracks = [];
        this.currentDrawing = [];
        if (!data) return;

        if (typeof data.friction === 'number') this.friction = data.friction;
        for (const t of data.tracks || []) {
            this.tracks.push(new Track(
                t.points.map(p => new Vector2D(p[0], p[1])),
                typeof t.friction === 'number' ? t.friction : this.friction
            ));
        }
    }

    draw(ctx) {
        this.tracks.forEach(track => track.draw(ctx));

        // 绘制正在创建的滑轨
        if (this.currentDrawing.length > 0) {
            ctx.save();
            ctx.strokeStyle = '#66aaff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.currentDrawing[0].x, this.currentDrawing[0].y);
            this.currentDrawing.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();

            ctx.fillStyle = '#66aaff';
            this.currentDrawing.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }
    }
}
