// Visitor log: page opens, tab changes and key actions go to the mrck-visits Worker (Cloudflare), which adds the
// IP, location and network operator. There is no sign-in, so a visitor is a random id kept in this browser;
// ?ref=<name> on a shared link names the visitor (remembered in this browser).
// Nothing is sent from localhost / file:// (development).
(function () {
  const ENDPOINT = 'https://mrck-visits.balintsmail.workers.dev/e';
  const off = location.protocol === 'file:' || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname);
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: a new id per visit */ } };
  const rnd = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

  let vid = get('mrck.vid');
  if (!vid) { vid = rnd(); set('mrck.vid', vid); }
  const q = new URLSearchParams(location.search);
  let ref = q.get('ref');
  if (ref) set('mrck.ref', ref.slice(0, 60)); else ref = get('mrck.ref');
  const sid = rnd(), started = Date.now();
  const base = {
    vid, sid, ref,
    tz: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone,
    lang: navigator.language,
    screen: `${screen.width}x${screen.height}`,
  };

  let queue = [], timer = 0;
  function flush() {
    clearTimeout(timer); timer = 0;
    if (!queue.length || off) { queue = []; return; }
    const body = JSON.stringify(queue); queue = [];
    try {
      // text/plain: a "simple" cross-origin request, no preflight; sendBeacon survives the page closing
      if (!navigator.sendBeacon || !navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' })))
        fetch(ENDPOINT, { method: 'POST', body, keepalive: true, mode: 'cors', headers: { 'content-type': 'text/plain' } }).catch(() => {});
    } catch (e) { /* never break the app over the log */ }
  }
  // kind: 'tab' | 'action'; path: the view; detail: what happened
  function track(kind, path, detail) {
    queue.push(Object.assign({ kind, path: path || null, detail: detail || null }, base));
    if (!timer) timer = setTimeout(flush, 2000);
  }
  window.MRCK_TRACK = track;

  queue.push(Object.assign({ kind: 'open', path: null, detail: null, referrer: document.referrer || null }, base));
  timer = setTimeout(flush, 1000);
  addEventListener('pagehide', () => {
    queue.push(Object.assign({ kind: 'leave', detail: `${Math.round((Date.now() - started) / 1000)} s on the page` }, base));
    flush();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
})();
