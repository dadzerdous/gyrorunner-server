import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};
let enemies = [];
let portal = null;     // The exit from Wave -> Hub
let hubExit = null;    // The exit from Hub -> Wave
let gamePhase = 'WAVE'; // 'WAVE' or 'HUB'
let waveNum = 1;
const arenaSize = 450;

function spawnWave(n) {
  gamePhase = 'WAVE';
  portal = null;
  hubExit = null;
  enemies = [];
  const count = 5 + (n * 2);
  
  for (let i = 0; i < count; i++) {
    enemies.push({
      id: Math.random().toString(36).slice(2),
      x: (Math.random() * 2 - 1) * (arenaSize - 50),
      y: (Math.random() * 2 - 1) * (arenaSize - 50),
      type: i % 4 === 0 ? 'archer' : 'goblin',
      hp: i % 4 === 0 ? 2 + (n*0.5) : 5 + (n*1),
      speed: i % 4 === 0 ? 2.5 : 1.8
    });
  }
  broadcastState();
}

function broadcastState() {
  const snapshot = JSON.stringify({
    type: "state",
    players,
    enemies,
    portal,
    phase: gamePhase,
    wave: waveNum
  });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);
  players[id] = { x: 0, y: 0, hp: 10, ready: false };

  ws.send(JSON.stringify({ type: "welcome", id }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    if (msg.type === "move" && players[id]) {
      players[id].x = msg.x;
      players[id].y = msg.y;
    }

    if (msg.type === "hit") {
      const target = enemies.find(en => en.id === msg.enemyId);
      if (target) {
        target.hp -= msg.damage;
        if (target.hp <= 0) enemies = enemies.filter(en => en.id !== msg.enemyId);
      }
    }

    if (msg.type === "playerReady") {
       if (players[id]) players[id].ready = msg.status;
       checkAllReady();
    }
  });

  ws.on("close", () => { delete players[id]; });
});

function checkAllReady() {
    const allReady = Object.values(players).every(p => p.ready);
    
    // 1. Wave -> Hub (Portal)
    if (gamePhase === 'WAVE' && portal && allReady) {
        gamePhase = 'HUB';
        portal = null;
        Object.values(players).forEach(p => { p.ready = false; p.x = 0; p.y = 0; }); // Teleport to center
        broadcastState();
    }
    // 2. Hub -> Wave (Exit Zone)
    else if (gamePhase === 'HUB' && allReady) {
        waveNum++;
        Object.values(players).forEach(p => p.ready = false);
        spawnWave(waveNum);
    }
}

// Game Loop
setInterval(() => {
  if (gamePhase === 'WAVE') {
      // Spawn Portal if enemies dead
      if (enemies.length === 0 && !portal) {
          portal = { x: 0, y: -350 }; // North side
      }

      // Enemy Logic
      enemies.forEach(en => {
        let closest = null, minDist = Infinity;
        for (const pid in players) {
          const d = Math.hypot(players[pid].x - en.x, players[pid].y - en.y);
          if (d < minDist) { minDist = d; closest = players[pid]; }
        }
        if (closest) {
            const dx = closest.x - en.x;
            const dy = closest.y - en.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 5) {
                en.x += (dx / dist) * en.speed;
                en.y += (dy / dist) * en.speed;
            }
        }
      });
  }
  broadcastState();
}, 50);

console.log("Server running...");
