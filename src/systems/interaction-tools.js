import { Vector2D } from '../utils/vector2d.js';

export class InteractionTools {
    constructor(clothSystem, bodySystem) {
        this.clothSystem = clothSystem;
        this.bodySystem = bodySystem;
        this.currentTool = 'hand';
        this.grabbedParticle = null;
        this.isMouseDown = false;
        this.mousePos = new Vector2D(0, 0);
        this.lastMousePos = new Vector2D(0, 0);
        this.windForce = new Vector2D(0, 0);
        this.windRadius = 100;
        this.windStrength = 50000;
    }

    setTool(tool) {
        this.currentTool = tool;
        this.grabbedParticle = null;
        this.isMouseDown = false;
    }

    // 读档时清空中间状态，避免抓着上个场景的粒子不放
    reset() {
        this.grabbedParticle = null;
        this.isMouseDown = false;
        this.lastMousePos = this.mousePos.clone();
    }

    onMouseDown(point) {
        this.mousePos = point.clone();
        this.lastMousePos = point.clone();
        this.isMouseDown = true;

        if (this.currentTool === 'hand') {
            // 抓取最近的布料粒子
            this.grabbedParticle = this.clothSystem.findParticleAt(point, 15);
            if (this.grabbedParticle) {
                // 记住原本是否已固定，松手时恢复，避免把固定点变成自由点
                this.wasPinned = this.grabbedParticle.pinned;
                // 滑轨节点不设 pinned，否则会绕过轨迹约束
                if (!this.grabbedParticle.track) {
                    this.grabbedParticle.pinned = true;
                }
            }
        }
    }

    onMouseMove(point) {
        this.lastMousePos = this.mousePos.clone();
        this.mousePos = point.clone();

        if (this.currentTool === 'hand' && this.grabbedParticle) {
            const p = this.grabbedParticle;
            if (p.track) {
                // 滑轨节点：把鼠标位置投影到轨迹上，只能顺着滑槽拖动
                const target = p.track.projectPoint(point);
                p.pos = target;
                p.oldPos = target.clone();
            } else {
                p.pos = point.clone();
                p.oldPos = point.clone();
            }
        } else if (this.currentTool === 'knife') {
            // 只有按住鼠标左键时才切割布料
            if (this.isMouseDown && this.lastMousePos.distance(this.mousePos) > 3) {
                this.clothSystem.cutCloth(this.lastMousePos, this.mousePos);
            }
        } else if (this.currentTool === 'wind') {
            // 计算风力方向
            const delta = this.mousePos.sub(this.lastMousePos);
            if (delta.length() > 1) {
                this.windForce = delta.normalize().mul(this.windStrength);
            }
        }
    }

    onMouseUp() {
        this.isMouseDown = false;

        if (this.currentTool === 'hand' && this.grabbedParticle) {
            // 恢复抓取前的固定状态
            this.grabbedParticle.pinned = this.wasPinned === true;
            this.grabbedParticle = null;
            this.wasPinned = false;
        }
    }

    update() {
        if (this.currentTool === 'wind') {
            // 对范围内的粒子施加风力
            this.clothSystem.particles.forEach(p => {
                if (p.pinned) return;

                const dist = p.pos.distance(this.mousePos);
                if (dist < this.windRadius) {
                    const strength = 1 - (dist / this.windRadius);
                    p.applyForce(this.windForce.mul(strength));
                }
            });

            // 风力衰减
            this.windForce = this.windForce.mul(0.95);
        }
    }

    draw(ctx) {
        if (this.currentTool === 'hand' && this.grabbedParticle) {
            // 绘制抓取线
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.mousePos.x, this.mousePos.y);
            ctx.lineTo(this.grabbedParticle.pos.x, this.grabbedParticle.pos.y);
            ctx.stroke();

            // 绘制抓取点
            ctx.fillStyle = '#ffff00';
            ctx.beginPath();
            ctx.arc(this.grabbedParticle.pos.x, this.grabbedParticle.pos.y, 6, 0, Math.PI * 2);
            ctx.fill();
        } else if (this.currentTool === 'knife') {
            if (this.isMouseDown) {
                // 按住时绘制红色切割轨迹
                ctx.strokeStyle = '#ff0000';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(this.lastMousePos.x, this.lastMousePos.y);
                ctx.lineTo(this.mousePos.x, this.mousePos.y);
                ctx.stroke();
            } else {
                // 未按住时显示刀尖指示（小十字）
                ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(this.mousePos.x - 8, this.mousePos.y);
                ctx.lineTo(this.mousePos.x + 8, this.mousePos.y);
                ctx.moveTo(this.mousePos.x, this.mousePos.y - 8);
                ctx.lineTo(this.mousePos.x, this.mousePos.y + 8);
                ctx.stroke();
            }
        } else if (this.currentTool === 'wind') {
            // 绘制风场范围
            ctx.strokeStyle = '#00ffff';
            ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.mousePos.x, this.mousePos.y, this.windRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // 绘制风力方向
            if (this.windForce.length() > 100) {
                const dir = this.windForce.normalize().mul(50);
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(this.mousePos.x, this.mousePos.y);
                ctx.lineTo(this.mousePos.x + dir.x, this.mousePos.y + dir.y);
                ctx.stroke();

                // 箭头
                const angle = Math.atan2(dir.y, dir.x);
                ctx.save();
                ctx.translate(this.mousePos.x + dir.x, this.mousePos.y + dir.y);
                ctx.rotate(angle);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(-10, -5);
                ctx.lineTo(-10, 5);
                ctx.closePath();
                ctx.fillStyle = '#00ffff';
                ctx.fill();
                ctx.restore();
            }
        }
    }
}
