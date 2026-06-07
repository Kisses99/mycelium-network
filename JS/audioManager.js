/**
 * audioManager.js — 100% procedural Web Audio API synthesis.
 * No external audio files. All sounds built from oscillators, noise buffers, and filters.
 */

import { loadAudioSettings, saveAudioSettings } from './storage.js';

let ctx = null;
let masterSfxGain = null;
let masterBgmGain = null;

// BGM components kept alive for toggling
let bgmOscillators = [];
let bgmLfoOsc = null;
let bgmFilter = null;
let bgmMix = null;

const BGM_VOLUME = 0.10;
const SFX_VOLUME = 0.25;
const RAMP_TIME = 0.2;

let settings = { sfxEnabled: true, bgmEnabled: true };

function ensureContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  masterSfxGain = ctx.createGain();
  masterSfxGain.gain.value = SFX_VOLUME;
  masterSfxGain.connect(ctx.destination);

  masterBgmGain = ctx.createGain();
  masterBgmGain.gain.value = BGM_VOLUME;
  masterBgmGain.connect(ctx.destination);
}

// ─── BGM ─────────────────────────────────────────────────────────────────────

function buildBgm() {
  if (!ctx) return;

  // Three detuned sine oscillators for the drone
  const baseFreqs = [55, 110.3, 165.7];
  bgmMix = ctx.createGain();
  bgmMix.gain.value = 0.33;

  bgmFilter = ctx.createBiquadFilter();
  bgmFilter.type = 'lowpass';
  bgmFilter.frequency.value = 250;
  bgmFilter.Q.value = 1.2;

  bgmOscillators = baseFreqs.map((freq) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(bgmMix);
    osc.start();
    return osc;
  });

  // LFO that sweeps filter cutoff 150–400 Hz over ~12 seconds
  bgmLfoOsc = ctx.createOscillator();
  bgmLfoOsc.type = 'sine';
  bgmLfoOsc.frequency.value = 1 / 12;

  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 125; // ±125 Hz around center 275

  bgmLfoOsc.connect(lfoGain);
  lfoGain.connect(bgmFilter.frequency);
  bgmLfoOsc.start();

  bgmMix.connect(bgmFilter);
  bgmFilter.connect(masterBgmGain);
}

// ─── SFX Helpers ─────────────────────────────────────────────────────────────

function createNoiseBuffer(duration) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// ─── SFX: Player Node Placement ──────────────────────────────────────────────

export function playSporeDrop() {
  if (!ctx || !settings.sfxEnabled) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);

  gain.gain.setValueAtTime(1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc.connect(gain);
  gain.connect(masterSfxGain);
  osc.start(now);
  osc.stop(now + 0.16);
}

// ─── SFX: AI Node Placement ──────────────────────────────────────────────────

export function playBlightSpread() {
  if (!ctx || !settings.sfxEnabled) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 300;
  filter.Q.value = 2;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterSfxGain);
  osc.start(now);
  osc.stop(now + 0.26);
}

// ─── SFX: Capture Burst ──────────────────────────────────────────────────────

export function playSporeBurst() {
  if (!ctx || !settings.sfxEnabled) return;
  const now = ctx.currentTime;
  const duration = 0.6;

  const noiseBuffer = createNoiseBuffer(duration);
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(400, now);
  filter.frequency.exponentialRampToValueAtTime(40, now + duration);
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterSfxGain);
  source.start(now);
  source.stop(now + duration + 0.01);
}

// ─── SFX: Victory / Game Over Arpeggio ───────────────────────────────────────

export function playEndJingle(isVictory) {
  if (!ctx || !settings.sfxEnabled) return;
  // Pentatonic scale notes (Hz)
  const pentatonic = isVictory
    ? [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]
    : [523.25, 440.0, 392.0, 329.63, 261.63, 196.0];

  pentatonic.forEach((freq, i) => {
    const t = ctx.currentTime + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.6, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

    osc.connect(gain);
    gain.connect(masterSfxGain);
    osc.start(t);
    osc.stop(t + 0.72);
  });
}

// ─── Toggle Helpers ───────────────────────────────────────────────────────────

export function setSfxEnabled(enabled) {
  settings.sfxEnabled = enabled;
  saveAudioSettings(settings);
  if (!masterSfxGain) return;
  const now = ctx.currentTime;
  masterSfxGain.gain.linearRampToValueAtTime(enabled ? SFX_VOLUME : 0, now + RAMP_TIME);
}

export function setBgmEnabled(enabled) {
  settings.bgmEnabled = enabled;
  saveAudioSettings(settings);
  if (!masterBgmGain) return;
  const now = ctx.currentTime;
  masterBgmGain.gain.linearRampToValueAtTime(enabled ? BGM_VOLUME : 0, now + RAMP_TIME);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initAudio(savedSettings) {
  settings = { ...settings, ...savedSettings };
}

export function resumeAudio() {
  ensureContext();
  if (ctx.state === 'suspended') ctx.resume();

  if (!bgmOscillators.length) {
    buildBgm();
    // Apply persisted BGM preference immediately (no ramp needed at cold start)
    masterBgmGain.gain.value = settings.bgmEnabled ? BGM_VOLUME : 0;
    masterSfxGain.gain.value = settings.sfxEnabled ? SFX_VOLUME : 0;
  }
}

export function getSettings() {
  return { ...settings };
}
