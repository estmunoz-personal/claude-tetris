'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // Tuerca - acero
  '#37474f', // Bomba - carbón
  '#fff176', // Rayo - amarillo eléctrico
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca (hueco central)
  [[9]],                                       // Bomba
  [[10]],                                      // Rayo
];

const NUT = 8;    // índice de tipo/color de la tuerca
const BOMB = 9;   // índice de tipo/color de la bomba
const RAY = 10;   // índice de tipo/color del rayo
const HOLE = 99;  // marcador de hueco en el tablero: cuenta como lleno, se dibuja vacío
const NUT_BONUS = 50;

const LAST_RANDOM = NUT;        // las especiales (bomba/rayo) no entran en el sorteo
const BOMB_EVERY = 10;          // piezas colocadas hasta la próxima bomba
const RAY_AFTER_BOMB = 3;       // piezas colocadas tras la bomba hasta el rayo
const BOMB_CELL_SCORE = 20;     // puntos por celda destruida por la bomba (x nivel)
const RAY_CELL_SCORE = 10;      // puntos por celda destruida por el rayo (x nivel)

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const specialEl = document.getElementById('special');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeSwitch = document.getElementById('theme-switch');

const THEME_KEY = 'tetris-theme';
const GRID_COLORS = { dark: '#22222e', light: '#dcdce6' };
let gridColor = GRID_COLORS.dark;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pieceCount, bombAt, rayAt;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return makePiece(Math.floor(Math.random() * LAST_RANDOM) + 1);
}

// Decide la siguiente pieza según el ciclo bomba -> (3 piezas) -> rayo -> (10 piezas) -> bomba...
function nextPiece() {
  pieceCount++;
  if (rayAt && pieceCount === rayAt) {
    rayAt = 0;
    bombAt = pieceCount + BOMB_EVERY;
    return makePiece(RAY);
  }
  if (pieceCount === bombAt) {
    rayAt = pieceCount + RAY_AFTER_BOMB;
    return makePiece(BOMB);
  }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];

  if (current.type === NUT) {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (!current.shape[r][c] && board[current.y + r][current.x + c] === 0)
          board[current.y + r][current.x + c] = HOLE;
  }
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

// Bomba: destruye el área 3x3 centrada en (cx, cy), recortada a los límites del tablero.
function explode(cx, cy) {
  let hit = 0;
  for (let r = cy - 1; r <= cy + 1; r++)
    for (let c = cx - 1; c <= cx + 1; c++)
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c]) { board[r][c] = 0; hit++; }
  return hit;
}

// Rayo: destruye la fila y la columna completas que pasan por (cx, cy).
function strike(cx, cy) {
  let hit = 0;
  for (let c = 0; c < COLS; c++) if (board[cy][c]) { board[cy][c] = 0; hit++; }
  for (let r = 0; r < ROWS; r++) if (board[r][cx]) { board[r][cx] = 0; hit++; }
  return hit;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === BOMB) {
    score += explode(current.x, current.y) * BOMB_CELL_SCORE * level;
  } else if (current.type === RAY) {
    score += strike(current.x, current.y) * RAY_CELL_SCORE * level;
  } else {
    if (current.type === NUT) score += NUT_BONUS * level;
    merge();
  }
  updateHUD();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = nextPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  if (specialEl) specialEl.textContent = specialStatus();
}

// Texto del indicador ESPECIAL: qué pieza especial llega y en cuántas piezas.
function specialStatus() {
  if (rayAt) return `Rayo en ${rayAt - pieceCount}`;
  return `Bomba en ${bombAt - pieceCount}`;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  const px = x * size + 1, py = y * size + 1, s = size - 2;

  if (colorIndex === HOLE) {
    // hueco de la tuerca: se insinúa, no se ve como bloque sólido
    context.fillStyle = 'rgba(96,125,139,0.18)';
    context.fillRect(px, py, s, s);
    context.save();
    context.setLineDash([3, 3]);
    context.strokeStyle = 'rgba(96,125,139,0.6)';
    context.lineWidth = 1;
    context.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    context.restore();
    context.globalAlpha = 1;
    return;
  }

  if (colorIndex === BOMB) {
    const cx = px + s / 2, cy = py + s / 2, radius = s * 0.38;
    // mecha
    context.strokeStyle = '#8d6e63';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx, cy - radius);
    context.lineTo(cx + s * 0.22, py - 2);
    context.stroke();
    // chispa
    context.fillStyle = '#ffb74d';
    context.beginPath();
    context.arc(cx + s * 0.22, py - 2, 2, 0, Math.PI * 2);
    context.fill();
    // cuerpo
    context.fillStyle = COLORS[BOMB];
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    // brillo
    context.fillStyle = 'rgba(255,255,255,0.25)';
    context.beginPath();
    context.arc(cx - radius * 0.35, cy - radius * 0.35, radius * 0.3, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    return;
  }

  if (colorIndex === RAY) {
    context.fillStyle = COLORS[RAY];
    context.fillRect(px, py, s, s);
    context.strokeStyle = 'rgba(97,74,0,0.5)';
    context.lineWidth = 1;
    context.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
    // zigzag del relámpago
    context.fillStyle = '#7a5c00';
    context.beginPath();
    context.moveTo(px + s * 0.55, py + s * 0.05);
    context.lineTo(px + s * 0.25, py + s * 0.55);
    context.lineTo(px + s * 0.45, py + s * 0.55);
    context.lineTo(px + s * 0.35, py + s * 0.95);
    context.lineTo(px + s * 0.75, py + s * 0.4);
    context.lineTo(px + s * 0.55, py + s * 0.4);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;
    return;
  }

  if (colorIndex === NUT) {
    const gradient = context.createLinearGradient(px, py, px + s, py + s);
    gradient.addColorStop(0, '#eceff1');
    gradient.addColorStop(0.5, '#b0bec5');
    gradient.addColorStop(1, '#607d8b');
    context.fillStyle = gradient;
    context.fillRect(px, py, s, s);
    context.strokeStyle = 'rgba(38,50,56,0.55)';
    context.lineWidth = 1;
    context.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  } else {
    context.fillStyle = COLORS[colorIndex];
    context.fillRect(px, py, s, s);
  }

  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(px, py, s, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  pieceCount = 0;
  bombAt = BOMB_EVERY;
  rayAt = 0;
  next = nextPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  gridColor = GRID_COLORS[theme] || GRID_COLORS.dark;
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'dark';
  themeSwitch.checked = saved === 'light';
  applyTheme(saved);
}

themeSwitch.addEventListener('change', () => {
  applyTheme(themeSwitch.checked ? 'light' : 'dark');
});

initTheme();
init();
