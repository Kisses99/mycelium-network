/**
 * audioManager.js
 *
 * SFX  — Raw Web Audio API (no external deps, instant)
 * BGM  — Tone.js procedural MIDI sequencer
 *         3 layers: deep sine bass · triangle pad arpeggio · sparse bell drops
 *         Effects:  long cave reverb (9 s decay) + dotted-quarter echo delay
 *         Tempo:    58 BPM  —  slow, meditative, organic
 */

import { saveAudioSettings } from './storage.js';

// ─── Shared state ─────────────────────────────────────────────────────────────
let settings = { sfxEnabled: true, bgmEnabled: true };
const RAMP_S = 0.25;

// ─── SFX: Raw Web Audio API ───────────────────────────────────────────────────
let sfxCtx       = null;
let masterSfxGain = null;
const SFX_VOL = 0.25;

function ensureSfxCtx() {
  if (sfxCtx) return;
  sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterSfxGain = sfxCtx.createGain();
  masterSfxGain.gain.value = settings.sfxEnabled ? SFX_VOL : 0;
  masterSfxGain.connect(sfxCtx.destination);
}

function mkNoise(dur) {
  const len = Math.floor(sfxCtx.sampleRate * dur);
  const buf = sfxCtx.createBuffer(1, len, sfxCtx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function playSporeDrop() {
  if (!sfxCtx || !settings.sfxEnabled) return;
  const t = sfxCtx.currentTime;
  const osc = sfxCtx.createOscillator(), g = sfxCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.15);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(g); g.connect(masterSfxGain);
  osc.start(t); osc.stop(t + 0.16);
}

export function playBlightSpread() {
  if (!sfxCtx || !settings.sfxEnabled) return;
  const t = sfxCtx.currentTime;
  const osc = sfxCtx.createOscillator();
  const flt = sfxCtx.createBiquadFilter();
  const g   = sfxCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.25);
  flt.type = 'lowpass'; flt.frequency.value = 300; flt.Q.value = 2;
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(flt); flt.connect(g); g.connect(masterSfxGain);
  osc.start(t); osc.stop(t + 0.26);
}

export function playSporeBurst() {
  if (!sfxCtx || !settings.sfxEnabled) return;
  const t   = sfxCtx.currentTime;
  const src = sfxCtx.createBufferSource();
  src.buffer = mkNoise(0.6);
  const flt = sfxCtx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(400, t);
  flt.frequency.exponentialRampToValueAtTime(40, t + 0.6);
  flt.Q.value = 1.5;
  const g = sfxCtx.createGain();
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  src.connect(flt); flt.connect(g); g.connect(masterSfxGain);
  src.start(t); src.stop(t + 0.61);
}

export function playEndJingle(isVictory) {
  if (!sfxCtx || !settings.sfxEnabled) return;
  const notes = isVictory
    ? [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]
    : [523.25, 440.0, 392.0, 329.63, 261.63, 196.0];
  notes.forEach((freq, i) => {
    const t   = sfxCtx.currentTime + i * 0.18;
    const osc = sfxCtx.createOscillator(), g = sfxCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g); g.connect(masterSfxGain);
    osc.start(t); osc.stop(t + 0.72);
  });
}

// ─── BGM: Tone.js sequencer ───────────────────────────────────────────────────
let bgmMaster = null; // Tone.Gain — master volume knob for BGM
let bgmBuilt  = false;

async function buildBgm() {
  if (bgmBuilt || !window.Tone) return;
  bgmBuilt = true;
  const T = window.Tone;

  // Master output for whole BGM (used for smooth mute / unmute)
  bgmMaster = new T.Gain(settings.bgmEnabled ? 0.72 : 0).toDestination();

  // ── Cave reverb (shared by all layers) ────────────────────────────────────
  const reverb = new T.Reverb({ decay: 9, wet: 0.78, preDelay: 0.05 });
  await reverb.generate(); // pre-bake impulse response
  reverb.connect(bgmMaster);

  // ── Dotted-quarter echo → feeds into reverb ───────────────────────────────
  const echo = new T.FeedbackDelay({
    delayTime : '4n.',   // dotted quarter = 1.5 beats ≈ 1.55 s at 58 BPM
    feedback  : 0.50,    // 50% repeat — long, trailing echoes
    wet       : 0.40,
  });
  echo.connect(reverb);

  // ── Layer 1: Deep sine bass drone (every 2 bars) ──────────────────────────
  const bass = new T.PolySynth(T.Synth, {
    oscillator: { type: 'sine' },
    envelope  : { attack: 2.8, decay: 0.8, sustain: 0.88, release: 7 },
  });
  bass.volume.value = -17;
  bass.connect(reverb); // bypass echo — pure reverb for depth

  const bassChords = [['A1','E2'], ['E2','B2'], ['D2','A2'], ['A1','E2']];
  let bIdx = 0;
  new T.Loop(time => {
    bass.triggerAttackRelease(
      bassChords[bIdx++ % bassChords.length],
      '2m', time,
      0.26 + Math.random() * 0.06,
    );
  }, '2m').start(0);

  // ── Layer 2: Triangle pad arpeggio (every 2 bars, offset 1 bar) ───────────
  const pad = new T.PolySynth(T.Synth, {
    oscillator: { type: 'triangle' },
    envelope  : { attack: 1.5, decay: 0.4, sustain: 0.72, release: 5 },
  });
  pad.volume.value = -23;
  pad.connect(echo); // echo → reverb for trailing shimmer

  // A-minor pentatonic phrases
  const padPhrases = [
    ['A3','C4','E4'],
    ['G3','A3','C4'],
    ['E3','A3','G3'],
    ['D3','A3','E4'],
  ];
  let pIdx = 0;
  const stepSec = T.Time('4n.').toSeconds(); // gap between arpeggio notes
  new T.Loop(time => {
    const phrase = padPhrases[pIdx++ % padPhrases.length];
    phrase.forEach((note, i) => {
      pad.triggerAttackRelease(
        note, '2n',
        time + i * stepSec,
        0.17 + Math.random() * 0.08,
      );
    });
  }, '2m').start('1m'); // stagger 1 bar after bass

  // ── Layer 3: Sparse sine bell drops ──────────────────────────────────────
  const bell = new T.Synth({
    oscillator: { type: 'sine' },
    envelope  : { attack: 0.004, decay: 2.8, sustain: 0.01, release: 8 },
  });
  bell.volume.value = -26;
  bell.connect(echo); // long echo trails on bells

  const bellNotes = ['A5','E5','G5','C5','D5','A5','E5'];
  let bellI = 0;
  new T.Loop(time => {
    // Only ring ~55% of loops for an organic, unpredictable feel
    if (Math.random() < 0.55) {
      bell.triggerAttackRelease(
        bellNotes[bellI % bellNotes.length], '32n',
        time,
        0.13 + Math.random() * 0.10,
      );
    }
    bellI++;
  }, '1m.').start('4m'); // enter late, ring every ~2.5 bars

  // ── Start transport ───────────────────────────────────────────────────────
  T.Transport.bpm.value = 58;
  T.Transport.start();
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function initAudio(savedSettings) {
  settings = { ...settings, ...savedSettings };
}

export function resumeAudio() {
  ensureSfxCtx();
  if (sfxCtx.state === 'suspended') sfxCtx.resume();
  if (window.Tone) {
    window.Tone.start().then(() => {
      if (!bgmBuilt) buildBgm();
    });
  }
}

export function setSfxEnabled(enabled) {
  settings.sfxEnabled = enabled;
  saveAudioSettings(settings);
  if (!masterSfxGain) return;
  const t = sfxCtx.currentTime;
  masterSfxGain.gain.linearRampToValueAtTime(enabled ? SFX_VOL : 0, t + RAMP_S);
}

export function setBgmEnabled(enabled) {
  settings.bgmEnabled = enabled;
  saveAudioSettings(settings);
  if (bgmMaster) bgmMaster.gain.rampTo(enabled ? 0.72 : 0, RAMP_S);
}

export function getSettings() {
  return { ...settings };
}
