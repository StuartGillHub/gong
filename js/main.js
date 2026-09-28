/* Wires the sound sources to the listener and the listener to the pool. */
(function () {
  'use strict';
  const G = window.G;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const player = $('player');

  /* ---------- the pool ---------- */
  let pool;
  try {
    pool = new G.Pool($('pool'));
  } catch (e) {
    $('welcome').querySelector('p').textContent = 'This browser can\'t draw the pool (WebGL is unavailable).';
    console.error(e);
    return;
  }

  /* ---------- settings (remembered on this device) ---------- */
  const settings = { sens: 1, variety: 0.5, bright: 1, quality: 0.75 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('gongpool') || '{}')); } catch (e) { /* none saved */ }
  function saveSettings() {
    try { localStorage.setItem('gongpool', JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }
  for (const key of Object.keys(settings)) {
    const el = $(key);
    el.value = settings[key];
    el.addEventListener('input', () => { settings[key] = +el.value; applySettings(); saveSettings(); });
  }
  function applySettings() {
    pool.brightness = settings.bright;
    pool.quality = settings.quality;
    if (listener) {
      listener.sensitivity = settings.sens;
      listener.variety = settings.variety;
    }
  }

  /* ---------- audio graph ---------- */
  let ctx = null, listener = null, mediaNode = null, demo = null, micStream = null, micNode = null;
  let mode = null;          // 'track' | 'mic' | 'demo'
  let queue = [], qi = 0;   // tracks: {kind:'audius'|'file', ...}
  applySettings();

  function ensureAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    listener = new G.Listener(ctx);
    // keep the analyser running even when nothing else reaches the speakers
    const sink = ctx.createGain();
    sink.gain.value = 0;
    listener.input.connect(sink);
    sink.connect(ctx.destination);
    player.crossOrigin = 'anonymous';
    mediaNode = ctx.createMediaElementSource(player);
    mediaNode.connect(listener.input);
    mediaNode.connect(ctx.destination);
    applySettings();
  }

  function stopAll() {
    if (demo) demo.stop();
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micNode.disconnect();
      micStream = null;
    }
    player.pause();
    mode = null;
    refreshButtons();
  }

  function begin() {
    body.classList.add('started');
    $('welcome').classList.add('gone');
  }

  function refreshButtons() {
    document.querySelectorAll('#bar [data-action]').forEach((b) => {
      const a = b.dataset.action;
      b.classList.toggle('on', (a === 'mic' && mode === 'mic') || (a === 'demo' && mode === 'demo') ||
        (a === 'audius' && mode === 'track' && queue[qi] && queue[qi].kind === 'audius') ||
        (a === 'file' && mode === 'track' && queue[qi] && queue[qi].kind === 'file'));
    });
    const playing = mode === 'demo' ? demo && demo.running : mode === 'mic' ? true : !player.paused;
    body.classList.toggle('playing', !!playing);
    $('nextBtn').style.display = mode === 'track' && queue.length > 1 ? '' : 'none';
  }

  /* ---------- sources ---------- */
  async function startMic() {
    ensureAudio();
    stopAll();
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      toast('The microphone isn\'t available. Check the browser\'s permission for this page.', 5000);
      return;
    }
    micNode = ctx.createMediaStreamSource(micStream);
    micNode.connect(listener.input);
    mode = 'mic';
    begin();
    setNowPlaying('Listening through the microphone');
    refreshButtons();
  }

  function startDemo() {
    ensureAudio();
    stopAll();
    if (!demo) {
      demo = new G.Demo(ctx, ctx.destination);
      demo.out.connect(listener.input);
    }
    demo.start();
    mode = 'demo';
    begin();
    setNowPlaying('Demo gongs');
    refreshButtons();
  }

  function playQueue(list, start) {
    ensureAudio();
    stopAll();
    queue = list;
    qi = start || 0;
    mode = 'track';
    begin();
    playCurrent();
  }

  let fallbackTried = false, currentUrl = null;
  function playCurrent() {
    const t = queue[qi];
    if (!t) return;
    fallbackTried = false;
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    if (t.kind === 'file') {
      currentUrl = URL.createObjectURL(t.file);
      player.src = currentUrl;
      setNowPlaying(t.title);
    } else {
      player.src = G.Audius.streamUrl(t);
      setNowPlaying(`${esc(t.title)} · ${esc(t.artist)} · <a href="${t.link}" target="_blank" rel="noopener">via Audius</a>`, true);
    }
    player.loop = queue.length === 1;
    player.play().catch(() => {});
    markCurrent();
    refreshButtons();
  }

  // if the browser can't stream a track directly, fetch the whole file instead
  player.addEventListener('error', async () => {
    const t = queue[qi];
    if (mode !== 'track' || !t || t.kind !== 'audius' || fallbackTried) {
      if (mode === 'track') { toast('That track couldn\'t be played. Trying the next one.', 4000); setTimeout(next, 1500); }
      return;
    }
    fallbackTried = true;
    const want = t;
    toast('Loading track…', 60000);
    try {
      const blob = await G.Audius.download(t, (p) => toast(`Loading track… ${Math.round(p * 100)}%`, 60000));
      if (queue[qi] !== want) return;
      currentUrl = URL.createObjectURL(blob);
      player.src = currentUrl;
      await player.play();
      toast('', 0);
    } catch (e) {
      toast("That track couldn't be loaded from Audius. Trying the next one.", 4000);
      setTimeout(next, 1500);
    }
  });
  player.addEventListener('ended', next);
  player.addEventListener('play', refreshButtons);
  player.addEventListener('pause', refreshButtons);

  function next() {
    if (mode !== 'track' || !queue.length) return;
    qi = (qi + 1) % queue.length;
    playCurrent();
  }

  function togglePlay() {
    if (!mode) { startDemo(); return; }
    ensureAudio();
    if (mode === 'demo') { demo.running ? demo.stop() : demo.start(); }
    else if (mode === 'mic') { stopAll(); setNowPlaying(''); }
    else if (player.paused) player.play().catch(() => {});
    else player.pause();
    refreshButtons();
  }

  /* ---------- files ---------- */
  $('fileInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) playQueue(files.map((f) => ({ kind: 'file', file: f, title: f.name.replace(/\.[^.]+$/, '') })), 0);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /^(audio|video)\//.test(f.type));
    if (files.length) playQueue(files.map((f) => ({ kind: 'file', file: f, title: f.name.replace(/\.[^.]+$/, '') })), 0);
  });

  /* ---------- Audius ---------- */
  let results = [], req = 0;
  function openSheet() {
    $('settings').hidden = true;
    $('sheet').hidden = false;
    if (!$('list').children.length) search($('query').value);
  }
  function closeSheet() { $('sheet').hidden = true; }
  function listMessage(text) {
    $('list').innerHTML = '';
    const li = document.createElement('li');
    li.className = 'msg';
    li.textContent = text;
    $('list').appendChild(li);
  }
  async function search(q) {
    q = (q || '').trim() || 'gong';
    $('query').value = q;
    const mine = ++req;
    $('listLabel').textContent = `Results for “${q}”`;
    listMessage('Searching…');
    try {
      const tracks = await G.Audius.search(q);
      if (mine !== req) return;
      results = tracks.map((t) => Object.assign({ kind: 'audius' }, t));
      if (!results.length) { listMessage('No playable tracks found. Try another search.'); return; }
      const list = $('list');
      list.innerHTML = '';
      results.forEach((t, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.innerHTML = `${t.artwork ? `<img src="${t.artwork}" alt="" loading="lazy">` : '<span class="art"></span>'}
          <span class="txt"><span class="t">${esc(t.title)}</span><span class="a">${esc(t.artist)}</span></span>
          <span class="dur">${fmt(t.duration)}</span>`;
        b.addEventListener('click', () => { playQueue(results.slice(), i); closeSheet(); });
        li.appendChild(b);
        list.appendChild(li);
      });
      markCurrent();
    } catch (e) {
      if (mine !== req) return;
      listMessage('Couldn\'t reach Audius. Check the connection. (Pages opened inside some previews aren\'t allowed to fetch music from other sites; open the hosted copy instead.)');
    }
  }
  function markCurrent() {
    const cur = queue[qi];
    [...$('list').children].forEach((li, i) => li.classList.toggle('current', !!cur && results[i] && results[i].id === cur.id));
  }
  $('searchForm').addEventListener('submit', (e) => { e.preventDefault(); search($('query').value); $('query').blur(); });
  document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => search(b.dataset.q)));
  $('sheetClose').addEventListener('click', closeSheet);

  /* ---------- buttons & keys ---------- */
  function act(a) {
    if (a === 'audius') { ensureAudio(); $('sheet').hidden ? openSheet() : closeSheet(); }
    else if (a === 'file') { ensureAudio(); $('fileInput').click(); }
    else if (a === 'mic') { mode === 'mic' ? (stopAll(), setNowPlaying('')) : startMic(); }
    else if (a === 'demo') { mode === 'demo' ? (stopAll(), setNowPlaying('')) : startDemo(); }
  }
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => act(b.dataset.action)));
  $('playBtn').addEventListener('click', togglePlay);
  $('nextBtn').addEventListener('click', next);
  $('settingsBtn').addEventListener('click', () => { closeSheet(); $('settings').hidden = !$('settings').hidden; });
  $('fullBtn').addEventListener('click', toggleFull);
  $('forgetBtn').addEventListener('click', () => { if (listener) listener.reset(); pool.forget(); toast('Starting afresh', 2000); });

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
  }
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'f') toggleFull();
    else if (k === 'n') next();
    else if (k === 'd') act('demo');
    else if (k === 'h') { body.classList.toggle('idle'); return; }
    else if (k === 'escape') { closeSheet(); $('settings').hidden = true; }
    wake();
  });

  /* ---------- fade the controls when the mouse rests ---------- */
  let idleTimer = null;
  function wake() {
    body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!body.classList.contains('started')) return;
      if (!$('sheet').hidden && document.activeElement === $('query')) return wake();
      body.classList.add('idle');
      $('settings').hidden = true;
    }, 4000);
  }
  ['pointermove', 'pointerdown', 'touchstart'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
  wake();

  /* ---------- little helpers ---------- */
  let toastTimer = null;
  function toast(text, ms) {
    const t = $('toast');
    clearTimeout(toastTimer);
    if (!text) { t.classList.remove('show'); return; }
    t.textContent = text;
    t.classList.add('show');
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3000);
  }
  function setNowPlaying(html, isHtml) {
    const el = $('nowPlaying');
    if (isHtml) el.innerHTML = html; else el.textContent = html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(sec) {
    if (!sec) return '';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  /* ---------- the loop ---------- */
  let last = performance.now() / 1000;
  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - last);
    last = now;
    if (listener && mode) {
      for (const s of listener.update(now)) pool.strike(s.gong, s.amp, now);
      pool.step(listener.gongs, now, dt);
    } else {
      pool.step([], now, dt);
    }
    const breathe = 0.04 + 0.03 * Math.sin(now * 0.4);
    pool.render(now, breathe);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // for testing: expose a way to drop a strike in by hand
  G.debug = { pool, get listener() { return listener; } };
})();
