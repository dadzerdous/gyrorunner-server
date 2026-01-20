import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};
let enemies = [];
const arenaSize = 450;

function spawnWave() {
  enemies = [];
  for (let i = 0; i < 10; i++) {
    enemies.push({
      id: Math.random().toString(36).slice(2),
      x: (Math.random() * 2 - 1) * arenaSize,
      y: (Math.random() * 2 - 1) * arenaSize,
      type: i % 7 === 0 ? 'archer' : 'goblin',
      hp: 3,
      speed: 1.2
    });
  }
}

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);
  players[id] = { x: 0, y: 0, hp: 10 };

  ws.send(JSON.stringify({ type: "welcome", id }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data);
    
    // Update player position
    if (msg.type === "move" && players[id]) {
      players[id].x = msg.x;
      players[id].y = msg.y;
    }

    // Handle enemy damage from a client-side hit detection
    if (msg.type === "hit") {
      const target = enemies.find(en => en.id === msg.enemyId);
      if (target) {
        target.hp -= msg.damage;
        // Remove dead enemies
        if (target.hp <= 0) {
          enemies = enemies.filter(en => en.id !== msg.enemyId);
        }
      }
    }
  });

  ws.on("close", () => { delete players[id]; }); //
});

setInterval(() => {
  if (enemies.length === 0) spawnWave();

  enemies.forEach(en => {
    let closest = null;
    let minDist = Infinity;

    for (const pid in players) {
      const d = Math.hypot(players[pid].x - en.x, players[pid].y - en.y);
      if (d < minDist) {
        minDist = d;
        closest = players[pid];
      }
    }

    if (closest && minDist > 5) {
      en.x += ((closest.x - en.x) / minDist) * en.speed;
      en.y += ((closest.y - en.y) / minDist) * en.speed;
    }
  });

  const snapshot = JSON.stringify({ type: "state", players, enemies });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(snapshot); });
}, 50);

console.log("Server running on port", PORT);
