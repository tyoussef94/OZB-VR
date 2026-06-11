const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

// rooms: code -> { controller: ws|null, viewers: Set<ws>, state: {cmd, time} }
const rooms = new Map();

function makeCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); }
  while (rooms.has(code));
  return code;
}

wss.on('connection', (ws) => {
  let room = null;
  let role = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    // ── Join as controller (creates room) ──
    if (msg.type === 'create') {
      const code = makeCode();
      room = { controller: ws, viewers: new Set(), state: { cmd: 'stop', time: 0, src: msg.src || '' } };
      rooms.set(code, room);
      role = 'controller';
      ws.send(JSON.stringify({ type: 'created', code }));
      return;
    }

    // ── Join as viewer (joins existing room) ──
    if (msg.type === 'join') {
      const code = String(msg.code);
      if (!rooms.has(code)) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Invalid code' }));
        return;
      }
      room = rooms.get(code);
      role = 'viewer';
      room.viewers.add(ws);
      // Sync viewer to current state immediately
      ws.send(JSON.stringify({ type: 'state', ...room.state }));
      return;
    }

    // ── Playback command from controller ──
    if (msg.type === 'cmd' && role === 'controller' && room) {
      room.state = { cmd: msg.cmd, time: msg.time || 0, src: room.state.src };
      const out = JSON.stringify({ type: 'state', ...room.state });
      room.viewers.forEach(v => { if (v.readyState === 1) v.send(out); });
      ws.send(out);
    }

    // ── Video source update from controller ──
    if (msg.type === 'src' && role === 'controller' && room) {
      room.state.src = msg.src || '';
      room.state.cmd = 'stop';
      room.state.time = 0;
      const out = JSON.stringify({ type: 'state', ...room.state });
      room.viewers.forEach(v => { if (v.readyState === 1) v.send(out); });
      ws.send(out);
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (role === 'viewer') {
      room.viewers.delete(ws);
    } else if (role === 'controller') {
      // Notify viewers and clean up room
      const out = JSON.stringify({ type: 'error', msg: 'Controller disconnected' });
      room.viewers.forEach(v => { if (v.readyState === 1) v.send(out); });
      // Find and delete the room
      for (const [code, r] of rooms) {
        if (r === room) { rooms.delete(code); break; }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
