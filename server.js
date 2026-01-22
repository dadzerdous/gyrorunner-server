import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};
let enemies = [];
let portal = null;      // The exit from Wave -> Hub
let gamePhase = 'WAVE'; // Starts in WAVE mode
let waveNum = 1;
const arenaSize = 450;

function spawnWave(n) {
  gamePhase = 'WAVE';
  portal = null;
  enemies = [];
  const count = 5 + (n * 2);
  
  console.log(`[Server] Spawning Wave ${n}`);

  for (let i = 0; i < count; i++) {
    enemies.push({
      id: Math.random().toString(36).slice(2),
      x: (Math.random() * 2 - 1) * (arenaSize - 50),
      y: (Math.random() * 2 - 1) * (arenaSize - 50),
      type: i % 4 === 0 ? 'archer' : 'goblin',
      hp: i % 4 === 0 ? 2 + (n * 0.5) : 5 + (n * 1),
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

  console.log(`[Server] Player ${id} connected`);
  ws.send(JSON.stringify({ type: "welcome", id }));

  // If joining an empty server, ensure we start fresh
  if (Object.keys(players).length === 1) {
      waveNum = 1;
      spawnWave(1);
  } else {
      // Send current state to new joiner immediately
      ws.send(JSON.stringify({
          type: "state", players, enemies, portal, phase: gamePhase, wave: waveNum
      }));
  }

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
        // Remove dead enemy
        if (target.hp <= 0) {
            enemies = enemies.filter(en => en.id !== msg.enemyId);
        }
      }
    }

    if (msg.type === "playerReady") {
       if (players[id]) players[id].ready = msg.status;
       checkAllReady();
    }
  });

  ws.on("close", () => { 
      delete players[id]; 
      // RESET LOGIC: If server empty, reset wave
      if (Object.keys(players).length === 0) {
          console.log("[Server] All players left. Resetting world.");
          waveNum = 1;
          gamePhase = 'WAVE';
          enemies = [];
          portal = null;
      }
  });
});

function checkAllReady() {
    const playerList = Object.values(players);
    if (playerList.length === 0) return;

    const allReady = playerList.every(p => p.ready);
    
    // 1. WAVE -> HUB (When Portal is active & everyone touches it)
    if (gamePhase === 'WAVE' && portal && allReady) {
        console.log("[Server] Wave Cleared! Moving to HUB.");
        gamePhase = 'HUB';
        portal = null;
        // Reset player readiness and move them to center (Safe Zone)
        playerList.forEach(p => { p.ready = false; p.x = 0; p.y = 0; });
        broadcastState();
    }
    // 2. HUB -> WAVE (When everyone is at Exit Zone)
    else if (gamePhase === 'HUB' && allReady) {
        waveNum++;
        console.log(`[Server] Starting Wave ${waveNum}`);
        playerList.forEach(p => p.ready = false);
        spawnWave(waveNum);
    }
}

// Game Loop
setInterval(() => {
  if (gamePhase === 'WAVE') {
      // WIN CONDITION: Spawn Portal if all enemies are dead
      if (enemies.length === 0 && !portal) {
          console.log("[Server] Wave clear. Spawning Portal.");
          portal = { x: 0, y: -350 }; // North side
          broadcastState(); // Force update so clients see portal immediately
      }

      // Simple AI
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
            // Move if far enough away (prevent stacking)
            if (dist > 5) {
                en.x += (dx / dist) * en.speed;
                en.y += (dy / dist) * en.speed;
            }
        }
      });
  }
  broadcastState();
}, 50);

console.log("GyroRunner Server Running...");
