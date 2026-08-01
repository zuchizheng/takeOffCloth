/**
 * 场景存档 - 把身体、滑轨、布料、材质的完整状态打包成一个 JSON 文件
 *
 * 存的是"当前状态"而不是"创建步骤"：布料的形变位置、被小刀切断的约束
 * 都会一起保存，所以读档后切开的口子还在，不用重新绘制。
 *
 * 读取顺序有依赖：滑轨必须先建好，布料粒子才能按下标接回自己绑定的滑轨。
 */

export const SCENE_VERSION = 1;

/**
 * 把当前场景导出成普通对象（可直接 JSON.stringify）
 */
export function serializeScene(app) {
    return {
        version: SCENE_VERSION,
        canvas: {
            width: app.canvas.width,
            height: app.canvas.height,
        },
        // 背景图转 dataURL 一起存进去，换机器打开也不会丢
        background: imageToDataURL(app.bodySystem.backgroundImage),
        body: app.bodySystem.toJSON(),
        tracks: app.trackSystem.toJSON(),
        // 布料要拿滑轨数组把 particle.track 转成下标
        cloth: app.clothSystem.toJSON(app.trackSystem.tracks),
        material: app.materialSystem.toJSON(),
    };
}

/**
 * 把场景数据恢复到 app 上
 * @returns {Promise<void>} 贴图和背景图需要解码，所以是异步的
 */
export async function deserializeScene(app, data) {
    if (!data || typeof data !== 'object') {
        throw new Error('存档内容不是有效的场景数据');
    }
    if (data.version > SCENE_VERSION) {
        throw new Error(`存档版本 ${data.version} 高于当前支持的 ${SCENE_VERSION}，请更新程序`);
    }

    // 先清掉可能正在进行的绘制/拖拽，避免残留状态污染新场景
    app.clothSystem.currentDrawing = [];
    app.trackSystem.currentDrawing = [];
    app.interactionTools.reset?.();

    app.bodySystem.fromJSON(data.body);
    // 滑轨先于布料：布料粒子按下标引用滑轨对象
    app.trackSystem.fromJSON(data.tracks);
    app.clothSystem.fromJSON(data.cloth, app.trackSystem.tracks);

    const jobs = [app.materialSystem.fromJSON(data.material)];
    if (data.background) {
        jobs.push(loadImage(data.background).then(
            img => app.bodySystem.loadImage(img),
            // 背景图丢了不该让整个读档失败
            () => { app.bodySystem.backgroundImage = null; }
        ));
    } else {
        app.bodySystem.backgroundImage = null;
    }

    await Promise.all(jobs);
}

function imageToDataURL(img) {
    if (!img) return null;

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    // 背景图压到 1600 以内：原图可能是几千像素的照片，
    // 存档会大到几十 MB，而画布根本显示不到那个精度
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);

    try {
        // JPEG 比 PNG 小得多，照片没有透明通道，不需要 PNG
        return cv.toDataURL('image/jpeg', 0.85);
    } catch (e) {
        // 跨域图片会污染画布导致 toDataURL 抛错，这时放弃存背景
        return null;
    }
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片解码失败'));
        img.src = src;
    });
}

// 记住用户选择的保存文件夹句柄
let saveDirectoryHandle = null;

/**
 * 保存场景到本地文件系统（使用 File System Access API）
 * 第一次会弹窗让用户选择保存文件夹，之后直接写入
 * @param {string} filename 不含扩展名
 */
export async function saveSceneToFile(app, filename = 'scene') {
    // 检查浏览器支持
    if (!('showDirectoryPicker' in window)) {
        alert('你的浏览器不支持直接保存文件，请使用 Chrome 或 Edge 浏览器');
        return;
    }

    try {
        // 第一次使用或丢失权限时，让用户选择保存文件夹
        if (!saveDirectoryHandle) {
            saveDirectoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'documents',
            });
        }

        // 验证权限（用户可能关闭后撤销了）
        const permission = await saveDirectoryHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            const request = await saveDirectoryHandle.requestPermission({ mode: 'readwrite' });
            if (request !== 'granted') {
                alert('需要文件夹写入权限才能保存');
                saveDirectoryHandle = null;
                return;
            }
        }

        // 创建或覆盖文件
        const fileHandle = await saveDirectoryHandle.getFileHandle(`${filename}.cloth.json`, { create: true });
        const writable = await fileHandle.createWritable();
        const json = JSON.stringify(serializeScene(app));
        await writable.write(json);
        await writable.close();

        alert(`已保存到：${saveDirectoryHandle.name}/${filename}.cloth.json`);
    } catch (err) {
        if (err.name === 'AbortError') {
            // 用户取消了文件夹选择
            return;
        }
        console.error('保存失败:', err);
        alert(`保存失败: ${err.message}`);
        saveDirectoryHandle = null; // 重置，下次重新选
    }
}

/**
 * 从 File 对象读取场景
 */
export async function loadSceneFromFile(app, file) {
    const text = await file.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('文件不是有效的 JSON');
    }
    await deserializeScene(app, data);
}

const AUTOSAVE_KEY = 'takeOffCloth.autosave';

/**
 * 存到 localStorage，用于"快速保存"和刷新恢复
 * @returns {boolean} 是否成功（超出配额会失败）
 */
export function saveToLocal(app) {
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeScene(app)));
        return true;
    } catch (e) {
        // localStorage 通常只有 5MB，带大背景图很容易撑爆
        console.warn('本地保存失败（可能超出容量限制）', e);
        return false;
    }
}

export function hasLocalSave() {
    try {
        return localStorage.getItem(AUTOSAVE_KEY) !== null;
    } catch (e) {
        return false;
    }
}

export async function loadFromLocal(app) {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) throw new Error('没有找到本地存档');
    await deserializeScene(app, JSON.parse(text));
}

export function clearLocalSave() {
    try {
        localStorage.removeItem(AUTOSAVE_KEY);
    } catch (e) { /* 忽略：清不掉也不影响使用 */ }
}
