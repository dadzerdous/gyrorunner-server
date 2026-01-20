const WS_URL = "wss://gyrorunner-server.onrender.com";

let ws = null;

export function connectNet() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[net] connected to server");
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    console.log("[net] state snapshot", msg);
  };

  ws.onerror = (err) => {
    console.error("[net] ws error", err);
  };

  ws.onclose = () => {
    console.log("[net] disconnected");
  };
}
