// ArrView — the Adaptive Rider Request tab: the Rider Request "Limit Setup" (Pre Control Limit curve, RCK25 manual 3.3)
// of a riding mode and gear against the driving force at the rear tyre contact patch in the imported MoTeC log.
//  - left column (this.side, docked by app.js like the Simulation's): riding mode and gear selectors; below them the
//    Torque smoothing (md_req / md_act) and the logged data's own filters (laps, timeline, circuit map / corners:
//    log-panel.js), shared with the other tabs. No μ filter here.
//  - the graph: force [N] over |lean| (70° -> 0°, as Simulation): the limit curve of the selected mode / gears
//    (dem_scale_select_<mode> -> dem_lim_fxmx_1_15, from the dataset), the logged limit (md_tgt_prectrl as a force, where
//    it limits), the request force and the actual force calculated from the engine torque, and the ECU's fx_rear_calc.
//    The legend hides / shows each of them.
// Force at the contact patch:  F [N] = M [Nm] × i_gear / r_tire_rr [m]   (i_gear = overall ratio crank -> rear wheel:
// primary × gearbox × rear / front sprocket; r_tire_rr = the ECU's rolling radius of the rear tyre, lean dependent).
// The Limit Setup curves are applied over lean angle (manual 3.3), so the graph uses the lean axis.
(function () {
  const MODES = ['Rain', 'Int', 'Dry1', 'Dry2'];          // idx_mode_veh 1..4
  const TPD_MIN = 0;                                       // on the throttle only, as Simulation
  const GEARS = [1, 2, 3, 4, 5, 6];
  const COL = { lim: '#f5d846', pre: '#ff4d5e', req: '#ff9f3f', act: '#36b2e3', fx: '#ffffff' };
  const fmtN = v => Math.round(v).toLocaleString('en-US');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pct = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

  // centred moving average over k samples (as the slip smoothing of log-panel.js); NaN samples are skipped and stay NaN
  function smooth(src, k) {
    if (!src || k <= 1) return src;
    const n = src.length, out = new Float32Array(n), cum = new Float64Array(n + 1), cnt = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { const ok = Number.isFinite(src[i]); cum[i + 1] = cum[i] + (ok ? src[i] : 0); cnt[i + 1] = cnt[i] + (ok ? 1 : 0); }
    const back = Math.floor((k - 1) / 2), fwd = k - 1 - back;
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - back), b = Math.min(n - 1, i + fwd), c = cnt[b + 1] - cnt[a]; out[i] = Number.isFinite(src[i]) && c ? (cum[b + 1] - cum[a]) / c : NaN; }
    return out;
  }

  // the Limit Setup curve at |lean| x: linear between the points, the end values outside the axis (lean ascending)
  function limitAt(L, row, x) {
    if (x <= L[0]) return row[0];
    const n = L.length;
    if (x >= L[n - 1]) return row[n - 1];
    let j = 0; while (j < n - 2 && x > L[j + 1]) j++;
    return row[j] + (row[j + 1] - row[j]) * (x - L[j]) / (L[j + 1] - L[j]);
  }

  const SIDE = `
    <div class="side-h">Adaptive Rider Request</div>
    <div class="sim-pick">
      <div class="lp-sub sim-sub"><span class="side-sub">Riding mode</span><button class="reset-btn" data-reset="mode" title="Reset riding mode: the logged one" aria-label="Reset riding mode: the logged one" hidden><span class="material-icons" aria-hidden="true">restart_alt</span></button></div>
      <div class="seg side-seg sim-modes" role="group" aria-label="Riding mode"></div>
    </div>
    <div class="sim-pick">
      <div class="lp-sub sim-sub"><span class="side-sub">Gears</span><button class="reset-btn" data-reset="gear" title="Reset gears: the most used one" aria-label="Reset gears: the most used one" hidden><span class="material-icons" aria-hidden="true">restart_alt</span></button></div>
      <div class="chip-list sim-gears arr-gears" role="group" aria-label="Gears to show"></div>
    </div>
    <div class="sim-info"></div>`;
  const TEMPLATE = `
    <div class="sim-empty" hidden>
      <span class="material-icons sim-empty-ic" aria-hidden="true">insights</span>
      <h2 class="sim-empty-h">You need to add MOTEC data to use Adaptive Rider Request</h2>
      <p class="sim-empty-p">The logged driving force at the rear wheel is compared with the Rider Request Limit Setup.</p>
      <div class="modal-opts sim-empty-opts">
        <button class="modal-opt sim-sample"><span class="material-icons" aria-hidden="true">dataset</span><span class="mo-txt"><b>Load sample data</b><span class="mo-sub">Bol d'Or sample data</span></span></button>
        <button class="modal-opt sim-browse"><span class="material-icons" aria-hidden="true">folder_open</span><span class="mo-txt"><b>Browse my files</b><span class="mo-sub">A MoTeC log file (.ld)</span></span></button>
      </div>
    </div>
    <div class="sim-body">
      <div class="sim-h">Rear wheel force and the Limit Setup <span class="sim-h-sub arr-h-top"></span></div>
      <div class="sim-legend sim-legend-top"></div>
      <div class="sim-plot"><canvas class="arr-top" role="img"></canvas></div>
    </div>`;

  class ArrView {
    // opts: { getLog, filters: () => logView.f, modeName: key -> name, riderLimit: () => D.riderLimit | null,
    //         onSample: button -> load the sample, onBrowse }
    constructor(el, opts) {
      this.el = el; this.o = opts;
      this.mode = null; this.gear = 1; this.sel = new Set([1]); this.autoGear = true;
      el.innerHTML = TEMPLATE;
      this.side = document.createElement('section');
      this.side.className = 'side-block sim-side arr-side';
      this.side.setAttribute('aria-label', 'Adaptive Rider Request selection');
      this.side.innerHTML = SIDE;
      this.q = s => el.querySelector(s) || this.side.querySelector(s);
      this.top = new SimView.Plot(this.q('.arr-top'));
      this.q('.sim-sample').onclick = e => opts.onSample(e.currentTarget);
      this.q('.sim-browse').onclick = () => opts.onBrowse();
      this.q('.sim-modes').addEventListener('click', e => { const b = e.target.closest('button[data-m]'); if (b) { this.mode = b.dataset.m; this.render(); } });
      this.q('.arr-gears').addEventListener('click', e => { const b = e.target.closest('button[data-g]'); if (b && !b.disabled) this.toggleGear(+b.dataset.g); });
      this.side.addEventListener('click', e => {
        const r = e.target.closest('.reset-btn[data-reset]'); if (!r) return;
        if (r.dataset.reset === 'mode') this.mode = null; else this.autoGear = true;
        this.render();
      });
      this.hide = new Set();
      const lg = this.q('.sim-legend-top');
      const toggle = it => { const k = it.dataset.k; this.hide.has(k) ? this.hide.delete(k) : this.hide.add(k); this.render(); };
      lg.addEventListener('click', e => { const it = e.target.closest('[data-k]'); if (it) toggle(it); });
      lg.addEventListener('keydown', e => { const it = e.target.closest('[data-k]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(it); } });
      new ResizeObserver(() => { if (!el.hidden) this.render(); }).observe(el);
      window.addEventListener('resize', () => { if (!el.hidden) this.render(); });
    }

    // the riding mode logged (idx_mode_veh, most frequent value), Dry 2 when the log does not have it
    loggedMode(d) {
      if (!d.vmode) return 'Dry2';
      const c = [0, 0, 0, 0, 0];
      for (let i = 0; i < d.n; i += 10) { const m = Math.round(d.vmode[i]); if (m >= 1 && m <= 4) c[m]++; }
      const best = c.indexOf(Math.max(...c));
      return best >= 1 && c[best] ? MODES[best - 1] : 'Dry2';
    }
    gearCh(d) { return d.gearRaw || d.gear; }               // always the gear: the Limit Setup is per gear (STK)
    toggleGear(g) {
      this.autoGear = false;
      if (!this.sel.has(g)) { this.sel.add(g); this.gear = g; }
      else if (this.sel.size > 1) { this.sel.delete(g); if (g === this.gear) this.gear = Math.min(...this.sel); }
      else return;
      this.render();
    }
    key(e) {
      const d = this.o.getLog(); if (!d) return false;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = MODES.indexOf(this.curMode(d));
        this.mode = MODES[clamp(i + (e.key === 'ArrowLeft' ? -1 : 1), 0, MODES.length - 1)]; this.render(); return true;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const gs = this.gears || GEARS, i = gs.indexOf(this.gear), g = gs[clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, gs.length - 1)];
        this.autoGear = false; this.sel = new Set([g]); this.gear = g; this.render(); return true;
      }
      return false;
    }
    curMode(d) { return this.mode || this.loggedMode(d); }

    // forces [N] at the contact patch, once per log: F = M × i_gear / r_tire_rr
    _forces(d) {
      if (this.fFor === d) return this.F;
      const ok = !!(d.iGear && d.rTire), n = d.n;
      const conv = md => {
        if (!ok || !md) return null;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = d.rTire[i] > 0.1 && d.iGear[i] > 0 ? md[i] * d.iGear[i] / d.rTire[i] : NaN;
        return out;
      };
      let preMax = -Infinity;                               // md_tgt_prectrl when it does not limit = the demand map's max. torque
      if (d.mdPre) for (let i = 0; i < n; i++) if (d.mdPre[i] > preMax) preMax = d.mdPre[i];
      this.F = { req: conv(d.mdReq), act: conv(d.mdAct), pre: conv(d.mdPre), preMax, conv };
      this.fFor = d;
      return this.F;
    }
    // the graph's forces with the Torque smoothing of the left column (f.mdSmooth samples): md_req and md_act are smoothed,
    // then converted; fx_rear_calc is smoothed the same way so it stays comparable. The logged limit uses
    // the logged values.
    _smoothed(d) {
      const k = Math.max(1, Math.round(this.o.filters().mdSmooth || 1)), F = this._forces(d);
      if (this.sFor === d && this.sK === k) return this.S;
      this.S = k <= 1 ? { req: F.req, act: F.act, fx: d.fxCalc }
        : { req: F.conv(smooth(d.mdReq, k)), act: F.conv(smooth(d.mdAct, k)), fx: smooth(d.fxCalc, k) };
      this.S.k = k; this.sFor = d; this.sK = k;
      return this.S;
    }

    // gears in the corners of the log; the most used one is selected by default
    _gears(d) {
      const gc = this.gearCh(d);
      if (this.countsFor !== d) {
        const count = new Array(7).fill(0);
        if (gc) d.corners.forEach(c => c.ranges.forEach(([a, b]) => {
          for (let i = Math.floor(a * d.rate); i < Math.min(d.n, Math.ceil(b * d.rate)); i++) { const g = Math.round(gc[i]); if (g >= 1 && g <= 6) count[g]++; }
        }));
        this.counts = count; this.countsFor = d; this.autoGear = true;
      }
      this.gears = gc ? GEARS.filter(g => this.counts[g]) : GEARS;
      if (!this.gears.length) this.gears = GEARS;
      this.sel = new Set([...this.sel].filter(g => this.gears.includes(g)));
      if (this.autoGear || !this.sel.size) {
        this.autoGear = false;
        this.gear = this.gears.reduce((a, g) => (this.counts[g] > this.counts[a] ? g : a), this.gears[0]);
        this.sel = new Set([this.gear]);
      }
      if (!this.sel.has(this.gear)) this.gear = Math.min(...this.sel);
    }

    // samples in the selected corner(s) and time section (no μ filter), on the throttle, as runs of consecutive samples
    // (a new run where the gear changes), of the gears gearOk(g) accepts
    _select(d, gearOk) {
      const f = this.o.filters(), gc = this.gearCh(d), F = this._forces(d);
      const ranges = (f.corners.size ? d.corners.filter(c => f.corners.has(c.n)) : d.corners).flatMap(c => c.ranges);
      const runs = [];
      ranges.forEach(([a, b]) => {
        a = Math.max(a, f.t0); b = Math.min(b, f.t1);
        let run = null;
        for (let i = Math.max(0, Math.floor(a * d.rate)); i < Math.min(d.n, Math.ceil(b * d.rate)); i++) {
          const g = gc ? Math.round(gc[i]) : 0;
          const ok = gearOk(g) && Number.isFinite(F.act ? F.act[i] : NaN) && (!d.tpd || d.tpd[i] > TPD_MIN);
          if (ok && run && gc && g !== Math.round(gc[run[run.length - 1]])) run = null;
          if (ok) { if (!run) runs.push(run = []); run.push(i); } else run = null;
        }
      });
      return runs;
    }

    // Limit Setup curve number of a riding mode / gear (dem_scale_select), and its values (null: a library curve 16..30)
    curveNo(mode, g) { const RL = this.o.riderLimit(); return RL && RL.select[mode] ? RL.select[mode][g - 1] : null; }
    curve(no) { const RL = this.o.riderLimit(); return RL && no >= 1 && no <= RL.curves.length ? RL.curves[no - 1] : null; }

    _syncPickers(d) {
      const mode = this.curMode(d), logged = this.loggedMode(d);
      const most = this.gears.reduce((a, g) => (this.counts[g] > this.counts[a] ? g : a), this.gears[0]);
      this.q('.reset-btn[data-reset="mode"]').hidden = mode === logged;
      this.q('.reset-btn[data-reset="mode"]').title = `Reset riding mode: ${this.o.modeName(logged)} (logged)`;
      this.q('.reset-btn[data-reset="gear"]').hidden = this.sel.size === 1 && this.sel.has(most);
      this.q('.sim-modes').innerHTML = MODES.map(k =>
        `<button data-m="${k}" aria-pressed="${k === mode}" title="${this.o.modeName(k)}${k === logged ? ' · the logged riding mode' : ''}">${this.o.modeName(k)}${k === logged ? ' •' : ''}</button>`).join('');
      this.q('.arr-gears').innerHTML = GEARS.map(g => {
        const on = this.sel.has(g), have = this.gears.includes(g), no = this.curveNo(mode, g);
        return `<button class="chip lp-chip${g === this.gear && this.sel.size > 1 ? ' is-edit' : ''}" data-g="${g}" aria-pressed="${on}" style="--mc:#3f8ce8"` +
          `${have ? '' : ' disabled'} title="${have ? `Gear ${g} · Limit Setup curve ${no ?? '–'}` : `Gear ${g} is not used in the corners of this log`}">#${g}<span>L${no ?? '–'}</span></button>`;
      }).join('');
    }

    render() {
      const d = this.o.getLog();
      this.q('.sim-empty').hidden = !!d;
      this.q('.sim-body').hidden = !d;
      this.side.classList.toggle('is-off', !d);
      if (!d) { this.q('.sim-info').textContent = 'Add MoTeC data to compare.'; return; }
      this._gears(d);
      this._syncPickers(d);
      const mode = this.curMode(d), RL = this.o.riderLimit(), F = this._forces(d);
      const H = k => this.hide.has(k);
      const runs = this._select(d, g => this.sel.has(g)), all = runs.flat();
      const selG = [...this.sel].sort((a, b) => a - b);
      const x = i => Math.abs(d.lean[i]);
      // the selected gears' curves: the gear clicked last first (bold), other gears with another curve thin
      const curves = [...new Map([this.gear, ...selG.filter(g => g !== this.gear)].map(g => [this.curveNo(mode, g), g])).entries()]
        .map(([no, g]) => ({ no, g, row: this.curve(no) }));
      const missing = !F.act ? 'This log has no md_act / i_gear / r_tire_rr: the force cannot be calculated.' : '';
      this.q('.sim-info').textContent = missing || `${this.o.modeName(mode)} ${selG.map(g => '#' + g).join(' ')} · Limit Setup ${curves.map(c => 'curve ' + (c.no ?? '–')).join(', ')} · ${all.length.toLocaleString()} samples`;
      this.q('.arr-h-top').textContent = `· ${this.o.modeName(mode)} #${this.gear} · curve ${curves[0].no ?? '–'}` + (curves[0].row ? '' : curves[0].no ? ' (library curve in the ECU dataset, values not in the file)' : ' (no Limit Setup in this dataset)');

      // value axis: up to the highest curve / force shown, in steps of 1000 N
      let top = 0;
      curves.forEach(c => { if (c.row && !H('lim')) top = Math.max(top, ...c.row); });
      const S = this._smoothed(d), vis = ['req', 'act', 'fx'].filter(k => !H(k)).map(k => S[k]).filter(Boolean);
      vis.forEach(a => { const v = pct(all.map(i => a[i]).filter(Number.isFinite), 0.995); if (v > top) top = v; });
      if (!H('pre') && F.pre) all.forEach(i => { if (d.mdPre[i] < F.preMax - 0.5 && F.pre[i] > top) top = F.pre[i]; });
      const Y = { min: 0, max: clamp(Math.ceil((top || 4000) * 1.05 / 1000) * 1000, 2000, 12000), major: 500, label: 1000, minor: 100, fmt: v => fmtN(v) + ' N' };
      const h = Math.max(320, Math.round(window.innerHeight - (this.q('.arr-top').parentNode.getBoundingClientRect().top + window.scrollY) - 16));
      const c = this.top.begin(h, Y), gr = this.top.g;
      const pts = (arr, color, size, alpha, cond) => {
        c.globalAlpha = alpha; c.fillStyle = color;
        all.forEach(i => { const v = arr[i]; if (Number.isFinite(v) && (!cond || cond(i))) c.fillRect(gr.px(x(i)) - size / 2, gr.py(v) - size / 2, size, size); });
        c.globalAlpha = 1;
      };
      const lines = (arr, color, w, alpha) => {
        c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = w; c.lineJoin = 'round';
        runs.forEach(run => { c.beginPath(); run.forEach((i, k) => (k ? c.lineTo(gr.px(x(i)), gr.py(arr[i])) : c.moveTo(gr.px(x(i)), gr.py(arr[i])))); c.stroke(); });
        c.globalAlpha = 1;
      };
      if (!H('fx') && S.fx) pts(S.fx, COL.fx, 2, 0.45);
      if (!H('act') && S.act) lines(S.act, COL.act, 1.2, 0.75);
      if (!H('req') && S.req) lines(S.req, COL.req, 1.2, 0.75);
      if (!H('pre') && F.pre) pts(F.pre, COL.pre, 4, 0.9, i => d.mdPre[i] < F.preMax - 0.5);   // only where it limits
      if (!H('lim')) curves.slice().reverse().forEach((cv, k, arr) => {
        if (!cv.row) return;
        const bold = k === arr.length - 1;
        c.beginPath();
        for (let lx = 70; lx >= 0; lx -= 0.5) { const X = gr.px(lx), Yv = gr.py(limitAt(RL.lean, cv.row, lx)); lx === 70 ? c.moveTo(X, Yv) : c.lineTo(X, Yv); }
        c.strokeStyle = COL.lim; c.lineWidth = bold ? 3.5 : 1.5; c.setLineDash(bold ? [] : [6, 4]); c.stroke(); c.setLineDash([]);
        if (bold) RL.lean.forEach((lx, j) => { c.beginPath(); c.arc(gr.px(lx), gr.py(cv.row[j]), 4, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill(); c.lineWidth = 2; c.strokeStyle = COL.lim; c.stroke(); });
      });
      this.top.end();
      if (!H('lim')) curves.forEach((cv, k) => { if (cv.row) this.top.rightLabel(`L${cv.no} #${cv.g}`, gr.py(limitAt(RL.lean, cv.row, 0)) + k * 19, COL.lim, k === 0, 17); });

      const item = (k, html, off) => `<span data-k="${k}" role="button" tabindex="0" class="${H(k) || off ? 'is-off' : ''}" aria-pressed="${!H(k)}" title="${off ? 'Not in this log' : 'Click to hide / show'}">${html}</span>`;
      this.q('.sim-legend-top').innerHTML =
        item('lim', `<i class="sim-sw arr-sw-lim"></i>Limit Setup curve ${curves[0].no ?? '–'} (dataset)`, !curves[0].row) +
        item('pre', `<i class="sim-sw arr-sw-pts" style="--c:${COL.pre}"></i>Logged limit · md_tgt_prectrl × i / r, where it limits`, !F.pre) +
        item('req', `<i class="sim-sw arr-sw-ln" style="--c:${COL.req}"></i>Request · md_req × i / r`, !F.req) +
        item('act', `<i class="sim-sw arr-sw-ln" style="--c:${COL.act}"></i>Actual · md_act × i / r`, !F.act) +
        item('fx', `<i class="sim-sw arr-sw-pts" style="--c:${COL.fx}"></i>fx_rear_calc (logged)`, !d.fxCalc) +
        `<span class="arr-sm">${S.k > 1 ? `Request, actual and fx_rear_calc smoothed over ${S.k} samples` : 'Not smoothed'}</span>`;
      this.q('.arr-top').setAttribute('aria-label', `Rear wheel force over lean angle, gear ${selG.join(', ')}, with the Limit Setup curve ${curves[0].no ?? ''}`);
    }
  }

  window.ArrView = ArrView;
})();
