// EZOX Duo — private watch-together server (2 people per room)
// Nothing is saved: chat, calls and rooms live only in memory.
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// STUN/TURN servers for the video call. TURN is optional but needed on many mobile networks.
// Vercel-hosted page asks this server for call settings
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });

app.get('/config', (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS,
    });
  }
  res.json({ iceServers });
});
app.get('/health', (req, res) => res.send('ok'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

const MAX_PEOPLE = 2;
const rooms = new Map(); // key -> { password, clients:Set, source, state }
let nextId = 1;

const broadcastReady = (r) => {
  const people = [...r.clients].map((c) => ({ id: c.id, name: c.name, ready: r.ready.has(c.id) }));
  r.clients.forEach((c) => send(c, { type: 'ready-state', people, at: r.readyAt }));
};
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const othersIn = (ws) => {
  const r = rooms.get(ws.roomKey);
  return r ? [...r.clients].filter((c) => c !== ws) : [];
};

wss.on('connection', (ws) => {
  ws.id = String(nextId++);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.type === 'join') {
      if (ws.roomKey) return;
      const room = String(m.room || '').trim().toLowerCase().slice(0, 40);
      const password = String(m.password || '');
      if (!room || password.length < 4) {
        return send(ws, { type: 'error', fatal: true, message: 'Room ka naam aur kam az kam 4 character ka password do.' });
      }
      // The Netflix extension uses its own channel so it never takes a call "seat".
      const key = (m.kind === 'netflix' ? 'nf:' : 'app:') + room;
      let r = rooms.get(key);
      if (!r) { r = { password, clients: new Set(), source: null, state: null, ready: new Set(), readyAt: '' }; rooms.set(key, r); }
      if (r.password !== password) return send(ws, { type: 'error', fatal: true, message: 'Password galat hai.' });
      if (r.clients.size >= MAX_PEOPLE) return send(ws, { type: 'error', fatal: true, message: 'Room full hai — sirf 2 log aa sakte hain.' });

      ws.roomKey = key;
      ws.name = String(m.name || 'Guest').slice(0, 30);
      const peers = [...r.clients].map((c) => ({ id: c.id, name: c.name }));
      r.clients.add(ws);
      const state = r.state ? { ...r.state, elapsed: (Date.now() - r.state.at) / 1000 } : null;
      send(ws, { type: 'joined', id: ws.id, peers, source: r.source, state });
      othersIn(ws).forEach((c) => send(c, { type: 'peer-joined', peer: { id: ws.id, name: ws.name } }));
      return;
    }

    if (!ws.roomKey) return;
    const r = rooms.get(ws.roomKey);
    if (!r) return;

    if (m.type === 'sync') {
      if (m.action === 'load') { r.source = m.source || null; r.state = null; }
      else r.state = { action: m.action, time: Number(m.time) || 0, watchId: m.watchId || null, site: m.site || null, at: Date.now() };
    }
    // Phone Netflix/Prime: both press Ready -> server starts the countdown for both at the same moment
    if (m.type === 'ready') {
      if (m.on) r.ready.add(ws.id); else r.ready.delete(ws.id);
      if (typeof m.at === 'string') r.readyAt = m.at.slice(0, 10);
      broadcastReady(r);
      if (r.clients.size === MAX_PEOPLE && r.ready.size === MAX_PEOPLE) {
        const at = r.readyAt;
        r.ready.clear();
        r.clients.forEach((c) => send(c, { type: 'countdown', at }));
        broadcastReady(r);
      }
      return;
    }

    if (['signal', 'chat', 'sync', 'typing', 'pauseall', 'media'].includes(m.type)) {
      othersIn(ws).forEach((c) => send(c, { ...m, from: ws.id, fromName: ws.name }));
    }
  });

  ws.on('close', () => {
    const r = rooms.get(ws.roomKey);
    if (!r) return;
    r.clients.delete(ws);
    r.ready.delete(ws.id);
    r.clients.forEach((c) => send(c, { type: 'peer-left', id: ws.id }));
    if (r.clients.size) broadcastReady(r);
    if (r.clients.size === 0) rooms.delete(ws.roomKey);
  });
});

// Drop dead connections (phone locked, network gone, etc.)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`EZOX Duo chal raha hai: http://localhost:${PORT}`));
