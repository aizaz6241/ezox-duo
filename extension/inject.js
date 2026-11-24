// Runs inside Netflix's own page. Netflix breaks if you change video.currentTime directly,
// so seeking goes through Netflix's internal player API.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__ezoxDuo !== 'seek') return;
  try {
    const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
    const id = vp.getAllPlayerSessionIds().find((s) => s.startsWith('watch')) || vp.getAllPlayerSessionIds()[0];
    vp.getVideoPlayerBySessionId(id).seek(Math.round(e.data.time * 1000));
  } catch (err) {
    console.warn('[EZOX Duo] seek failed', err);
  }
});
