// Level data. Level 1 is the original hand-made facility;
// level 2+ are procedurally generated (seeded BSP rooms) and validated for reachability.
import { NavGrid } from './pathfinding.js';

export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 1800;

const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;
const T = 20; // wall thickness

export const COLORS = {
    wall: '#60a5fa',
    table: '#d97706',
    bed: '#ef4444',
    sofa: '#a855f7',
    plant: '#22c55e',
};

const wall = (x, y, w, h) => ({ type: 'wall', color: COLORS.wall, x, y, w, h });
const item = (type, x, y, w, h) => ({ type, color: COLORS[type], x, y, w, h });
const outerWalls = () => [wall(0, 0, W, T), wall(0, H - T, W, T), wall(0, 0, T, H), wall(W - T, 0, T, H)];

const LEVEL_1 = {
    name: 'Original Facility',
    start: { x: 100, y: 100 },
    goal: { x: 2200, y: 1600, width: 100, height: 100 },
    objects: [
        // Outer boundaries (Walls)
        ...outerWalls(),

        // Interior Walls (Rooms)
        wall(600, 0, 20, 800),
        wall(600, 1000, 20, 800),
        wall(600, 800, 600, 20),
        wall(1400, 800, 1000, 20),
        wall(1400, 0, 20, 500),
        wall(1400, 1100, 20, 700),

        // Furniture - Tables (Brown)
        item('table', 300, 300, 150, 100),
        item('table', 800, 200, 200, 100),
        item('table', 1800, 1200, 120, 250),

        // Furniture - Beds (Red)
        item('bed', 100, 1500, 120, 200),
        item('bed', 2100, 100, 200, 150),

        // Furniture - Sofa (Purple)
        item('sofa', 800, 1300, 250, 80),
        item('sofa', 1000, 1300, 80, 200),

        // Miscellaneous objects (Green)
        item('plant', 50, 50, 40, 40),
        item('plant', 550, 50, 40, 40),
        item('plant', 550, 1700, 40, 40),
        item('plant', 2300, 850, 40, 40),
    ],
    guards: [
        { viewRange: 300, waypoints: [{ x: 200, y: 600 }, { x: 200, y: 100 }] },
        { viewRange: 300, waypoints: [{ x: 1050, y: 300 }, { x: 1050, y: 700 }] },
        { viewRange: 350, waypoints: [{ x: 1600, y: 300 }, { x: 2200, y: 300 }, { x: 2200, y: 700 }, { x: 1600, y: 700 }] },
        { viewRange: 300, waypoints: [{ x: 800, y: 1600 }, { x: 1200, y: 1600 }] },
    ],
    chips: [
        { x: 150, y: 1000 },
        { x: 900, y: 600 },
        { x: 2000, y: 500 },
        { x: 1250, y: 1100 },
        { x: 2200, y: 1100 },
    ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

const levelCache = new Map();

export function getLevel(n) {
    if (n <= 1) return clone(LEVEL_1);
    if (!levelCache.has(n)) {
        let lvl = null;
        for (let attempt = 0; attempt < 40 && !lvl; attempt++) {
            lvl = generateLevel(n, n * 1013 + attempt * 7919);
        }
        levelCache.set(n, lvl || LEVEL_1);
    }
    return clone(levelCache.get(n));
}

// Deterministic PRNG so a given level number always produces the same map
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function generateLevel(n, seed) {
    const rand = mulberry32(seed);
    const rr = (a, b) => a + rand() * (b - a);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const shuffle = (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    const MIN_ROOM = 380;
    const DOOR = 130;
    const objects = outerWalls();
    const doors = [];
    const rooms = [];

    // Build a wall along `line` from `start` to `end`, leaving 1–2 doorways.
    function addDoorWall(vertical, line, start, end) {
        const len = end - start;
        const pickSpan = (a, b) => {
            const from = Math.round(rr(a + 40, b - 40 - DOOR));
            return { from, to: from + DOOR };
        };
        const spans = [];
        if (len > 800 && rand() < 0.5) {
            const mid = start + len / 2;
            spans.push(pickSpan(start, mid), pickSpan(mid, end));
        } else {
            spans.push(pickSpan(start, end));
        }

        let cursor = start;
        const piece = (a, b) => {
            if (b - a <= 0) return;
            objects.push(vertical ? wall(line, a, T, b - a) : wall(a, line, b - a, T));
        };
        for (const s of spans) {
            piece(cursor, s.from);
            doors.push({ vertical, line, from: s.from, to: s.to });
            cursor = s.to;
        }
        piece(cursor, end);
    }

    // A new perpendicular wall must not end inside an existing doorway.
    function hitsDoorway(vertical, pos, reg) {
        return doors.some((d) => {
            if (d.vertical === vertical) return false;
            const onBoundary = vertical
                ? d.line === reg.y - T || d.line === reg.y + reg.h
                : d.line === reg.x - T || d.line === reg.x + reg.w;
            return onBoundary && pos + T > d.from - 30 && pos < d.to + 30;
        });
    }

    function split(reg, depth) {
        const canV = reg.w >= MIN_ROOM * 2 + T;
        const canH = reg.h >= MIN_ROOM * 2 + T;
        const stop = (!canV && !canH) || (depth >= 2 && rand() < 0.2);

        if (!stop) {
            const vertical = canV && (!canH || (reg.w >= reg.h ? rand() < 0.75 : rand() < 0.25));
            for (let tries = 0; tries < 12; tries++) {
                if (vertical) {
                    const sx = Math.round(rr(reg.x + MIN_ROOM, reg.x + reg.w - MIN_ROOM - T));
                    if (hitsDoorway(true, sx, reg)) continue;
                    addDoorWall(true, sx, reg.y, reg.y + reg.h);
                    split({ x: reg.x, y: reg.y, w: sx - reg.x, h: reg.h }, depth + 1);
                    split({ x: sx + T, y: reg.y, w: reg.x + reg.w - sx - T, h: reg.h }, depth + 1);
                    return;
                } else {
                    const sy = Math.round(rr(reg.y + MIN_ROOM, reg.y + reg.h - MIN_ROOM - T));
                    if (hitsDoorway(false, sy, reg)) continue;
                    addDoorWall(false, sy, reg.x, reg.x + reg.w);
                    split({ x: reg.x, y: reg.y, w: reg.w, h: sy - reg.y }, depth + 1);
                    split({ x: reg.x, y: sy + T, w: reg.w, h: reg.y + reg.h - sy - T }, depth + 1);
                    return;
                }
            }
        }
        rooms.push(reg);
    }

    split({ x: T, y: T, w: W - 2 * T, h: H - 2 * T }, 0);
    if (rooms.length < 4) return null;

    const roomCenter = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    const startRoom = rooms.reduce((a, b) => (a.x + a.y <= b.x + b.y ? a : b));
    const start = { x: startRoom.x + 70, y: startRoom.y + 70 };
    const goalRoom = rooms.reduce((a, b) => (dist(roomCenter(a), start) >= dist(roomCenter(b), start) ? a : b));
    const gc = roomCenter(goalRoom);
    const goal = { x: Math.round(gc.x - 50), y: Math.round(gc.y - 50), width: 100, height: 100 };

    // ---------- Furniture ----------
    const overlaps = (a, b, pad = 0) =>
        a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
    const keepClear = [
        { x: start.x - 90, y: start.y - 90, w: 180, h: 180 },
        { x: goal.x - 60, y: goal.y - 60, w: goal.width + 120, h: goal.height + 120 },
    ];
    const FURNITURE = [
        ['table', [[150, 100], [200, 100], [100, 220], [120, 120]]],
        ['bed', [[120, 200], [200, 130]]],
        ['sofa', [[240, 80], [80, 200]]],
    ];
    const placed = [];

    for (const room of rooms) {
        const maxItems = Math.min(3, Math.floor((room.w * room.h) / 150000));
        const count = Math.floor(rr(0, maxItems + 1));
        for (let k = 0; k < count; k++) {
            for (let tries = 0; tries < 15; tries++) {
                const [type, sizes] = pick(FURNITURE);
                const [w, h] = pick(sizes);
                if (room.w - 140 < w || room.h - 140 < h) continue;
                const f = item(type,
                    Math.round(rr(room.x + 70, room.x + room.w - 70 - w)),
                    Math.round(rr(room.y + 70, room.y + room.h - 70 - h)), w, h);
                if (keepClear.some((z) => overlaps(f, z)) || placed.some((o) => overlaps(f, o, 70))) continue;
                placed.push(f);
                break;
            }
        }

        const corners = [
            [room.x + 30, room.y + 30], [room.x + room.w - 70, room.y + 30],
            [room.x + 30, room.y + room.h - 70], [room.x + room.w - 70, room.y + room.h - 70],
        ];
        for (const [x, y] of corners) {
            if (rand() > 0.35) continue;
            const p = item('plant', Math.round(x), Math.round(y), 40, 40);
            if (keepClear.some((z) => overlaps(p, z)) || placed.some((o) => overlaps(p, o, 40))) continue;
            placed.push(p);
        }
    }
    objects.push(...placed);

    // ---------- Validation & spawn points ----------
    const nav = new NavGrid(W, H, 30, objects, 14);
    const seen = nav.reachableFrom(start.x, start.y);
    if (!nav.isReachable(seen, gc.x, gc.y)) return null;

    const snapFree = (x, y) => {
        const { c, r } = nav.toCell(x, y);
        const f = nav.nearestFree(c, r, 3);
        return f && seen[nav.idx(f.c, f.r)] ? nav.center(f.c, f.r) : null;
    };
    const freePointIn = (room, margin = 50) => {
        for (let tries = 0; tries < 30; tries++) {
            const p = snapFree(rr(room.x + margin, room.x + room.w - margin), rr(room.y + margin, room.y + room.h - margin));
            if (p && p.x > room.x && p.x < room.x + room.w && p.y > room.y && p.y < room.y + room.h) return p;
        }
        return null;
    };

    // Data chips
    const otherRooms = rooms.filter((r) => r !== startRoom);
    const chipCount = Math.min(4 + Math.floor(n / 2), 8);
    const chips = [];
    for (let tries = 0; chips.length < chipCount && tries < 300; tries++) {
        const p = freePointIn(pick(otherRooms), 60);
        if (!p) continue;
        if (dist(p, start) < 300) continue;
        if (chips.some((c) => dist(c, p) < 220)) continue;
        if (p.x > goal.x - 60 && p.x < goal.x + goal.width + 60 && p.y > goal.y - 60 && p.y < goal.y + goal.height + 60) continue;
        chips.push(p);
    }
    if (chips.length < 3) return null;

    // Guards
    const guardRooms = shuffle(otherRooms.filter((r) => dist(roomCenter(r), start) > 500));
    if (!guardRooms.length) return null;
    const guardCount = Math.min(2 + n, 10);
    const guards = [];

    for (let i = 0; i < guardCount; i++) {
        let waypoints = null;

        // From level 3 on, one guard roams between several rooms
        if (i === guardCount - 1 && n >= 3 && otherRooms.length >= 3) {
            const stops = shuffle(otherRooms).slice(0, 3).map((r) => freePointIn(r, 70)).filter(Boolean);
            if (stops.length >= 2) waypoints = stops;
        }

        if (!waypoints) {
            const room = guardRooms[i % guardRooms.length];
            const m = 60 + (i >= guardRooms.length ? 50 : 0);
            const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
            let raw;
            if (rand() < 0.5) {
                raw = [[room.x + m, room.y + m], [room.x + room.w - m, room.y + m],
                    [room.x + room.w - m, room.y + room.h - m], [room.x + m, room.y + room.h - m]];
            } else if (room.w > room.h) {
                raw = [[room.x + m, cy], [room.x + room.w - m, cy]];
            } else {
                raw = [[cx, room.y + m], [cx, room.y + room.h - m]];
            }
            const shift = Math.floor(rand() * raw.length);
            raw = raw.slice(shift).concat(raw.slice(0, shift));
            if (rand() < 0.5) raw.reverse();
            waypoints = raw.map(([x, y]) => snapFree(x, y)).filter(Boolean);
        }

        if (waypoints.length < 2) continue;
        if (dist(waypoints[0], start) < 500) continue;
        guards.push({ waypoints });
    }
    if (guards.length < 2) return null;

    return { name: `Generated Facility #${n}`, start, goal, objects, guards, chips };
}
