// SimView — the Simulation tab: what the DTC slip target would have been through the corners of the imported
// MoTeC log, for one riding mode and gear (the slip target map the allocation gives them).
//  - left column (this.side, docked by app.js): riding mode and gear selectors (dropdown + ‹ ›; ← / → = riding
//    mode, ↑ / ↓ = gear). The timeline and the circuit map (corners) are the logged data's own filters (log-panel.js).
//  - top graph: logged slip over |lean| coloured by μ (dark blue -> red), the map's μ levels as thin lines, a thick
//    white line where the target is at the μ logged at each sample (interpolated between the μ levels). Editable
//    μ levels show their target points, which can be dragged as on the other tabs (the dragged level becomes the
//    selected one, drawn bold); calculated levels are dashed. A μ label on the right selects that level.
//  - μ-class graphs: the samples split into 0.2 wide μ classes, each in its colour, points and the median per 1° of
//    lean — logged slip, and the longitudinal acceleration (accx_veh) as a duplicate. The μ range slider of the logged
//    data (left column) filters every graph on the tab.
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
    // a label right of the plot: boxed (rounded box in the colour, dark 11px text, as the slip-target graph's selectable
    // levels) or plain coloured text
    rightLabel(text, y, color, boxed, h) {
      const c = this.c, g = this.g, x = g.x1 + 10;
      c.save(); c.textAlign = 'left'; c.textBaseline = 'middle';
      if (boxed) {
        c.font = "700 11px 'Noto Sans', system-ui, sans-serif";
        const w = c.measureText(text).width + 10;
        c.fillStyle = color; c.beginPath();
        c.roundRect ? c.roundRect(x, y - h / 2, w, h, 4) : c.rect(x, y - h / 2, w, h); c.fill();
        c.fillStyle = '#0c0c12'; c.fillText(text, x + 5, y + 0.5);
      } else { c.font = FONT; c.fillStyle = color; c.fillText(text, x, y); }
      c.restore();
    }
  }

  const SIDE = `
    <div class="side-h">Simulation</div>
    <div class="sim-pick">
      <div class="lp-sub sim-sub"><span class="side-sub">Riding mode</span><button class="reset-btn" data-reset="mode" title="Reset riding mode: Dry 2" aria-label="Reset riding mode: Dry 2" hidden><span class="material-icons" aria-hidden="true">restart_alt</span></button></div>
      <div class="seg side-seg sim-modes" role="group" aria-label="Riding mode"></div>
    </div>
    <div class="sim-pick">
      <div class="lp-sub sim-sub"><span class="side-sub">Gears</span><button class="reset-btn" data-reset="gear" title="Reset gears: the most used one" aria-label="Reset gears: the most used one" hidden><span class="material-icons" aria-hidden="true">restart_alt</span></button></div>
      <div class="chip-list sim-gears" role="group" aria-label="Gears to simulate"></div>
    </div>
    <div class="sim-info"></div>`;
  const CLASSES_SUB = 'points and the median per 1° of lean';
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
      <div class="sim-plot"><canvas class="sim-bot" role="img"></canvas></div>
      <div class="sim-h">Acceleration by <span class="lc">μ</span> class <span class="sim-h-sub">accx_veh [G] · ${CLASSES_SUB}</span></div>
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
      this.q('.sim-modes').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (b) this.setMode(b.dataset.m); });
      this.q('.sim-gears').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (b && !b.disabled) this.toggleGear(+b.dataset.g); });
      this.side.addEventListener('click', e => {                // reset: riding mode Dry 2 / gears back to the most used one
        const r = e.target.closest('.reset-btn[data-reset]'); if (!r) return;
        if (r.dataset.reset === 'mode') this.setMode('Dry2');
        else { this.autoGear = true; this.sel = new Set(); this.o.onSelect(); }
      });
      this.hide = new Set();                                    // legend entries switched off (top graph)
      const lg = this.q('.sim-legend-top');
      const toggle = el => { const k = el.dataset.k; this.hide.has(k) ? this.hide.delete(k) : this.hide.add(k); this.render(); };
      lg.addEventListener('click', e => { const el = e.target.closest('[data-k]'); if (el) toggle(el); });
      lg.addEventListener('keydown', e => { const el = e.target.closest('[data-k]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(el); } });
      this._bindEdit();
      new ResizeObserver(() => { if (!el.hidden) this.render(); }).observe(el);
    }
    // the corner shown: picked on the circuit map (0 = all; -1 = several)
    get corner() { const s = this.o.filters().corners; return s.size === 0 ? 0 : s.size === 1 ? [...s][0] : -1; }
    // the edited map: riding mode + the gear clicked last (this.gear) among the selected gears (this.sel)
    get map() { return this.o.mapFor(this.mode, this.gear); }
    setMode(m) { if (m !== this.mode) { this.mode = m; this.o.onSelect(); } }
    // gears work like the lap buttons: a click turns a gear on / off (at least one stays on); the gear turned on last
    // is the edited map (when it is turned off: the lowest one left)
    toggleGear(g) {
      this.autoGear = false;
      if (!this.sel.has(g)) { this.sel.add(g); this.gear = g; }
      else if (this.sel.size > 1) { this.sel.delete(g); if (g === this.gear) this.gear = Math.min(...this.sel); }
      else return;
      this.o.onSelect();
    }
    // keyboard: ← / → riding mode, ↑ / ↓ gear (selects that gear alone)
    key(e) {
      if (!this.o.getLog()) return false;
      const modes = this.o.modes.map(m => m[0]);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = modes.indexOf(this.mode), j = clamp(i + (e.key === 'ArrowLeft' ? -1 : 1), 0, modes.length - 1);
        this.setMode(modes[j]); return true;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const i = this.gears.indexOf(this.gear), g = this.gears[clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, this.gears.length - 1)];
        if (g !== this.gear || this.sel.size > 1) { this.autoGear = false; this.sel = new Set([g]); this.gear = g; this.o.onSelect(); }
        return true;
      }
      return false;
    }
    // the gears in the log's corners; by default only the most used one is selected
    currentGear() {
      const d = this.o.getLog();
      if (!this.sel) this.sel = new Set();
      if (!d) { if (!this.gear) { this.gear = 1; this.sel = new Set([1]); this.autoGear = true; } this.gears = [1, 2, 3, 4, 5, 6]; return this.gear; }   // placeholder until data arrives
      if (!this.counts || this.countsFor !== d) {
        const count = new Array(7).fill(0);
        if (d.gear) d.corners.forEach(c => c.ranges.forEach(([a, b]) => {
          for (let i = Math.floor(a * d.rate); i < Math.min(d.n, Math.ceil(b * d.rate)); i++) { const g = Math.round(d.gear[i]); if (g >= 1 && g <= 6) count[g]++; }
        }));
        this.counts = count; this.countsFor = d;
      }
      const gears = d.gear ? [1, 2, 3, 4, 5, 6].filter(g => this.counts[g]) : [1, 2, 3, 4, 5, 6];
      this.gears = gears;
      this.sel = new Set([...this.sel].filter(g => gears.includes(g)));
      if (this.autoGear || !this.sel.size) {
        this.autoGear = false;
        this.gear = d.gear ? gears.reduce((a, g) => (this.counts[g] > this.counts[a] ? g : a), gears[0]) : 1;
        this.sel = new Set([this.gear]);
      }
      if (!this.sel.has(this.gear)) this.gear = Math.min(...this.sel);
      return this.gear;
    }

    // Samples of the selected gears in the selected corner(s) and time section, as runs of consecutive samples.
    _select(d) {
      const f = this.o.filters();
      const gearOk = i => !d.gear || this.sel.has(Math.round(d.gear[i]));
      const [M0, M1] = LogPanel.MU_RANGE, muLo = f.muLo <= M0 + 1e-9 ? -Infinity : f.muLo, muHi = f.muHi >= M1 - 1e-9 ? Infinity : f.muHi;
      const ranges = (f.corners.size ? d.corners.filter(c => f.corners.has(c.n)) : d.corners).flatMap(c => c.ranges);
      const runs = [];
      ranges.forEach(([a, b]) => {
        a = Math.max(a, f.t0); b = Math.min(b, f.t1);
        let run = null;
        for (let i = Math.max(0, Math.floor(a * d.rate)); i < Math.min(d.n, Math.ceil(b * d.rate)); i++) {
          const ok = gearOk(i) && Number.isFinite(d.slip[i]) && d.slip[i] >= 0 && d.mu[i] >= muLo && d.mu[i] <= muHi;
          // a new run where the gear changes, so each run is simulated with one map
          if (ok && run && d.gear && Math.round(d.gear[i]) !== Math.round(d.gear[run[run.length - 1]])) run = null;
          if (ok) { if (!run) runs.push(run = []); run.push(i); } else run = null;
        }
      });
      return runs;
    }

    _syncPickers() {
      const most = this.gears.reduce((a, g) => (this.counts && this.counts[g] > this.counts[a] ? g : a), this.gears[0]);
      this.q('.reset-btn[data-reset="mode"]').hidden = this.mode === 'Dry2';
      this.q('.reset-btn[data-reset="gear"]').hidden = this.sel.size === 1 && this.sel.has(most);
      this.q('.sim-modes').innerHTML = this.o.modes.map(([k, name]) =>
        `<button data-m="${k}" aria-pressed="${k === this.mode}">${name}</button>`).join('');
      this.q('.sim-gears').innerHTML = [1, 2, 3, 4, 5, 6].map(g => {
        const on = this.sel.has(g), have = this.gears.includes(g), id = this.o.mapFor(this.mode, g).id;
        return `<button class="chip lp-chip${g === this.gear && this.sel.size > 1 ? ' is-edit' : ''}" data-g="${g}" aria-pressed="${on}" style="--mc:#3f8ce8"` +
          `${have ? '' : ' disabled'} title="${have ? `Gear ${g} · map ${id}${on && g === this.gear ? ' (edited)' : ''}` : `Gear ${g} is not used in the corners of this log`}">#${g}<span>M${id}</span></button>`;
      }).join('');
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
      const hitLabel = (x, y) => (this.hit && x > this.hit.g.x1 ? (this.hit.labels.find(l => Math.abs(l.y - y) < 9) || null) : null);
      cv.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const [x, y] = at(e), lab = hitLabel(x, y);
        if (lab) { if (lab.r >= 0) this.o.edit.selectMu(lab.r); return; }   // other gears' map labels are not selectable
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
      this._syncPickers();
      const t = this.map, muRows = this.o.muRows, col = LogPanel.muColor;
      const mi = this.o.edit.mu(), locked = this.o.edit.locked(t), editable = !locked.includes(mi);
      const runs = this._select(d), all = runs.flat(), corner = this.corner;
      const passes = corner > 0 ? (d.corners.find(c => c.n === corner) || { ranges: [] }).ranges.length : null;
      const selG = [...this.sel].sort((a, b) => a - b);
      // other selected gears with a different map: drawn thin (selected μ level) in their colour, simulated with their map
      const others = [...new Map(selG.filter(gg => gg !== this.gear).map(gg => [this.o.mapFor(this.mode, gg).id, gg])).entries()]
        .filter(([id]) => id !== t.id).map(([id, gg]) => ({ id, gg, t: this.o.mapFor(this.mode, gg) }));
      this.q('.sim-info').textContent = `${this.o.modeName(this.mode)} ${selG.map(gg => '#' + gg).join(' ')} · map ${[t.id, ...others.map(o => o.id)].join(', ')} · ${all.length.toLocaleString()} samples` +
        (passes != null ? ` · ${passes} pass${passes === 1 ? '' : 'es'}` : '');
      this.q('.sim-h-top').textContent = `· ${this.o.modeName(this.mode)} #${this.gear} · map ${t.id} · μ ${fmtMu(muRows[mi])} selected` + (editable ? ' (drag its points)' : ' (calculated level)');
      const x = i => Math.abs(d.lean[i]);

      // ---- top: logged slip coloured by μ, the map as on the first three tabs (selected map), the target at the logged μ ----
      const mc = this.o.colorFor(t.id);                            // the map's own colour
      const c = this.top.begin(440, SLIP_Y), g = this.top.g;
      const H = k => this.hide.has(k);
      c.globalAlpha = 0.6;
      if (!H('dots')) all.forEach(i => { c.fillStyle = col(d.mu[i]); c.fillRect(g.px(x(i)) - 1, g.py(d.slip[i]) - 1, 2, 2); });
      c.globalAlpha = 1;
      const rowPath = r => { c.beginPath(); t.lean.forEach((lx, j) => { const X = g.px(lx), Y = g.py(t.rows[r][j]); j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); };
      const top = t.rows.length - 1;                               // μ band: 10 % of the map colour between the lowest and highest level
      if (!H('mu')) {
        c.beginPath();
        t.lean.forEach((lx, j) => { const X = g.px(lx), Y = g.py(t.rows[top][j]); j ? c.lineTo(X, Y) : c.moveTo(X, Y); });
        for (let j = t.lean.length - 1; j >= 0; j--) c.lineTo(g.px(t.lean[j]), g.py(t.rows[0][j]));
        c.closePath(); c.fillStyle = mc; c.globalAlpha = 0.1; c.fill(); c.globalAlpha = 1;
      }
      const rowsEd = muRows.map((m, r) => r).filter(r => !locked.includes(r));
      muRows.forEach((m, r) => {                                   // other levels: calculated dotted, editable solid with points
        if (r === mi || H('mu')) return;
        rowPath(r); c.strokeStyle = mc;
        if (locked.includes(r)) { c.lineWidth = 1.5; c.setLineDash([4, 8]); } else { c.lineWidth = 1; c.setLineDash([]); }
        c.stroke(); c.setLineDash([]);
        if (!locked.includes(r)) t.lean.forEach((lx, j) => {
          c.beginPath(); c.arc(g.px(lx), g.py(t.rows[r][j]), 3, 0, Math.PI * 2);
          c.fillStyle = '#0c0c12'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = mc; c.stroke();
        });
      });
      if (!H('map')) others.forEach(o => {                         // other selected gears' maps: their selected μ level, thin
        c.beginPath(); o.t.lean.forEach((lx, j) => { const X = g.px(lx), Y = g.py(o.t.rows[mi][j]); j ? c.lineTo(X, Y) : c.moveTo(X, Y); });
        c.strokeStyle = this.o.colorFor(o.id); c.lineWidth = 1.5; c.stroke();
      });
      runs.forEach(run => {                                        // the target at the logged μ, per pass: plain 4px white
        if (run.length < 2 || H('tgt')) return;
        const tr = d.gear ? this.o.mapFor(this.mode, Math.round(d.gear[run[0]])) : t;   // each pass with its gear's map
        c.beginPath();
        run.forEach((i, k) => { const X = g.px(x(i)), Y = g.py(targetAt(tr, muRows, x(i), d.mu[i])); k ? c.lineTo(X, Y) : c.moveTo(X, Y); });
        c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = '#ffffff'; c.lineWidth = 4; c.stroke();
      });
      if (!H('map')) { rowPath(mi); c.strokeStyle = mc; c.lineWidth = 3.5; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }   // the selected level, on top
      if (editable && !H('map')) t.lean.forEach((lx, j) => {     // its points: white with a map-colour ring
        c.beginPath(); c.arc(g.px(lx), g.py(t.rows[mi][j]), 5, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 2; c.strokeStyle = mc; c.stroke();
      });
      this.top.end();
      c.font = "700 11px 'Noto Sans', system-ui, sans-serif"; c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (!H('map')) t.lean.forEach((lx, j) => {                  // its values above the points (outside the clip: the end points too)
        const X = g.px(lx), Y = g.py(t.rows[mi][j]);
        c.fillText(t.rows[mi][j].toFixed(1) + '%', X, Y - 22 < g.y0 - 8 ? Y + 22 : Y - 22);
      });
      // right-hand labels: the selected and the editable levels boxed in the map colour, calculated ones as text
      const BOX_H = 17, labs = muRows.map((m, r) => ({ m, r, text: 'μ ' + fmtMu(m), color: mc, boxed: !locked.includes(r) || r === mi, y: g.py(t.rows[r][t.rows[r].length - 1]) }))
        .concat(others.map(o => ({ r: -1, text: `M${o.id} #${o.gg}`, color: this.o.colorFor(o.id), boxed: false, y: g.py(o.t.rows[mi][o.t.rows[mi].length - 1]) })))
        .filter(l => (l.r === mi || l.r < 0 ? !H('map') : !H('mu')))   // labels follow what is shown
        .sort((a, b) => a.y - b.y);
      const gap = BOX_H + 2;
      for (let k = 1; k < labs.length; k++) if (labs[k].y - labs[k - 1].y < gap) labs[k].y = labs[k - 1].y + gap;
      for (let k = labs.length - 1; k >= 0; k--) { const max = k === labs.length - 1 ? g.y1 : labs[k + 1].y - gap; if (labs[k].y > max) labs[k].y = max; }
      labs.forEach(l => this.top.rightLabel(l.text, l.y, l.color, l.boxed, BOX_H));
      const rowsHit = rowsEd.filter(r => (r === mi ? !H('map') : !H('mu')));   // hidden levels cannot be dragged
      this.hit = { t, mi, g, editable, rowsEd: rowsHit, labels: labs };
      // legend: each entry hides / shows its data on the graph (as the slip-target graph's legends)
      const item = (k, html) => `<span data-k="${k}" role="button" tabindex="0" class="${H(k) ? 'is-off' : ''}" aria-pressed="${!H(k)}" title="Click to hide / show">${html}</span>`;
      this.q('.sim-legend-top').innerHTML =
        item('dots', `<i class="sim-sw sim-sw-dots"></i>Logged slip, coloured by μ <span class="sim-scale"><span>${fmtMu(LogPanel.MU_RANGE[0])}</span><i></i><span>${fmtMu(LogPanel.MU_RANGE[1])}</span></span>`) +
        item('map', `<i class="sim-sw sim-sw-map" style="border-color:${mc}"></i>Map ${t.id} at μ ${fmtMu(muRows[mi])}`) +
        item('mu', `<i class="sim-sw sim-sw-mu" style="border-color:${mc}"></i>Other μ levels`) +
        item('tgt', `<i class="sim-sw sim-sw-tgt"></i>Slip target at the logged μ`);

      // ---- μ classes of 0.2 from 0 to 1.6; below 0 one class (-1), from 1.6 up another (8) ----
      const binOf = m => clamp(Math.floor(m / MU_STEP + 1e-9), -1, 8);
      const binMid = k => (k < 0 ? -0.1 : k > 7 ? 1.7 : (k + 0.5) * MU_STEP);
      const bins = new Map();
      all.forEach(i => { const k = binOf(d.mu[i]); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(i); });
      const keys = [...bins.keys()].sort((a, b) => a - b);
      const classes = (plot, h, Y, val) => {
        const cx = plot.begin(h, Y), gx = plot.g;
        keys.forEach(k => {
          cx.fillStyle = col(binMid(k)); cx.globalAlpha = 0.22;
          bins.get(k).forEach(i => { const v = val(i); if (Number.isFinite(v)) cx.fillRect(gx.px(x(i)) - 1, gx.py(v) - 1, 2, 2); });
        });
        cx.globalAlpha = 1;
        keys.forEach(k => {                                       // median per 1° of lean
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
      this.q('.sim-acc').closest('.sim-plot').previousElementSibling.querySelector('.sim-h-sub').textContent =
        d.accx ? `accx_veh [G] · ${CLASSES_SUB}` : 'not in this log (no accx_veh channel)';
      const what = `gear ${selG.join(', ')}, ${corner > 0 ? 'corner ' + corner : 'all corners'}`;
      this.q('.sim-top').setAttribute('aria-label', `Logged slip over lean angle, ${what}, with the slip target of map ${t.id} at the logged μ`);
      this.q('.sim-bot').setAttribute('aria-label', `Logged slip over lean angle by μ class, ${what}`);
      this.q('.sim-acc').setAttribute('aria-label', `Longitudinal acceleration over lean angle by μ class, ${what}`);
    }
  }

  SimView.targetAt = targetAt;
  window.SimView = SimView;
})();
