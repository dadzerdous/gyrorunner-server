import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const wss = new WebSocketServer({ port: PORT });

const players = {};

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).slice(2);

  players[id] = { x: 0, y: 0, hp: 10 };

  ws.send(JSON.stringify({
    type: "welcome",
    id
  }));

  ws.on("message", (data) => {
    const msg = JSON.parse(data);

    if (msg.type === "move") {
      players[id].x += msg.x;
      players[id].y += msg.y;
    }
  });

  ws.on("close", () => {
    delete players[id];
  });
});

setInterval(() => {
  const snapshot = JSON.stringify({
    type: "state",
    players
  });

  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(snapshot);
  });
}, 50);

console.log("GyroRunner server running on port", PORT);
