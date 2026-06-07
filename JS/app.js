/**
 * app.js — Game loop, screen management, tutorial, and level progression.
 *
 * Screen flow:
 *   tutorial-card → playing (tutorial) → gameover
 *     → level-intro → playing → gameover → level-intro → …
 *       → campaign-complete
 */

import { generateBoard, computeEdgeControlPoints } from './boardGen.js';
import { applyMove, getLegalMoves, getScores } from './rulesEngine.js';
import { getAIMove } from './aiEngine.js';
import {
  initAudio, resumeAudio, getSettings,
  playSporeDrop, playBlightSpread, playSporeBurst, playEndJingle,
  setSfxEnabled, setBgmEnabled,
} from './audioManager.js';
import { loadAudioSettings, loadProgress, saveProgress } from './storage.js';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let mouseX = 0, mouseY = 0;

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();

// ─── Level Config ─────────────────────────────────────────────────────────────
const LEVELS = [
  { id: 0, name: 'Tutorial',  nodeCount: 20, difficulty: 'easy',        accentColor: '#55ff99', desc: 'Learn the network' },
  { id: 1, name: 'Level 1',   nodeCount: 28, difficulty: 'easy',        accentColor: '#55ff99', desc: 'First Growth' },
  { id: 2, name: 'Level 2',   nodeCount: 34, difficulty: 'easy',        accentColor: '#aaff55', desc: 'The Spores Spread' },
  { id: 3, name: 'Level 3',   nodeCount: 40, difficulty: 'medium-easy', accentColor: '#ffdd44', desc: 'The Network Deepens' },
  { id: 4, name: 'Level 4',   nodeCount: 46, difficulty: 'medium',      accentColor: '#ff8844', desc: 'Underground War' },
  { id: 5, name: 'Level 5',   nodeCount: 54, difficulty: 'hard',        accentColor: '#ff4455', desc: 'The Final Blight' },
];

const DIFF_LABEL = {
  easy: 'Easy', 'medium-easy': 'Intermediate', medium: 'Medium', hard: 'Hard'
};

const TUTORIAL_CARDS = [
  {
    title: 'Mycelium Network',
    lines: [
      'You are the living Mycelium (green).',
      'Your enemy: the Blight (red).',
      '',
      'Spread across the organic network.',
      'Outlast the Blight to claim victory.',
    ],
    btn: 'Next  →',
  },
  {
    title: 'Groups & Liberties',
    lines: [
      'Connected same-color nodes form a Group.',
      '',
      'Groups share Liberties — empty neighbors.',
      'A group with zero Liberties is Captured.',
      'Captured nodes return to empty.',
    ],
    btn: 'Next  →',
  },
  {
    title: 'Atari — Danger!',
    lines: [
      'A group with only 1 Liberty left',
      'is in Atari — one move from capture.',
      '',
      'Expand it fast, or the Blight',
      'will close in and destroy it.',
    ],
    btn: 'Next  →',
  },
  {
    title: 'Ready to Play!',
    lines: [
      'Click a glowing node to place a spore.',
      'Turns alternate: Mycelium, then Blight.',
      '',
      'When the board is full,',
      'the player with the most nodes wins!',
    ],
    btn: 'Begin Tutorial',
  },
];

// ─── Game State ───────────────────────────────────────────────────────────────
let screen = 'tutorial-card'; // 'tutorial-card'|'level-intro'|'playing'|'gameover'|'campaign-complete'
let currentLevelIdx = 0;
let tutorialCardIdx = 0;

let nodes = [];
let edgeCPs = [];
let legalMoves = new Set();
let hoveredNode = null;
let gamePhase = 'playing'; // 'playing' | 'done'
let scores = { mycelium: 0, blight: 0 };
let captureFlash = [];
let aiDelay = null;
let gameoverResult = null; // 'win' | 'lose' | 'tutorial-done'

const PLAYER = 'mycelium';
const AI     = 'blight';
const AI_THINK_MS = 680;

// ─── Button Registry (rebuilt each frame) ────────────────────────────────────
let _btns = [];
function clearBtns() { _btns = []; }
function regBtn(x, y, w, h, fn) { _btns.push({ x, y, w, h, fn }); }
function hitBtn(x, y) { return _btns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); }

// ─── Level Lifecycle ──────────────────────────────────────────────────────────
function initLevel(idx) {
  currentLevelIdx = idx;
  const cfg = LEVELS[idx];
  const board = generateBoard(canvas.width, canvas.height, cfg.nodeCount);
  nodes = board.nodes;
  edgeCPs = computeEdgeControlPoints(nodes, board.edges);
  legalMoves = getLegalMoves(nodes, PLAYER);
  scores = getScores(nodes);
  gamePhase = 'playing';
  captureFlash = [];
  hoveredNode = null;
  gameoverResult = null;
  if (aiDelay) { clearTimeout(aiDelay); aiDelay = null; }
}

// ─── Player Move ──────────────────────────────────────────────────────────────
function doPlayerMove(nodeId) {
  if (screen !== 'playing' || gamePhase !== 'playing') return;
  if (!legalMoves.has(nodeId)) return;
  resumeAudio();

  const result = applyMove(nodes, nodeId, PLAYER);
  if (!result.ok) return;
  nodes = result.nodes;
  playSporeDrop();
  if (result.captured.length) {
    playSporeBurst();
    result.captured.forEach(id => captureFlash.push({ id, t: 1.0 }));
  }
  scores = getScores(nodes);
  if (checkGameOver()) return;
  legalMoves = new Set();
  aiDelay = setTimeout(doAIMove, AI_THINK_MS);
}

function doAIMove() {
  const moveId = getAIMove(nodes, LEVELS[currentLevelIdx].difficulty);
  if (moveId === null) { endGame(); return; }
  const result = applyMove(nodes, moveId, AI);
  if (!result.ok) { endGame(); return; }
  nodes = result.nodes;
  playBlightSpread();
  if (result.captured.length) {
    playSporeBurst();
    result.captured.forEach(id => captureFlash.push({ id, t: 1.0 }));
  }
  scores = getScores(nodes);
  legalMoves = getLegalMoves(nodes, PLAYER);
  checkGameOver();
}

function checkGameOver() {
  const empty = nodes.filter(n => n.owner === null).length;
  if (empty === 0 || legalMoves.size === 0) { endGame(); return true; }
  return false;
}

function endGame() {
  gamePhase = 'done';
  scores = getScores(nodes);
  if (currentLevelIdx === 0) {
    gameoverResult = 'tutorial-done';
    playEndJingle(true);
  } else {
    const won = scores.mycelium > scores.blight;
    gameoverResult = won ? 'win' : 'lose';
    playEndJingle(won);
  }
  screen = 'gameover';
}

// ─── Screen Transitions ───────────────────────────────────────────────────────
function advanceCard() {
  if (tutorialCardIdx < TUTORIAL_CARDS.length - 1) {
    tutorialCardIdx++;
  } else {
    screen = 'playing';
  }
}

function skipTutorial() {
  saveProgress({ tutorialDone: true, unlockedLevel: 1 });
  currentLevelIdx = 1;
  initLevel(1);
  screen = 'level-intro';
}

function handleTutorialDone() {
  saveProgress({ tutorialDone: true, unlockedLevel: 1 });
  currentLevelIdx = 1;
  initLevel(1);
  screen = 'level-intro';
}

function handleWin() {
  const nextIdx = currentLevelIdx + 1;
  if (nextIdx >= LEVELS.length) {
    screen = 'campaign-complete';
    return;
  }
  const progress = loadProgress();
  saveProgress({ unlockedLevel: Math.max(progress.unlockedLevel, nextIdx) });
  currentLevelIdx = nextIdx;
  initLevel(nextIdx);
  screen = 'level-intro';
}

function handleLose() {
  initLevel(currentLevelIdx);
  screen = 'level-intro';
}

function handlePlayAgain() {
  currentLevelIdx = 1;
  initLevel(1);
  screen = 'level-intro';
}

// ─── Drawing Helpers ──────────────────────────────────────────────────────────
const CLR = {
  mycelium: { core: '#a8ffb0', glow: '#00ff88' },
  blight:   { core: '#ff7b7b', glow: '#ff2200' },
  empty:    { core: '#1a2a1a', glow: '#3d6b3d' },
  edge:     'rgba(80,160,80,0.22)',
  edgeOwned:'rgba(100,255,140,0.55)',
};

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Draw a panel button; registers it with the button registry. Returns its rect. */
function drawBtn(x, y, w, h, label, fn, variant = 'primary') {
  const hov = mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h;
  if (variant === 'primary') {
    ctx.fillStyle = hov ? '#00ff88' : '#003311';
    ctx.shadowBlur = hov ? 22 : 8;
    ctx.shadowColor = '#00ff88';
    rr(x, y, w, h, 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = hov ? '#001108' : '#00ff88';
  } else {
    ctx.font = '13px monospace';
    ctx.fillStyle = hov ? '#88bb88' : '#446644';
  }
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + 6);
  ctx.textAlign = 'left';
  regBtn(x, y, w, h, fn);
}

function drawBackground() {
  const g = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 0,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75
  );
  g.addColorStop(0, '#0a1a0a');
  g.addColorStop(1, '#030803');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(120,255,120,0.035)';
  for (let i = 0; i < 120; i++) {
    const x = (Math.sin(i * 137.508) * 0.5 + 0.5) * canvas.width;
    const y = (Math.cos(i * 137.508 + 1.1) * 0.5 + 0.5) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEdges() {
  for (const { a, b, cpx, cpy } of edgeCPs) {
    const na = nodes[a], nb = nodes[b];
    const both = na.owner !== null && nb.owner !== null && na.owner === nb.owner;
    ctx.strokeStyle = both ? CLR.edgeOwned : CLR.edge;
    ctx.lineWidth = both ? 2.2 : 1;
    ctx.shadowBlur = both ? 8 : 0;
    ctx.shadowColor = both ? CLR[na.owner].glow : 'transparent';
    ctx.beginPath();
    ctx.moveTo(na.x, na.y);
    ctx.quadraticCurveTo(cpx, cpy, nb.x, nb.y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawNodes() {
  const now = performance.now();
  for (const node of nodes) {
    const isLegal = legalMoves.has(node.id);
    const isHov   = node.id === hoveredNode;
    const col = node.owner ? CLR[node.owner] : CLR.empty;
    const r = node.r;
    let glowR = r * 2.5;
    if (!node.owner && isLegal) glowR = r * 2.8 + Math.sin(now / 600 + node.id) * r * 0.6;

    const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR * 1.8);
    grad.addColorStop(0, col.core);
    grad.addColorStop(0.35, col.glow + '99');
    grad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowR * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(node.x, node.y, r * (isHov && isLegal ? 1.35 : 1), 0, Math.PI * 2);
    ctx.fillStyle = col.core;
    ctx.shadowBlur = node.owner ? 18 : (isLegal ? 10 : 4);
    ctx.shadowColor = col.glow;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawCaptureFlashes() {
  captureFlash = captureFlash.filter(f => f.t > 0);
  for (const f of captureFlash) {
    const node = nodes[f.id];
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r * (4 - f.t * 3), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,180,${f.t * 0.7})`;
    ctx.fill();
    f.t -= 0.04;
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD() {
  const cfg = LEVELS[currentLevelIdx];
  const as = getSettings();

  // Score bar
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  rr(12, 12, 450, 46, 10); ctx.fill();

  ctx.font = 'bold 14px monospace';
  let tx = 28;
  ctx.fillStyle = cfg.accentColor;
  ctx.fillText(cfg.name, tx, 38);
  tx += ctx.measureText(cfg.name).width + 14;

  ctx.fillStyle = '#334433';
  ctx.fillText('|', tx, 38);
  tx += ctx.measureText('|').width + 14;

  ctx.fillStyle = CLR.mycelium.glow;
  const mLabel = `Mycelium: ${scores.mycelium}`;
  ctx.fillText(mLabel, tx, 38);
  tx += ctx.measureText(mLabel).width + 14;

  ctx.fillStyle = '#334433';
  ctx.fillText('|', tx, 38);
  tx += ctx.measureText('|').width + 14;

  ctx.fillStyle = CLR.blight.glow;
  ctx.fillText(`Blight: ${scores.blight}`, tx, 38);

  // Audio toggle buttons
  const bw = 46, bh = 38, mg = 12;
  const sfxX = canvas.width - mg - bw * 2 - 6;
  const bgmX = canvas.width - mg - bw;
  const btnY = mg;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  rr(sfxX, btnY, bw, bh, 8); ctx.fill();
  rr(bgmX, btnY, bw, bh, 8); ctx.fill();
  ctx.font = '20px sans-serif';
  ctx.fillText(as.sfxEnabled ? '🔊' : '🔇', sfxX + 10, btnY + 27);
  ctx.fillText(as.bgmEnabled ? '🎵' : '📴', bgmX + 10, btnY + 27);

  regBtn(sfxX, btnY, bw, bh, () => { resumeAudio(); setSfxEnabled(!getSettings().sfxEnabled); });
  regBtn(bgmX, btnY, bw, bh, () => { resumeAudio(); setBgmEnabled(!getSettings().bgmEnabled); });
}

// ─── Tutorial Hint Bar ────────────────────────────────────────────────────────
function drawTutorialHint() {
  const owned = nodes.filter(n => n.owner !== null).length;
  const total = nodes.length;
  let hint;
  if (owned === 0)        hint = 'Click any glowing node to place your first Mycelium spore!';
  else if (owned <= 2)    hint = 'The Blight is thinking… See how it spreads across the network.';
  else if (owned <= 6)    hint = 'Build connections! Groups of linked spores share their Liberties.';
  else if (owned <= 10)   hint = 'Try surrounding a Blight cluster — groups with no Liberties are captured!';
  else if (owned / total < 0.65) hint = 'Hub nodes with many connections are the most strategic positions!';
  else if (scores.mycelium > scores.blight) hint = `Final stretch — you're ahead! Hold your territory.`;
  else if (scores.blight  > scores.mycelium) hint = `Fight back! Capture Blight nodes before the board fills.`;
  else hint = 'It\'s a tie — every node counts now!';

  const barH = 42, barY = canvas.height - barH - 10;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  rr(16, barY, canvas.width - 32, barH, 8); ctx.fill();
  ctx.font = '14px monospace';
  ctx.fillStyle = '#88dd88';
  ctx.textAlign = 'center';
  ctx.fillText(hint, canvas.width / 2, barY + 27);
  ctx.textAlign = 'left';
}

// ─── Tutorial Card Screen ─────────────────────────────────────────────────────
function drawTutorialCard() {
  const card = TUTORIAL_CARDS[tutorialCardIdx];
  const isLast = tutorialCardIdx === TUTORIAL_CARDS.length - 1;
  const W = Math.min(520, canvas.width - 48);
  const H = 360;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const x = cx - W / 2, y = cy - H / 2;

  ctx.fillStyle = 'rgba(4,12,4,0.94)';
  rr(x, y, W, H, 18); ctx.fill();

  ctx.strokeStyle = '#00ff8866';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 20; ctx.shadowColor = '#00ff88';
  rr(x, y, W, H, 18); ctx.stroke();
  ctx.shadowBlur = 0;

  // Progress dots
  ctx.textAlign = 'center';
  for (let i = 0; i < TUTORIAL_CARDS.length; i++) {
    ctx.beginPath();
    ctx.arc(cx - (TUTORIAL_CARDS.length - 1) * 10 + i * 20, y + 26, 4, 0, Math.PI * 2);
    ctx.fillStyle = i === tutorialCardIdx ? '#00ff88' : '#224422';
    ctx.fill();
  }

  // Title
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#00ff88';
  ctx.fillText(card.title, cx, y + 60);

  // Separator
  ctx.strokeStyle = '#00ff8830'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 28, y + 74); ctx.lineTo(x + W - 28, y + 74);
  ctx.stroke();

  // Body lines
  ctx.font = '14px monospace';
  ctx.fillStyle = '#88aa88';
  let ty = y + 100;
  for (const line of card.lines) {
    ctx.fillText(line, cx, ty);
    ty += 24;
  }

  // Primary button
  const btnW = 200, btnH = 46;
  const btnX = cx - btnW / 2, btnY = y + H - 66;
  drawBtn(btnX, btnY, btnW, btnH, card.btn, advanceCard);

  // Skip link (not on last card)
  if (!isLast) {
    drawBtn(cx - 70, y + H - 14, 140, 18, 'Skip Tutorial', skipTutorial, 'link');
  }

  ctx.textAlign = 'left';
}

// ─── Level Intro Screen ───────────────────────────────────────────────────────
function drawLevelIntro() {
  const cfg = LEVELS[currentLevelIdx];
  const W = Math.min(460, canvas.width - 48);
  const H = 310;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const x = cx - W / 2, y = cy - H / 2;

  ctx.fillStyle = 'rgba(4,12,4,0.94)';
  rr(x, y, W, H, 18); ctx.fill();

  ctx.strokeStyle = cfg.accentColor + '88';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 20; ctx.shadowColor = cfg.accentColor;
  rr(x, y, W, H, 18); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';

  // Level name
  ctx.font = 'bold 42px monospace';
  ctx.fillStyle = cfg.accentColor;
  ctx.shadowBlur = 24; ctx.shadowColor = cfg.accentColor;
  ctx.fillText(cfg.name, cx, y + 74);
  ctx.shadowBlur = 0;

  // Description
  ctx.font = '17px monospace';
  ctx.fillStyle = '#88aa88';
  ctx.fillText(cfg.desc, cx, y + 108);

  // Difficulty badge
  const diffLabel = DIFF_LABEL[cfg.difficulty];
  const badgeW = ctx.measureText(diffLabel).width + 28;
  const badgeX = cx - badgeW / 2;
  ctx.fillStyle = cfg.accentColor + '22';
  rr(badgeX, y + 126, badgeW, 26, 13); ctx.fill();
  ctx.strokeStyle = cfg.accentColor + '66'; ctx.lineWidth = 1;
  rr(badgeX, y + 126, badgeW, 26, 13); ctx.stroke();
  ctx.font = '13px monospace';
  ctx.fillStyle = cfg.accentColor;
  ctx.fillText(diffLabel, cx, y + 144);

  // Node count
  ctx.font = '13px monospace';
  ctx.fillStyle = '#446644';
  ctx.fillText(`Network size: ${cfg.nodeCount} nodes`, cx, y + 182);

  // Begin button
  const btnW = 180, btnH = 48;
  drawBtn(cx - btnW / 2, y + H - 70, btnW, btnH, 'Begin!', () => { screen = 'playing'; });

  ctx.textAlign = 'left';
}

// ─── Gameover Overlay ─────────────────────────────────────────────────────────
function drawGameoverOverlay() {
  // Dim board
  ctx.fillStyle = 'rgba(0,0,0,0.60)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const W = Math.min(440, canvas.width - 48);
  const H = 280;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const x = cx - W / 2, y = cy - H / 2;

  let headColor, headText, subText, btnLabel, btnFn;

  if (gameoverResult === 'tutorial-done') {
    headColor = CLR.mycelium.glow;
    headText  = 'Tutorial Complete!';
    subText   = `Mycelium ${scores.mycelium}  —  Blight ${scores.blight}`;
    btnLabel  = 'Start Campaign  →';
    btnFn     = handleTutorialDone;
  } else if (gameoverResult === 'win') {
    headColor = CLR.mycelium.glow;
    headText  = 'Mycelium Wins!';
    subText   = `${scores.mycelium}  —  ${scores.blight}`;
    btnLabel  = currentLevelIdx < LEVELS.length - 1 ? 'Next Level  →' : 'Campaign Complete!';
    btnFn     = handleWin;
  } else {
    headColor = CLR.blight.glow;
    headText  = 'Blight Wins.';
    subText   = `Mycelium ${scores.mycelium}  —  Blight ${scores.blight}`;
    btnLabel  = 'Try Again';
    btnFn     = handleLose;
  }

  ctx.fillStyle = 'rgba(4,12,4,0.95)';
  rr(x, y, W, H, 18); ctx.fill();

  ctx.strokeStyle = headColor + '66';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 20; ctx.shadowColor = headColor;
  rr(x, y, W, H, 18); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.font = 'bold 34px monospace';
  ctx.fillStyle = headColor;
  ctx.shadowBlur = 22; ctx.shadowColor = headColor;
  ctx.fillText(headText, cx, y + 68);
  ctx.shadowBlur = 0;

  ctx.font = '20px monospace';
  ctx.fillStyle = '#99bb99';
  ctx.fillText(subText, cx, y + 108);

  const btnW = 240, btnH = 48;
  drawBtn(cx - btnW / 2, y + H - 72, btnW, btnH, btnLabel, btnFn);

  ctx.textAlign = 'left';
}

// ─── Campaign Complete ────────────────────────────────────────────────────────
function drawCampaignComplete() {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const W = Math.min(520, canvas.width - 48);
  const H = 320;
  const x = cx - W / 2, y = cy - H / 2;

  ctx.fillStyle = 'rgba(4,12,4,0.96)';
  rr(x, y, W, H, 18); ctx.fill();

  ctx.strokeStyle = '#00ff8888';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 28; ctx.shadowColor = '#00ff88';
  rr(x, y, W, H, 18); ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';

  ctx.font = 'bold 13px monospace';
  ctx.fillStyle = '#55aa55';
  ctx.fillText('ALL LEVELS CONQUERED', cx, y + 46);

  ctx.font = 'bold 38px monospace';
  ctx.fillStyle = '#00ff88';
  ctx.shadowBlur = 28; ctx.shadowColor = '#00ff88';
  ctx.fillText('Mycelium Reigns!', cx, y + 96);
  ctx.shadowBlur = 0;

  ctx.font = '15px monospace';
  ctx.fillStyle = '#669966';
  ctx.fillText('The Blight has been driven from the network.', cx, y + 134);
  ctx.fillText('The mycelium spans the entire forest floor.', cx, y + 158);

  const btnW = 220, btnH = 48;
  drawBtn(cx - btnW / 2, y + H - 72, btnW, btnH, 'Play Again (Level 1)', handlePlayAgain);

  ctx.textAlign = 'left';
}

// ─── Main Render Loop ─────────────────────────────────────────────────────────
function render() {
  clearBtns();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();

  if (screen === 'tutorial-card') {
    ctx.globalAlpha = 0.28;
    drawEdges(); drawNodes();
    ctx.globalAlpha = 1.0;
    drawTutorialCard();

  } else if (screen === 'level-intro') {
    ctx.globalAlpha = 0.25;
    drawEdges(); drawNodes();
    ctx.globalAlpha = 1.0;
    drawLevelIntro();

  } else if (screen === 'playing') {
    drawEdges();
    drawCaptureFlashes();
    drawNodes();
    drawHUD();
    if (currentLevelIdx === 0) drawTutorialHint();

  } else if (screen === 'gameover') {
    drawEdges();
    drawCaptureFlashes();
    drawNodes();
    drawHUD();
    drawGameoverOverlay();

  } else if (screen === 'campaign-complete') {
    ctx.globalAlpha = 0.28;
    drawEdges(); drawNodes();
    ctx.globalAlpha = 1.0;
    drawCampaignComplete();
  }

  requestAnimationFrame(render);
}

// ─── Input ────────────────────────────────────────────────────────────────────
function hitNode(px, py, node) {
  const dx = px - node.x, dy = py - node.y;
  const r = Math.max(node.r * 2.2, 18);
  return dx * dx + dy * dy <= r * r;
}

canvas.addEventListener('mousemove', (e) => {
  const { x, y } = canvasPos(e);
  mouseX = x; mouseY = y;
  hoveredNode = null;
  if (screen === 'playing') {
    for (const node of nodes) {
      if (hitNode(x, y, node)) { hoveredNode = node.id; break; }
    }
  }
  const onLegal = hoveredNode !== null && legalMoves.has(hoveredNode);
  canvas.style.cursor = onLegal || hitBtn(x, y) ? 'pointer' : 'default';
});

canvas.addEventListener('click', (e) => {
  const { x, y } = canvasPos(e);
  const btn = hitBtn(x, y);
  if (btn) { btn.fn(); return; }

  if (screen === 'playing' && gamePhase === 'playing') {
    for (const node of nodes) {
      if (hitNode(x, y, node)) { doPlayerMove(node.id); break; }
    }
  }
});

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  mouseX = t.clientX; mouseY = t.clientY;
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const { x, y } = { x: mouseX, y: mouseY };
  const btn = hitBtn(x, y);
  if (btn) { btn.fn(); return; }
  if (screen === 'playing' && gamePhase === 'playing') {
    for (const node of nodes) {
      if (hitNode(x, y, node)) { doPlayerMove(node.id); break; }
    }
  }
}, { passive: false });

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ─── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  resize();
  initLevel(currentLevelIdx);
  if (screen === 'playing' || screen === 'gameover') screen = 'level-intro';
  if (screen === 'tutorial-card') tutorialCardIdx = 0;
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
function initApp() {
  initAudio(loadAudioSettings());
  const progress = loadProgress();
  if (!progress.tutorialDone) {
    currentLevelIdx = 0;
    tutorialCardIdx = 0;
    screen = 'tutorial-card';
    initLevel(0);
  } else {
    currentLevelIdx = Math.min(progress.unlockedLevel, LEVELS.length - 1);
    screen = 'level-intro';
    initLevel(currentLevelIdx);
  }
  render();
}

initApp();
