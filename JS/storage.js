const STORAGE_KEY = 'mycelium_network_state';

const defaultState = {
  audioSettings: { sfxEnabled: true, bgmEnabled: true },
  progress: { tutorialDone: false, unlockedLevel: 1 },
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(defaultState));
    const parsed = JSON.parse(raw);
    return {
      ...defaultState,
      ...parsed,
      audioSettings: { ...defaultState.audioSettings, ...(parsed.audioSettings || {}) },
      progress: { ...defaultState.progress, ...(parsed.progress || {}) },
    };
  } catch {
    return JSON.parse(JSON.stringify(defaultState));
  }
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function loadAudioSettings() { return loadState().audioSettings; }
export function saveAudioSettings(audioSettings) {
  const s = loadState();
  s.audioSettings = { ...s.audioSettings, ...audioSettings };
  saveState(s);
}

export function loadProgress() { return loadState().progress; }
export function saveProgress(progress) {
  const s = loadState();
  s.progress = { ...s.progress, ...progress };
  saveState(s);
}
