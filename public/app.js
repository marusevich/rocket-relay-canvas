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

let state = {
  players: [],
  strokes: [],
  currentPlayerId: null,
  activeStrokePlayerId: null,
  hostId: null,
  strokeCount: 0,
};

let playerId = sessionStorage.getItem("rocketRelayPlayerId") || crypto.randomUUID();
let playerName = localStorage.getItem("rocketRelayPlayerName") || "";
let selectedColor = colors[1];
let drawing = false;
let pendingPoints = [];
let localPreview = null;

sessionStorage.setItem("rocketRelayPlayerId", playerId);
nameInput.value = playerName;

function api(path, payload) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "Request failed.");
    }
    return body;
  });
}

function drawStroke(stroke) {
  if (!stroke.points || stroke.points.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of state.strokes) {
    drawStroke(stroke);
  }
  if (localPreview) {
    drawStroke(localPreview);
  }
}

function currentPlayer() {
  return state.players.find((player) => player.id === state.currentPlayerId);
}

function me() {
  return state.players.find((player) => player.id === playerId);
}

function canDraw() {
  return Boolean(me()) && state.currentPlayerId === playerId && !state.activeStrokePlayerId;
}

function hasPendingDone() {
  return state.activeStrokePlayerId === playerId && state.currentPlayerId === playerId;
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
  const isHost = state.hostId === playerId;

  strokeCount.textContent = state.strokeCount;
  undoButton.classList.toggle("hidden", !isHost);
  clearButton.classList.toggle("hidden", !isHost);
  doneButton.classList.toggle("hidden", !hasPendingDone());
  canvas.classList.toggle("locked", !canDraw());

  if (!joined) {
    statusText.textContent = "Enter your name to join the shared canvas.";
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

async function finishDrawing(event) {
  if (!drawing) return;
  drawing = false;
  pendingPoints.push(canvasPoint(event));
  const stroke = { color: selectedColor, size: Number(brushSize.value), points: pendingPoints };
  localPreview = null;
  redraw();

  try {
    await api("/api/stroke", { playerId, ...stroke });
  } catch (error) {
    statusText.textContent = error.message;
  } finally {
    pendingPoints = [];
  }
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

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  playerName = name;
  localStorage.setItem("rocketRelayPlayerName", name);

  try {
    const result = await api("/api/join", { playerId, name });
    playerId = result.playerId;
    sessionStorage.setItem("rocketRelayPlayerId", playerId);
    state = result.state;
    render();
  } catch (error) {
    statusText.textContent = error.message;
  }
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

doneButton.addEventListener("click", async () => {
  try {
    await api("/api/done", { playerId });
  } catch (error) {
    statusText.textContent = error.message;
  }
});

saveButton.addEventListener("click", () => {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = "#fffefa";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  for (const stroke of state.strokes) {
    ctx.save();
    drawStrokeOn(exportCtx, stroke);
    ctx.restore();
  }
  const link = document.createElement("a");
  link.download = "rocket-relay-canvas.png";
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
});

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

undoButton.addEventListener("click", async () => {
  try {
    await api("/api/undo", { playerId });
  } catch (error) {
    statusText.textContent = error.message;
  }
});

clearButton.addEventListener("click", async () => {
  const confirmed = confirm("Clear the canvas for everyone?");
  if (!confirmed) return;
  try {
    await api("/api/clear", { playerId });
  } catch (error) {
    statusText.textContent = error.message;
  }
});

const events = new EventSource("/events");
events.addEventListener("state", (event) => {
  state = JSON.parse(event.data);
  render();
});

buildColorPicker();
render();
