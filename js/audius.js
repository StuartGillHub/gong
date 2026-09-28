/* Audius: an open music streaming service whose public API lets apps search
 * the catalogue and stream full tracks. No key needed; app_name identifies us.
 * API: https://api.audius.co/v1
 */
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const API = 'https://api.audius.co/v1';
  const APP = 'GongPool';

  async function getJSON(path, params) {
    const q = new URLSearchParams(Object.assign({ app_name: APP }, params || {}));
    const res = await fetch(`${API}${path}?${q}`);
    if (!res.ok) throw new Error(`Audius replied ${res.status}`);
    const body = await res.json();
    return body.data || [];
  }

  // Only tracks anyone can stream in full.
  function playable(tracks) {
    return tracks.filter((t) => t && t.id && t.is_streamable !== false && !t.is_stream_gated && !t.is_delete);
  }

  function describe(t) {
    const art = t.artwork || {};
    return {
      id: t.id,
      title: t.title || 'Untitled',
      artist: (t.user && (t.user.name || t.user.handle)) || 'Unknown artist',
      duration: t.duration || 0,
      artwork: art['150x150'] || art['480x480'] || '',
      link: t.permalink ? `https://audius.co${t.permalink}` : 'https://audius.co',
    };
  }

  async function search(query) {
    return playable(await getJSON('/tracks/search', { query, limit: 40 })).map(describe);
  }

  function streamUrl(track) {
    return `${API}/tracks/${encodeURIComponent(track.id)}/stream?app_name=${APP}`;
  }

  // Fallback when the browser won't stream directly: fetch the whole file.
  async function download(track, onProgress) {
    const res = await fetch(streamUrl(track));
    if (!res.ok) throw new Error(`Audius replied ${res.status}`);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !res.body.getReader) return await res.blob();
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (onProgress) onProgress(total ? got / total : Math.min(0.95, got / 3e7));
    }
    return new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
  }

  G.Audius = { search, streamUrl, download };
})();
