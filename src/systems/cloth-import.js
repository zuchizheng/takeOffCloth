/**
 * 从图片生成布料系统
 * 1. 识别图片轮廓（非透明区域）
 * 2. 在轮廓内生成网格
 * 3. 应用原图作为贴图
 */

import { Vector2D } from '../utils/vector2d.js';

/**
 * 从图片生成布料
 * @param {Image} img
 * @param {Object} opts
 * @param {number} opts.resolution 网格密度
 * @param {number} opts.alphaThreshold 透明度阈值 0-255
 * @param {Vector2D} opts.position 放置位置
 * @param {number} opts.scale 缩放比例
 * @returns {Object} {outline: Vector2D[], bounds: {minX,maxX,minY,maxY}, texture: Image}
 */
export function imageToClothData(img, opts = {}) {
    const {
        resolution = 15,
        alphaThreshold = 128,
        position = new Vector2D(400, 300),
        scale = 1.0,
    } = opts;

    // 1. 提取图片的 alpha 通道
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const { data, width, height } = imageData;

    // 2. 构建二值化 alpha 遮罩
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        mask[i] = data[i * 4 + 3] >= alphaThreshold ? 1 : 0;
    }

    // 3. 查找轮廓（外边界追踪）
    const outline = traceOutline(mask, width, height);
    if (outline.length < 3) {
        throw new Error('图片轮廓点太少，无法生成布料');
    }

    // 4. 计算边界框
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of outline) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    // 5. 归一化轮廓到 [0,1] 范围，然后缩放并平移到目标位置
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const scaledOutline = outline.map(p => {
        const nx = (p.x - minX) / spanX; // 0~1
        const ny = (p.y - minY) / spanY;
        return new Vector2D(
            position.x + (nx - 0.5) * spanX * scale,
            position.y + (ny - 0.5) * spanY * scale
        );
    });

    return {
        outline: scaledOutline,
        bounds: { minX, maxX, minY, maxY },
        texture: img,
        resolution,
        mask,
        maskWidth: width,
        maskHeight: height,
    };
}

/**
 * Moore-Neighbor 轮廓追踪
 * @returns {Vector2D[]} 边界点列表
 */
function traceOutline(mask, width, height) {
    // 找起点：第一个非透明像素
    let startX = -1, startY = -1;
    outer: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (mask[y * width + x]) {
                startX = x;
                startY = y;
                break outer;
            }
        }
    }
    if (startX === -1) return [];

    const outline = [];
    const dirs = [
        [1, 0], [1, 1], [0, 1], [-1, 1],
        [-1, 0], [-1, -1], [0, -1], [1, -1]
    ];

    let cx = startX, cy = startY;
    let dir = 6; // 从左下开始搜索
    const visited = new Set();

    do {
        outline.push(new Vector2D(cx, cy));
        visited.add(`${cx},${cy}`);

        // 找下一个边界点
        let found = false;
        for (let i = 0; i < 8; i++) {
            const checkDir = (dir + i) % 8;
            const nx = cx + dirs[checkDir][0];
            const ny = cy + dirs[checkDir][1];

            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (mask[ny * width + nx]) {
                cx = nx;
                cy = ny;
                dir = (checkDir + 5) % 8; // 回退搜索方向
                found = true;
                break;
            }
        }

        if (!found) break;
        if (cx === startX && cy === startY && outline.length > 1) break;
        if (outline.length > width * height) break; // 防死循环
    } while (true);

    // 降采样：太密集的轮廓会导致后续计算慢
    return simplifyOutline(outline, 2);
}

/**
 * Douglas-Peucker 简化轮廓
 */
function simplifyOutline(points, epsilon = 2) {
    if (points.length < 3) return points;

    function perpDistance(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const norm = Math.sqrt(dx * dx + dy * dy);
        if (norm < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
        return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / norm;
    }

    function dp(pts, eps) {
        if (pts.length < 3) return pts;
        let maxDist = 0, maxIdx = 0;
        const first = pts[0], last = pts[pts.length - 1];

        for (let i = 1; i < pts.length - 1; i++) {
            const d = perpDistance(pts[i], first, last);
            if (d > maxDist) {
                maxDist = d;
                maxIdx = i;
            }
        }

        if (maxDist > eps) {
            const left = dp(pts.slice(0, maxIdx + 1), eps);
            const right = dp(pts.slice(maxIdx), eps);
            return left.slice(0, -1).concat(right);
        } else {
            return [first, last];
        }
    }

    return dp(points, epsilon);
}

/**
 * 检查点是否在遮罩内（用于生成网格时过滤粒子）
 */
export function pointInMask(x, y, mask, maskWidth, maskHeight, bounds) {
    // 世界坐标 → 图片坐标
    const { minX, maxX, minY, maxY } = bounds;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const nx = (x - minX) / spanX;
    const ny = (y - minY) / spanY;

    const px = Math.floor(nx * maskWidth);
    const py = Math.floor(ny * maskHeight);

    if (px < 0 || px >= maskWidth || py < 0 || py >= maskHeight) return false;
    return mask[py * maskWidth + px] === 1;
}
