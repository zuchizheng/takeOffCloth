import { BodySystem } from './systems/capsule-body.js';
import { ClothSystem } from './systems/cloth-simulation.js';
import { InteractionTools } from './systems/interaction-tools.js';
import { TrackSystem } from './systems/track.js';
import { MaterialSystem, MATERIAL_PRESETS } from './systems/material.js';
import {
    saveSceneToFile, loadSceneFromFile,
    saveToLocal, loadFromLocal, hasLocalSave,
} from './systems/scene.js';
import { imageToClothData, pointInMask } from './systems/cloth-import.js';
import { Vector2D } from './utils/vector2d.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('main-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // 初始化各系统
        this.bodySystem = new BodySystem();
        this.clothSystem = new ClothSystem();
        this.trackSystem = new TrackSystem();
        this.materialSystem = new MaterialSystem();
        this.interactionTools = new InteractionTools(this.clothSystem, this.bodySystem);

        // 游戏状态
        this.mode = 'edit-body'; // 'edit-body', 'edit-cloth', 'play'
        this.isDrawingCloth = false;
        this.isAddingCapsule = false;
        this.isPinningPoints = false;
        this.isDrawingTrack = false;
        this.isBindingTrack = false;
        this.clothTool = null; // 'cloth' | 'track' | 'pin' | 'bind' | null
        this.capsuleStart = null;
        this.currentMousePos = null;

        // 衣服导入状态
        this.clothImportData = null; // 导入的衣服数据
        this.clothImportScale = 1.0;
        this.clothImportOffset = new Vector2D(0, 0);
        this.clothImportOpacity = 0.7;

        this.lastTime = performance.now();
        this.isPaused = false;

        this.initUI();
        this.initEvents();
        this.initDefaultScene();
        this.animate();
    }

    resizeCanvas() {
        const container = document.getElementById('canvas-container');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
    }

    initUI() {
        // 模式切换（移除已隐藏的 edit-body 模式）
        document.getElementById('mode-edit-cloth').addEventListener('click', () => {
            this.setMode('edit-cloth');
        });
        document.getElementById('mode-play').addEventListener('click', () => {
            this.setMode('play');
        });

        // 背景照片导入（移除 add-capsule 按钮事件）
        document.getElementById('load-image').addEventListener('click', () => {
            document.getElementById('image-input').click();
        });

        document.getElementById('image-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        this.bodySystem.loadImage(img);
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        });

        // 衣服编辑工具
        document.getElementById('draw-cloth').addEventListener('click', () => {
            this.setClothTool('cloth');
            this.clothSystem.startDrawing();
        });

        document.getElementById('finish-cloth').addEventListener('click', () => {
            if (this.clothSystem.currentDrawing.length >= 3) {
                this.clothSystem.finishDrawing();
                this.setClothTool(null);
            } else {
                alert('至少需要3个点才能创建衣服！');
            }
        });

        document.getElementById('cancel-cloth').addEventListener('click', () => {
            this.setClothTool(null);
        });

        // 导入衣服图片
        document.getElementById('import-cloth').addEventListener('click', () => {
            document.getElementById('cloth-image-input').click();
        });

        document.getElementById('cloth-image-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        // 生成衣服轮廓数据
                        this.clothImportData = imageToClothData(img, {
                            resolution: this.clothSystem.resolution,
                            alphaThreshold: 128,
                            position: new Vector2D(this.canvas.width / 2, this.canvas.height / 2),
                            scale: 1.0,
                        });

                        console.log('导入成功:', {
                            outlinePoints: this.clothImportData.outline.length,
                            maskSize: `${this.clothImportData.maskWidth}x${this.clothImportData.maskHeight}`,
                            bounds: this.clothImportData.bounds,
                        });

                        // 重置变换参数
                        this.clothImportScale = 1.0;
                        this.clothImportOffset = new Vector2D(0, 0);
                        this.clothImportOpacity = 0.7;

                        // 显示变换控制面板
                        document.getElementById('cloth-transform-tools').style.display = 'block';
                        document.getElementById('cloth-scale').value = 1.0;
                        document.getElementById('cloth-scale-value').textContent = '1.00';
                        document.getElementById('cloth-offset-x').value = 0;
                        document.getElementById('cloth-offset-x-value').textContent = '0';
                        document.getElementById('cloth-offset-y').value = 0;
                        document.getElementById('cloth-offset-y-value').textContent = '0';
                        document.getElementById('cloth-preview-opacity').value = 0.7;
                        document.getElementById('cloth-preview-opacity-value').textContent = '0.70';

                        alert(`已导入衣服图片\n轮廓点数: ${this.clothImportData.outline.length}\n请调整位置和大小，然后点击"确认生成布料"`);
                    } catch (err) {
                        console.error('导入失败:', err);
                        alert('导入失败: ' + err.message);
                    }
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
            e.target.value = ''; // 清空，允许重复选择同一文件
        });

        // 衣服变换控制
        document.getElementById('cloth-scale').addEventListener('input', (e) => {
            this.clothImportScale = parseFloat(e.target.value);
            document.getElementById('cloth-scale-value').textContent = e.target.value;
        });

        document.getElementById('cloth-offset-x').addEventListener('input', (e) => {
            this.clothImportOffset.x = parseFloat(e.target.value);
            document.getElementById('cloth-offset-x-value').textContent = e.target.value;
        });

        document.getElementById('cloth-offset-y').addEventListener('input', (e) => {
            this.clothImportOffset.y = parseFloat(e.target.value);
            document.getElementById('cloth-offset-y-value').textContent = e.target.value;
        });

        document.getElementById('cloth-preview-opacity').addEventListener('input', (e) => {
            this.clothImportOpacity = parseFloat(e.target.value);
            document.getElementById('cloth-preview-opacity-value').textContent =
                parseFloat(e.target.value).toFixed(2);
        });

        document.getElementById('confirm-cloth-import').addEventListener('click', () => {
            if (!this.clothImportData) return;

            try {
                // 应用当前变换生成最终轮廓
                const data = this.clothImportData;
                const centerX = this.canvas.width / 2 + this.clothImportOffset.x;
                const centerY = this.canvas.height / 2 + this.clothImportOffset.y;

                const transformedOutline = data.outline.map(p => {
                    const dx = p.x - this.canvas.width / 2;
                    const dy = p.y - this.canvas.height / 2;
                    return new Vector2D(
                        centerX + dx * this.clothImportScale,
                        centerY + dy * this.clothImportScale
                    );
                });

                console.log('开始生成布料:', {
                    outlinePoints: transformedOutline.length,
                    resolution: this.clothSystem.resolution,
                    centerX, centerY,
                    scale: this.clothImportScale,
                });

                // 计算变换后的边界框
                const imgSpanX = data.bounds.maxX - data.bounds.minX;
                const imgSpanY = data.bounds.maxY - data.bounds.minY;
                const scaledSpanX = imgSpanX * this.clothImportScale;
                const scaledSpanY = imgSpanY * this.clothImportScale;
                const scaledMinX = centerX - scaledSpanX / 2;
                const scaledMinY = centerY - scaledSpanY / 2;

                console.log('边界框:', { scaledMinX, scaledMinY, scaledSpanX, scaledSpanY });

                // 生成布料（使用遮罩过滤内部点）
                const particlesBefore = this.clothSystem.particles.length;
                this.clothSystem.createFromOutline(
                    transformedOutline,
                    this.clothSystem.resolution,
                    (x, y) => {
                        // 世界坐标 → 归一化坐标 → 图片像素坐标
                        const nx = (x - scaledMinX) / scaledSpanX;
                        const ny = (y - scaledMinY) / scaledSpanY;

                        const px = Math.floor(nx * data.maskWidth);
                        const py = Math.floor(ny * data.maskHeight);

                        if (px < 0 || px >= data.maskWidth || py < 0 || py >= data.maskHeight) {
                            return false;
                        }
                        return data.mask[py * data.maskWidth + px] === 1;
                    }
                );
                const particlesAfter = this.clothSystem.particles.length;
                const particlesAdded = particlesAfter - particlesBefore;

                console.log('布料生成完成:', {
                    particlesAdded,
                    totalParticles: particlesAfter,
                    faces: this.clothSystem.faces.length,
                });

                if (particlesAdded === 0) {
                    alert('生成失败：没有粒子被创建。\n可能原因：\n1. 图片背景不够透明（alpha < 128）\n2. 图片太小或轮廓太细\n3. 网格间距太大');
                    return;
                }

                // 应用贴图
                this.materialSystem.loadTexture(data.texture);

                // 清理导入状态
                this.clothImportData = null;
                document.getElementById('cloth-transform-tools').style.display = 'none';

                alert(`布料生成成功！\n粒子数: ${particlesAdded}\n面片数: ${this.clothSystem.faces.length}`);
            } catch (err) {
                console.error('生成失败:', err);
                alert('生成失败: ' + err.message);
            }
        });

        document.getElementById('cancel-cloth-import').addEventListener('click', () => {
            this.clothImportData = null;
            document.getElementById('cloth-transform-tools').style.display = 'none';
        });

        document.getElementById('clear-cloth').addEventListener('click', () => {
            this.clothSystem.clear();
            this.setClothTool(null);
        });

        document.getElementById('cloth-stiffness').addEventListener('input', (e) => {
            this.clothSystem.stiffness = parseFloat(e.target.value);
            document.getElementById('stiffness-value').textContent = e.target.value;
        });

        document.getElementById('cloth-resolution').addEventListener('input', (e) => {
            this.clothSystem.resolution = parseFloat(e.target.value);
            document.getElementById('resolution-value').textContent = e.target.value;
        });

        document.getElementById('pin-points').addEventListener('click', () => {
            this.setClothTool(this.clothTool === 'pin' ? null : 'pin');
        });

        // 滑轨工具
        document.getElementById('draw-track').addEventListener('click', () => {
            this.setClothTool('track');
            this.trackSystem.startDrawing();
        });

        document.getElementById('finish-track').addEventListener('click', () => {
            if (this.trackSystem.currentDrawing.length >= 2) {
                this.trackSystem.finishDrawing();
                this.setClothTool(null);
            } else {
                alert('滑轨至少需要2个点！');
            }
        });

        document.getElementById('cancel-track').addEventListener('click', () => {
            this.setClothTool(null);
        });

        document.getElementById('bind-track').addEventListener('click', () => {
            this.setClothTool(this.clothTool === 'bind' ? null : 'bind');
        });

        document.getElementById('track-friction').addEventListener('input', (e) => {
            this.trackSystem.setFriction(parseFloat(e.target.value));
            document.getElementById('track-friction-value').textContent = e.target.value;
        });

        document.getElementById('clear-track').addEventListener('click', () => {
            // 清除滑轨前解绑所有引用，避免粒子指向已删除的轨迹
            this.clothSystem.particles.forEach(p => { p.track = null; });
            this.trackSystem.clear();
            this.setClothTool(null);
        });

        // 交互工具
        document.getElementById('tool-hand').addEventListener('click', () => {
            this.setTool('hand');
        });
        document.getElementById('tool-knife').addEventListener('click', () => {
            this.setTool('knife');
        });
        // 移除 tool-wind 事件监听（功能已隐藏）

        // 控制
        document.getElementById('reset').addEventListener('click', () => {
            this.reset();
        });

        document.getElementById('gravity').addEventListener('input', (e) => {
            this.clothSystem.gravity = parseFloat(e.target.value);
            document.getElementById('gravity-value').textContent = e.target.value;
        });

        // 材质
        document.getElementById('mat-preset').addEventListener('change', (e) => {
            this.materialSystem.setPreset(e.target.value);
            this.syncMaterialUI();
        });

        document.getElementById('mat-color').addEventListener('input', (e) => {
            this.materialSystem.setBaseColor(e.target.value);
        });

        document.getElementById('mat-opacity').addEventListener('input', (e) => {
            this.materialSystem.opacity = parseFloat(e.target.value);
            document.getElementById('mat-opacity-value').textContent =
                parseFloat(e.target.value).toFixed(2);
        });

        document.getElementById('mat-sheen').addEventListener('input', (e) => {
            this.materialSystem.sheen = parseFloat(e.target.value);
            document.getElementById('mat-sheen-value').textContent = e.target.value;
        });

        document.getElementById('mat-fold').addEventListener('input', (e) => {
            this.materialSystem.fold = parseFloat(e.target.value);
            document.getElementById('mat-fold-value').textContent = e.target.value;
        });

        document.getElementById('mat-thickness').addEventListener('input', (e) => {
            this.materialSystem.thickness = parseFloat(e.target.value);
            document.getElementById('mat-thickness-value').textContent = e.target.value;
        });

        document.getElementById('mat-thickness-darken').addEventListener('input', (e) => {
            this.materialSystem.thicknessDarken = parseFloat(e.target.value);
            document.getElementById('mat-thickness-darken-value').textContent =
                parseFloat(e.target.value).toFixed(2);
        });

        document.getElementById('mat-blur').addEventListener('input', (e) => {
            this.materialSystem.blur = parseFloat(e.target.value);
            document.getElementById('mat-blur-value').textContent = e.target.value;
        });

        document.getElementById('mat-smooth').addEventListener('input', (e) => {
            this.materialSystem.smooth = parseFloat(e.target.value);
            document.getElementById('mat-smooth-value').textContent =
                parseFloat(e.target.value).toFixed(1);
        });

        document.getElementById('mat-load-texture').addEventListener('click', () => {
            document.getElementById('mat-texture-input').click();
        });

        document.getElementById('mat-texture-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => this.materialSystem.loadTexture(img);
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });

        document.getElementById('mat-clear-texture').addEventListener('click', () => {
            this.materialSystem.clearTexture();
        });

        document.getElementById('mat-tex-mode').addEventListener('change', (e) => {
            this.materialSystem.texMode = e.target.value;
        });

        document.getElementById('mat-render-mode').addEventListener('change', (e) => {
            this.materialSystem.renderMode = e.target.value;
        });

        document.getElementById('mat-show-nodes').addEventListener('change', (e) => {
            this.materialSystem.showNodes = e.target.checked;
        });

        // 场景存取
        document.getElementById('save-scene').addEventListener('click', async () => {
            const name = prompt('场景名称（不含扩展名）:', 'scene');
            if (name) await saveSceneToFile(this, name);
        });

        document.getElementById('load-scene').addEventListener('click', () => {
            document.getElementById('scene-file-input').click();
        });

        document.getElementById('scene-file-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await loadSceneFromFile(this, file);
                this.syncMaterialUI();
                alert('场景已读取');
            } catch (err) {
                alert('读取失败: ' + err.message);
            }
            e.target.value = ''; // 清掉，同一文件能反复选
        });

        document.getElementById('quick-save').addEventListener('click', () => {
            const ok = saveToLocal(this);
            if (ok) {
                alert('已保存到浏览器本地（刷新后可用"快速读取"恢复）');
            } else {
                alert('本地保存失败（可能超出容量限制），请用"保存场景到文件"');
            }
        });

        document.getElementById('quick-load').addEventListener('click', async () => {
            if (!hasLocalSave()) {
                alert('没有找到本地存档');
                return;
            }
            try {
                await loadFromLocal(this);
                this.syncMaterialUI();
                alert('本地存档已读取');
            } catch (err) {
                alert('读取失败: ' + err.message);
            }
        });
    }

    /**
     * 把所有控件拉到当前系统状态。
     * 预设切换和读档后都要调，否则滑块显示的还是旧值。
     */
    syncMaterialUI() {
        const set = (id, value, text = null) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
            if (text !== null) {
                const label = document.getElementById(id + '-value');
                if (label) label.textContent = text;
            }
        };

        const m = this.materialSystem;
        set('mat-preset', m.preset);
        set('mat-color', m.baseColor);
        set('mat-opacity', m.opacity, m.opacity.toFixed(2));
        set('mat-sheen', m.sheen, m.sheen.toFixed(2));
        set('mat-fold', m.fold, m.fold.toFixed(2));
        set('mat-thickness', m.thickness, m.thickness.toFixed(1));
        set('mat-thickness-darken', m.thicknessDarken, m.thicknessDarken.toFixed(2));
        set('mat-blur', m.blur, String(m.blur));
        set('mat-smooth', m.smooth, m.smooth.toFixed(1));
        set('mat-tex-mode', m.texMode);
        set('mat-render-mode', m.renderMode);
        const nodesEl = document.getElementById('mat-show-nodes');
        if (nodesEl) nodesEl.checked = m.showNodes;

        // 布料和滑轨参数在读档后也会变
        const c = this.clothSystem;
        set('cloth-stiffness', c.stiffness, c.stiffness.toFixed(2));
        set('cloth-resolution', c.resolution, String(c.resolution));
        set('gravity', c.gravity, String(c.gravity));
        set('track-friction', this.trackSystem.friction,
            this.trackSystem.friction.toFixed(2));
    }

    /**
     * 衣服编辑模式下的工具互斥切换
     * tool: 'cloth' | 'track' | 'pin' | 'bind' | null
     * 同一时刻只有一个工具生效，避免 onMouseDown 里的分支互相抢占
     */
    setClothTool(tool) {
        this.clothTool = tool;
        this.isDrawingCloth = tool === 'cloth';
        this.isDrawingTrack = tool === 'track';
        this.isPinningPoints = tool === 'pin';
        this.isBindingTrack = tool === 'bind';

        // 切走时丢弃未完成的绘制，避免残留半截轮廓
        if (tool !== 'cloth') this.clothSystem.currentDrawing = [];
        if (tool !== 'track') this.trackSystem.cancelDrawing();

        this.syncClothToolButtons();
    }

    syncClothToolButtons() {
        const show = (id, visible) => {
            document.getElementById(id).style.display = visible ? 'block' : 'none';
        };
        const setActive = (id, active) => {
            document.getElementById(id).classList.toggle('active', active);
        };

        setActive('draw-cloth', this.isDrawingCloth);
        setActive('draw-track', this.isDrawingTrack);
        setActive('pin-points', this.isPinningPoints);
        setActive('bind-track', this.isBindingTrack);

        show('finish-cloth', this.isDrawingCloth);
        show('cancel-cloth', this.isDrawingCloth);
        show('finish-track', this.isDrawingTrack);
        show('cancel-track', this.isDrawingTrack);
    }

    setMode(mode) {
        this.mode = mode;
        this.isAddingCapsule = false;
        this.setClothTool(null);

        // 更新UI
        document.querySelectorAll('#toolbar .tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // body-tools (背景设置) 始终显示，不隐藏
        document.getElementById('cloth-tools').style.display = 'none';
        document.getElementById('play-tools').style.display = 'none';

        // 移除 edit-body 模式的处理
        if (mode === 'edit-cloth') {
            document.getElementById('mode-edit-cloth').classList.add('active');
            document.getElementById('cloth-tools').style.display = 'block';
        } else if (mode === 'play') {
            document.getElementById('mode-play').classList.add('active');
            document.getElementById('play-tools').style.display = 'block';
            document.getElementById('tool-hand').classList.add('active');
        }
    }

    setTool(tool) {
        this.interactionTools.setTool(tool);
        document.querySelectorAll('#play-tools .tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`tool-${tool}`).classList.add('active');

        // 更新鼠标样式
        this.canvas.className = `${tool}-cursor`;
    }

    initEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));

        // 键盘快捷键
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Delete' && this.bodySystem.selectedCapsule) {
                this.bodySystem.removeCapsule(this.bodySystem.selectedCapsule);
                this.bodySystem.selectedCapsule = null;
            }
            if (e.key === ' ') {
                this.isPaused = !this.isPaused;
                e.preventDefault();
            }
        });
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return new Vector2D(
            e.clientX - rect.left,
            e.clientY - rect.top
        );
    }

    onMouseDown(e) {
        const point = this.getMousePos(e);

        if (this.mode === 'edit-body') {
            if (this.isAddingCapsule) {
                // 开始添加胶囊体
                this.capsuleStart = point;
            } else {
                // 选择和拖拽胶囊体
                this.bodySystem.selectAt(point);
            }
        } else if (this.mode === 'edit-cloth') {
            if (this.isDrawingCloth) {
                // 添加布料绘制点
                this.clothSystem.addDrawingPoint(point);
            } else if (this.isDrawingTrack) {
                // 添加滑轨折点
                this.trackSystem.addDrawingPoint(point);
            } else if (this.isPinningPoints) {
                // 固定/取消固定点
                const particle = this.clothSystem.findParticleAt(point, 10);
                if (particle) {
                    particle.pinned = !particle.pinned;
                    // 固定点和滑轨节点互斥
                    if (particle.pinned) particle.track = null;
                }
            } else if (this.isBindingTrack) {
                // 绑定/解绑滑轨节点
                const particle = this.clothSystem.findParticleAt(point, 10);
                if (particle) {
                    if (particle.track) {
                        particle.track = null;
                    } else {
                        const track = this.trackSystem.findNearestTrack(particle.pos);
                        if (track) {
                            particle.track = track;
                            particle.pinned = false;
                            // 立刻吸附到轨迹上
                            track.constrainParticle(particle);
                        }
                    }
                }
            }
        } else if (this.mode === 'play') {
            // 使用交互工具
            this.interactionTools.onMouseDown(point);
        }
    }

    onMouseMove(e) {
        const point = this.getMousePos(e);
        this.currentMousePos = point; // 始终追踪鼠标位置

        if (this.mode === 'edit-body' && this.bodySystem.selectedCapsule) {
            this.bodySystem.dragSelected(point);
        } else if (this.mode === 'play') {
            this.interactionTools.onMouseMove(point);
        }
    }

    onMouseUp(e) {
        const point = this.getMousePos(e);

        if (this.mode === 'edit-body' && this.isAddingCapsule && this.capsuleStart) {
            // 完成添加胶囊体
            if (this.capsuleStart.distance(point) > 20) {
                this.bodySystem.addCapsule(this.capsuleStart, point, 30);
            }
            this.capsuleStart = null;
        }

        if (this.mode === 'edit-body') {
            this.bodySystem.endDrag();
        } else if (this.mode === 'play') {
            this.interactionTools.onMouseUp();
        }
    }

    initDefaultScene() {
        // 创建一个默认的人体模型
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        // 躯干
        this.bodySystem.addCapsule(
            new Vector2D(centerX, centerY - 100),
            new Vector2D(centerX, centerY + 50),
            40
        );

        // 头
        this.bodySystem.addCapsule(
            new Vector2D(centerX, centerY - 120),
            new Vector2D(centerX, centerY - 100),
            30
        );

        // 左臂
        this.bodySystem.addCapsule(
            new Vector2D(centerX, centerY - 80),
            new Vector2D(centerX - 80, centerY - 40),
            15
        );

        // 右臂
        this.bodySystem.addCapsule(
            new Vector2D(centerX, centerY - 80),
            new Vector2D(centerX + 80, centerY - 40),
            15
        );

        // 左腿
        this.bodySystem.addCapsule(
            new Vector2D(centerX - 15, centerY + 50),
            new Vector2D(centerX - 20, centerY + 150),
            18
        );

        // 右腿
        this.bodySystem.addCapsule(
            new Vector2D(centerX + 15, centerY + 50),
            new Vector2D(centerX + 20, centerY + 150),
            18
        );
    }

    reset() {
        this.clothSystem.clear();
        this.trackSystem.clear();
        this.bodySystem.capsules = [];
        this.setClothTool(null);
        this.initDefaultScene();
    }

    update(dt) {
        if (this.isPaused) return;

        if (this.mode === 'play') {
            this.clothSystem.update(dt, this.bodySystem);
            this.interactionTools.update();
        }
    }

    draw() {
        // 清空画布
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // 绘制身体系统
        this.bodySystem.draw(this.ctx);

        // 编辑衣服时强制显示网格和轨道，纯材质预览下则全部隐藏保持画面干净
        const editing = this.mode === 'edit-cloth';

        // 绘制滑轨（在布料下方，避免遮挡节点）
        if (this.materialSystem.shouldShowRig(editing)) {
            this.trackSystem.draw(this.ctx);
        }

        // 绘制布料系统（材质系统负责外观）
        this.materialSystem.render(this.ctx, this.clothSystem, { forceWireframe: editing });

        // 绘制交互工具效果
        if (this.mode === 'play') {
            this.interactionTools.draw(this.ctx);
        }

        // 绘制临时胶囊体（添加中）
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

        // 绘制衣服绘制预览（连接到当前鼠标位置）
        if (this.mode === 'edit-cloth' && this.isDrawingCloth && this.clothSystem.currentDrawing.length > 0 && this.currentMousePos) {
            const drawing = this.clothSystem.currentDrawing;

            // 绘制从最后一个点到鼠标的预览线
            this.ctx.strokeStyle = '#ffff00';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(drawing[drawing.length - 1].x, drawing[drawing.length - 1].y);
            this.ctx.lineTo(this.currentMousePos.x, this.currentMousePos.y);
            this.ctx.stroke();

            // 如果有3个以上点，显示闭合预览
            if (drawing.length >= 3) {
                this.ctx.moveTo(drawing[0].x, drawing[0].y);
                this.ctx.lineTo(this.currentMousePos.x, this.currentMousePos.y);
                this.ctx.stroke();
            }
            this.ctx.setLineDash([]);
        }

        // 绘制衣服导入预览（半透明显示待生成的衣服）
        if (this.clothImportData) {
            const data = this.clothImportData;
            const centerX = this.canvas.width / 2 + this.clothImportOffset.x;
            const centerY = this.canvas.height / 2 + this.clothImportOffset.y;

            this.ctx.save();
            this.ctx.globalAlpha = this.clothImportOpacity;

            // 绘制变换后的图片
            const img = data.texture;
            const spanX = data.bounds.maxX - data.bounds.minX;
            const spanY = data.bounds.maxY - data.bounds.minY;
            const drawW = spanX * this.clothImportScale;
            const drawH = spanY * this.clothImportScale;

            this.ctx.drawImage(
                img,
                centerX - drawW / 2,
                centerY - drawH / 2,
                drawW,
                drawH
            );

            // 绘制轮廓预览
            this.ctx.globalAlpha = 1.0;
            this.ctx.strokeStyle = '#00ff00';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            const outline = data.outline;
            for (let i = 0; i < outline.length; i++) {
                const p = outline[i];
                const dx = p.x - this.canvas.width / 2;
                const dy = p.y - this.canvas.height / 2;
                const x = centerX + dx * this.clothImportScale;
                const y = centerY + dy * this.clothImportScale;
                if (i === 0) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.closePath();
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            this.ctx.restore();
        }

        // 绘制滑轨预览（从最后一个折点连到鼠标）
        if (this.mode === 'edit-cloth' && this.isDrawingTrack
            && this.trackSystem.currentDrawing.length > 0 && this.currentMousePos) {
            const drawing = this.trackSystem.currentDrawing;
            this.ctx.strokeStyle = '#66aaff';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.moveTo(drawing[drawing.length - 1].x, drawing[drawing.length - 1].y);
            this.ctx.lineTo(this.currentMousePos.x, this.currentMousePos.y);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // 绘制提示信息
        this.drawHints();
    }

    drawHints() {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '14px Microsoft YaHei';
        let y = 20;

        if (this.mode === 'edit-body') {
            this.ctx.fillText('身体编辑模式 - 点击添加胶囊体按钮后拖拽创建胶囊体', 10, y);
            y += 20;
            this.ctx.fillText('选中胶囊体后可拖动调整，按Delete删除', 10, y);
        } else if (this.mode === 'edit-cloth') {
            if (this.isDrawingCloth) {
                this.ctx.fillText('衣服编辑模式 - 点击画布添加点，绘制闭合轮廓', 10, y);
                y += 20;
                this.ctx.fillText('至少3个点，点击"完成绘制"按钮结束', 10, y);
                if (this.clothSystem.currentDrawing.length > 0) {
                    y += 20;
                    this.ctx.fillText(`已绘制 ${this.clothSystem.currentDrawing.length} 个点`, 10, y);
                }
            } else if (this.isDrawingTrack) {
                this.ctx.fillText('绘制滑轨 - 点击画布添加折点，形成一条轨迹', 10, y);
                y += 20;
                this.ctx.fillText('至少2个点，点击"完成滑轨"按钮结束', 10, y);
                if (this.trackSystem.currentDrawing.length > 0) {
                    y += 20;
                    this.ctx.fillText(`已绘制 ${this.trackSystem.currentDrawing.length} 个折点`, 10, y);
                }
            } else if (this.isPinningPoints) {
                this.ctx.fillText('固定点模式 - 点击布料点切换固定/自由状态', 10, y);
                y += 20;
                this.ctx.fillText('红色大点=固定，蓝色方块=滑轨节点，白色小点=自由', 10, y);
            } else if (this.isBindingTrack) {
                this.ctx.fillText('绑定滑轨 - 点击布料点，把它绑到最近的滑轨上', 10, y);
                y += 20;
                this.ctx.fillText('再次点击可解绑。蓝色方块=已绑定，只能沿轨迹滑动', 10, y);
            } else {
                this.ctx.fillText('衣服编辑模式 - 点击按钮绘制衣服、滑轨或编辑节点', 10, y);
            }
        } else if (this.mode === 'play') {
            this.ctx.fillText('游戏模式 - 使用工具与衣服互动', 10, y);
            y += 20;
            this.ctx.fillText('空格键暂停/继续', 10, y);
        }
    }

    animate() {
        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.033); // 限制最大时间步长
        this.lastTime = now;

        this.update(dt);
        this.draw();

        requestAnimationFrame(() => this.animate());
    }
}

// 启动游戏
window.addEventListener('DOMContentLoaded', () => {
    new Game();
});
