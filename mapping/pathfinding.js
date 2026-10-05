// Geometry helpers + grid-based A* pathfinding used by guards and the level generator.

// Collision detection between circle and rect
export function circleRectCollide(cx, cy, radius, rect) {
    const testX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const testY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - testX;
    const dy = cy - testY;
    return dx * dx + dy * dy <= radius * radius;
}

// Liang–Barsky: does the segment (x1,y1)-(x2,y2) touch the rect expanded by `pad`?
export function segmentHitsRect(x1, y1, x2, y2, r, pad = 0) {
    const minX = r.x - pad, maxX = r.x + r.w + pad;
    const minY = r.y - pad, maxY = r.y + r.h + pad;
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];
    let t0 = 0, t1 = 1;

    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return false;
        } else {
            const t = q[i] / p[i];
            if (p[i] < 0) {
                if (t > t1) return false;
                if (t > t0) t0 = t;
            } else {
                if (t < t0) return false;
                if (t < t1) t1 = t;
            }
        }
    }
    return true;
}

export function segmentBlocked(x1, y1, x2, y2, objects, pad = 0) {
    for (const o of objects) {
        if (segmentHitsRect(x1, y1, x2, y2, o, pad)) return true;
    }
    return false;
}

class MinHeap {
    constructor() { this.items = []; this.prio = []; }
    get size() { return this.items.length; }

    push(item, p) {
        const a = this.items, b = this.prio;
        let i = a.length;
        a.push(item); b.push(p);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (b[parent] <= b[i]) break;
            this.swap(i, parent);
            i = parent;
        }
    }

    pop() {
        const a = this.items, b = this.prio;
        const top = a[0];
        const lastItem = a.pop(), lastPrio = b.pop();
        if (a.length) {
            a[0] = lastItem; b[0] = lastPrio;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < a.length && b[l] < b[m]) m = l;
                if (r < a.length && b[r] < b[m]) m = r;
                if (m === i) break;
                this.swap(i, m);
                i = m;
            }
        }
        return top;
    }

    swap(i, j) {
        const a = this.items, b = this.prio;
        [a[i], a[j]] = [a[j], a[i]];
        [b[i], b[j]] = [b[j], b[i]];
    }
}

const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class NavGrid {
    constructor(worldW, worldH, cellSize, objects, clearance) {
        this.cell = cellSize;
        this.cols = Math.ceil(worldW / cellSize);
        this.rows = Math.ceil(worldH / cellSize);
        this.objects = objects;
        this.clearance = clearance;
        this.blocked = new Uint8Array(this.cols * this.rows);

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const x = (c + 0.5) * cellSize;
                const y = (r + 0.5) * cellSize;
                for (const o of objects) {
                    if (circleRectCollide(x, y, clearance, o)) {
                        this.blocked[r * this.cols + c] = 1;
                        break;
                    }
                }
            }
        }
    }

    idx(c, r) { return r * this.cols + c; }
    center(c, r) { return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell }; }

    toCell(x, y) {
        return {
            c: Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell))),
            r: Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell))),
        };
    }

    isFree(c, r) {
        return c >= 0 && r >= 0 && c < this.cols && r < this.rows && !this.blocked[r * this.cols + c];
    }

    nearestFree(c, r, maxRadius = 4) {
        if (this.isFree(c, r)) return { c, r };
        for (let rad = 1; rad <= maxRadius; rad++) {
            for (let dr = -rad; dr <= rad; dr++) {
                for (let dc = -rad; dc <= rad; dc++) {
                    if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
                    if (this.isFree(c + dc, r + dr)) return { c: c + dc, r: r + dr };
                }
            }
        }
        return null;
    }

    // Flood fill of every cell reachable from (x, y). Used to validate generated levels.
    reachableFrom(x, y) {
        const seen = new Uint8Array(this.cols * this.rows);
        const s0 = this.toCell(x, y);
        const s = this.nearestFree(s0.c, s0.r);
        if (!s) return seen;

        const stack = [this.idx(s.c, s.r)];
        seen[stack[0]] = 1;
        while (stack.length) {
            const i = stack.pop();
            const c = i % this.cols, r = (i / this.cols) | 0;
            for (let d = 0; d < 4; d++) {
                const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
                if (!this.isFree(nc, nr)) continue;
                const ni = this.idx(nc, nr);
                if (!seen[ni]) { seen[ni] = 1; stack.push(ni); }
            }
        }
        return seen;
    }

    isReachable(seen, x, y) {
        const { c, r } = this.toCell(x, y);
        const n = this.nearestFree(c, r, 2);
        return !!n && seen[this.idx(n.c, n.r)] === 1;
    }

    // A* on an 8-connected grid (no corner cutting), followed by string-pulling smoothing.
    findPath(sx, sy, tx, ty) {
        const s0 = this.toCell(sx, sy), t0 = this.toCell(tx, ty);
        const s = this.nearestFree(s0.c, s0.r, 3);
        const t = this.nearestFree(t0.c, t0.r, 4);
        if (!s || !t) return null;

        const cols = this.cols;
        const N = cols * this.rows;
        const si = this.idx(s.c, s.r), ti = this.idx(t.c, t.r);
        const g = new Float32Array(N).fill(Infinity);
        const parent = new Int32Array(N).fill(-1);
        const closed = new Uint8Array(N);
        const h = (i) => {
            const dc = Math.abs((i % cols) - t.c);
            const dr = Math.abs(((i / cols) | 0) - t.r);
            return dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr);
        };

        const heap = new MinHeap();
        g[si] = 0;
        heap.push(si, h(si));
        let found = si === ti;

        while (heap.size && !found) {
            const cur = heap.pop();
            if (closed[cur]) continue;
            if (cur === ti) { found = true; break; }
            closed[cur] = 1;

            const c = cur % cols, r = (cur / cols) | 0;
            for (const [dc, dr, cost] of DIRS) {
                const nc = c + dc, nr = r + dr;
                if (!this.isFree(nc, nr)) continue;
                if (dc && dr && (!this.isFree(c + dc, r) || !this.isFree(c, r + dr))) continue;
                const ni = nr * cols + nc;
                if (closed[ni]) continue;
                const ng = g[cur] + cost;
                if (ng < g[ni]) {
                    g[ni] = ng;
                    parent[ni] = cur;
                    heap.push(ni, ng + h(ni));
                }
            }
        }
        if (!found) return null;

        const cells = [];
        for (let i = ti; i !== -1 && i !== si; i = parent[i]) cells.push(i);
        cells.reverse();

        const pts = cells.map((i) => this.center(i % cols, (i / cols) | 0));
        if (t.c === t0.c && t.r === t0.r) pts.push({ x: tx, y: ty });
        return this.smooth(sx, sy, pts);
    }

    smooth(sx, sy, pts) {
        const out = [];
        const pad = this.clearance * 0.75;
        let ax = sx, ay = sy, i = 0;
        while (i < pts.length) {
            let j = Math.min(pts.length - 1, i + 24);
            while (j > i && segmentBlocked(ax, ay, pts[j].x, pts[j].y, this.objects, pad)) j--;
            out.push(pts[j]);
            ax = pts[j].x; ay = pts[j].y;
            i = j + 1;
        }
        return out;
    }
}
