import { createClient, LiveList } from "https://esm.sh/@liveblocks/client";

const LIVEBLOCKS_PUBLIC_KEY = "pk_dev_SZzSgGXCAoPCkfWRQxuejbHuFKXNBAvr2ca23yegbTyfMLP3v1rBEOQWbiRZRdXG";
const colors = ["#19202d", "#2457ff", "#f04d4d", "#ffb000", "#14a56a", "#7b4dff"];

const canvas = document.querySelector("#drawingCanvas");
const ctx = canvas.getContext("2d");
const joinForm = document.querySelector("#joinForm");
const nameInput = document.querySelector("#nameInput");
const colorGrid = document.querySelector("#colorGrid");
const brushSize = document.querySelector("#brushSize");
const brushValue = document.querySelector("#brushValue");
const playerList = document.querySelector("#playerList");
const statusText = document.querySelector("#statusText");
const turnText = document.querySelector("#turnText");
const strokeCount = document.querySelector("#strokeCount");
const doneButton = document.querySelector("#doneButton");
const saveButton = document.querySelector("#saveButton");
const undoButton = document.querySelector("#undoButton");
const clearButton = document.querySelector("#clearButton");

const roomId = new URLSearchParams(location.search).get("room") || "company-anniversary-rocket";
const playerId = sessionStorage.getItem("rocketRelayPlayerId") || crypto.randomUUID();
let playerName = localStorage.getItem("rocketRelayPlayerName") || "";
let selectedColor = colors[1];
let drawing = false;
let pendingPoints = [];
let localPreview = null;
let root = null;
let strokesList = null;
let storageReady = false;
let others = [];

let state = {
  players: [],
  strokes: [],
  currentPlayerId: null,
  activeStrokePlayerId: null,
  hostId: null,
  strokeCount: 0,
};

sessionStorage.setItem("rocketRelayPlayerId", playerId);
nameInput.value = playerName;

const client = createClient({
  publicApiKey: LIVEBLOCKS_PUBLIC_KEY,
  throttle: 32,
});

const { room } = client.enterRoom(roomId, {
  initialPresence: {
    playerId,
    name: "",
    joinedAt: 0,
    hasJoined: false,
  },
  initialStorage: {
    strokes: new LiveList(),
    currentPlayerId: null,
    activeStrokePlayerId: null,
  },
});

function livePlayers() {
  const mine = room.getPresence();
  const players = [];

  if (mine?.hasJoined) {
    players.push({
      id: mine.playerId,
      name: mine.name,
      joinedAt: mine.joinedAt,
      isMe: true,
    });
  }

  for (const other of others) {
    const presence = other.presence;
    if (!presence?.hasJoined) continue;
    players.push({
      id: presence.playerId,
      name: presence.name,
      joinedAt: presence.joinedAt,
      isMe: false,
    });
  }

  return players
    .filter((player, index, all) => all.findIndex((item) => item.id === player.id) === index)
    .sort((a, b) => a.joinedAt - b.joinedAt || a.name.localeCompare(b.name));
}

function readState() {
  const players = livePlayers();
  const hostId = players[0]?.id || null;
  const currentPlayerId = root?.get("currentPlayerId") || null;
  const activeStrokePlayerId = root?.get("activeStrokePlayerId") || null;
  const strokes = strokesList?.toImmutable() || [];

  state = {
    players,
    strokes,
    currentPlayerId,
    activeStrokePlayerId,
    hostId,
    strokeCount: strokes.length,
  };
}

function normalizeTurn() {
  if (!storageReady || !root) return;
  const players = livePlayers();
  const currentExists = players.some((player) => player.id === root.get("currentPlayerId"));
  const activeExists = players.some((player) => player.id === root.get("activeStrokePlayerId"));

  if (!players.length) {
    if (root.get("currentPlayerId") !== null) root.set("currentPlayerId", null);
    if (root.get("activeStrokePlayerId") !== null) root.set("activeStrokePlayerId", null);
    return;
  }

  if (!currentExists) {
    root.set("currentPlayerId", players[0].id);
  }

  if (!activeExists && root.get("activeStrokePlayerId")) {
    root.set("activeStrokePlayerId", null);
  }
}

function syncAndRender() {
  normalizeTurn();
  readState();
  render();
}

function currentPlayer() {
  return state.players.find((player) => player.id === state.currentPlayerId);
}

function me() {
  return state.players.find((player) => player.id === playerId);
}

function isHost() {
  return state.hostId === playerId;
}

function canDraw() {
  return Boolean(me()) && state.currentPlayerId === playerId && !state.activeStrokePlayerId;
}

function hasPendingDone() {
  return state.activeStrokePlayerId === playerId && state.currentPlayerId === playerId;
}

function drawStrokeOn(targetCtx, stroke) {
  if (!stroke.points || stroke.points.length < 2) return;
  targetCtx.save();
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.strokeStyle = stroke.color;
  targetCtx.lineWidth = stroke.size;
  targetCtx.beginPath();
  targetCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) {
    targetCtx.lineTo(point.x, point.y);
  }
  targetCtx.stroke();
  targetCtx.restore();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of state.strokes) {
    drawStrokeOn(ctx, stroke);
  }
  if (localPreview) {
    drawStrokeOn(ctx, localPreview);
  }
}

function renderPlayers() {
  playerList.innerHTML = "";
  for (const player of state.players) {
    const item = document.createElement("li");
    if (player.id === state.currentPlayerId) item.classList.add("current");
    item.textContent = player.name;
    if (player.id === state.hostId) {
      const host = document.createElement("span");
      host.className = "host-tag";
      host.textContent = "host";
      item.append(host);
    }
    playerList.append(item);
  }
}

function renderStatus() {
  const active = currentPlayer();
  const joined = me();

  strokeCount.textContent = state.strokeCount;
  undoButton.classList.toggle("hidden", !isHost());
  clearButton.classList.toggle("hidden", !isHost());
  doneButton.classList.toggle("hidden", !hasPendingDone());
  canvas.classList.toggle("locked", !canDraw());

  if (!storageReady) {
    statusText.textContent = "Connecting to the shared canvas...";
    turnText.textContent = "Connecting";
    return;
  }

  if (!joined) {
    statusText.textContent = `Enter your name to join room ${roomId}.`;
    turnText.textContent = state.players.length ? `${active?.name || "Someone"} is drawing` : "Waiting for players";
    return;
  }

  if (hasPendingDone()) {
    statusText.textContent = "Nice stroke. Pass the turn when you are ready.";
    turnText.textContent = "Your stroke is on the canvas";
    return;
  }

  if (canDraw()) {
    statusText.textContent = "It is your turn. Add one stroke, then pass it on.";
    turnText.textContent = "Your turn";
    return;
  }

  statusText.textContent = active ? `${active.name} is drawing now.` : "Waiting for players.";
  turnText.textContent = active ? `${active.name}'s turn` : "Waiting for players";
}

function render() {
  renderPlayers();
  renderStatus();
  redraw();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round(((event.clientX - rect.left) / rect.width) * canvas.width),
    y: Math.round(((event.clientY - rect.top) / rect.height) * canvas.height),
  };
}

function startDrawing(event) {
  if (!canDraw()) return;
  drawing = true;
  pendingPoints = [canvasPoint(event)];
  localPreview = { color: selectedColor, size: Number(brushSize.value), points: pendingPoints };
  canvas.setPointerCapture(event.pointerId);
  redraw();
}

function continueDrawing(event) {
  if (!drawing) return;
  pendingPoints.push(canvasPoint(event));
  localPreview = { color: selectedColor, size: Number(brushSize.value), points: pendingPoints };
  redraw();
}

function finishDrawing(event) {
  if (!drawing || !strokesList || !root) return;
  drawing = false;
  pendingPoints.push(canvasPoint(event));
  const cleanPoints = pendingPoints
    .map((point) => ({
      x: Math.round(Math.min(600, Math.max(0, point.x))),
      y: Math.round(Math.min(400, Math.max(0, point.y))),
    }))
    .slice(0, 2000);

  localPreview = null;

  if (cleanPoints.length < 2) {
    pendingPoints = [];
    redraw();
    return;
  }

  if (!canDraw()) {
    pendingPoints = [];
    redraw();
    return;
  }

  strokesList.push({
    id: crypto.randomUUID(),
    playerId,
    color: selectedColor,
    size: Number(brushSize.value),
    points: cleanPoints,
  });
  root.set("activeStrokePlayerId", playerId);
  pendingPoints = [];
  syncAndRender();
}

function buildColorPicker() {
  colors.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "color-swatch";
    button.style.background = color;
    button.setAttribute("aria-label", `Choose ${color}`);
    button.addEventListener("click", () => {
      selectedColor = color;
      document.querySelectorAll(".color-swatch").forEach((swatch) => {
        swatch.classList.toggle("active", swatch === button);
      });
    });
    colorGrid.append(button);
    if (color === selectedColor) button.classList.add("active");
  });
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }

  playerName = name.slice(0, 24);
  localStorage.setItem("rocketRelayPlayerName", playerName);
  room.updatePresence({
    playerId,
    name: playerName,
    joinedAt: Date.now(),
    hasJoined: true,
  });
  syncAndRender();
});

brushSize.addEventListener("input", () => {
  brushValue.textContent = brushSize.value;
});

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", continueDrawing);
canvas.addEventListener("pointerup", finishDrawing);
canvas.addEventListener("pointercancel", () => {
  drawing = false;
  pendingPoints = [];
  localPreview = null;
  redraw();
});

doneButton.addEventListener("click", () => {
  if (!hasPendingDone() || !root) return;
  const players = livePlayers();
  const currentIndex = players.findIndex((player) => player.id === playerId);
  const nextPlayer = players[(currentIndex + 1) % players.length];

  root.set("activeStrokePlayerId", null);
  root.set("currentPlayerId", nextPlayer?.id || null);
  syncAndRender();
});

saveButton.addEventListener("click", () => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = "#fffefa";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  for (const stroke of state.strokes) {
    drawStrokeOn(exportCtx, stroke);
  }
  const link = document.createElement("a");
  link.download = "rocket-relay-canvas.png";
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
});

undoButton.addEventListener("click", () => {
  if (!isHost() || !strokesList || !root || strokesList.length === 0) return;
  strokesList.delete(strokesList.length - 1);
  root.set("activeStrokePlayerId", null);
  syncAndRender();
});

clearButton.addEventListener("click", () => {
  if (!isHost() || !strokesList || !root) return;
  const confirmed = confirm("Clear the canvas for everyone?");
  if (!confirmed) return;
  strokesList.clear();
  root.set("activeStrokePlayerId", null);
  root.set("currentPlayerId", livePlayers()[0]?.id || null);
  syncAndRender();
});

room.subscribe("others", (nextOthers) => {
  others = nextOthers.toArray();
  syncAndRender();
});

room.getStorage().then(({ root: storageRoot }) => {
  root = storageRoot;
  strokesList = root.get("strokes");
  storageReady = true;

  room.subscribe(root, syncAndRender, { isDeep: true });

  if (playerName) {
    room.updatePresence({
      playerId,
      name: playerName,
      joinedAt: Date.now(),
      hasJoined: true,
    });
  }

  syncAndRender();
});

room.subscribe("lost-connection", () => {
  statusText.textContent = "Connection is slow. Reconnecting to the shared canvas...";
});

buildColorPicker();
render();
