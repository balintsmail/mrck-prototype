// SimView — the Simulation tab: what the DTC slip target would have been through the corners of the imported
// MoTeC log, for one riding mode and gear (the slip target map the allocation gives them).
//  - left column (this.side, docked by app.js): riding mode and gear selectors (dropdown + ‹ ›; ← / → = riding
//    mode, ↑ / ↓ = gear). The timeline and the circuit map (corners) are the logged data's own filters (log-panel.js).
//  - top graph: logged slip over |lean| coloured by μ (dark blue -> red), the map's μ levels as thin lines, a thick
//    white line where the target is at the μ logged at each sample (interpolated between the μ levels). Editable
//    μ levels show their target points, which can be dragged as on the other tabs (the dragged level becomes the
//    selected one, drawn bold); calculated levels are dashed. A μ label on the right selects that level.
//  - μ-class graphs: the samples split into 0.2 wide μ classes, each in its colour, points and the median per 1° of
//    lean — logged slip, and the longitudinal acceleration (accx_veh) as a duplicate; the legend switches classes.
// The graphs share the slip-target graph's lean axis (70° -> 0° left to right).
(function () {
  const X_MAX = 70, MU_STEP = 0.2, MIN_PER_DEG = 5, SLIP_MAX = 25.5;
  const FONT = "700 10px 'Noto Sans', system-ui, sans-serif";
  const fmtMu = m => m.toFixed(2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = v => Math.round(v * 10) / 10;
  const SLIP_Y = { min: 0, max: 20, major: 1, label: 2, fmt: v => v + '%', minor: 0.2 };
  const ACC_Y = { min: -1, max: 1.5, major: 0.25, label: 0.5, fmt: v => v.toFixed(1) + ' G', minor: 0.05 };

  // Slip target of a map (lean descending) at |lean| x and μ m: linear in lean along each μ level, then
  // linear between the two μ levels around m (clamped to the lowest / highest level), as the ECU interpolates.
  function targetAt(t, muRows, x, m) {
    const L = t.lean, n = L.length;
    const rowAt = row => {
      if (x >= L[0]) return row[0];
      if (x <= L[n - 1]) return row[n - 1];
      let j = 0; while (j < n - 2 && x < L[j + 1]) j++;
      return row[j] + (row[j + 1] - row[j]) * (L[j] - x) / (L[j] - L[j + 1]);
    };
    if (m <= muRows[0]) return rowAt(t.rows[0]);
    const k = muRows.length - 1;
    if (m >= muRows[k]) return rowAt(t.rows[k]);
    let i = 0; while (i < k - 1 && m > muRows[i + 1]) i++;
    const u = (m - muRows[i]) / (muRows[i + 1] - muRows[i]);
    return rowAt(t.rows[i]) * (1 - u) + rowAt(t.rows[i + 1]) * u;
  }

  // A canvas plot with the slip-target graph's frame: grid, axis labels, lean 70 -> 0 and a value axis Y.
  class Plot {
    constructor(canvas) { this.cv = canvas; }
    begin(h, Y) {
      const cv = this.cv, W = Math.max(320, cv.parentNode.clientWidth), dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(W * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = W + 'px'; cv.style.height = h + 'px';
      const c = this.c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, h);
      const g = this.g = { x0: 52, x1: W - 72, y0: 14, y1: h - 30, Y };
      g.px = x => g.x0 + (X_MAX - x) / X_MAX * (g.x1 - g.x0);
      g.py = y => g.y1 - (y - Y.min) / (Y.max - Y.min) * (g.y1 - g.y0);
      g.ix = px => X_MAX - (px - g.x0) / (g.x1 - g.x0) * X_MAX;
      g.iy = py => Y.min + (g.y1 - py) / (g.y1 - g.y0) * (Y.max - Y.min);
      c.strokeStyle = '#ffffff'; c.lineWidth = 1;
      const line = (a, b, cc, d) => { c.beginPath(); c.moveTo(a, b); c.lineTo(cc, d); c.stroke(); };
      const steps = (st, f) => { for (let k = Math.ceil(Y.min / st - 1e-9); k * st <= Y.max + 1e-9; k++) f(+(k * st).toFixed(4), k); };
      c.setLineDash([1, 3]); c.globalAlpha = 0.15;              // minor: 1° and Y.minor
      for (let x = 0; x <= X_MAX; x++) if (x % 5) line(Math.round(g.px(x)) + 0.5, g.y0, Math.round(g.px(x)) + 0.5, g.y1);
      steps(Y.minor, v => line(g.x0, Math.round(g.py(v)) + 0.5, g.x1, Math.round(g.py(v)) + 0.5));
      c.setLineDash([1, 2]); c.globalAlpha = 0.3;               // major: 5° and Y.major
      for (let x = 0; x <= X_MAX; x += 5) line(Math.round(g.px(x)) + 0.5, g.y0, Math.round(g.px(x)) + 0.5, g.y1);
      steps(Y.major, v => line(g.x0, Math.round(g.py(v)) + 0.5, g.x1, Math.round(g.py(v)) + 0.5));
      c.setLineDash([]);
      if (Y.min < 0) { c.globalAlpha = 0.6; line(g.x0, Math.round(g.py(0)) + 0.5, g.x1, Math.round(g.py(0)) + 0.5); }
      c.globalAlpha = 1;
      c.fillStyle = '#ffffff'; c.font = FONT; c.textBaseline = 'middle';
      c.textAlign = 'right'; steps(Y.label, v => c.fillText(Y.fmt(v), g.x0 - 10, g.py(v)));
      c.textAlign = 'center';
      for (let x = X_MAX; x >= 0; x -= 5) c.fillText(x + '°', g.px(x), g.y1 + 16);
      c.save(); c.beginPath(); c.rect(g.x0, g.y0 - 1, g.x1 - g.x0, g.y1 - g.y0 + 2); c.clip();   // plot area
      return c;
    }
    end() { this.c.restore(); }
    rightLabel(text, y, color, bold) {
      const c = this.c, g = this.g;
      c.save(); c.fillStyle = color; c.font = bold ? "800 11px 'Noto Sans', system-ui, sans-serif" : FONT;
      c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(text, g.x1 + 8, y); c.restore();
    }
  }

  const PICK = (k, label, prev, next) => `
      <div class="sim-pick" data-k="${k}">
        <div class="side-sub">${label}</div>
        <div class="sim-pick-row">
          <button class="icon-btn sim-step" data-d="-1" aria-label="Previous ${label.toLowerCase()}" title="Previous ${label.toLowerCase()} (${prev})"><span class="material-icons" aria-hidden="true">chevron_left</span></button>
          <select class="sim-sel" aria-label="${label}"></select>
          <button class="icon-btn sim-step" data-d="1" aria-label="Next ${label.toLowerCase()}" title="Next ${label.toLowerCase()} (${next})"><span class="material-icons" aria-hidden="true">chevron_right</span></button>
        </div>
      </div>`;
  const SIDE = `
    <div class="side-h">Simulation</div>
    ${PICK('mode', 'Riding mode', '←', '→')}
    ${PICK('gear', 'Gear', '↑', '↓')}
    <div class="sim-info"></div>`;
  const CLASSES_SUB = 'points and the median per 1° of lean · click a class to hide / show it';
  const TEMPLATE = `
    <div class="sim-empty" hidden>
      <span class="material-icons sim-empty-ic" aria-hidden="true">insights</span>
      <h2 class="sim-empty-h">You need to add MOTEC data to use Simulation</h2>
      <p class="sim-empty-p">The simulation replays a logged session through the slip target maps.</p>
      <div class="modal-opts sim-empty-opts">
        <button class="modal-opt sim-sample"><span class="material-icons" aria-hidden="true">dataset</span><span class="mo-txt"><b>Load sample data</b><span class="mo-sub">Bol d'Or sample data</span></span></button>
        <button class="modal-opt sim-browse"><span class="material-icons" aria-hidden="true">folder_open</span><span class="mo-txt"><b>Browse my files</b><span class="mo-sub">A MoTeC log file (.ld)</span></span></button>
      </div>
    </div>
    <div class="sim-body">
      <div class="sim-h">Slip target at the logged <span class="lc">μ</span> <span class="sim-h-sub sim-h-top"></span></div>
      <div class="sim-legend sim-legend-top"></div>
      <div class="sim-plot"><canvas class="sim-top" role="img"></canvas></div>
      <div class="sim-h">Logged slip by <span class="lc">μ</span> class <span class="sim-h-sub">0.2 μ steps · ${CLASSES_SUB}</span></div>
      <div class="sim-legend sim-legend-bins"></div>
      <div class="sim-plot"><canvas class="sim-bot" role="img"></canvas></div>
      <div class="sim-h">Acceleration by <span class="lc">μ</span> class <span class="sim-h-sub">accx_veh [G] · ${CLASSES_SUB}</span></div>
      <div class="sim-legend sim-legend-bins"></div>
      <div class="sim-plot"><canvas class="sim-acc" role="img"></canvas></div>
    </div>`;

  class SimView {
    // opts: { getLog: () => sessionData | null, filters: () => { t0, t1, corners: Set }, setCorners: Set -> void,
    //         modes: [[key, name]], modeName: key -> name, mapFor: (mode, gear) -> target, muRows, onSample: button -> load the sample, onBrowse,
//         onSelect: riding mode / gear changed (the app selects that map and re-syncs),
    //         edit: { mu: () => selected μ row, locked: t -> rows, start, change: t -> void, selectMu: row -> void } }
    constructor(el, opts) {
      this.el = el; this.o = opts;
      this.gear = null; this.mode = 'Dry2';        // riding mode + gear -> the slip target map (allocation)
      this.hiddenBins = new Set();
      el.innerHTML = TEMPLATE;
      this.side = document.createElement('section');
      this.side.className = 'side-block sim-side';
      this.side.setAttribute('aria-label', 'Simulation selection');
      this.side.innerHTML = SIDE;
      this.q = s => el.querySelector(s) || this.side.querySelector(s);
      this.top = new Plot(this.q('.sim-top'));
      this.bot = new Plot(this.q('.sim-bot'));
      this.acc = new Plot(this.q('.sim-acc'));
      this.q('.sim-sample').onclick = e => opts.onSample(e.currentTarget);   // empty state: the same two options as Add MOTEC data
      this.q('.sim-browse').onclick = () => opts.onBrowse();
      this.side.querySelectorAll('.sim-pick').forEach(p => {
        const k = p.dataset.k, sel = p.querySelector('select');
        sel.onchange = () => this.set(k, k === 'gear' ? +sel.value : sel.value);
        p.querySelectorAll('.sim-step').forEach(b => { b.onclick = () => this.step(k, +b.dataset.d); });
      });
      el.querySelectorAll('.sim-legend-bins').forEach(lg => lg.addEventListener('click', e => {
        const b = e.target.closest('[data-bin]'); if (!b) return;
        const k = +b.dataset.bin;
        this.hiddenBins.has(k) ? this.hiddenBins.delete(k) : this.hiddenBins.add(k);
        this.render();
      }));
      this._bindEdit();
      new ResizeObserver(() => { if (!el.hidden) this.render(); }).observe(el);
    }
    // the corner shown: picked on the circuit map (0 = all; -1 = several)
    get corner() { const s = this.o.filters().corners; return s.size === 0 ? 0 : s.size === 1 ? [...s][0] : -1; }
    get map() { return this.o.mapFor(this.mode, this.gear); }
    cur(k) { return k === 'gear' ? this.gear : this.mode; }
    options(k) { return [...this.q(`.sim-pick[data-k="${k}"] select`).options].map(o => (k === 'gear' ? +o.value : o.value)); }
    set(k, v) { if (k === 'gear') { this.gear = v; this.autoGear = false; } else this.mode = v; this.o.onSelect(); }   // the app selects the map and re-syncs
    step(k, d) {
      const vals = this.options(k); if (!vals.length) return;
      const i = vals.indexOf(this.cur(k)), next = vals[clamp(i + d, 0, vals.length - 1)];
      if (next !== this.cur(k)) this.set(k, next);
    }
    // keyboard: ↑ / ↓ gear, ← / → riding mode (app.js calls this while the tab is open)
    key(e) {
      const m = { ArrowUp: ['gear', -1], ArrowDown: ['gear', 1], ArrowLeft: ['mode', -1], ArrowRight: ['mode', 1] }[e.key];
      if (!m || !this.o.getLog()) return false;
      this.step(m[0], m[1]);
      return true;
    }
    // the gear to simulate: kept, else the gear used most in the corners of the log
    currentGear() {
      const d = this.o.getLog();
      if (!d) { if (!this.gear) { this.gear = 1; this.autoGear = true; } this.gears = [1, 2, 3, 4, 5, 6]; return this.gear; }   // placeholder until data arrives
      if (!this.counts || this.countsFor !== d) {
        const count = new Array(7).fill(0);
        if (d.gear) d.corners.forEach(c => c.ranges.forEach(([a, b]) => {
          for (let i = Math.floor(a * d.rate); i < Math.min(d.n, Math.ceil(b * d.rate)); i++) { const g = Math.round(d.gear[i]); if (g >= 1 && g <= 6) count[g]++; }
        }));
        this.counts = count; this.countsFor = d;
      }
      const gears = d.gear ? [1, 2, 3, 4, 5, 6].filter(g => this.counts[g]) : [1, 2, 3, 4, 5, 6];
      if (this.autoGear || !gears.includes(this.gear)) this.autoGear = false, this.gear = d.gear ? gears.reduce((a, g) => (this.counts[g] > this.counts[a] ? g : a), gears[0]) : 1;
      this.gears = gears;
      return this.gear;
    }

    // Samples of the selected gear in the selected corner(s) and time section, as runs of consecutive samples.
    _select(d) {
      const f = this.o.filters();
      const gearOk = i => !d.gear || Math.round(d.gear[i]) === this.gear;
      const ranges = (f.corners.size ? d.corners.filter(c => f.corners.has(c.n)) : d.corners).flatMap(c => c.ranges);
      const runs = [];
      ranges.forEach(([a, b]) => {
        a = Math.max(a, f.t0); b = Math.min(b, f.t1);
        let run = null;
        for (let i = Math.max(0, Math.floor(a * d.rate)); i < Math.min(d.n, Math.ceil(b * d.rate)); i++) {
          const ok = gearOk(i) && Number.isFinite(d.slip[i]) && d.slip[i] >= 0 && Number.isFinite(d.mu[i]);
          if (ok) { if (!run) runs.push(run = []); run.push(i); } else run = null;
        }
      });
      return runs;
    }

    _syncPickers(d) {
      const ms = this.q('.sim-pick[data-k="mode"] select');
      ms.innerHTML = this.o.modes.map(([k, name]) => `<option value="${k}">${name}</option>`).join('');
      ms.value = this.mode;
      const gs = this.q('.sim-pick[data-k="gear"] select');
      gs.innerHTML = this.gears.map(g => `<option value="${g}">#${g} · Map ${this.o.mapFor(this.mode, g).id}</option>`).join('');
      gs.value = this.gear;
      this.side.querySelectorAll('.sim-pick').forEach(p => {
        const vals = this.options(p.dataset.k), i = vals.indexOf(this.cur(p.dataset.k));
        p.querySelector('[data-d="-1"]').disabled = i <= 0;
        p.querySelector('[data-d="1"]').disabled = i >= vals.length - 1;
      });
    }

    // ---- editing the selected μ level on the top graph ----------------------
    _bindEdit() {
      const cv = this.q('.sim-top');
      const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      // nearest target point of an editable μ level within 10px; the selected level wins a tie
      const hitPoint = (x, y) => {
        const h = this.hit; if (!h) return null;
        let best = null, bd = 10;
        h.rowsEd.forEach(r => h.t.lean.forEach((lx, j) => {
          const dd = Math.hypot(h.g.px(lx) - x, h.g.py(h.t.rows[r][j]) - y) - (r === h.mi ? 0.5 : 0);
          if (dd < bd) { bd = dd; best = { r, j }; }
        }));
        return best;
      };
      const hitLabel = (x, y) => (this.hit && x > this.hit.g.x1 ? (this.hit.labels.find(l => Math.abs(l.y - y) < 6) || null) : null);
      cv.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const [x, y] = at(e), lab = hitLabel(x, y);
        if (lab) { this.o.edit.selectMu(lab.r); return; }
        const p = hitPoint(x, y); if (!p) return;
        e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        if (p.r !== this.hit.mi) this.o.edit.selectMu(p.r);    // dragging a level selects it
        this.drag = { r: p.r, j: p.j, id: e.pointerId, moved: false };
      });
      cv.addEventListener('pointermove', e => {
        const [x, y] = at(e), dr = this.drag;
        if (!dr || e.pointerId !== dr.id) {
          cv.style.cursor = hitPoint(x, y) != null ? 'grab' : hitLabel(x, y) ? 'pointer' : '';
          return;
        }
        const { t, g } = this.hit, n = t.lean.length, j = dr.j;
        if (!dr.moved) { dr.moved = true; this.o.edit.start(); }
        if (j > 0 && j < n - 1) {        // the lean axis is shared by all μ levels: keep the points ordered, >= 1° apart
          const lo = Math.ceil(t.lean[j + 1] + 1), hi = Math.floor(t.lean[j - 1] - 1);
          if (lo <= hi) t.lean[j] = clamp(Math.round(g.ix(x)), lo, hi);
        }
        t.rows[dr.r][j] = clamp(r1(g.iy(y)), 0, SLIP_MAX);
        cv.style.cursor = 'grabbing';
        this.o.edit.change(t);
      });
      const end = e => { if (this.drag && e.pointerId === this.drag.id) { this.drag = null; cv.style.cursor = ''; } };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
    }

    render() {
      const d = this.o.getLog();
      this.q('.sim-empty').hidden = !!d;
      this.q('.sim-body').hidden = !d;
      this.side.classList.toggle('is-off', !d);
      if (!d) { this.q('.sim-info').textContent = 'Add MoTeC data to simulate.'; return; }
      this.currentGear();
      this._syncPickers(d);
      const t = this.map, muRows = this.o.muRows, col = LogPanel.muColor;
      const mi = this.o.edit.mu(), locked = this.o.edit.locked(t), editable = !locked.includes(mi);
      const runs = this._select(d), all = runs.flat(), corner = this.corner;
      const passes = corner > 0 ? (d.corners.find(c => c.n === corner) || { ranges: [] }).ranges.length : null;
      this.q('.sim-info').textContent = `${this.o.modeName(this.mode)} #${this.gear} · slip target map ${t.id} · ${all.length.toLocaleString()} samples` +
        (passes != null ? ` · ${passes} pass${passes === 1 ? '' : 'es'}` : '');
      this.q('.sim-h-top').textContent = `· ${this.o.modeName(this.mode)} #${this.gear} · map ${t.id} · μ ${fmtMu(muRows[mi])} selected` + (editable ? ' (drag its points)' : ' (calculated level)');
      const x = i => Math.abs(d.lean[i]);

      // ---- top: logged slip coloured by μ, the map's μ levels, the target at the logged μ ----
      const c = this.top.begin(440, SLIP_Y), g = this.top.g;
      c.globalAlpha = 0.6;
      all.forEach(i => { c.fillStyle = col(d.mu[i]); c.fillRect(g.px(x(i)) - 1, g.py(d.slip[i]) - 1, 2, 2); });
      const rowPath = r => { c.beginPath(); t.lean.forEach((lx, j) => { const X = g.px(lx), Y = g.py(t.rows[r][j]); j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); };
      muRows.forEach((m, r) => {                                   // μ levels: thin, in their μ colour
        if (r === mi) return;
        rowPath(r); c.strokeStyle = col(m); c.lineWidth = 1; c.globalAlpha = 0.8;
        c.setLineDash(locked.includes(r) ? [4, 4] : []); c.stroke();
      });
      c.setLineDash([]); c.globalAlpha = 1;
      runs.forEach(run => {                                        // the target at the logged μ, per pass
        if (run.length < 2) return;
        const path = () => { c.beginPath(); run.forEach((i, k) => { const X = g.px(x(i)), Y = g.py(targetAt(t, muRows, x(i), d.mu[i])); k ? c.lineTo(X, Y) : c.moveTo(X, Y); }); };
        c.lineJoin = 'round'; c.lineCap = 'round';
        path(); c.strokeStyle = 'rgba(12,12,18,.9)'; c.lineWidth = 6; c.stroke();
        path(); c.strokeStyle = '#ffffff'; c.lineWidth = 3; c.stroke();
      });
      rowPath(mi); c.strokeStyle = col(muRows[mi]); c.lineWidth = 2.5; c.stroke();   // the selected μ level, on top
      const rowsEd = muRows.map((m, r) => r).filter(r => !locked.includes(r));
      rowsEd.forEach(r => {                                       // the other editable levels: small points, draggable
        if (r !== mi) t.lean.forEach((lx, j) => {
          c.beginPath(); c.arc(g.px(lx), g.py(t.rows[r][j]), 3, 0, Math.PI * 2);
          c.fillStyle = '#0c0c12'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = col(muRows[r]); c.stroke();
        });
      });
      if (editable) t.lean.forEach((lx, j) => {
        c.beginPath(); c.arc(g.px(lx), g.py(t.rows[mi][j]), 5, 0, Math.PI * 2);
        c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 2; c.strokeStyle = col(muRows[mi]); c.stroke();
      });
      this.top.end();
      const labs = muRows.map((m, r) => ({ m, r, y: g.py(t.rows[r][t.rows[r].length - 1]) })).sort((a, b) => b.y - a.y);
      for (let k = 1; k < labs.length; k++) labs[k].y = Math.min(labs[k].y, labs[k - 1].y - 11);
      labs.forEach(l => this.top.rightLabel('μ ' + fmtMu(l.m), l.y, col(l.m), l.r === mi));
      this.hit = { t, mi, g, editable, rowsEd, labels: labs };
      this.q('.sim-legend-top').innerHTML =
        `<span><i class="sim-sw sim-sw-dots"></i>Logged slip, coloured by μ</span>` +
        `<span><i class="sim-sw sim-sw-mu"></i>μ levels of map ${t.id} (click a label to select)</span>` +
        `<span><i class="sim-sw sim-sw-tgt"></i>Slip target at the logged μ</span>` +
        `<span class="sim-scale"><span>μ ${fmtMu(LogPanel.MU_RANGE[0])}</span><i></i><span>${fmtMu(LogPanel.MU_RANGE[1])}</span></span>`;

      // ---- μ classes of 0.2 from 0 to 1.6; below 0 one class (-1), from 1.6 up another (8) ----
      const binOf = m => clamp(Math.floor(m / MU_STEP + 1e-9), -1, 8);
      const binMid = k => (k < 0 ? -0.1 : k > 7 ? 1.7 : (k + 0.5) * MU_STEP);
      const binName = k => (k < 0 ? 'μ < 0' : k > 7 ? 'μ ≥ 1.60' : `μ ${fmtMu(k * MU_STEP)}–${fmtMu((k + 1) * MU_STEP)}`);
      const bins = new Map();
      all.forEach(i => { const k = binOf(d.mu[i]); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(i); });
      const keys = [...bins.keys()].sort((a, b) => a - b);
      const classes = (plot, h, Y, val) => {
        const cx = plot.begin(h, Y), gx = plot.g;
        keys.forEach(k => {
          if (this.hiddenBins.has(k)) return;
          cx.fillStyle = col(binMid(k)); cx.globalAlpha = 0.22;
          bins.get(k).forEach(i => { const v = val(i); if (Number.isFinite(v)) cx.fillRect(gx.px(x(i)) - 1, gx.py(v) - 1, 2, 2); });
        });
        cx.globalAlpha = 1;
        keys.forEach(k => {                                       // median per 1° of lean
          if (this.hiddenBins.has(k)) return;
          const per = Array.from({ length: X_MAX + 1 }, () => []);
          bins.get(k).forEach(i => { const b = Math.round(x(i)), v = val(i); if (b <= X_MAX && Number.isFinite(v)) per[b].push(v); });
          const pts = [];
          per.forEach((v, b) => { if (v.length >= MIN_PER_DEG) { v.sort((p, q) => p - q); pts.push([b, v[v.length >> 1]]); } });
          if (pts.length < 2) return;
          cx.strokeStyle = col(binMid(k)); cx.lineWidth = 2.5; cx.lineJoin = 'round'; cx.beginPath();
          pts.forEach(([b, v], j) => { const X = gx.px(b), Y = gx.py(v); j ? cx.lineTo(X, Y) : cx.moveTo(X, Y); });
          cx.stroke();
        });
        plot.end();
      };
      classes(this.bot, 360, SLIP_Y, i => d.slip[i]);
      if (d.accx) classes(this.acc, 360, ACC_Y, i => d.accx[i]);
      this.q('.sim-acc').closest('.sim-plot').previousElementSibling.previousElementSibling.querySelector('.sim-h-sub').textContent =
        d.accx ? `accx_veh [G] · ${CLASSES_SUB}` : 'not in this log (no accx_veh channel)';
      const legend = keys.map(k => {
        const n = bins.get(k).length;
        return `<button class="sim-bin" data-bin="${k}" aria-pressed="${!this.hiddenBins.has(k)}" title="${n.toLocaleString()} samples">` +
          `<i style="background:${col(binMid(k))}"></i>${binName(k)}<span>${n.toLocaleString()}</span></button>`;
      }).join('') || '<span class="sim-none">No samples in this gear and corner</span>';
      this.el.querySelectorAll('.sim-legend-bins').forEach(lg => { lg.innerHTML = legend; });
      const what = `gear ${this.gear}, ${corner > 0 ? 'corner ' + corner : 'all corners'}`;
      this.q('.sim-top').setAttribute('aria-label', `Logged slip over lean angle, ${what}, with the slip target of map ${t.id} at the logged μ`);
      this.q('.sim-bot').setAttribute('aria-label', `Logged slip over lean angle by μ class, ${what}`);
      this.q('.sim-acc').setAttribute('aria-label', `Longitudinal acceleration over lean angle by μ class, ${what}`);
    }
  }

  SimView.targetAt = targetAt;
  window.SimView = SimView;
})();
