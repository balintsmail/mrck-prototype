// LogPanel — the imported MoTeC log, below the slip-target graph:
//  - show / hide the logged data on the graph
//  - DTC torque reduction graph (180px, same lean axis as the slip-target graph)
//  - gear filter (1–6) and μ filter (two-ended slider, the bar between the ends can be dragged), each with
//    "Automatically adjust": follow the gears / μ level selected on the graph (app.js passes them in setContext)
//  - timeline: laps / a dragged section, and corners as quick filters
// The filtered samples go to the graph through opts.onChange({ traces, target }) (see SlipChart._logPath).
(function () {
  const MU_MIN = -0.25, MU_MAX = 1.6, X_MAX = 70, TGT_MAX = 25.5, GEARS = [1, 2, 3, 4, 5, 6];
  const C = { accent: '#3f8ce8', log: '#545459', red: '#8b8b92', grid: '#ffffff', muted: '#858588', text: '#ffffff', sel: 'rgba(63,140,232,.16)', lapBand: 'rgba(255,255,255,.035)' };
  // μ colour scale, dark blue (low) → red (high), as in the Lean vs Slip viewer (tools/motec, dark theme);
  // fixed to the μ slider's range, values outside take the end colours
  const MU_STOPS = [[0, '#2a3fae'], [0.2, '#2f6fe0'], [0.4, '#36b2e3'], [0.55, '#86d9b6'], [0.7, '#f5d846'], [0.85, '#f38e2e'], [1, '#e0282e']];
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const MU_LUT = Array.from({ length: 64 }, (_, k) => {
    const t = k / 63; let j = 0;
    while (j < MU_STOPS.length - 2 && t > MU_STOPS[j + 1][0]) j++;
    const [t0, c0] = MU_STOPS[j], [t1, c1] = MU_STOPS[j + 1], u = (t - t0) / (t1 - t0), a = hex(c0), b = hex(c1);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(',')})`;
  });
  const muBin = m => Math.max(0, Math.min(63, Math.round((m - MU_MIN) / (MU_MAX - MU_MIN) * 63)));
  const MU_GRADIENT = `linear-gradient(90deg, ${MU_STOPS.map(([t, c]) => `${c} ${t * 100}%`).join(', ')})`;
  const fmtLap = s => { const m = Math.floor(s / 60); return m + ':' + (s - m * 60).toFixed(3).padStart(6, '0'); };
  const fmtClock = s => { const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s - m * 60)).padStart(2, '0'); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const sw = (key, label, title) =>
    `<button class="switch" data-sw="${key}" role="switch" aria-checked="false" title="${title}"><span class="material-icons" aria-hidden="true">toggle_off</span>${label}</button>`;

  // Adjusters, in the left column (app.js docks this.side there; into the panel when there is no left column)
  const SIDE = `
    <div class="side-h">Logged data</div>
    ${sw('show', 'Show logged data', 'Show the imported MoTeC data on the graph')}
    <div class="lp-info"></div>
    <div class="lp-side-body">
      <div class="side-h lp-filters-h">Logged data filters</div>
      <div class="lp-filter">
        <div class="lp-sub"><span class="side-sub">Gears</span></div>
        <div class="chip-list lp-gears" role="group" aria-label="Gears to show"></div>
        ${sw('autoGears', 'Automatically adjust', 'Filter the gears whose slip targets are selected on the graph')}
      </div>
      <div class="lp-filter">
        <div class="lp-sub"><span class="side-sub lp-lbl-mu">μ</span><span class="lp-read lp-mu-read"></span></div>
        <div class="lp-mu">
          <div class="lp-range">
            <div class="lp-track" style="background:${MU_GRADIENT}"></div><div class="lp-dim lp-dim-l"></div><div class="lp-dim lp-dim-r"></div>
            <div class="lp-bar" title="Drag to move the μ range · double-click for the full range"></div>
            <div class="lp-thumb" data-t="lo" tabindex="0" role="slider" aria-label="μ minimum" aria-valuemin="${MU_MIN}" aria-valuemax="${MU_MAX}"></div>
            <div class="lp-thumb" data-t="hi" tabindex="0" role="slider" aria-label="μ maximum" aria-valuemin="${MU_MIN}" aria-valuemax="${MU_MAX}"></div>
          </div>
          <div class="lp-ticks"></div>
        </div>
        ${sw('autoMu', 'Automatically adjust', 'Filter the μ range of the μ level selected on the graph')}
      </div>
      <section class="lp-filter lp-time" aria-label="Timeline">
        <div class="lp-sub"><span class="side-sub">Laps</span></div>
        <div class="chip-list lp-laps" role="group" aria-label="Laps"></div>
        <div class="lp-corner-row">
          <div class="lp-sub"><span class="side-sub">Corners</span><button class="lp-link lp-c-clear" hidden>Show all</button></div>
          <!-- track map from GPS (reference lap): click corners to filter; buttons when there is no GPS -->
          <div class="lp-map-box"><svg class="lp-map" role="group" aria-label="Track map: click corners to filter by them"></svg></div>
          <div class="chip-list lp-corners" role="group" aria-label="Corners"></div>
        </div>
        <div class="lp-sub lp-tl-h"><span class="side-sub">Timeline</span></div>
        <div class="lp-tl-box"><canvas class="lp-tl" aria-label="Timeline: click a lap, drag to select a section, drag the ends to trim"></canvas></div>
        <div class="lp-read lp-sel-read"></div>
      </section>
    </div>`;

  const TEMPLATE = `
    <div class="lp-head">
      <span class="lp-legend">
        <span><svg viewBox="0 0 26 12" aria-hidden="true"><path d="M1 9L9 4L17 7L25 2" stroke="${C.log}" stroke-width="1.2" fill="none"/><path d="M7.5 2.5l3 3m0-3l-3 3M15.5 5.5l3 3m0-3l-3 3" stroke="#8b8b92" stroke-width="1"/></svg>Logged slip</span>
        <span><svg viewBox="0 0 26 12" aria-hidden="true"><path d="M1 6H25" stroke="#fff" stroke-width="1.5" stroke-dasharray="1.5 2.5" stroke-linecap="round"/></svg>ECU slip target (slip_tgt)</span>
      </span>
    </div>
    <div class="lp-body">
      <section class="lp-red" aria-label="DTC torque reduction over lean angle">
        <div class="lp-cap">DTC torque reduction <span class="lp-red-src"></span></div>
        <div class="lp-red-box"><svg class="lp-red-svg" role="img"></svg></div>
      </section>
    </div>`;

  class LogPanel {
    constructor(el, opts) {
      this.el = el;
      this.o = Object.assign({ onChange() {}, geom: () => null, muRows: [] }, opts);
      this.d = null;
      this.f = { show: true, autoGears: true, gears: new Set(GEARS), autoMu: false, muLo: MU_MIN, muHi: MU_MAX, t0: 0, t1: 0, corners: new Set() };
      this.ctx = { visible: true, gears: GEARS, muBand: [-Infinity, Infinity] };
      el.innerHTML = TEMPLATE;
      this.side = document.createElement('section');
      this.side.className = 'side-block lp-side';
      this.side.setAttribute('aria-label', 'Logged data filters');
      this.side.innerHTML = SIDE;
      this.side.hidden = true;
      this.q = s => el.querySelector(s) || this.side.querySelector(s);
      this._bind();
      this.ro = new ResizeObserver(() => this._redrawSoon());
      this.ro.observe(el);
      this.ro.observe(this.side);
    }

    load(d, name) {
      this.d = d; this.name = name;
      Object.assign(this.f, { show: true, t0: 0, t1: d.duration, autoMu: false, muLo: MU_MIN, muHi: MU_MAX });   // a new log starts on the full μ range
      this.f.corners.clear();
      this.cache = null;
      this.track = this._buildTrack(d);
      this.update();
    }

    // Track outline for the corner map: the reference lap's GPS positions (equirectangular, north up), with
    // each corner's part of it. null when there is no GPS (the corners are then shown as buttons).
    _buildTrack(d) {
      if (!d.lat || !d.lon || !d.refLap || !d.corners.length) return null;
      const { rate } = d, i0 = Math.ceil(d.refLap.a * rate), i1 = Math.min(d.n - 1, Math.floor(d.refLap.b * rate));
      const step = Math.max(1, Math.round((i1 - i0) / 900)), raw = [];
      for (let i = i0; i <= i1; i += step) if (d.lat[i] && d.lon[i]) raw.push([d.lon[i], d.lat[i], i / rate]);
      if (raw.length < 50) return null;
      const k = Math.cos(raw.reduce((a, p) => a + p[1], 0) / raw.length * Math.PI / 180);
      const pts = raw.map(([lon, lat, t]) => [lon * k, -lat, t]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      return { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    clear() { this.d = null; this.cache = null; this.update(); }
    get loaded() { return !!this.d; }
    get show() { return !!this.d && this.f.show; }
    set show(v) { this.f.show = !!v; this.update(); }
    // μ filter as [lo, hi] (open ends as ±Infinity) while the log is shown and the slider is not on its full range, else null
    get muFilter() {
      const f = this.f, lo = f.muLo <= MU_MIN + 1e-9, hi = f.muHi >= MU_MAX - 1e-9;
      return !this.show || (lo && hi) ? null : [lo ? -Infinity : f.muLo, hi ? Infinity : f.muHi];
    }

    // ctx: { visible, gears: [1..6] selected on the graph, muBand: [lo, hi] of the selected μ level }
    setContext(ctx) { this.ctx = Object.assign({}, this.ctx, ctx); this.update(); }

    update() {
      const f = this.f, d = this.d;
      // the adjusters (this.side) stay while a log is loaded; the graphs below the slip-target graph only while it is shown,
      // unless the adjusters are docked in the panel (no left column)
      const docked = this.el.contains(this.side);
      this.side.hidden = !d || !this.ctx.visible;
      this.el.hidden = !d || !this.ctx.visible || (!f.show && !docked);
      if (f.autoGears) f.gears = new Set(this.ctx.gears);
      if (f.autoMu) { f.muLo = clamp(this.ctx.muBand[0], MU_MIN, MU_MAX); f.muHi = clamp(this.ctx.muBand[1], MU_MIN, MU_MAX); }
      if (!d) { this.o.onChange(null); return; }
      this._filter();
      this._controls();
      this.o.onChange(f.show ? this.sel : null);
      this._redrawSoon();
    }

    // ---- filtering ------------------------------------------------------
    _filter() {
      const f = this.f, d = this.d;
      const key = [f.t0, f.t1, [...f.gears].sort(), f.muLo, f.muHi, [...f.corners].sort()].join('|');
      if (this.cache === key) return;
      this.cache = key;
      const { rate, n, lean, slip, mu, gear, tgt, red } = d;
      const i0 = clamp(Math.ceil(f.t0 * rate), 0, n), i1 = clamp(Math.floor(f.t1 * rate), 0, n - 1);
      // slider ends are open: everything below / above the slider range is included at the ends
      const lo = f.muLo <= MU_MIN + 1e-9 ? -Infinity : f.muLo, hi = f.muHi >= MU_MAX - 1e-9 ? Infinity : f.muHi;
      let inCorner = null;
      if (f.corners.size) {
        inCorner = new Uint8Array(n);
        d.corners.filter(c => f.corners.has(c.n)).forEach(c => c.ranges.forEach(([a, b]) => {
          for (let i = Math.max(0, Math.floor(a * rate)); i < Math.min(n, Math.ceil(b * rate)); i++) inCorner[i] = 1;
        }));
      }
      const traces = [], target = [], reduction = [];
      let tr = null, tg = null, rd = null, shown = 0;
      for (let i = i0; i <= i1; i++) {
        const ok = (!inCorner || inCorner[i]) && (!gear || f.gears.has(gear[i])) && mu[i] >= lo && mu[i] <= hi;
        const x = Math.abs(lean[i]);
        if (ok && slip[i] >= 0) { if (!tr) traces.push(tr = []); tr.push([x, slip[i]]); shown++; } else tr = null;
        if (ok && tgt && tgt[i] <= TGT_MAX) { if (!tg) target.push(tg = []); tg.push([x, tgt[i]]); } else tg = null;
        if (ok && red) { if (!rd) reduction.push(rd = []); rd.push([x, red[i], mu[i]]); } else rd = null;
      }
      this.sel = { traces, target };
      this.reduction = reduction;
      this.shown = shown;
    }

    // ---- controls -------------------------------------------------------
    _controls() {
      const f = this.f, d = this.d, m = d.meta || {};
      this.side.querySelectorAll('.switch[data-sw]').forEach(b => {
        const on = !!f[b.dataset.sw];
        b.setAttribute('aria-checked', on);
        b.querySelector('.material-icons').textContent = on ? 'toggle_on' : 'toggle_off';
      });
      this.el.classList.toggle('is-off', !f.show);
      this.side.classList.toggle('is-off', !f.show);
      const full = d.laps.filter(l => l.full);
      this.q('.lp-info').textContent = [m.venue, m.session, full.length ? `${full.length} lap${full.length > 1 ? 's' : ''}` : '', fmtClock(d.duration) + ' min'].filter(Boolean).join(' · ');
      this.q('.lp-red-src').textContent = d.red ? `[Nm] · ${d.redSource}` : '· not in this log';
      // gears
      this.q('.lp-gears').innerHTML = GEARS.map(g => `<button class="chip" data-g="${g}" aria-pressed="${f.gears.has(g)}" style="--mc:${C.accent}" ${d.gear ? '' : 'disabled title="No Gear channel in this log"'}>${g}</button>`).join('');
      // μ slider
      const pc = v => (v - MU_MIN) / (MU_MAX - MU_MIN) * 100;
      const a = pc(f.muLo), b = pc(f.muHi);
      this.q('.lp-thumb[data-t="lo"]').style.left = a + '%';
      this.q('.lp-thumb[data-t="hi"]').style.left = b + '%';
      this.q('.lp-thumb[data-t="lo"]').setAttribute('aria-valuenow', f.muLo.toFixed(2));
      this.q('.lp-thumb[data-t="hi"]').setAttribute('aria-valuenow', f.muHi.toFixed(2));
      Object.assign(this.q('.lp-bar').style, { left: a + '%', width: (b - a) + '%' });
      this.q('.lp-dim-l').style.width = a + '%';
      this.q('.lp-dim-r').style.width = (100 - b) + '%';
      if (!this.ticksDone) {
        this.q('.lp-ticks').innerHTML = this.o.muRows.filter((v, i) => i === 0 || Math.round(v * 10) % 4 === 0).map(v => `<span style="left:${pc(v)}%">${+v.toFixed(2)}</span>`).join('');
        this.ticksDone = true;
      }
      const ends = f.muLo <= MU_MIN + 1e-9 && f.muHi >= MU_MAX - 1e-9;
      this.q('.lp-mu-read').textContent = ends ? 'all' : `${f.muLo <= MU_MIN + 1e-9 ? '≤ ' : ''}${f.muLo.toFixed(2)} … ${f.muHi >= MU_MAX - 1e-9 ? '≥ ' : ''}${f.muHi.toFixed(2)}`;
      // laps
      const same = (a0, b0) => Math.abs(a0 - f.t0) < 1e-3 && Math.abs(b0 - f.t1) < 1e-3;
      const fastest = full.length ? full.reduce((p, l) => (l.b - l.a < p.b - p.a ? l : p)) : null;
      this.q('.lp-laps').innerHTML = [{ name: 'All', a: 0, b: d.duration }, ...d.laps].map((l, k) =>
        `<button class="chip lp-chip" data-a="${l.a}" data-b="${l.b}" aria-pressed="${same(l.a, l.b)}" style="--mc:${C.accent}">${esc(l.name)}${l.full ? ` <small>${fmtLap(l.b - l.a)}${l === fastest ? ' ★' : ''}</small>` : ''}</button>`).join('');
      // corners
      this.q('.lp-corner-row').hidden = !d.corners.length;
      this.q('.lp-map-box').hidden = !this.track;
      this.q('.lp-c-clear').hidden = !f.corners.size;
      this.q('.lp-corners').innerHTML = d.corners.length && !this.track ? `<button class="chip lp-chip" data-c="all" aria-pressed="${!f.corners.size}" style="--mc:${C.accent}">All</button>` +
        d.corners.map(c => `<button class="chip lp-chip" data-c="${c.n}" aria-pressed="${f.corners.has(c.n)}" style="--mc:${C.accent}" title="Corner ${c.n} · ${c.ranges.length} pass${c.ranges.length === 1 ? '' : 'es'} in this log" aria-label="Corner ${c.n}">C${c.n}</button>`).join('') : '';
      const lap = d.laps.find(l => f.t0 >= l.a - 1e-3 && f.t1 <= l.b + 1e-3);
      this.q('.lp-sel-read').textContent = `${f.t0.toFixed(2)} – ${f.t1.toFixed(2)} s${lap && !same(lap.a, lap.b) ? ` (${lap.name} +${(f.t0 - lap.a).toFixed(1)}…+${(f.t1 - lap.a).toFixed(1)} s)` : ''} · ${this.shown.toLocaleString()} samples`;
    }

    _set(patch) { Object.assign(this.f, patch); this.update(); }
    _setRange(a, b) {
      if (a > b) [a, b] = [b, a];
      this._set({ t0: clamp(a, 0, this.d.duration), t1: clamp(b, 0, this.d.duration) });
    }
    _setMu(which, v) {
      v = clamp(Math.round(v * 100) / 100, MU_MIN, MU_MAX);
      const f = this.f;
      if (which === 'lo') this._set({ autoMu: false, muLo: Math.min(v, f.muHi) });
      else this._set({ autoMu: false, muHi: Math.max(v, f.muLo) });
    }

    _bind() {
      const onClick = e => {
        const s = e.target.closest('.switch[data-sw]');
        if (s) {
          const k = s.dataset.sw, on = !this.f[k];
          // μ Automatically adjust switched off: back to the full μ range
          this._set(k === 'autoMu' && !on ? { autoMu: false, muLo: MU_MIN, muHi: MU_MAX } : { [k]: on });
          return;
        }
        const g = e.target.closest('.lp-gears .chip');
        if (g && !g.disabled) {
          const gears = new Set(this.f.gears), v = +g.dataset.g;
          gears.has(v) ? gears.delete(v) : gears.add(v);
          this._set({ autoGears: false, gears });             // picking gears by hand switches Automatically adjust off
          return;
        }
        const l = e.target.closest('.lp-laps .chip');
        if (l) { this._setRange(+l.dataset.a, +l.dataset.b); return; }
        if (e.target.closest('.lp-c-clear')) { this._set({ corners: new Set() }); return; }
        const cm = e.target.closest('.lp-map [data-c]');                  // a corner on the track map
        if (cm) {
          const corners = new Set(this.f.corners), v = +cm.dataset.c;
          corners.has(v) ? corners.delete(v) : corners.add(v);
          this._set({ corners });
          return;
        }
        const c = e.target.closest('.lp-corners .chip');
        if (c) {
          const corners = new Set(this.f.corners);
          if (c.dataset.c === 'all') corners.clear();
          else { const v = +c.dataset.c; corners.has(v) ? corners.delete(v) : corners.add(v); }
          this._set({ corners });
        }
      };
      this.side.addEventListener('click', onClick);
      this.el.addEventListener('click', e => { if (!this.side.contains(e.target)) onClick(e); });   // the side block may be docked inside

      // μ slider: drag an end, drag the bar between them (moves the range), or press on the track (nearest end jumps there)
      const range = this.q('.lp-range');
      const muAt = x => { const r = range.getBoundingClientRect(); return MU_MIN + (x - r.left) / r.width * (MU_MAX - MU_MIN); };
      let drag = null;
      range.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const v = muAt(e.clientX), f = this.f;
        const t = e.target.closest('.lp-thumb');
        if (t) drag = { t: t.dataset.t };
        else if (e.target.closest('.lp-bar')) drag = { t: 'bar', off: v - f.muLo, w: f.muHi - f.muLo };
        else { drag = { t: Math.abs(v - f.muLo) <= Math.abs(v - f.muHi) ? 'lo' : 'hi' }; this._setMu(drag.t, v); }
        try { range.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        range.classList.toggle('is-moving', drag.t === 'bar');
        e.preventDefault();
      });
      range.addEventListener('pointermove', e => {
        if (!drag) return;
        const v = muAt(e.clientX);
        if (drag.t === 'bar') {
          const lo = clamp(Math.round((v - drag.off) * 100) / 100, MU_MIN, MU_MAX - drag.w);
          this._set({ autoMu: false, muLo: lo, muHi: Math.round((lo + drag.w) * 100) / 100 });
        } else this._setMu(drag.t, v);
      });
      range.addEventListener('dblclick', () => this._set({ autoMu: false, muLo: MU_MIN, muHi: MU_MAX }));   // double-click: full range
      const end = () => { drag = null; range.classList.remove('is-moving'); };
      range.addEventListener('pointerup', end);
      range.addEventListener('pointercancel', end);
      range.addEventListener('keydown', e => {
        const t = e.target.closest('.lp-thumb'); if (!t) return;
        const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!dir) return;
        e.preventDefault();
        this._setMu(t.dataset.t, (t.dataset.t === 'lo' ? this.f.muLo : this.f.muHi) + dir * (e.shiftKey ? 0.1 : 0.01));
      });

      // timeline: click = the lap under the pointer, drag = a section, drag an end = trim it, drag inside = move it
      const tl = this.q('.lp-tl');
      let td = null;
      const tAt = x => (this.tg ? clamp((x - this.tg.x0) / this.tg.w * this.d.duration, 0, this.d.duration) : 0);
      const xOf = t => this.tg.x0 + t / this.d.duration * this.tg.w;
      tl.addEventListener('pointerdown', e => {
        if (!this.tg || e.button > 0) return;
        const x = e.offsetX, t = tAt(x), f = this.f, xa = xOf(f.t0), xb = xOf(f.t1);
        if (Math.abs(x - xa) <= 7) td = { m: 'edge', fixed: f.t1 };
        else if (Math.abs(x - xb) <= 7) td = { m: 'edge', fixed: f.t0 };
        else if (x > xa && x < xb) td = { m: 'move', off: t - f.t0, len: f.t1 - f.t0, x0: x };
        else td = { m: 'new', fixed: t, x0: x };
        try { tl.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      });
      tl.addEventListener('pointermove', e => {
        if (!this.tg) return;
        const x = e.offsetX, t = tAt(x);
        if (!td) {
          const xa = xOf(this.f.t0), xb = xOf(this.f.t1);
          tl.style.cursor = Math.abs(x - xa) <= 7 || Math.abs(x - xb) <= 7 ? 'ew-resize' : x > xa && x < xb ? 'grab' : 'crosshair';
          return;
        }
        if (td.m === 'edge') this._setRange(td.fixed, t);
        else if (Math.abs(x - td.x0) > 3 || td.moved) {
          td.moved = true;
          if (td.m === 'move') { const a = clamp(t - td.off, 0, this.d.duration - td.len); this._setRange(a, a + td.len); }
          else this._setRange(td.fixed, t);
        }
      });
      tl.addEventListener('pointerup', e => {
        if (td && td.m !== 'edge' && !td.moved) {
          const t = tAt(e.offsetX), l = this.d.laps.find(l => t >= l.a && t < l.b) || this.d.laps[this.d.laps.length - 1];
          this._setRange(l.a, l.b);
        } else if (this.f.t1 - this.f.t0 < 0.2) this._setRange(this.f.t0, this.f.t0 + 0.2);
        td = null;
      });
    }

    // ---- drawing --------------------------------------------------------
    // Track map: 8px track line, cut (2px gaps) at every corner's start and end; corners are clickable, the selected
    // ones blue; nothing coloured by default (no corner filter = all data). Small corner numbers beside the apexes.
    _drawMap() {
      const tr = this.track, svg = this.q('.lp-map'), box = this.q('.lp-map-box');
      if (!tr || !box.clientWidth) return;
      const W = box.clientWidth, pad = 16, f = v => Math.round(v * 10) / 10;
      const sc = Math.min((W - 2 * pad) / (tr.maxX - tr.minX || 1), 300 / (tr.maxY - tr.minY || 1));
      const H = Math.round((tr.maxY - tr.minY) * sc + 2 * pad);
      const P = tr.pts.map(([x, y, t]) => [pad + (x - tr.minX) * sc + ((W - 2 * pad) - (tr.maxX - tr.minX) * sc) / 2, pad + (y - tr.minY) * sc, t]);
      const line = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');
      const at = t => { let best = 0; P.forEach((p, i) => { if (Math.abs(p[2] - t) < Math.abs(P[best][2] - t)) best = i; }); return best; };
      const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length;
      const normal = i => {   // unit normal at point i, pointing away from the track's centre
        const a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)];
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        return (P[i][0] + nx - cx) ** 2 + (P[i][1] + ny - cy) ** 2 > (P[i][0] - cx) ** 2 + (P[i][1] - cy) ** 2 ? [nx, ny] : [-nx, -ny];
      };
      const out = [`<path d="${line(P)}Z" class="lp-trk"/>`];
      const cuts = [], nums = [];
      this.d.corners.forEach(c => {
        const a = at(c.ref[0]), b = Math.max(a + 1, at(c.ref[1]));
        const on = this.f.corners.has(c.n);
        out.push(`<g class="lp-c${on ? ' is-on' : ''}" data-c="${c.n}"><title>Corner ${c.n}</title>` +
          `<path d="${line(P.slice(a, b + 1))}" class="lp-c-hit"/><path d="${line(P.slice(a, b + 1))}" class="lp-c-line"/></g>`);
        [a, b].forEach(i => {   // 2px gap across the track at the corner's start and end
          const [nx, ny] = normal(i);
          cuts.push(`M${f(P[i][0] - nx * 6)} ${f(P[i][1] - ny * 6)}L${f(P[i][0] + nx * 6)} ${f(P[i][1] + ny * 6)}`);
        });
        const ap = at(c.apex), [nx, ny] = normal(ap);
        nums.push(`<text class="lp-c-num${on ? ' is-on' : ''}" data-c="${c.n}" x="${f(P[ap][0] + nx * 12)}" y="${f(P[ap][1] + ny * 12)}" text-anchor="middle" dominant-baseline="central">${c.n}</text>`);
      });
      out.push(`<path d="${cuts.join('')}" class="lp-cut"/>`, ...nums);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.innerHTML = out.join('');
    }

    _redrawSoon() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.d && !this.el.hidden) { this._drawReduction(); this._drawTimeline(); this._drawMap(); } });
    }

    // Same x geometry as the slip-target graph (its plot left / right edges), so lean angles line up.
    _drawReduction() {
      const svg = this.q('.lp-red-svg'), box = this.q('.lp-red-box');
      const H = 180, W = box.clientWidth, g = this.o.geom();
      if (!W) return;
      const s = g ? g.s : 1, k = g && g.W ? W / g.W : 1;
      const x0 = g ? g.x0 * k : 40, x1 = g ? g.x1 * k : W - 50, y0 = 12 * s, y1 = H - 26 * s;
      const px = v => x0 + (X_MAX - v) / X_MAX * (x1 - x0);
      let top = 0;
      (this.reduction || []).forEach(run => run.forEach(p => { if (p[0] <= X_MAX && p[1] > top) top = p[1]; }));
      const step = top > 100 ? 25 : top > 40 ? 10 : 5;
      const yMax = Math.max(10, Math.ceil(top / step) * step);
      const py = v => y1 - v / yMax * (y1 - y0);
      const f = v => Math.round(v * 10) / 10, pc = v => Math.round(v - 0.5) + 0.5;
      const out = [];
      let major = '', minor = '';
      for (let x = X_MAX; x >= 0; x--) { const d = `M${pc(px(x))} ${pc(y0)}V${pc(y1)}`; if (x % 5 === 0) major += d; else if ((x1 - x0) / 70 >= 4) minor += d; }
      for (let v = 0; v <= yMax; v += step) major += `M${pc(x0)} ${pc(py(v))}H${pc(x1)}`;
      out.push(`<g fill="none" stroke="${C.grid}" stroke-width="1"><path d="${minor}" stroke-dasharray="1 3" stroke-opacity=".15"/><path d="${major}" stroke-dasharray="1 2" stroke-opacity=".3"/></g>`);
      const fs = 10 * s, xStep = g ? g.xStep : 5;
      for (let v = 0; v <= yMax; v += step) out.push(`<text class="ax" x="${f(x0 - 20 * s)}" y="${f(py(v))}" text-anchor="end" dominant-baseline="central" font-size="${fs}">${v}</text>`);
      for (let x = X_MAX; x >= 0; x -= xStep) out.push(`<text class="ax" x="${f(px(x))}" y="${f(y1 + 15 * s)}" text-anchor="middle" dominant-baseline="central" font-size="${fs}">${x}°</text>`);
      if (this.f.show && this.reduction) {
        // line segments and a dot per reducing sample, coloured by μ (same scale as the μ slider); a segment takes the
        // mean μ of its two samples. Grouped into one path per colour.
        const segs = MU_LUT.map(() => ''), dots = MU_LUT.map(() => '');
        const r = 1.4 * s, count = this.reduction.reduce((a, run) => a + run.length, 0), every = Math.max(1, Math.ceil(count / 8000));
        let n = 0;
        this.reduction.forEach(run => {
          let prev = null;
          run.forEach(([x, v, mu]) => {
            if (x > X_MAX) { prev = null; return; }
            const X = f(px(x)), Y = f(py(v));
            if (prev) segs[muBin((prev[2] + mu) / 2)] += `M${prev[0]} ${prev[1]}L${X} ${Y}`;
            prev = [X, Y, mu];
            if (v > 0.05 && n++ % every === 0) dots[muBin(mu)] += `M${f(X - r)} ${Y}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
          });
        });
        out.push(`<g fill="none" stroke-width="${0.9 * s}" stroke-linecap="round" stroke-opacity=".75">${segs.map((p, k) => (p ? `<path d="${p}" stroke="${MU_LUT[k]}"/>` : '')).join('')}</g>`);
        out.push(`<g fill-opacity=".9">${dots.map((p, k) => (p ? `<path d="${p}" fill="${MU_LUT[k]}"/>` : '')).join('')}</g>`);
      }
      if (!this.d.red) out.push(`<text class="ax" x="${f((x0 + x1) / 2)}" y="${f((y0 + y1) / 2)}" text-anchor="middle" font-size="${11 * s}" fill-opacity=".5">No DTC torque channels (md_dtc_reduction, or md_req and md_tgt_dtc) in this log</text>`);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.setAttribute('aria-label', `DTC torque reduction [Nm] over lean angle, 0 to ${yMax} Nm`);
      svg.innerHTML = out.join('');
    }

    _drawTimeline() {
      const cv = this.q('.lp-tl'), W = this.q('.lp-tl-box').clientWidth, H = 110, dpr = window.devicePixelRatio || 1;
      if (!W) return;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const d = this.d, f = this.f;
      const x0 = 34, x1 = W - 6, top = 18, bot = H - 20, ph = bot - top - 8;   // left column width; 8px strip for the corners
      this.tg = { x0, w: x1 - x0 };
      const tx = t => x0 + t / d.duration * (x1 - x0);
      ctx.font = '700 10px "Noto Sans", system-ui, sans-serif';
      // trace: v_ref, or |lean| when there is no speed channel
      const tr = d.vref || d.lean.map(Math.abs);
      let vmax = 0; for (let i = 0; i < tr.length; i += 10) vmax = Math.max(vmax, tr[i]);
      vmax = vmax || 1;
      const vy = v => top + ph - v / vmax * ph;
      d.laps.forEach((l, i) => {
        const a = tx(l.a), b = tx(l.b);
        if (i % 2) { ctx.fillStyle = C.lapBand; ctx.fillRect(a, top, b - a, bot - top); }
        if (i) { ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(Math.round(a) + 0.5, top - 4); ctx.lineTo(Math.round(a) + 0.5, bot); ctx.stroke(); ctx.setLineDash([]); }
        const label = l.full ? `${l.name}  ${fmtLap(l.b - l.a)}` : l.name;
        ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const fit = [label, l.name.replace('Lap ', 'L').replace('Out lap', 'Out').replace('In lap', 'In')].find(x => b - a > ctx.measureText(x).width + 6);   // short name when narrow
        if (fit) ctx.fillText(fit, (a + b) / 2, top - 5);
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = C.muted;
      for (let t = 0; t <= d.duration; t += d.duration > 1200 ? 120 : 60) ctx.fillText(fmtClock(t), tx(t), bot + 5);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(d.vref ? 'km/h' : '|lean|', x0 - 8, top + 4);
      const line = (t0, t1, color, w) => {
        const i0 = Math.max(0, Math.floor(t0 * d.rate)), i1 = Math.min(d.n - 1, Math.ceil(t1 * d.rate));
        const stride = Math.max(1, Math.floor((i1 - i0) / ((tx(t1) - tx(t0)) * 2 || 1)));
        ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.beginPath();
        for (let i = i0; i <= i1; i += stride) { const X = tx(i / d.rate), Y = vy(tr[i]); i === i0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
        ctx.stroke();
      };
      line(0, d.duration, '#4a4a52', 1);
      // corners: strip under the trace; selected ones in the accent colour
      d.corners.forEach(c => c.ranges.forEach(([a, b]) => {
        ctx.fillStyle = f.corners.has(c.n) ? C.accent : 'rgba(255,255,255,.18)';
        ctx.fillRect(tx(a), bot - 5, Math.max(1, tx(b) - tx(a)), 4);
      }));
      // selection
      const a = tx(f.t0), b = tx(f.t1);
      ctx.fillStyle = C.sel; ctx.fillRect(a, top, b - a, bot - top);
      line(f.t0, f.t1, C.accent, 1.5);
      ctx.fillStyle = C.accent;
      [a, b].forEach(x => {
        ctx.fillRect(Math.round(x) - 1, top, 2, bot - top);
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 3.5, top + (bot - top) / 2 - 10, 7, 20, 2) : ctx.rect(x - 3.5, top + (bot - top) / 2 - 10, 7, 20); ctx.fill();
      });
    }
  }

  window.LogPanel = LogPanel;
})();
