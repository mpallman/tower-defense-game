// audio.js — every sound is synthesised at runtime. No audio file is ever
// loaded, downloaded or committed.
//
// The AudioContext is created on the first user gesture, never before, because
// browsers refuse to start one otherwise (and silently, which is worse).

import { BALANCE } from './balance.js';

// Musical content, not balance: a four-bar loop in A minor.
const A = 45; // MIDI A2
const PROGRESSION = [
  { root: 0,  quality: [0, 3, 7] },   // i   Am
  { root: -4, quality: [0, 4, 7] },   // VI  F
  { root: 3,  quality: [0, 4, 7] },   // III C
  { root: -2, quality: [0, 4, 7] },   // VII G
];
const PENTATONIC = [0, 3, 5, 7, 10];
const ARP_PATTERN = [0, 2, 1, 3, 2, 4, 1, 2];

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio(options = {}) {
  const cfg = BALANCE.audio;
  const getState = options.getState || (() => ({ muted: false, musicOff: false, wave: 1 }));

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let musicBus = null;
  let noiseBuffer = null;
  let voices = 0;
  let shotBudget = cfg.shotsPerSecond;
  let budgetAt = 0;
  let timer = 0;
  let step = 0;
  let nextStepTime = 0;
  let musicTarget = -1;

  const stepSeconds = () => 60 / cfg.bpm / (cfg.stepsPerBar / 4);

  function makeNoise() {
    const frames = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // Called from a real user gesture. Safe to call repeatedly.
  function unlock() {
    if (!ctx) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = cfg.master;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = cfg.sfx;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(master);
      noiseBuffer = makeNoise();
      nextStepTime = ctx.currentTime;
      startScheduler();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const active = () => !!ctx && !getState().muted;

  function claimVoice(when) {
    if (voices >= cfg.maxVoices) return false;
    voices += 1;
    // Release the slot slightly after the sound is due to finish.
    setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.max(30, when * 1000 + 60));
    return true;
  }

  // --- primitives ---------------------------------------------------------
  function tone({ freq, to, duration, type = 'square', gain = 0.2, bus = sfxBus, delay = 0, sweepType = 'exp' }) {
    if (!active()) return;
    if (bus === sfxBus && !claimVoice(duration + delay)) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to && to !== freq) {
      if (sweepType === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
      else osc.frequency.linearRampToValueAtTime(Math.max(20, to), t + duration);
    }
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, duration * 0.3));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(bus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function noise({ duration, gain = 0.2, cutoff = 1200, sweepTo = 200, delay = 0 }) {
    if (!active()) return;
    if (!claimVoice(duration + delay)) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(amp).connect(sfxBus);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // --- sound effects ------------------------------------------------------
  function shot(towerType) {
    if (!active()) return;
    const now = ctx.currentTime;
    if (now - budgetAt >= 1) { shotBudget = cfg.shotsPerSecond; budgetAt = now; }
    if (shotBudget <= 0) return;   // twenty turrets must not sound like twenty
    shotBudget -= 1;

    if (towerType === 'laser') {
      tone({ freq: 1400, to: 520, duration: 0.05, type: 'sawtooth', gain: 0.05 });
    } else if (towerType === 'mortar') {
      tone({ freq: 150, to: 45, duration: 0.18, type: 'sine', gain: 0.22 });
      noise({ duration: 0.14, gain: 0.1, cutoff: 900, sweepTo: 120 });
    } else {
      tone({ freq: 340, to: 150, duration: 0.06, type: 'square', gain: 0.09 });
    }
  }

  const sounds = {
    kill: (boss) => boss
      ? (tone({ freq: 220, to: 60, duration: 0.5, type: 'sawtooth', gain: 0.2 }),
         noise({ duration: 0.5, gain: 0.2, cutoff: 2200, sweepTo: 100 }))
      : tone({ freq: 620, to: 880, duration: 0.07, type: 'triangle', gain: 0.06 }),
    leak: () => tone({ freq: 200, to: 90, duration: 0.22, type: 'sawtooth', gain: 0.14 }),
    build: () => {
      tone({ freq: 300, to: 300, duration: 0.06, type: 'square', gain: 0.1 });
      tone({ freq: 450, to: 450, duration: 0.09, type: 'square', gain: 0.09, delay: 0.06 });
    },
    upgrade: () => {
      tone({ freq: 520, to: 520, duration: 0.07, type: 'triangle', gain: 0.1 });
      tone({ freq: 780, to: 780, duration: 0.12, type: 'triangle', gain: 0.09, delay: 0.07 });
    },
    sell: () => tone({ freq: 400, to: 220, duration: 0.14, type: 'triangle', gain: 0.09 }),
    deny: () => tone({ freq: 180, to: 130, duration: 0.12, type: 'square', gain: 0.08 }),
    waveStart: (boss) => {
      if (boss) {
        tone({ freq: 90, to: 45, duration: 1.1, type: 'sawtooth', gain: 0.22 });
        tone({ freq: 180, to: 90, duration: 1.1, type: 'triangle', gain: 0.12, delay: 0.05 });
      } else {
        tone({ freq: 330, to: 330, duration: 0.1, type: 'triangle', gain: 0.08 });
      }
    },
    waveClear: () => {
      tone({ freq: 523, to: 523, duration: 0.1, type: 'triangle', gain: 0.09 });
      tone({ freq: 784, to: 784, duration: 0.16, type: 'triangle', gain: 0.08, delay: 0.09 });
    },
    breach: () => {
      tone({ freq: 300, to: 40, duration: 0.9, type: 'sawtooth', gain: 0.25 });
      noise({ duration: 0.9, gain: 0.22, cutoff: 1800, sweepTo: 80 });
    },
    prestige: () => {
      [0, 4, 7, 12].forEach((semi, i) => {
        tone({ freq: midiToFreq(69 + semi), to: midiToFreq(69 + semi), duration: 0.3,
          type: 'triangle', gain: 0.09, delay: i * 0.09 });
      });
    },
  };

  // --- procedural music ---------------------------------------------------
  // How busy the loop is: rises with the wave, jumps on boss waves.
  function intensity() {
    const s = getState();
    const base = Math.min(1, (s.wave || 1) / cfg.intensityWaves);
    return Math.min(1, base + (s.boss ? cfg.bossIntensity : 0));
  }

  function musicNote({ midi, time, duration, type, gain, detune = 0, cutoff = 0 }) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = midiToFreq(midi);
    osc.detune.value = detune;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(gain, time + duration * 0.25);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    let node = amp;
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      amp.connect(filter);
      node = filter;
    }
    osc.connect(amp);
    node.connect(musicBus);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  function scheduleStep(index, time) {
    const bar = Math.floor(index / cfg.stepsPerBar) % PROGRESSION.length;
    const beat = index % cfg.stepsPerBar;
    const chord = PROGRESSION[bar];
    const level = intensity();
    const barSeconds = stepSeconds() * cfg.stepsPerBar;

    if (beat === 0) {
      // pad: the chord, held for the bar, slightly detuned for width
      for (const semi of chord.quality) {
        musicNote({ midi: A + 12 + chord.root + semi, time, duration: barSeconds * 0.95,
          type: 'triangle', gain: 0.05 + level * 0.03, detune: -6, cutoff: 700 + level * 900 });
        musicNote({ midi: A + 12 + chord.root + semi, time, duration: barSeconds * 0.95,
          type: 'triangle', gain: 0.04 + level * 0.03, detune: 7, cutoff: 700 + level * 900 });
      }
    }
    if (beat % 4 === 0) {
      musicNote({ midi: A + chord.root, time, duration: stepSeconds() * 1.6,
        type: 'sine', gain: 0.12 + level * 0.05 });
    }
    // arpeggio thickens as the run gets deeper
    if (level > 0.15 && (beat % 2 === 0 || level > 0.6)) {
      const degree = PENTATONIC[ARP_PATTERN[index % ARP_PATTERN.length] % PENTATONIC.length];
      musicNote({ midi: A + 24 + chord.root + degree, time, duration: stepSeconds() * 0.8,
        type: 'triangle', gain: 0.03 + level * 0.035, cutoff: 1800 + level * 2500 });
    }
  }

  function tick() {
    if (!ctx) return;
    const s = getState();
    // Only schedule a ramp when the target actually changes. Re-issuing
    // setTargetAtTime every tick restarts the curve and the fade crawls.
    const wanted = s.muted || s.musicOff ? 0 : cfg.music;
    if (wanted !== musicTarget) {
      musicTarget = wanted;
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
      // Muting should feel instant; fading back in should not thump.
      const fade = (wanted === 0 ? cfg.muteFadeSeconds : cfg.fadeSeconds) / 3;
      musicBus.gain.setTargetAtTime(wanted, ctx.currentTime, fade);
    }
    if (wanted === 0) { nextStepTime = Math.max(nextStepTime, ctx.currentTime); return; }
    while (nextStepTime < ctx.currentTime + cfg.lookahead) {
      if (nextStepTime >= ctx.currentTime) scheduleStep(step, nextStepTime);
      nextStepTime += stepSeconds();
      step += 1;
    }
  }

  function startScheduler() {
    if (timer) return;
    timer = setInterval(tick, cfg.tickInterval);
  }

  return {
    unlock,
    isActive: () => !!ctx,
    contextState: () => (ctx ? ctx.state : 'none'),
    shot,
    play(name, arg) {
      if (!active()) return;
      const fn = sounds[name];
      if (fn) fn(arg);
    },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    debug: () => ({ voices, step, music: musicBus ? musicBus.gain.value : 0 }),
  };
}
