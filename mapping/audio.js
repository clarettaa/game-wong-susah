// Tiny synthesized sound effects using the Web Audio API (no audio files needed).
// The AudioContext is created lazily on the first user gesture (browser autoplay policy).

let ctx = null;
let master = null;
let muted = localStorage.getItem('robotMapper.muted') === '1';
const MASTER_VOLUME = 0.6;

function ensureContext() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : MASTER_VOLUME;
        master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

function tone({ freq = 440, endFreq = null, type = 'sine', duration = 0.2, volume = 0.2, delay = 0 }) {
    const ac = ensureContext();
    if (!ac || muted) return;

    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
}

export const sfx = {
    unlock: () => ensureContext(),
    isMuted: () => muted,
    toggleMute() {
        muted = !muted;
        localStorage.setItem('robotMapper.muted', muted ? '1' : '0');
        if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
        return muted;
    },

    ping: () => tone({ freq: 1400, endFreq: 700, duration: 0.35, volume: 0.025 }),
    click: () => tone({ freq: 900, duration: 0.06, volume: 0.05 }),
    suspicious: () => tone({ freq: 500, endFreq: 760, type: 'triangle', duration: 0.18, volume: 0.08 }),
    alarm() {
        [0, 0.17, 0.34].forEach((delay, i) =>
            tone({ freq: i % 2 ? 660 : 880, type: 'square', duration: 0.15, volume: 0.05, delay }));
    },
    pickup() {
        [660, 880, 1320].forEach((freq, i) =>
            tone({ freq, type: 'triangle', duration: 0.12, volume: 0.1, delay: i * 0.06 }));
    },
    goal() {
        [880, 1175].forEach((freq, i) =>
            tone({ freq, type: 'triangle', duration: 0.2, volume: 0.08, delay: i * 0.1 }));
    },
    win() {
        [523, 659, 784, 1047].forEach((freq, i) =>
            tone({ freq, type: 'triangle', duration: 0.3, volume: 0.12, delay: i * 0.12 }));
    },
    star: (i) => tone({ freq: 700 + i * 220, type: 'triangle', duration: 0.25, volume: 0.1 }),
    caught: () => tone({ freq: 420, endFreq: 60, type: 'sawtooth', duration: 0.7, volume: 0.12 }),
};
