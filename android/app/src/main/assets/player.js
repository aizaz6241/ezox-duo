// EZOX Duo – runs inside Netflix / YouTube / Prime / Hotstar in the Android app.
// Talks to the app through window.DuoBridge; the app talks back through window.__duoIn.
(function () {
  if (window.__duoLoaded) return;
  window.__duoLoaded = true;

  var HOST = location.hostname;
  var SITE = HOST.indexOf('netflix') >= 0 ? 'netflix'
    : HOST.indexOf('youtube') >= 0 ? 'youtube'
    : HOST.indexOf('hotstar') >= 0 ? 'hotstar'
    : 'prime';
  var SITE_NAME = { netflix: 'Netflix', youtube: 'YouTube', hotstar: 'Hotstar', prime: 'Prime Video' }[SITE];

  var video = null, expect = null, pending = null, joined = false;

  var badge = (function () {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(0,0,0,.8);color:#fff;font:15px system-ui,sans-serif;padding:7px 14px;border-radius:8px;' +
      'pointer-events:none;transition:opacity .4s;max-width:90%;text-align:center';
    var t;
    return function (text, stay) {
      el.textContent = 'EZOX Duo · ' + text;
      if (!el.isConnected) (document.body || document.documentElement).appendChild(el);
      el.style.opacity = '1';
      clearTimeout(t);
      if (!stay) t = setTimeout(function () { el.style.opacity = '0'; }, 3500);
    };
  })();

  function send(o) { try { window.DuoBridge && window.DuoBridge.post(JSON.stringify(o)); } catch (e) {} }

  function titleId() {
    var p = location.pathname, m;
    if (SITE === 'netflix') { m = p.match(/\/watch\/(\d+)/); return m ? m[1] : null; }
    if (SITE === 'youtube') return p === '/watch' ? new URLSearchParams(location.search).get('v') : null;
    if (SITE === 'hotstar') { m = p.match(/\/(\d{6,})(?:\/watch)?\/?$/); return m ? m[1] : p; }
    m = p.match(/\/detail\/([A-Za-z0-9]+)/); return m ? m[1] : p;
  }

  function onPlayerPage() {
    var p = location.pathname;
    if (SITE === 'netflix') return p.indexOf('/watch') === 0;
    if (SITE === 'youtube') return p === '/watch';
    return true;
  }

  function findVideo() {
    var vids = Array.prototype.slice.call(document.querySelectorAll('video'))
      .filter(function (v) { return v.readyState > 0 && v.offsetWidth > 0; });
    if (!vids.length) return null;
    vids.sort(function (a, b) { return (b.duration || 0) - (a.duration || 0); });
    return vids[0];
  }

  function seek(t) {
    if (SITE === 'netflix') {
      try {
        var vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
        var ids = vp.getAllPlayerSessionIds();
        var id = ids.filter(function (s) { return s.indexOf('watch') === 0; })[0] || ids[0];
        vp.getVideoPlayerBySessionId(id).seek(Math.round(t * 1000));
        return;
      } catch (e) {}
    }
    if (video) video.currentTime = t;
  }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(s).padStart(2, '0');
  }

  function apply(s) {
    if (s.site && s.site !== SITE) { badge('Partner ' + s.site + ' par hain — neeche se wahi kholo', true); return; }
    if (s.watchId && s.watchId !== titleId()) {
      if (SITE === 'netflix' || SITE === 'youtube') {
        try { sessionStorage.setItem('ezoxDuoPending', JSON.stringify(s)); } catch (e) {}
        badge('Partner wali movie khul rahi hai…', true);
        location.href = SITE === 'netflix' ? 'https://www.netflix.com/watch/' + s.watchId : 'https://www.youtube.com/watch?v=' + s.watchId;
      } else badge('Partner doosri movie/episode par hain — same wali kholo', true);
      return;
    }
    if (!video) { pending = s; return; }
    expect = { action: s.action, time: s.time, until: Date.now() + 2500 };
    if (Math.abs(video.currentTime - s.time) > 1.5) seek(s.time);
    if (s.action === 'play' && video.paused) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () { badge('Ek dafa play dabao'); }); }
    if (s.action === 'pause' && !video.paused) video.pause();
  }

  function report(action) {
    if (!video) return;
    if (expect && Date.now() < expect.until && action === expect.action && Math.abs(video.currentTime - expect.time) < 2) return;
    send({ type: 'sync', action: action, time: video.currentTime, watchId: titleId(), site: SITE });
  }

  window.__duoIn = function (raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'error') { badge(m.message, true); return; }
    if (m.type === 'joined') {
      joined = true;
      badge(m.peers.length ? SITE_NAME + ' sync ✓ — ' + m.peers[0].name + ' bhi yahan hain' : SITE_NAME + ' sync ✓ — partner ka intezar…');
      if (m.state) apply(Object.assign({}, m.state, { time: m.state.action === 'play' ? m.state.time + m.state.elapsed : m.state.time }));
      else if (m.peers.length && video) setTimeout(function () { report(video.paused ? 'pause' : 'play'); }, 1000);
    }
    if (m.type === 'peer-joined') {
      badge(m.peer.name + ' aa gaye ❤️');
      setTimeout(function () { if (video) report(video.paused ? 'pause' : 'play'); }, 1500);
    }
    if (m.type === 'peer-left') badge('Partner chale gaye');
    if (m.type === 'sync' && m.action !== 'load') {
      badge(m.fromName + ': ' + (m.action === 'play' ? '▶ play' : '⏸ pause') + ' · ' + fmt(m.time));
      apply(m);
    }
  };

  setInterval(function () {
    if (!onPlayerPage()) return;
    var v = findVideo();
    if (!v || v === video) return;
    video = v;
    v.addEventListener('play', function () { report('play'); });
    v.addEventListener('pause', function () { report('pause'); });
    v.addEventListener('seeked', function () { report(v.paused ? 'pause' : 'play'); });
    var saved = null;
    try { saved = sessionStorage.getItem('ezoxDuoPending'); sessionStorage.removeItem('ezoxDuoPending'); } catch (e) {}
    if (saved) pending = JSON.parse(saved);
    if (pending) { var p = pending; pending = null; setTimeout(function () { apply(p); }, 1500); }
    else if (joined) setTimeout(function () { report(v.paused ? 'pause' : 'play'); }, 800);
  }, 1000);

  // ask the app for the room status (in case we loaded after joining)
  try { window.DuoBridge && window.DuoBridge.ready(); } catch (e) {}
})();
