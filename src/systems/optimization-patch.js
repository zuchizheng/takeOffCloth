/**
 * 一键启用 WebGL 加速优化
 *
 * 使用方法：
 * 1. 在 main.js 开头添加：import './optimization-patch.js';
 * 2. 刷新页面即可自动启用优化
 *
 * 或者直接按照下面的说明手动修改 main.js
 */

// ============================================
// 自动补丁（实验性）
// ============================================

// 注意：此文件提供自动补丁功能，但推荐手动集成以获得更好的控制

export function applyOptimizations(game) {
    console.log('[优化] 正在应用 WebGL 加速...');

    // 1. 替换布料系统为优化版本
    if (typeof ClothSystemOptimized !== 'undefined') {
        const oldSystem = game.clothSystem;
        game.clothSystem = new ClothSystemOptimized();

        // 复制配置
        game.clothSystem.stiffness = oldSystem.stiffness;
        game.clothSystem.gravity = oldSystem.gravity;
        game.clothSystem.resolution = oldSystem.resolution;

        console.log('[优化] ✓ 已切换到优化的布料系统');
    }

    // 2. 创建 WebGL 渲染器
    if (typeof ClothRendererWebGL !== 'undefined') {
        game.webglRenderer = new ClothRendererWebGL(game.canvas);
        game.useWebGL = game.webglRenderer.gl !== null;

        if (game.useWebGL) {
            console.log('[优化] ✓ WebGL 渲染器已启用');
        } else {
            console.warn('[优化] ⚠ WebGL2 不支持，使用 Canvas 2D 回退');
        }
    }

    // 3. 劫持原有的 draw 方法
    const originalDraw = game.draw.bind(game);
    game.draw = function() {
        if (this.useWebGL && this.webglRenderer) {
            // 使用 WebGL 渲染
            this.webglDrawOptimized();
        } else {
            // 使用原版渲染
            originalDraw();
        }
    };

    // 4. 添加优化的绘制方法
    game.webglDrawOptimized = function() {
        const gl = this.webglRenderer.gl;

        // 清空背景（使用 WebGL）
        this.webglRenderer.beginFrame();

        // 绘制身体系统（仍使用 Canvas 2D，因为它不是性能瓶颈）
        this.ctx.save();
        this.bodySystem.draw(this.ctx);
        this.ctx.restore();

        const editing = this.mode === 'edit-cloth';

        // 绘制滑轨
        if (this.materialSystem.shouldShowRig && this.materialSystem.shouldShowRig(editing)) {
            this.trackSystem.draw(this.ctx);
        }

        // 使用 WebGL 绘制布料
        if (this.clothSystem.faces.length > 0) {
            // 渲染面片
            if (this.materialSystem.renderMode !== 'wireframe') {
                this.webglRenderer.renderFaces(this.clothSystem.faces);
            }

            // 渲染线框
            if (this.materialSystem.renderMode === 'wireframe' ||
                this.materialSystem.renderMode === 'both' || editing) {
                this.webglRenderer.renderConstraints(this.clothSystem.constraints);
            }

            // 渲染粒子
            if ((this.materialSystem.showNodes || editing) && this.clothSystem.particles.length < 5000) {
                this.webglRenderer.renderParticles(this.clothSystem.particles);
            }
        }

        // 其他 Canvas 2D 绘制（工具、提示等）
        if (this.mode === 'play') {
            this.interactionTools.draw(this.ctx);
        }

        // 临时胶囊体
        if (this.mode === 'edit-body' && this.capsuleStart && this.isAddingCapsule && this.currentMousePos) {
            this.ctx.strokeStyle = '#ffff00';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(this.capsuleStart.x, this.capsuleStart.y);
            this.ctx.lineTo(this.currentMousePos.x, this.currentMousePos.y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // 绘制提示
        this.drawHints();

        // 性能统计
        if (this.clothSystem.getPerformanceInfo) {
            this.ctx.fillStyle = '#00ff00';
            this.ctx.font = '11px monospace';
            this.ctx.fillText(this.clothSystem.getPerformanceInfo(), 10, this.canvas.height - 10);
        }
    };

    console.log('[优化] ✓ 所有优化已应用');
    console.log('[优化] 粒子数超过 1000 时性能提升明显');
}

// ============================================
// 手动集成指南
// ============================================

export const MANUAL_INTEGRATION_GUIDE = `
手动集成 WebGL 优化（推荐）
====================================

1. 修改 src/main.js 文件顶部的导入部分：

   // 添加新的导入
   import { ClothSystemOptimized } from './systems/cloth-simulation-optimized.js';
   import { ClothRendererWebGL } from './systems/cloth-renderer-webgl.js';

2. 在 Game 类的 constructor 中，找到：

   this.clothSystem = new ClothSystem();

   替换为：

   this.clothSystem = new ClothSystemOptimized();

   然后在 resizeCanvas() 之后添加：

   // WebGL 渲染器
   this.webglRenderer = new ClothRendererWebGL(this.canvas);
   this.useWebGL = this.webglRenderer.gl !== null;
   console.log('WebGL 加速:', this.useWebGL ? '已启用' : '不支持');

3. 在 draw() 方法中，找到布料渲染部分：

   // 绘制布料系统（材质系统负责外观）
   this.materialSystem.render(this.ctx, this.clothSystem, { forceWireframe: editing });

   替换为：

   // WebGL 加速渲染
   if (this.useWebGL && this.clothSystem.faces.length > 0) {
       // 面片
       if (this.materialSystem.renderMode !== 'wireframe') {
           this.webglRenderer.renderFaces(this.clothSystem.faces);
       }

       // 线框
       if (this.materialSystem.renderMode !== 'material' || editing) {
           this.webglRenderer.renderConstraints(this.clothSystem.constraints);
       }

       // 粒子
       if (this.materialSystem.showNodes || editing) {
           this.webglRenderer.renderParticles(this.clothSystem.particles);
       }
   } else {
       // Canvas 2D 回退
       this.materialSystem.render(this.ctx, this.clothSystem, { forceWireframe: editing });
   }

4. （可选）在 draw() 方法末尾添加性能信息：

   // 性能统计
   if (this.clothSystem.getPerformanceInfo) {
       this.ctx.fillStyle = '#00ff00';
       this.ctx.font = '12px monospace';
       this.ctx.fillText(this.clothSystem.getPerformanceInfo(), 10, this.canvas.height - 10);
   }

5. 保存文件，刷新浏览器测试

性能调优
========

如果性能仍不理想，可以调整参数：

// 在 ClothSystemOptimized 构造函数中
this.substeps = 3;              // 减少到 2 可进一步提速
this.constraintIterations = 2;  // 减少到 1 可进一步提速（但布料会更软）

// 或者在初始化后动态调整
game.clothSystem.substeps = 2;
game.clothSystem.constraintIterations = 1;

完成！
======

现在你的布料模拟应该快得多了。
查看控制台的性能统计信息，绿色文字显示活跃粒子数和计算时间。
`;

// 打印手动集成指南
if (typeof console !== 'undefined') {
    console.log(MANUAL_INTEGRATION_GUIDE);
}
