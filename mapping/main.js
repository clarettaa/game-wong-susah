import { sfx } from './audio.js';
import { NavGrid, circleRectCollide, segmentBlocked } from './pathfinding.js';
import { getLevel, WORLD_WIDTH, WORLD_HEIGHT } from './levels.js';

let screenWidth = 800;
let screenHeight = 600;
let currentLevel = 1;
let level;
let objects = [];
let guards = [];
let chips = [];
let goal;
let navGrid;
let isGameRunning = false;
let lastFrameTime = 0;
let elapsedTime = 0;
let collectedChips = 0;
let pingTimer = 0;
let shakeTime = 0;

const mapCanvas = document.getElementById('map-canvas');
const mainCanvas = document.getElementById('main-canvas');
const resultCanvas = document.getElementById('result-canvas');
const minimapCanvas = document.getElementById('minimap-canvas');
const gameContainer = document.getElementById('game-container');
const mapCtx = mapCanvas.getContext('2d', { willReadFrequently: true });
const ctx = mainCanvas.getContext('2d');
const resultCtx = resultCanvas.getContext('2d');
const minimapCtx = minimapCanvas.getContext('2d');

mapCanvas.width = WORLD_WIDTH;
mapCanvas.height = WORLD_HEIGHT;
resultCanvas.width = 800;
resultCanvas.height = Math.round(800 * WORLD_HEIGHT / WORLD_WIDTH);
minimapCanvas.width = 150;
minimapCanvas.height = 150;

const hud = {
    level: document.getElementById('level-value'),
    timer: document.getElementById('timer-value'),
    coverage: document.getElementById('coverage-value'),
    chips: document.getElementById('chips-value'),
};

const keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
const robot = {
    x: 100,
    y: 100,
    radius: 12,
    angle: 0,
    baseSpeed: 300,
    viewRange: 200,
    currentViewRange: 200,
    mode: 'normal',
};
const camera = { x: 0, y: 0 };
let lastTracePos = { x: robot.x, y: robot.y };

const COVERAGE_CELL = 30;
const coverageCols = Math.ceil(WORLD_WIDTH / COVERAGE_CELL);
const coverageRows = Math.ceil(WORLD_HEIGHT / COVERAGE_CELL);
let exploredCells = new Uint8Array(coverageCols * coverageRows);
let explorableCells = new Uint8Array(coverageCols * coverageRows);
let exploredCount = 0;
let explorableCount = 1;

function resizeCanvas() {
    const rect = mainCanvas.parentElement.getBoundingClientRect();
    screenWidth = Math.max(1, Math.round(rect.width));
    screenHeight = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mainCanvas.width = Math.round(screenWidth * dpr);
    mainCanvas.height = Math.round(screenHeight * dpr);
    mainCanvas.style.width = `${screenWidth}px`;
    mainCanvas.style.height = `${screenHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
}

function coveragePercent() {
    return Math.min(100, exploredCount / explorableCount * 100);
}

function updateHud() {
    hud.level.textContent = currentLevel;
    hud.timer.textContent = formatTime(elapsedTime);
    hud.coverage.textContent = `${coveragePercent().toFixed(1)}%`;
    hud.chips.textContent = `${collectedChips}/${chips.length}`;
    document.getElementById('movement-mode').textContent = robot.mode.toUpperCase();
    document.getElementById('movement-mode').dataset.mode = robot.mode;
}

function initializeCoverage() {
    exploredCells = new Uint8Array(coverageCols * coverageRows);
    explorableCells = new Uint8Array(coverageCols * coverageRows);
    exploredCount = 0;
    explorableCount = 0;
    for (let row = 0; row < coverageRows; row++) {
        for (let col = 0; col < coverageCols; col++) {
            const x = (col + 0.5) * COVERAGE_CELL;
            const y = (row + 0.5) * COVERAGE_CELL;
            if (!objects.some((object) => circleRectCollide(x, y, 2, object))) {
                explorableCells[row * coverageCols + col] = 1;
                explorableCount++;
            }
        }
    }
}

function markExploredLine(x1, y1, x2, y2) {
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(distance / (COVERAGE_CELL * 0.6)));
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const col = Math.floor((x1 + (x2 - x1) * t) / COVERAGE_CELL);
        const row = Math.floor((y1 + (y2 - y1) * t) / COVERAGE_CELL);
        if (col < 0 || row < 0 || col >= coverageCols || row >= coverageRows) continue;
        const index = row * coverageCols + col;
        if (explorableCells[index] && !exploredCells[index]) {
            exploredCells[index] = 1;
            exploredCount++;
        }
    }
}

function createGuard(data) {
    const first = data.waypoints[0];
    return {
        x: first.x,
        y: first.y,
        radius: 12,
        patrolSpeed: 150,
        chaseSpeed: 240,
        waypoints: data.waypoints,
        currentWaypoint: data.waypoints.length > 1 ? 1 : 0,
        angle: 0,
        fov: Math.PI / 2.5,
        viewRange: data.viewRange || 310,
        state: 'patrol',
        suspicion: 0,
        path: [],
        pathIndex: 0,
        pathTimer: 0,
        lastKnown: null,
        sensorVisible: false,
    };
}

function loadLevel(number) {
    currentLevel = Math.max(1, number);
    level = getLevel(currentLevel);
    objects = level.objects;
    goal = level.goal;
    guards = level.guards.map(createGuard);
    chips = level.chips.map((chip) => ({ ...chip, collected: false, radius: 10 }));
    navGrid = new NavGrid(WORLD_WIDTH, WORLD_HEIGHT, 36, objects, 15);

    robot.x = level.start.x;
    robot.y = level.start.y;
    robot.angle = 0;
    robot.mode = 'normal';
    robot.currentViewRange = robot.viewRange;
    lastTracePos = { x: robot.x, y: robot.y };
    elapsedTime = 0;
    collectedChips = 0;
    pingTimer = 0;
    shakeTime = 0;
    mapCtx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    initializeCoverage();
    updateCamera();
    updateHud();
    document.getElementById('results-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    gameContainer.classList.remove('chase');
    isGameRunning = true;
    lastFrameTime = performance.now();
}

function moveEntity(entity, dx, dy) {
    entity.x += dx;
    if (objects.some((object) => circleRectCollide(entity.x, entity.y, entity.radius, object))) entity.x -= dx;
    entity.y += dy;
    if (objects.some((object) => circleRectCollide(entity.x, entity.y, entity.radius, object))) entity.y -= dy;
}

function getIntersection(ray, segment) {
    const sdx = segment.x2 - segment.x1;
    const sdy = segment.y2 - segment.y1;
    const denominator = ray.dx * sdy - ray.dy * sdx;
    if (Math.abs(denominator) < 0.00001) return null;
    const t1 = ((segment.x1 - ray.x) * sdy - (segment.y1 - ray.y) * sdx) / denominator;
    const t2 = ((segment.x1 - ray.x) * ray.dy - (segment.y1 - ray.y) * ray.dx) / denominator;
    if (t1 <= 0 || t1 > 1 || t2 < 0 || t2 > 1) return null;
    return { x: ray.x + ray.dx * t1, y: ray.y + ray.dy * t1, param: t1 };
}

function raycast(x, y, angle, maxDistance = robot.currentViewRange) {
    const dx = Math.cos(angle) * maxDistance;
    const dy = Math.sin(angle) * maxDistance;
    let closest = { x: x + dx, y: y + dy, hit: false, objColor: null, distParam: 1 };
    for (const object of objects) {
        const segments = [
            { x1: object.x, y1: object.y, x2: object.x + object.w, y2: object.y },
            { x1: object.x, y1: object.y + object.h, x2: object.x + object.w, y2: object.y + object.h },
            { x1: object.x, y1: object.y, x2: object.x, y2: object.y + object.h },
            { x1: object.x + object.w, y1: object.y, x2: object.x + object.w, y2: object.y + object.h },
        ];
        for (const segment of segments) {
            const hit = getIntersection({ x, y, dx, dy }, segment);
            if (hit && hit.param < closest.distParam) {
                closest = { ...hit, hit: true, objColor: object.color };
            }
        }
    }
    return closest;
}

function hasLineOfSight(x1, y1, x2, y2, padding = 0) {
    return !segmentBlocked(x1, y1, x2, y2, objects, padding);
}

function updateMap() {
    const rayCount = 120;
    mapCtx.lineCap = 'round';
    for (let i = 0; i < rayCount; i++) {
        const angle = i / rayCount * Math.PI * 2;
        const point = raycast(robot.x, robot.y, angle);
        mapCtx.beginPath();
        mapCtx.moveTo(robot.x, robot.y);
        mapCtx.lineTo(point.x, point.y);
        mapCtx.strokeStyle = 'rgba(30, 41, 59, 0.055)';
        mapCtx.lineWidth = 3;
        mapCtx.stroke();
        markExploredLine(robot.x, robot.y, point.x, point.y);
        if (point.hit) {
            mapCtx.beginPath();
            mapCtx.arc(point.x, point.y, 2, 0, Math.PI * 2);
            mapCtx.fillStyle = point.objColor;
            mapCtx.fill();
        }
    }

    if (Math.hypot(robot.x - lastTracePos.x, robot.y - lastTracePos.y) > 3) {
        mapCtx.beginPath();
        mapCtx.moveTo(lastTracePos.x, lastTracePos.y);
        mapCtx.lineTo(robot.x, robot.y);
        mapCtx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
        mapCtx.lineWidth = 2;
        mapCtx.stroke();
        lastTracePos = { x: robot.x, y: robot.y };
    }
}

function updateCamera() {
    camera.x = Math.max(0, Math.min(WORLD_WIDTH - screenWidth, robot.x - screenWidth / 2));
    camera.y = Math.max(0, Math.min(WORLD_HEIGHT - screenHeight, robot.y - screenHeight / 2));
}

function normalizeAngle(angle) {
    while (angle <= -Math.PI) angle += Math.PI * 2;
    while (angle > Math.PI) angle -= Math.PI * 2;
    return angle;
}

function setGuardPath(guard, target) {
    guard.path = navGrid.findPath(guard.x, guard.y, target.x, target.y) || [];
    guard.pathIndex = 0;
    guard.pathTimer = guard.state === 'chase' ? 0.35 : 1.2;
}

function followGuardPath(guard, speed, dt, target) {
    guard.pathTimer -= dt;
    if (guard.pathTimer <= 0 || !guard.path.length || guard.pathIndex >= guard.path.length) setGuardPath(guard, target);
    const point = guard.path[guard.pathIndex];
    if (!point) return;
    const dx = point.x - guard.x;
    const dy = point.y - guard.y;
    const distance = Math.hypot(dx, dy);
    if (distance < Math.max(8, speed * dt * 1.5)) {
        guard.pathIndex++;
        return;
    }
    const angle = Math.atan2(dy, dx);
    const amount = Math.min(distance, speed * dt);
    moveEntity(guard, Math.cos(angle) * amount, Math.sin(angle) * amount);
    guard.angle += normalizeAngle(angle - guard.angle) * Math.min(1, 7 * dt);
}

function updateGuards(dt) {
    let chasing = false;
    for (const guard of guards) {
        const distance = Math.hypot(robot.x - guard.x, robot.y - guard.y);
        if (distance < guard.radius + robot.radius) {
            triggerGameOver();
            return;
        }

        const angleToRobot = Math.atan2(robot.y - guard.y, robot.x - guard.x);
        const insideCone = Math.abs(normalizeAngle(angleToRobot - guard.angle)) <= guard.fov / 2;
        const canSee = distance <= guard.viewRange && insideCone && hasLineOfSight(guard.x, guard.y, robot.x, robot.y, 1);
        const detectionRate = robot.mode === 'run' ? 1.65 : robot.mode === 'sneak' ? 0.55 : 1;

        if (canSee) {
            guard.suspicion = Math.min(1, guard.suspicion + dt * 0.75 * detectionRate);
            guard.lastKnown = { x: robot.x, y: robot.y };
        } else {
            guard.suspicion = Math.max(0, guard.suspicion - dt * (guard.state === 'chase' ? 0.08 : 0.22));
        }

        if (guard.suspicion >= 1 && guard.state !== 'chase') {
            guard.state = 'chase';
            guard.pathTimer = 0;
            sfx.alarm();
        } else if (guard.suspicion > 0 && guard.state === 'patrol') {
            guard.state = 'suspicious';
            guard.path = [];
            sfx.suspicious();
        } else if (guard.suspicion === 0 && guard.state === 'suspicious') {
            guard.state = 'patrol';
            guard.pathTimer = 0;
        }

        if (guard.state === 'chase') {
            chasing = true;
            if (canSee) guard.lastKnown = { x: robot.x, y: robot.y };
            followGuardPath(guard, guard.chaseSpeed, dt, guard.lastKnown || robot);
            if (!canSee && guard.suspicion <= 0.15 && guard.lastKnown && Math.hypot(guard.x - guard.lastKnown.x, guard.y - guard.lastKnown.y) < 45) {
                guard.state = 'return';
                guard.lastKnown = null;
                guard.pathTimer = 0;
            }
        } else if (guard.state === 'suspicious') {
            guard.angle += normalizeAngle(angleToRobot - guard.angle) * Math.min(1, 4 * dt);
        } else {
            const target = guard.waypoints[guard.currentWaypoint];
            if (Math.hypot(target.x - guard.x, target.y - guard.y) < 35) {
                guard.currentWaypoint = (guard.currentWaypoint + 1) % guard.waypoints.length;
                guard.pathTimer = 0;
                if (guard.state === 'return') guard.state = 'patrol';
            }
            followGuardPath(guard, guard.patrolSpeed, dt, guard.waypoints[guard.currentWaypoint]);
        }

        guard.sensorVisible = distance <= robot.currentViewRange + guard.radius && hasLineOfSight(robot.x, robot.y, guard.x, guard.y);
    }

    gameContainer.classList.toggle('chase', chasing);
    if (chasing) shakeTime = Math.max(shakeTime, 0.12);
}

function updateRobot(dt) {
    let inputX = (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + joystickVector.x;
    let inputY = (keys.s ? 1 : 0) - (keys.w ? 1 : 0) + joystickVector.y;
    const magnitude = Math.hypot(inputX, inputY);
    if (magnitude > 1) {
        inputX /= magnitude;
        inputY /= magnitude;
    }

    robot.mode = keys.space ? 'sneak' : keys.shift ? 'run' : 'normal';
    const speedMultiplier = robot.mode === 'run' ? 1.65 : robot.mode === 'sneak' ? 0.48 : 1;
    robot.currentViewRange = robot.viewRange * (robot.mode === 'run' ? 0.62 : 1);
    if (magnitude > 0.05) {
        robot.angle = Math.atan2(inputY, inputX);
        moveEntity(robot, inputX * robot.baseSpeed * speedMultiplier * dt, inputY * robot.baseSpeed * speedMultiplier * dt);
        pingTimer -= dt;
        if (pingTimer <= 0) {
            sfx.ping();
            pingTimer = robot.mode === 'run' ? 1.4 : 2.8;
        }
    }
}

function updateChips() {
    for (const chip of chips) {
        if (!chip.collected && Math.hypot(robot.x - chip.x, robot.y - chip.y) < robot.radius + chip.radius + 4) {
            chip.collected = true;
            collectedChips++;
            sfx.pickup();
        }
    }
}

function checkGoal() {
    if (robot.x + robot.radius > goal.x && robot.x - robot.radius < goal.x + goal.width &&
        robot.y + robot.radius > goal.y && robot.y - robot.radius < goal.y + goal.height) finishGame();
}

function calculateStars(coverage) {
    let points = coverage >= 45 ? 1 : 0;
    if (coverage >= 70) points++;
    const chipRatio = chips.length ? collectedChips / chips.length : 1;
    if (chipRatio >= 0.75 && elapsedTime <= 300) points++;
    return Math.max(1, Math.min(3, points));
}

function finishGame() {
    if (!isGameRunning) return;
    isGameRunning = false;
    gameContainer.classList.remove('chase');
    const coverage = coveragePercent();
    const stars = calculateStars(coverage);
    resultCtx.fillStyle = '#05070d';
    resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);
    resultCtx.drawImage(mapCanvas, 0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0, 0, resultCanvas.width, resultCanvas.height);
    document.getElementById('result-level').textContent = `${level.name} selesai`;
    document.getElementById('result-stars').textContent = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
    document.getElementById('result-coverage').textContent = `${coverage.toFixed(1)}%`;
    document.getElementById('result-time').textContent = formatTime(elapsedTime);
    document.getElementById('result-chips').textContent = `${collectedChips}/${chips.length}`;
    document.getElementById('results-modal').classList.remove('hidden');
    sfx.win();
    for (let i = 0; i < stars; i++) window.setTimeout(() => sfx.star(i), 250 + i * 180);
}

function triggerGameOver() {
    if (!isGameRunning) return;
    isGameRunning = false;
    gameContainer.classList.remove('chase');
    document.getElementById('gameover-detail').textContent = `Tertangkap di Level ${currentLevel} setelah ${formatTime(elapsedTime)}.`;
    document.getElementById('gameover-modal').classList.remove('hidden');
    sfx.caught();
}

function drawGoal() {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.fillRect(goal.x, goal.y, goal.width, goal.height);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.strokeRect(goal.x, goal.y, goal.width, goal.height);
    ctx.fillStyle = '#6ee7b7';
    ctx.font = '700 18px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', goal.x + goal.width / 2, goal.y + goal.height / 2 + 6);
}

function drawChips() {
    for (const chip of chips) {
        if (chip.collected) continue;
        ctx.save();
        ctx.translate(chip.x, chip.y);
        ctx.rotate(performance.now() / 700);
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#67e8f9';
        ctx.fillRect(-8, -8, 16, 16);
        ctx.strokeStyle = '#0e7490';
        ctx.lineWidth = 3;
        ctx.strokeRect(-8, -8, 16, 16);
        ctx.restore();
    }
}

function drawGuards() {
    for (const guard of guards) {
        if (!guard.sensorVisible) continue;
        const chasing = guard.state === 'chase';
        const suspicious = guard.suspicion > 0 && !chasing;
        ctx.beginPath();
        ctx.moveTo(guard.x, guard.y);
        ctx.arc(guard.x, guard.y, guard.viewRange, guard.angle - guard.fov / 2, guard.angle + guard.fov / 2);
        ctx.closePath();
        ctx.fillStyle = chasing ? 'rgba(239, 68, 68, 0.22)' : 'rgba(245, 158, 11, 0.10)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(guard.x, guard.y, guard.radius, 0, Math.PI * 2);
        ctx.fillStyle = chasing ? '#ef4444' : suspicious ? '#facc15' : '#fb7185';
        ctx.fill();
        if (suspicious || chasing) {
            ctx.fillStyle = chasing ? '#ef4444' : '#facc15';
            ctx.font = '800 24px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(chasing ? '!' : '?', guard.x, guard.y - 22);
            if (suspicious) {
                ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                ctx.fillRect(guard.x - 18, guard.y - 17, 36, 4);
                ctx.fillStyle = '#facc15';
                ctx.fillRect(guard.x - 18, guard.y - 17, 36 * guard.suspicion, 4);
            }
        }
    }
}

function drawSensor() {
    const rayCount = 64;
    ctx.lineWidth = 1;
    for (let i = 0; i < rayCount; i++) {
        const angle = i / rayCount * Math.PI * 2;
        const point = raycast(robot.x, robot.y, angle);
        ctx.beginPath();
        ctx.moveTo(robot.x, robot.y);
        ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.11)';
        ctx.stroke();
    }
}

function drawRobot() {
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#60a5fa';
    ctx.beginPath();
    ctx.arc(0, 0, robot.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#60a5fa';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.rotate(robot.angle);
    ctx.beginPath();
    ctx.moveTo(robot.radius + 8, 0);
    ctx.lineTo(3, -6);
    ctx.lineTo(3, 6);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.restore();
}

function renderMinimap() {
    minimapCtx.fillStyle = '#05070d';
    minimapCtx.fillRect(0, 0, 150, 150);
    minimapCtx.save();
    minimapCtx.translate(75, 75);
    minimapCtx.scale(0.15, 0.15);
    minimapCtx.translate(-robot.x, -robot.y);
    minimapCtx.drawImage(mapCanvas, 0, 0);
    minimapCtx.beginPath();
    minimapCtx.arc(robot.x, robot.y, 28, 0, Math.PI * 2);
    minimapCtx.fillStyle = '#60a5fa';
    minimapCtx.fill();
    minimapCtx.restore();
}

function render() {
    ctx.fillStyle = '#020308';
    ctx.fillRect(0, 0, screenWidth, screenHeight);
    ctx.save();
    if (shakeTime > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    ctx.translate(-camera.x, -camera.y);
    ctx.drawImage(mapCanvas, 0, 0);
    drawGoal();
    drawChips();
    drawGuards();
    drawSensor();
    drawRobot();
    ctx.restore();
    renderMinimap();
}

function gameLoop(timestamp) {
    if (!isGameRunning) return;
    const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
    lastFrameTime = timestamp;
    elapsedTime += dt;
    shakeTime = Math.max(0, shakeTime - dt);

    updateRobot(dt);
    updateMap();
    updateCamera();
    updateChips();
    updateGuards(dt);
    checkGoal();
    updateHud();
    if (!isGameRunning) return;
    render();
    requestAnimationFrame(gameLoop);
}

let joystickActive = false;
let joystickVector = { x: 0, y: 0 };
const joystickBase = document.getElementById('joystick-base');
const joystickKnob = document.getElementById('joystick-knob');

function handleJoystick(event) {
    if (!joystickActive) return;
    event.preventDefault();
    const pointer = event.touches ? event.touches[0] : event;
    const rect = joystickBase.getBoundingClientRect();
    const maxRadius = rect.width / 2 - joystickKnob.offsetWidth / 2;
    let x = pointer.clientX - (rect.left + rect.width / 2);
    let y = pointer.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(x, y);
    if (distance > maxRadius) {
        x *= maxRadius / distance;
        y *= maxRadius / distance;
    }
    joystickVector = { x: x / maxRadius, y: y / maxRadius };
    joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
}

function stopJoystick() {
    joystickActive = false;
    joystickVector = { x: 0, y: 0 };
    joystickKnob.style.transform = 'translate(0, 0)';
}

joystickBase.addEventListener('pointerdown', (event) => {
    joystickActive = true;
    joystickBase.setPointerCapture(event.pointerId);
    handleJoystick(event);
    sfx.unlock();
});
joystickBase.addEventListener('pointermove', handleJoystick);
joystickBase.addEventListener('pointerup', stopJoystick);
joystickBase.addEventListener('pointercancel', stopJoystick);

window.addEventListener('keydown', (event) => {
    const key = event.code === 'Space' ? 'space' : event.key.toLowerCase();
    if (Object.hasOwn(keys, key)) {
        keys[key] = true;
        event.preventDefault();
    }
    sfx.unlock();
});
window.addEventListener('keyup', (event) => {
    const key = event.code === 'Space' ? 'space' : event.key.toLowerCase();
    if (Object.hasOwn(keys, key)) keys[key] = false;
});
window.addEventListener('blur', () => Object.keys(keys).forEach((key) => { keys[key] = false; }));

document.getElementById('restart-btn').addEventListener('click', () => {
    loadLevel(currentLevel);
    requestAnimationFrame(gameLoop);
});
document.getElementById('retry-btn').addEventListener('click', () => {
    loadLevel(currentLevel);
    requestAnimationFrame(gameLoop);
});
document.getElementById('next-level-btn').addEventListener('click', () => {
    loadLevel(currentLevel + 1);
    requestAnimationFrame(gameLoop);
});
document.getElementById('mute-btn').addEventListener('click', (event) => {
    const muted = sfx.toggleMute();
    event.currentTarget.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
});
document.getElementById('mute-btn').textContent = sfx.isMuted() ? 'SOUND OFF' : 'SOUND ON';

loadLevel(1);
requestAnimationFrame(gameLoop);
