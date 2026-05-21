const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");

const state = {
  players: [],
  strokes: [],
  currentTurn: 0,
  activeStrokePlayerId: null,
  hostId: null,
};

const clients = new Set();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function publicState() {
  const players = state.players.map((player) => ({
    id: player.id,
    name: player.name,
    joinedAt: player.joinedAt,
  }));

  return {
    players,
    strokes: state.strokes,
    currentTurn: state.currentTurn,
    currentPlayerId: players[state.currentTurn]?.id || null,
    activeStrokePlayerId: state.activeStrokePlayerId,
    hostId: state.hostId,
    strokeCount: state.strokes.length,
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function normalizeTurn() {
  if (state.players.length === 0) {
    state.currentTurn = 0;
    state.hostId = null;
    state.activeStrokePlayerId = null;
    return;
  }

  if (!state.hostId || !state.players.some((player) => player.id === state.hostId)) {
    state.hostId = state.players[0].id;
  }

  if (state.currentTurn >= state.players.length) {
    state.currentTurn = 0;
  }

  if (
    state.activeStrokePlayerId &&
    !state.players.some((player) => player.id === state.activeStrokePlayerId)
  ) {
    state.activeStrokePlayerId = null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function isCurrentPlayer(playerId) {
  return state.players[state.currentTurn]?.id === playerId;
}

async function handleApi(req, res) {
  try {
    if (req.method === "GET" && req.url === "/api/state") {
      sendJson(res, 200, publicState());
      return;
    }

    if (req.method === "POST" && req.url === "/api/join") {
      const body = await readBody(req);
      const name = String(body.name || "").trim().slice(0, 24);
      const providedId = String(body.playerId || "").trim();
      const playerId = providedId || crypto.randomUUID();

      if (!name) {
        sendJson(res, 400, { error: "Name is required." });
        return;
      }

      const existing = state.players.find((player) => player.id === playerId);
      if (existing) {
        existing.name = name;
      } else {
        state.players.push({ id: playerId, name, joinedAt: Date.now() });
      }

      normalizeTurn();
      broadcast();
      sendJson(res, 200, { playerId, state: publicState() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/stroke") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");
      const points = Array.isArray(body.points) ? body.points : [];
      const color = /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#2457ff";
      const size = Math.min(28, Math.max(2, Number(body.size) || 6));

      if (!isCurrentPlayer(playerId)) {
        sendJson(res, 403, { error: "It is not your turn." });
        return;
      }

      if (state.activeStrokePlayerId && state.activeStrokePlayerId !== playerId) {
        sendJson(res, 409, { error: "Another stroke is being finished." });
        return;
      }

      if (state.activeStrokePlayerId === playerId) {
        sendJson(res, 409, { error: "Click Done to pass the turn." });
        return;
      }

      const cleanPoints = points
        .map((point) => ({
          x: Math.round(Math.min(600, Math.max(0, Number(point.x) || 0))),
          y: Math.round(Math.min(400, Math.max(0, Number(point.y) || 0))),
        }))
        .slice(0, 2000);

      if (cleanPoints.length < 2) {
        sendJson(res, 400, { error: "Draw a longer stroke." });
        return;
      }

      state.strokes.push({
        id: crypto.randomUUID(),
        playerId,
        color,
        size,
        points: cleanPoints,
      });
      state.activeStrokePlayerId = playerId;
      broadcast();
      sendJson(res, 200, { state: publicState() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/done") {
      const body = await readBody(req);
      const playerId = String(body.playerId || "");

      if (state.activeStrokePlayerId !== playerId || !isCurrentPlayer(playerId)) {
        sendJson(res, 403, { error: "You can pass only after your stroke." });
        return;
      }

      state.activeStrokePlayerId = null;
      state.currentTurn = (state.currentTurn + 1) % Math.max(1, state.players.length);
      normalizeTurn();
      broadcast();
      sendJson(res, 200, { state: publicState() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/undo") {
      const body = await readBody(req);
      if (String(body.playerId || "") !== state.hostId) {
        sendJson(res, 403, { error: "Only the host can undo." });
        return;
      }

      state.strokes.pop();
      state.activeStrokePlayerId = null;
      broadcast();
      sendJson(res, 200, { state: publicState() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/clear") {
      const body = await readBody(req);
      if (String(body.playerId || "") !== state.hostId) {
        sendJson(res, 403, { error: "Only the host can clear the canvas." });
        return;
      }

      state.strokes = [];
      state.activeStrokePlayerId = null;
      state.currentTurn = 0;
      normalizeTurn();
      broadcast();
      sendJson(res, 200, { state: publicState() });
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Something went wrong." });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Team drawing canvas running at http://localhost:${PORT}`);
});
