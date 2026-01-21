import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};
let enemies = [];
let portal = null; // { x, y }
let gamePhase = 'WAVE'; // 'WAVE' or 'HUB'
let waveNum = 1;
const arenaSize = 450;

function spawnWave(n) {
  gamePhase = 'WAVE';
  portal = null;
  enemies = [];
  const count = 5 + (n * 2);
  
  for (let i = 0; i < count; i++) {
    enemies.push({
      id: Math.random().toString(36).slice(2),
      x: (Math.random() * 2 - 1) * arenaSize,
      y: (Math.random() * 2 - 1) * arenaSize,
      type: i % 4 === 0 ? 'archer' : 'goblin',
      hp: i % 4 === 0 ? 2 : 5,
      speed: i % 4 === 0 ? 2.5 : 1.8, // Archers are faster now
      cooldown: 0
    });
  }
  // Broadcast new wave info
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
  players[id] = { x: 0, y: 0, hp: 10, ready: false }; // Added 'ready' flag

  ws.send(JSON.stringify({ type: "welcome", id }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    if (msg.type === "move") {
      if (players[id]) {
        players[id].x = msg.x;
        players[id].y = msg.y;
      }
    }

    // HIT LOGIC
    if (msg.type === "hit") {
      const target = enemies.find(en => en.id === msg.enemyId);
      if (target) {
        target.hp -= msg.damage;
        if (target.hp <= 0) {
          enemies = enemies.filter(en => en.id !== msg.enemyId);
        }
      }
    }

    // PORTAL / EXIT LOGIC
    if (msg.type === "playerReady") {
       players[id].ready = msg.status;
       checkAllReady();
    }
  });

  ws.on("close", () => { delete players[id]; });
});

function checkAllReady() {
    const allReady = Object.values(players).every(p => p.ready);
    
    // If everyone is ready at the portal -> Go to HUB
    if (gamePhase === 'WAVE' && portal && allReady) {
        gamePhase = 'HUB';
        portal = null;
        Object.values(players).forEach(p => p.ready = false); // Reset
        broadcastState();
    }
    // If everyone is ready at the Hub Exit -> Go to WAVE
    else if (gamePhase === 'HUB' && allReady) {
        waveNum++;
        spawnWave(waveNum);
        Object.values(players).forEach(p => p.ready = false); // Reset
    }
}

// Server Loop (Logic)
setInterval(() => {
  // 1. WAVE LOGIC
  if (gamePhase === 'WAVE') {
      if (enemies.length === 0 && !portal) {
          // Spawn Portal on random edge
          const side = Math.floor(Math.random() * 4);
          if (side === 0) portal = { x: 0, y: -400 }; // Top
          else if (side === 1) portal = { x: 0, y: 400 }; // Bottom
          else if (side === 2) portal = { x: -400, y: 0 }; // Left
          else portal = { x: 400, y: 0 }; // Right
      }

      // Enemy AI
      enemies.forEach(en => {
        let closest = null;
        let minDist = Infinity;
        for (const pid in players) {
          const d = Math.hypot(players[pid].x - en.x, players[pid].y - en.y);
          if (d < minDist) { minDist = d; closest = players[pid]; }
        }

        if (closest) {
            const dx = closest.x - en.x;
            const dy = closest.y - en.y;
            const dist = Math.hypot(dx, dy);

            if (en.type === 'archer') {
                // ARCHER AI: Kite Logic
                if (dist < 250) { 
                    // Too close! Run away!
                    en.x -= (dx / dist) * en.speed;
                    en.y -= (dy / dist) * en.speed;
                } else if (dist > 400) {
                    // Too far! Chase!
                    en.x += (dx / dist) * en.speed;
                    en.y += (dy / dist) * en.speed;
                }
                // (Server side shooting would go here, simplified for now)
            } else {
                // GOBLIN AI: Charge
                if (dist > 5) {
                    en.x += (dx / dist) * en.speed;
                    en.y += (dy / dist) * en.speed;
                }
            }
        }
      });
  }

  broadcastState();
}, 50);

console.log("Server running...");
