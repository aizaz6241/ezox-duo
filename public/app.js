// EZOX Duo — client
const $ = (s) => document.querySelector(s);

let ws, myId, pc, localStream, iceServers = [];
let isOfferer = false, pendingCandidates = [];
let remoteStream = new MediaStream();
let roomName = '', roomPass = '', myName = '';
const IN_APP = /EZOXDuoApp/.test(navigator.userAgent) && !!window.DuoNative;
if (IN_APP) document.body.classList.add('inapp');
let facingMode = 'user';

// player state
let currentSource = null, yt = null, ytReady = false, videoEl = null;
let localFileUrl = null, localFileName = null, pendingState = null;
let expect = null;

/* ---------- server address ---------- */
// On Render the page and server are the same site. On Vercel the page talks to the Render server.
const SERVER = (window.DUO_SERVER || location.origin).replace(/\/$/, '');
const WS_URL = SERVER.replace(/^http/, 'ws');

/* ---------- helpers ---------- */
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}
function setStatus(t, ok = false) { const s = $('#status'); s.textContent = t; s.classList.toggle('ok', ok); }
function store(k, v) { try { localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }

$('#name').value = load('duo_name');
$('#room').value = load('duo_room');

/* ---------- join ---------- */
$('#joinBtn').onclick = async () => {
  const name = $('#name').value.trim() || 'Guest';
  const room = $('#room').value.trim();
  const password = $('#password').value;
  if (!room || password.length < 4) return toast('Room naam aur 4+ character password do');
  store('duo_name', name); store('duo_room', room);
  roomName = room; roomPass = password; myName = name;
  $('#joinBtn').disabled = true;

  try { iceServers = (await (await fetch(SERVER + '/config')).json()).iceServers; }
  catch { iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]; }

  localStream = await getMedia();
  $('#localVideo').srcObject = localStream;
  camOn = localStream.getVideoTracks().length > 0;
  micOn = localStream.getAudioTracks().length > 0;
  $('#camBtn').classList.toggle('off', !camOn);
  $('#micBtn').classList.toggle('off', !micOn);
  $('#localVideo').classList.toggle('cam-off', !camOn);

  ws = new WebSocket(WS_URL);
  ws.onopen = () => send({ type: 'join', room, password, name });
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => { setStatus('Connection toot gaya — page refresh karo'); };
};

async function getMedia() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); toast('Camera nahi mila — sirf voice chalegi'); return s; }
    catch { toast('Mic/camera ki permission nahi mili'); return new MediaStream(); }
  }
}

function handle(m) {
  switch (m.type) {
    case 'error':
      alert(m.message);
      localStream?.getTracks().forEach((t) => t.stop());
      location.reload();
      break;
    case 'joined':
      myId = m.id;
      $('#join').classList.add('hidden');
      $('#main').classList.remove('hidden');
      $('#roomLabel').textContent = roomName;
      if (IN_APP) { try { window.DuoNative.joined(roomName.toLowerCase(), roomPass, myName); } catch {} }
      if (m.state) pendingState = { ...m.state };
      if (m.source) loadSource(m.source, false);
      if (m.peers.length) {
        $('#remoteName').textContent = m.peers[0].name;
        startPeer(true);
        setStatus('Connect ho raha hai…');
        shareMediaState();
      } else setStatus('Partner ka intezar…');
      break;
    case 'peer-joined':
      $('#remoteName').textContent = m.peer.name;
      sysMsg(`${m.peer.name} aa gaye ❤️`);
      startPeer(false);
      setStatus('Connect ho raha hai…');
      shareMediaState();
      // share what we're watching with the newcomer
      if (currentSource) send({ type: 'sync', action: 'load', source: currentSource });
      setTimeout(() => { const p = player(); if (p) send({ type: 'sync', action: p.paused() ? 'pause' : 'play', time: p.time() }); }, 1500);
      break;
    case 'peer-left':
      sysMsg('Partner chale gaye');
      closePeer();
      $('#remoteName').textContent = '';
      showRemoteMedia({ cam: true, mic: true });
      setStatus('Partner ka intezar…');
      break;
    case 'signal': onSignal(m); break;
    case 'chat': addMsg(m.text, false); $('#typing').textContent = ''; break;
    case 'typing':
      $('#typing').textContent = `${m.fromName} likh rahe hain…`;
      clearTimeout(handle.tt); handle.tt = setTimeout(() => ($('#typing').textContent = ''), 2500);
      break;
    case 'sync': applySync(m); break;
    case 'ready-state': showReady(m); break;
    case 'countdown': runCountdown(m.at); break;
    case 'pauseall': showPauseAlert(m.fromName); break;
    case 'media': showRemoteMedia(m); break;
  }
}

/* ---------- Phone Netflix / Prime: ready check + countdown ---------- */
let counting = false, iAmReady = false;

$('#tabPhone').onclick = () => { $('#tabPhone').classList.add('active'); $('#tabLaptop').classList.remove('active'); $('#panePhone').classList.remove('hidden'); $('#paneLaptop').classList.add('hidden'); };
$('#tabLaptop').onclick = () => { $('#tabLaptop').classList.add('active'); $('#tabPhone').classList.remove('active'); $('#paneLaptop').classList.remove('hidden'); $('#panePhone').classList.add('hidden'); };

function cleanTime(t) {
  t = String(t || '').trim().replace(/[.\s]/g, ':');
  return /^\d{1,2}(:\d{1,2}){0,2}$/.test(t) ? t : '';
}

$('#atInput').onchange = () => {
  const at = cleanTime($('#atInput').value);
  if ($('#atInput').value && !at) return toast('Time aise likho: 45:10 ya 1:05:30');
  send({ type: 'ready', on: iAmReady, at });
};

$('#readyBtn').onclick = () => {
  if (!pc) return toast('Pehle partner ko room mein aane do');
  const raw = $('#atInput').value;
  const at = cleanTime(raw);
  if (raw && !at) return toast('Time aise likho: 45:10 ya 1:05:30');
  iAmReady = !iAmReady;
  send({ type: 'ready', on: iAmReady, at });
};

function showReady(m) {
  const me = m.people.find((p) => p.id === myId);
  iAmReady = !!(me && me.ready);
  $('#readyBtn').classList.toggle('on', iAmReady);
  $('#readyBtn').textContent = iAmReady ? '✅ Ready (wapas lo)' : '✅ Main ready hoon';
  const box = $('#people'); box.innerHTML = '';
  m.people.forEach((p) => {
    const d = document.createElement('span');
    d.className = 'person' + (p.ready ? ' ready' : '');
    d.textContent = (p.id === myId ? 'Aap' : p.name) + (p.ready ? ' ✓ ready' : ' ⏳');
    box.appendChild(d);
  });
  if (m.at) {
    $('#atShow').textContent = `Dono movie ko ${m.at} par rok do`;
    $('#atShow').classList.remove('hidden');
    if (document.activeElement !== $('#atInput')) $('#atInput').value = m.at;
  } else $('#atShow').classList.add('hidden');
  // open the panel for the partner so they see the request
  const other = m.people.find((p) => p.id !== myId);
  if (other && other.ready && !iAmReady) {
    $('#nfModal').classList.remove('hidden');
    navigator.vibrate?.(100);
  }
}

function runCountdown(at) {
  if (counting) return;
  counting = true;
  iAmReady = false;
  $('#readyBtn').classList.remove('on'); $('#readyBtn').textContent = '✅ Main ready hoon';
  $('#nfModal').classList.add('hidden');
  const box = $('#countdown'), num = $('#countNum'), txt = $('#countText');
  box.classList.remove('hidden');
  txt.textContent = at ? `Movie ${at} par ruki hui ho — PLAY par play dabao` : 'PLAY par Netflix / Prime mein play dabao';
  let n = 3;
  num.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) num.textContent = n;
    else if (n === 0) { num.textContent = 'PLAY'; txt.textContent = 'Abhi dabao! ▶'; navigator.vibrate?.(300); }
    else { clearInterval(iv); box.classList.add('hidden'); counting = false; }
  }, 1000);
  sysMsg('3-2-1 chala — dono ne ek saath play kiya 🎬');
}

$('#pauseAllBtn').onclick = () => {
  if (!pc) return toast('Partner abhi room mein nahi');
  send({ type: 'pauseall' });
  $('#nfModal').classList.add('hidden');
  toast('Partner ko pause ka alert chala gaya');
  sysMsg('Aapne pause kaha ⏸');
};

function showPauseAlert(name) {
  $('#pauseText').textContent = `${name} ne pause kiya — apni movie pause karo`;
  $('#pauseAlert').classList.remove('hidden');
  navigator.vibrate?.([200, 100, 200]);
  sysMsg(`${name} ne pause kaha ⏸`);
}
$('#pauseOk').onclick = () => {
  $('#pauseAlert').classList.add('hidden');
  send({ type: 'chat', text: '⏸ Maine bhi pause kar diya' });
  addMsg('⏸ Maine bhi pause kar diya', true);
};

/* ---------- video call (WebRTC) ---------- */
function startPeer(offerer) {
  closePeer();
  isOfferer = offerer;
  pc = new RTCPeerConnection({ iceServers });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  if (!localStream.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
  if (!localStream.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });

  remoteStream = new MediaStream();
  $('#remoteVideo').srcObject = remoteStream;
  pc.ontrack = (e) => { remoteStream.addTrack(e.track); };
  pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'signal', candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') setStatus('Connected ✓', true);
    else if (s === 'disconnected') setStatus('Network kamzor hai…');
    else if (s === 'failed') { setStatus('Call fail — dobara koshish…'); if (isOfferer) makeOffer(true); }
  };
  if (offerer) makeOffer(false);
}

async function makeOffer(iceRestart) {
  const o = await pc.createOffer({ iceRestart });
  await pc.setLocalDescription(o);
  send({ type: 'signal', sdp: pc.localDescription });
}

async function onSignal(m) {
  if (!pc) startPeer(false);
  try {
    if (m.sdp) {
      await pc.setRemoteDescription(m.sdp);
      for (const c of pendingCandidates) { try { await pc.addIceCandidate(c); } catch {} }
      pendingCandidates = [];
      if (m.sdp.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        send({ type: 'signal', sdp: pc.localDescription });
      }
    } else if (m.candidate) {
      if (pc.remoteDescription) { try { await pc.addIceCandidate(m.candidate); } catch {} }
      else pendingCandidates.push(m.candidate);
    }
  } catch (err) { console.warn('signal error', err); }
}

function closePeer() {
  if (pc) { pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = null; pc.close(); pc = null; }
  pendingCandidates = [];
}

/* ---------- camera / mic: really turn the device OFF (light goes off) ---------- */
let camOn = true, micOn = true;

function shareMediaState() { send({ type: 'media', cam: camOn, mic: micOn }); }

// put a track (or null) on the call without restarting it
async function attachTrack(kind, track) {
  if (!pc) return;
  const tr = pc.getTransceivers().find((t) => t.receiver.track && t.receiver.track.kind === kind);
  if (!tr) { if (track) { pc.addTrack(track, localStream); await makeOffer(false); } return; }
  await tr.sender.replaceTrack(track);
  if (track && (tr.direction === 'recvonly' || tr.direction === 'inactive')) {
    tr.direction = 'sendrecv';
    await makeOffer(false);
  }
}

async function setDevice(kind, on) {
  if (!on) {
    const getter = kind === 'video' ? 'getVideoTracks' : 'getAudioTracks';
    localStream[getter]().forEach((t) => { t.stop(); localStream.removeTrack(t); });
    await attachTrack(kind, null);
  } else {
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia(kind === 'video'
        ? { video: { facingMode } }
        : { audio: { echoCancellation: true, noiseSuppression: true } });
    } catch { toast(kind === 'video' ? 'Camera nahi khula — permission check karo' : 'Mic nahi khula'); return false; }
    const t = kind === 'video' ? s.getVideoTracks()[0] : s.getAudioTracks()[0];
    localStream.addTrack(t);
    await attachTrack(kind, t);
  }
  return true;
}

$('#camBtn').onclick = async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  const want = !camOn;
  if (await setDevice('video', want) !== false) camOn = want;
  btn.disabled = false;
  btn.classList.toggle('off', !camOn);
  $('#localVideo').srcObject = localStream;
  $('#localVideo').classList.toggle('cam-off', !camOn);
  shareMediaState();
};
$('#micBtn').onclick = async (e) => {
  const btn = e.currentTarget; btn.disabled = true;
  const want = !micOn;
  if (await setDevice('audio', want) !== false) micOn = want;
  btn.disabled = false;
  btn.classList.toggle('off', !micOn);
  btn.textContent = micOn ? '🎤' : '🔇';
  shareMediaState();
};
$('#flipBtn').onclick = async () => {
  if (!camOn) return toast('Pehle camera on karo');
  const old = localStream.getVideoTracks()[0];
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
    const nt = s.getVideoTracks()[0];
    if (old) { localStream.removeTrack(old); old.stop(); }
    localStream.addTrack(nt);
    await attachTrack('video', nt);
    $('#localVideo').srcObject = localStream;
    $('#localVideo').style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'none';
  } catch { toast('Doosra camera nahi mila'); facingMode = 'user'; }
};

function showRemoteMedia(m) {
  $('#remoteOff').classList.toggle('hidden', m.cam !== false);
  $('#remoteAvatar').textContent = (m.fromName || '?').trim().charAt(0).toUpperCase();
  $('#remoteOffName').textContent = m.fromName || '';
  $('#remoteMic').classList.toggle('hidden', m.mic !== false);
}
$('#pipBtn').onclick = async () => {
  const v = $('#remoteVideo');
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
  } catch { toast('Yeh browser chhoti window support nahi karta'); }
};
$('#leaveBtn').onclick = () => {
  if (IN_APP) { try { window.DuoNative.left(); } catch {} }
  closePeer(); localStream?.getTracks().forEach((t) => t.stop()); ws?.close(); location.reload();
};

/* ---------- chat ---------- */
function addMsg(text, me) {
  const d = document.createElement('div');
  d.className = 'msg' + (me ? ' me' : '');
  d.textContent = text;
  $('#messages').appendChild(d);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}
function sysMsg(text) {
  const d = document.createElement('div'); d.className = 'msg sys'; d.textContent = text;
  $('#messages').appendChild(d); $('#messages').scrollTop = $('#messages').scrollHeight;
}
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const t = $('#chatInput').value.trim(); if (!t) return;
  send({ type: 'chat', text: t.slice(0, 2000) }); addMsg(t, true); $('#chatInput').value = '';
};
let lastTyping = 0;
$('#chatInput').oninput = () => { if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); send({ type: 'typing' }); } };

/* ---------- synced player ---------- */
function parseYouTube(u) {
  const m = u.match(/(?:youtu\.be\/|[?&]v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}

$('#loadBtn').onclick = () => {
  const v = $('#urlInput').value.trim(); if (!v) return;
  const id = parseYouTube(v);
  if (id) loadSource({ kind: 'youtube', value: id }, true);
  else if (/^https?:\/\//i.test(v)) loadSource({ kind: 'url', value: v }, true);
  else toast('Sahi YouTube ya video link do');
  $('#urlInput').value = '';
};
$('#urlInput').onkeydown = (e) => { if (e.key === 'Enter') $('#loadBtn').click(); };

$('#fileInput').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (localFileUrl) URL.revokeObjectURL(localFileUrl);
  localFileUrl = URL.createObjectURL(f); localFileName = f.name;
  // if partner already chose this file, don't re-announce it
  const answering = currentSource && currentSource.kind === 'local' && currentSource.value === f.name;
  loadSource({ kind: 'local', value: f.name }, !answering);
  e.target.value = '';
};

$('#netflixBtn').onclick = () => $('#nfModal').classList.remove('hidden');
$('#nfClose').onclick = () => $('#nfModal').classList.add('hidden');

let ytPromise;
function ensureYT() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((res) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  });
  return ytPromise;
}

function loadSource(src, broadcast) {
  currentSource = src;
  if (yt) { try { yt.destroy(); } catch {} yt = null; ytReady = false; }
  videoEl = null;
  const box = $('#player'); box.innerHTML = '';

  if (src.kind === 'youtube') {
    const d = document.createElement('div'); d.id = 'yt'; box.appendChild(d);
    ensureYT().then(() => {
      if (currentSource !== src) return;
      yt = new YT.Player('yt', {
        videoId: src.value,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { ytReady = true; applyPending(); },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) localEvent('play');
            else if (e.data === YT.PlayerState.PAUSED) localEvent('pause');
          },
        },
      });
    });
  } else if (src.kind === 'url' || (src.kind === 'local' && localFileUrl && localFileName === src.value)) {
    const v = document.createElement('video');
    v.controls = true; v.playsInline = true; v.preload = 'auto';
    v.src = src.kind === 'url' ? src.value : localFileUrl;
    v.onplay = () => localEvent('play');
    v.onpause = () => localEvent('pause');
    v.onseeked = () => localEvent(v.paused ? 'pause' : 'play');
    v.onloadedmetadata = applyPending;
    v.onerror = () => toast('Video load nahi hui — link check karo');
    box.appendChild(v); videoEl = v;
  } else if (src.kind === 'local') {
    const d = document.createElement('div'); d.className = 'empty';
    d.textContent = `Partner "${src.value}" chala rahe hain. Apne phone/laptop se wohi file chuno.`;
    const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'File chuno';
    b.onclick = () => $('#fileInput').click();
    d.appendChild(document.createElement('br')); d.appendChild(b); box.appendChild(d);
  }

  if (broadcast) send({ type: 'sync', action: 'load', source: src });
}

function player() {
  if (yt && ytReady) return {
    time: () => yt.getCurrentTime(), seek: (t) => yt.seekTo(t, true),
    play: () => yt.playVideo(), pause: () => yt.pauseVideo(),
    paused: () => yt.getPlayerState() !== YT.PlayerState.PLAYING,
  };
  if (videoEl && videoEl.readyState >= 1) return {
    time: () => videoEl.currentTime, seek: (t) => { videoEl.currentTime = t; },
    play: () => videoEl.play().catch(() => toast('Play dabao — browser ne auto-play roka')),
    pause: () => videoEl.pause(), paused: () => videoEl.paused,
  };
  return null;
}

function localEvent(action) {
  const p = player(); if (!p) return;
  // skip only the echo of the partner's own command — real clicks always go through
  if (expect && Date.now() < expect.until && action === expect.action && Math.abs(p.time() - expect.time) < 2) return;
  send({ type: 'sync', action, time: p.time() });
}

function applySync(m) {
  if (m.action === 'load') {
    const same = currentSource && currentSource.kind === m.source.kind && currentSource.value === m.source.value;
    if (same && (m.source.kind !== 'local' || localFileUrl)) return;
    loadSource(m.source, false);
    sysMsg(`${m.fromName} ne nayi video lagayi`);
    return;
  }
  applyState(m.action, m.time);
}

function applyState(action, time) {
  const p = player();
  if (!p) { pendingState = { action, time, elapsed: 0 }; return; }
  expect = { action, time, until: Date.now() + 2500 };
  if (Math.abs(p.time() - time) > 1) p.seek(time);
  action === 'play' ? p.play() : p.pause();
}

function applyPending() {
  if (!pendingState) return;
  const s = pendingState; pendingState = null;
  const t = s.action === 'play' ? s.time + (s.elapsed || 0) : s.time;
  applyState(s.action, t);
}
