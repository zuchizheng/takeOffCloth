import { Vector2D } from '../utils/vector2d.js';

export class Capsule {
    constructor(start, end, radius) {
        this.start = start;  // Vector2D
        this.end = end;      // Vector2D
        this.radius = radius;
        this.selected = false;
        this.dragging = null; // null, 'start', 'end', or 'body'
    }

    draw(ctx) {
        ctx.save();

        // 绘制胶囊体
        ctx.strokeStyle = this.selected ? '#ff6600' : '#00ff00';
        ctx.fillStyle = this.selected ? 'rgba(255, 102, 0, 0.2)' : 'rgba(0, 255, 0, 0.1)';
        ctx.lineWidth = 2;

        // 绘制圆角矩形
        const dx = this.end.x - this.start.x;
        const dy = this.end.y - this.start.y;
        const angle = Math.atan2(dy, dx);
        const length = Math.sqrt(dx * dx + dy * dy);

        ctx.translate(this.start.x, this.start.y);
        ctx.rotate(angle);

        // 绘制主体矩形
        ctx.beginPath();
        ctx.rect(0, -this.radius, length, this.radius * 2);
        ctx.fill();
        ctx.stroke();

        // 绘制两端圆形
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(length, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();

        // 绘制控制点
        if (this.selected) {
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(this.start.x, this.start.y, 6, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(this.end.x, this.end.y, 6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    pointInside(point) {
        // 检查点是否在胶囊体内
        const dx = this.end.x - this.start.x;
        const dy = this.end.y - this.start.y;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            return point.distance(this.start) <= this.radius;
        }

        const t = Math.max(0, Math.min(1,
            ((point.x - this.start.x) * dx + (point.y - this.start.y) * dy) / lengthSq
        ));

        const projection = new Vector2D(
            this.start.x + t * dx,
            this.start.y + t * dy
        );

        return point.distance(projection) <= this.radius;
    }

    getClosestPoint(point) {
        // 获取线段上最近的点
        const dx = this.end.x - this.start.x;
        const dy = this.end.y - this.start.y;
        const lengthSq = dx * dx + dy * dy;

        if (lengthSq === 0) {
            return this.start.clone();
        }

        const t = Math.max(0, Math.min(1,
            ((point.x - this.start.x) * dx + (point.y - this.start.y) * dy) / lengthSq
        ));

        return new Vector2D(
            this.start.x + t * dx,
            this.start.y + t * dy
        );
    }

    hitTest(point, threshold = 10) {
        // 检测点击了哪个控制点
        if (point.distance(this.start) < threshold) {
            return 'start';
        }
        if (point.distance(this.end) < threshold) {
            return 'end';
        }
        if (this.pointInside(point)) {
            return 'body';
        }
        return null;
    }
}

export class BodySystem {
    constructor() {
        this.capsules = [];
        this.selectedCapsule = null;
        this.backgroundImage = null;
    }

    addCapsule(start, end, radius = 20) {
        const capsule = new Capsule(start, end, radius);
        this.capsules.push(capsule);
        return capsule;
    }

    removeCapsule(capsule) {
        const index = this.capsules.indexOf(capsule);
        if (index > -1) {
            this.capsules.splice(index, 1);
        }
    }

    loadImage(imageData) {
        this.backgroundImage = imageData;
    }

    draw(ctx) {
        // 绘制背景图片（保持原比例，居中显示）
        if (this.backgroundImage) {
            ctx.globalAlpha = 0.5;

            const img = this.backgroundImage;
            const canvasW = ctx.canvas.width;
            const canvasH = ctx.canvas.height;
            const imgRatio = img.width / img.height;
            const canvasRatio = canvasW / canvasH;

            let drawW, drawH, drawX, drawY;

            // 按照"包含"模式：图片完整显示，可能留白边
            // 如果想"覆盖"模式（填满画布，可能裁切图片），把 < 改成 >
            if (imgRatio < canvasRatio) {
                // 图片更窄，以高度为准
                drawH = canvasH;
                drawW = drawH * imgRatio;
                drawX = (canvasW - drawW) / 2;
                drawY = 0;
            } else {
                // 图片更宽，以宽度为准
                drawW = canvasW;
                drawH = drawW / imgRatio;
                drawX = 0;
                drawY = (canvasH - drawH) / 2;
            }

            ctx.drawImage(img, drawX, drawY, drawW, drawH);
            ctx.globalAlpha = 1.0;
        }

        // 绘制所有胶囊体
        this.capsules.forEach(capsule => capsule.draw(ctx));
    }

    selectAt(point) {
        this.selectedCapsule = null;
        for (let i = this.capsules.length - 1; i >= 0; i--) {
            const capsule = this.capsules[i];
            capsule.selected = false;
            const hit = capsule.hitTest(point);
            if (hit && !this.selectedCapsule) {
                capsule.selected = true;
                capsule.dragging = hit;
                this.selectedCapsule = capsule;
            }
        }
        return this.selectedCapsule;
    }

    dragSelected(point) {
        if (!this.selectedCapsule) return;

        if (this.selectedCapsule.dragging === 'start') {
            this.selectedCapsule.start = point.clone();
        } else if (this.selectedCapsule.dragging === 'end') {
            this.selectedCapsule.end = point.clone();
        } else if (this.selectedCapsule.dragging === 'body') {
            const dx = point.x - (this.selectedCapsule.start.x + this.selectedCapsule.end.x) / 2;
            const dy = point.y - (this.selectedCapsule.start.y + this.selectedCapsule.end.y) / 2;
            this.selectedCapsule.start.x += dx;
            this.selectedCapsule.start.y += dy;
            this.selectedCapsule.end.x += dx;
            this.selectedCapsule.end.y += dy;
        }
    }

    endDrag() {
        if (this.selectedCapsule) {
            this.selectedCapsule.dragging = null;
        }
    }

    // 供布料模拟系统调用的碰撞检测
    constrainPoint(point, radius = 0) {
        for (const capsule of this.capsules) {
            const closest = capsule.getClosestPoint(point);
            const dist = point.distance(closest);
            const minDist = capsule.radius + radius;

            if (dist < minDist && dist > 0.001) {
                const normal = point.sub(closest).normalize();
                const correction = normal.mul(minDist - dist);
                point.x += correction.x;
                point.y += correction.y;
            }
        }
    }

    // 背景图不在这里序列化：它是 Image 对象，由 scene.js 统一转成 dataURL
    toJSON() {
        return {
            capsules: this.capsules.map(c => ({
                start: [c.start.x, c.start.y],
                end: [c.end.x, c.end.y],
                radius: c.radius,
            })),
        };
    }

    fromJSON(data) {
        this.capsules = [];
        this.selectedCapsule = null;
        if (!data || !Array.isArray(data.capsules)) return;

        for (const c of data.capsules) {
            this.addCapsule(
                new Vector2D(c.start[0], c.start[1]),
                new Vector2D(c.end[0], c.end[1]),
                c.radius
            );
        }
    }

    // 更温和的碰撞检测 - 用于布料模拟
    constrainPointGentle(point, radius = 0) {
        for (const capsule of this.capsules) {
            const closest = capsule.getClosestPoint(point);
            const dist = point.distance(closest);
            const minDist = capsule.radius + radius;

            if (dist < minDist && dist > 0.001) {
                // 极低的推力，几乎让布料"垂"在身体上
                const pushRatio = 0.15;
                const normal = point.sub(closest).normalize();
                const correction = normal.mul((minDist - dist) * pushRatio);
                point.x += correction.x;
                point.y += correction.y;
            }
        }
    }
}
