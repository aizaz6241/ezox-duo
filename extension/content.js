// EZOX Duo – Movie Sync (Netflix, Prime Video, Hotstar, YouTube)
const HOST = location.hostname;
const SITE = HOST.includes('netflix') ? 'netflix'
  : HOST.includes('youtube') ? 'youtube'
  : HOST.includes('hotstar') ? 'hotstar'
  : 'prime';
const SITE_NAME = { netflix: 'Netflix', youtube: 'YouTube', hotstar: 'Hotstar', prime: 'Prime Video' }[SITE];

let cfg = null, ws = null, video = null, expect = null, retry = 0, stopped = true, pending = null;

const badge = (() => {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
    background: 'rgba(0,0,0,.8)', color: '#fff', font: '14px system-ui', padding: '7px 14px',
    borderRadius: '8px', pointerEvents: 'none', transition: 'opacity .4s',
  });
  let t;
  return (text, stay) => {
    el.textContent = 'EZOX Duo · ' + text;
    if (!el.isConnected) document.documentElement.appendChild(el);
    el.style.opacity = '1';
    clearTimeout(t);
    if (!stay) t = setTimeout(() => (el.style.opacity = '0'), 3500);
  };
})();

// Which movie/episode is open (so we know both are on the same thing)
function titleId() {
  const p = location.pathname;
  if (SITE === 'netflix') return (p.match(/\/watch\/(\d+)/) || [])[1] || null;
  if (SITE === 'youtube') return p === '/watch' ? new URLSearchParams(location.search).get('v') : null;
  if (SITE === 'hotstar') return (p.match(/\/(\d{6,})(?:\/watch)?\/?$/) || [])[1] || p;
  return (p.match(/\/detail\/([A-Za-z0-9]+)/) || [])[1] || p; // prime
}

// Only sync on real player pages (not previews on the home page)
function onPlayerPage() {
  const p = location.pathname;
  if (SITE === 'netflix') return p.startsWith('/watch');
  if (SITE === 'youtube') return p === '/watch';
  if (SITE === 'prime') return HOST.includes('primevideo') || p.includes('/gp/video') || p.includes('/video/');
  return true;
}

// Pick the main movie <video> (Prime has several hidden ones)
function findVideo() {
  const vids = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 && v.offsetWidth > 0);
  if (!vids.length) return null;
  return vids.sort((a, b) => (b.duration || 0) - (a.duration || 0))[0];
}

function seek(t) {
  if (SITE === 'netflix') window.postMessage({ __ezoxDuo: 'seek', time: t }, '*'); // Netflix breaks on currentTime
  else if (video) video.currentTime = t;
}

const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function readCfg(cb) {
  chrome.storage.local.get(['server', 'room', 'password', 'name', 'enabled'], (c) => { cfg = c; cb && cb(); });
}

function connect() {
  if (!cfg || cfg.enabled === false || !cfg.server || !cfg.room) return;
  if (ws && ws.readyState <= 1) return;
  stopped = false;
  const url = cfg.server.trim().replace(/^http/i, 'ws').replace(/\/$/, '');
  try { ws = new WebSocket(url); } catch { return badge('Server link galat hai', true); }
  ws.onopen = () => {
    retry = 0;
    send({ type: 'join', kind: 'netflix', room: cfg.room, password: cfg.password, name: cfg.name || 'Me' });
  };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => {
    if (stopped) return;
    badge('Connection toot gaya — dobara jor raha hai…');
    setTimeout(connect, Math.min(30000, 2000 * ++retry));
  };
}

function disconnect() { stopped = true; try { ws && ws.close(); } catch {} ws = null; }

function onMsg(m) {
  if (m.type === 'error') { stopped = true; badge(m.message + ' (kya doosra movie tab bhi khula hai?)', true); return; }
  if (m.type === 'joined') {
    badge(m.peers.length ? `${SITE_NAME} connected ✓ — ${m.peers[0].name} bhi yahan hain` : `${SITE_NAME} connected ✓ — partner ka intezar…`);
    if (m.state) apply({ ...m.state, time: m.state.action === 'play' ? m.state.time + m.state.elapsed : m.state.time });
    else if (m.peers.length) setTimeout(() => report(video && !video.paused ? 'play' : 'pause'), 1000);
  }
  if (m.type === 'peer-joined') {
    badge(`${m.peer.name} aa gaye ❤️`);
    setTimeout(() => { if (video) report(video.paused ? 'pause' : 'play'); }, 1500);
  }
  if (m.type === 'peer-left') badge('Partner chale gaye');
  if (m.type === 'sync' && m.action !== 'load') {
    badge(`${m.fromName}: ${m.action === 'play' ? '▶ play' : '⏸ pause'} · ${fmt(m.time)}`);
    apply(m);
  }
}

function fmt(t) {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(s).padStart(2, '0');
}

function apply(s) {
  if (s.site && s.site !== SITE) { badge(`Partner ${s.site} par hain — aap bhi wahan same movie kholo`, true); return; }
  if (s.watchId && s.watchId !== titleId()) {
    if (SITE === 'netflix' || SITE === 'youtube') {
      sessionStorage.setItem('ezoxDuoPending', JSON.stringify(s));
      location.href = SITE === 'netflix' ? 'https://www.netflix.com/watch/' + s.watchId : 'https://www.youtube.com/watch?v=' + s.watchId;
    } else badge('Partner doosri movie/episode par hain — same wali kholo', true);
    return;
  }
  if (!video) { pending = s; return; }
  expect = { action: s.action, time: s.time, until: Date.now() + 2500 };
  if (Math.abs(video.currentTime - s.time) > 1.5) seek(s.time);
  if (s.action === 'play' && video.paused) video.play().catch(() => badge('Ek dafa play dabao (browser ne roka)'));
  if (s.action === 'pause' && !video.paused) video.pause();
}

function report(action) {
  if (!video) return;
  // skip only the echo of what the partner just told us to do — real clicks always go through
  if (expect && Date.now() < expect.until && action === expect.action && Math.abs(video.currentTime - expect.time) < 2) return;
  send({ type: 'sync', action, time: video.currentTime, watchId: titleId(), site: SITE });
}

// Streaming sites are single-page apps: keep looking for the current movie <video>.
setInterval(() => {
  if (!onPlayerPage()) return;
  const v = findVideo();
  if (!v || v === video) return;
  video = v;
  v.addEventListener('play', () => report('play'));
  v.addEventListener('pause', () => report('pause'));
  v.addEventListener('seeked', () => report(v.paused ? 'pause' : 'play'));
  if (!cfg) return;
  connect(); // only connect once a real movie player is open
  const saved = sessionStorage.getItem('ezoxDuoPending');
  if (saved) { sessionStorage.removeItem('ezoxDuoPending'); pending = JSON.parse(saved); }
  if (pending) { const p = pending; pending = null; setTimeout(() => apply(p), 1500); }
}, 1000);

chrome.storage.onChanged.addListener(() => { disconnect(); readCfg(() => { if (video) connect(); }); });
readCfg();
