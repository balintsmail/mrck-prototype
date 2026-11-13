// ArrView — the Adaptive Rider Request tab: the Rider Request "Limit Setup" (Pre Control Limit curve, RCK25 manual 3.3)
// of the logged riding mode and a gear against the driving force at the rear tyre contact patch in the imported MoTeC log.
//  - gear: a second row of tabs above the graph (opts.subTabs, the B tabs row of app.js), one map per gear; the riding
//    mode is the logged one.
//  - left column (this.side, docked by app.js like the Simulation's): on top the adaptation on / off switch of the gear
//    (off: the gear keeps its dataset curve); the limit adaptation controls; below them the Torque smoothing (md_req / md_act) and the logged data's own filters
//    (laps, timeline, circuit map / corners: log-panel.js), shared with the other tabs. No μ filter here.
//  - the graph: force [N] over the signed lean angle (−70° left … +70° right); the Limit Setup curve is looked up by
//    |lean|, so it is drawn mirrored. Every sample of the selection, the logged limit, fx_rear_calc and the adapted map
//    after the shown lap.
//  - with no log, opening the tab loads the sample data (once per page load).
//  - Limit adaptation: every gear has its own map. Once per simulated lap the map of the gear moves towards the force at
//    which the TC reduced the torque on the selected lap (the best lap by default) in that gear (see _adapt), for the
//    map points inside the lean angles to work (a two-ended range; also dragged on the graph). A lap slider (1..20)
//    shows the map after N laps; Play animates it (0.25 s per lap), started when the tab opens, stopped by Stop or by
//    grabbing the lap slider.
// Force at the contact patch:  F [N] = M [Nm] × i_gear / r_tire_rr [m]   (i_gear = overall ratio crank -> rear wheel:
// primary × gearbox × rear / front sprocket; r_tire_rr = the ECU's rolling radius of the rear tyre, lean dependent).
(function () {
  const MODES = ['Rain', 'Int', 'Dry1', 'Dry2'];          // idx_mode_veh 1..4
  const TPD_MIN = 0;                                       // on the throttle only, as Simulation
  const GEARS = [1, 2, 3, 4, 5, 6];
  // colours from the All slip target maps scale (app.js MAP_COLORS); the map white
  const START_CURVE = 12;                                   // the Limit Setup curve the adaptation modifies by default
  const COL = { lim: '#ffffff', pre: '#00b0b7', req: '#0042e8', act: '#a40663', fx: '#6506a4', red: '#e2cf00', lean: '#9aa0b4' };
  const RED_MIN = 2;                                       // TC reduction [Nm] counted as "reducing" (md_req − md_tgt_dtc)
  const RED_SAMPLES = 5;                                   // a map point adapts on at least 5 reducing samples (50 ms) in its lean window
  const LAPS = 20, LAP_MS = 250;                           // simulated laps; animation: 0.25 s per lap
  const LEAN_DEF = [30, 70];                               // lean angles to work: |lean| from .. to [°]
  // adaptation parameters: [key, label, min, max, step, default, note next to the label, unit of the value field]
  const PARAMS = [
    ['margin', 'Target for adaptive', -10, 20, 1, 10, v => (v > 0 ? 'above the reduction' : v < 0 ? 'below the reduction' : 'at the reduction'), '%'],
    ['rate', 'Adaptation per lap', 0, 100, 1, 50, () => 'of the difference', '%'],
    ['step', 'Max. change per lap', 0, 1000, 10, 200, () => '', 'N'],
  ];
  const FONT = "700 10px 'Noto Sans', system-ui, sans-serif";
  const fmtN = v => Math.round(v).toLocaleString('en-US');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const median = a => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
  const setHTML = (el, html) => { if (el._html !== html) { el.innerHTML = html; el._html = html; } };   // no churn while animating
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
    <button class="switch arr-on" role="switch" aria-checked="true"><span class="material-icons" aria-hidden="true">toggle_on</span><span class="arr-on-t">Adaptation</span></button>
    <div class="sim-info"></div>
    <div class="arr-adapt">
      <div class="side-h arr-adapt-h">Limit adaptation</div>
      <div class="arr-ctl">
        <div class="lp-sub"><span class="side-sub">Lean angles to work</span><span class="lp-read" data-r="lean"></span><button class="reset-btn" data-reset="lean" title="Reset lean angles to work: ${LEAN_DEF[0]}–${LEAN_DEF[1]}°" aria-label="Reset lean angles to work" hidden><span class="material-icons" aria-hidden="true">restart_alt</span></button></div>
        <div class="arr-dual">
          <div class="arr-dual-track"><i class="arr-dual-fill"></i></div>
          <input type="range" data-l="lo" min="0" max="70" step="1" value="${LEAN_DEF[0]}" aria-label="Lean angles to work: from">
          <input type="range" data-l="hi" min="0" max="70" step="1" value="${LEAN_DEF[1]}" aria-label="Lean angles to work: to">
        </div>
      </div>
      ${PARAMS.map(([k, label, min, max, step, def]) => `
      <div class="arr-ctl">
        <div class="lp-sub"><span class="side-sub">${label}</span><span class="lp-read" data-r="${k}"></span><button class="reset-btn" data-reset="${k}" title="Reset ${label.toLowerCase()}: ${def}" aria-label="Reset ${label.toLowerCase()}" hidden><span class="material-icons" aria-hidden="true">restart_alt</span></button></div>
        <input type="range" class="lp-smooth-in" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${def}" aria-label="${label}">
      </div>`).join('')}
      <div class="arr-ctl arr-lapctl">
        <div class="lp-sub"><span class="side-sub">Simulated lap</span><span class="lp-read arr-lap-read"></span></div>
        <div class="arr-lap-row">
          <button class="ico-btn arr-play" aria-label="Stop"><span class="material-icons" aria-hidden="true">stop</span><span class="arr-play-t">Stop</span></button>
          <input type="range" class="lp-smooth-in arr-lap" min="0" max="${LAPS}" step="1" value="0" aria-label="Simulated lap">
        </div>
      </div>
    </div>`;
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
      <div class="sim-legend sim-legend-top arr-legend-f"></div>
      <div class="sim-plot"><canvas class="arr-top" role="img"></canvas></div>
    </div>`;

  class ArrView {
    // opts: { getLog, filters: () => logView.f, modeName: key -> name, riderLimit: () => D.riderLimit | null,
    //         onSample: button -> load the sample, onBrowse }
    constructor(el, opts) {
      this.el = el; this.o = opts;
      el.arrView = this;                                      // for checks from the console
      this.mode = null; this.gear = 1; this.sel = new Set([1]); this.autoGear = true;
      el.innerHTML = TEMPLATE;
      this.side = document.createElement('section');
      this.side.className = 'side-block sim-side arr-side';
      this.side.setAttribute('aria-label', 'Adaptive Rider Request selection');
      this.side.innerHTML = SIDE;
      // sliders: value fields + scale (range-ui.js)
      PARAMS.forEach(P => RangeUI.attach(this.side.querySelector(`input[data-p="${P[0]}"]`), { unit: P[7] }));
      RangeUI.attachDual(this.side.querySelector('input[data-l="lo"]'), this.side.querySelector('input[data-l="hi"]'), { unit: '°' });
      RangeUI.attach(this.side.querySelector('.arr-lap'), {});
      el.querySelector('.sim-body').appendChild(this.side.querySelector('.arr-lapctl'));   // the simulated lap: below the graph
      this.q = s => el.querySelector(s) || this.side.querySelector(s);
      this.top = new SimView.Plot(this.q('.arr-top'), -70);
      this.q('.sim-sample').onclick = e => opts.onSample(e.currentTarget);
      this.q('.sim-browse').onclick = () => opts.onBrowse();
      // gears: the second row of tabs (app.js leaves the clicks with data-k="arrGear" to this view)
      if (opts.subTabs) opts.subTabs.addEventListener('click', e => { const b = e.target.closest('button[data-k="arrGear"]'); if (b && !b.disabled && !el.hidden) this.setGear(+b.dataset.v); });
      // adaptation on / off, per gear (off: the gear keeps its dataset curve)
      this.off = new Set();
      this.q('.arr-on').onclick = () => { const g = this.gear; this.off.has(g) ? this.off.delete(g) : this.off.add(g); this.render(); };
      this.side.addEventListener('click', e => {
        const r = e.target.closest('.reset-btn[data-reset]'); if (!r) return;
        if (r.dataset.reset === 'mode') this.mode = null; else if (r.dataset.reset === 'gear') this.autoGear = true; else return;
        this.render();
      });
      this.hide = new Set();
      const toggle = it => { const k = it.dataset.k; this.hide.has(k) ? this.hide.delete(k) : this.hide.add(k); this.render(); };
      el.addEventListener('click', e => { const it = e.target.closest('.sim-legend-top [data-k]'); if (it) toggle(it); });
      el.addEventListener('keydown', e => { const it = e.target.closest('.sim-legend-top [data-k]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(it); } });
      // limit adaptation: parameters, simulated lap, play / stop
      this.p = Object.assign(Object.fromEntries(PARAMS.map(p => [p[0], p[5]])), { lo: LEAN_DEF[0], hi: LEAN_DEF[1] });
      this.lap = 0;                                          // lap 0: the original (dataset) map
      this.side.addEventListener('input', e => {
        const t = e.target, k = t.dataset && t.dataset.p, l = t.dataset && t.dataset.l;
        if (k) { this.p[k] = +t.value; this.render(); }
        else if (l) this._setLean(l, +t.value);
      });
      this.side.addEventListener('click', e => {
        const r = e.target.closest('.reset-btn[data-reset]'), P = r && PARAMS.find(p => p[0] === r.dataset.reset);
        if (P) { this.p[P[0]] = P[5]; this.render(); }
        else if (r && r.dataset.reset === 'lean') { this.p.lo = LEAN_DEF[0]; this.p.hi = LEAN_DEF[1]; this.render(); }
      });
      const lapIn = this.q('.arr-lap');
      const grab = () => this.stop();                         // grabbing the lap slider stops the animation
      lapIn.addEventListener('pointerdown', grab);
      lapIn.addEventListener('keydown', grab);
      lapIn.addEventListener('input', () => { this.stop(); this.lap = +lapIn.value; this.render(); });
      this.q('.arr-play').onclick = () => (this.timer ? this.stop() : this.play());
      this._bindDrag(this.q('.arr-top'), this.top);
      // the animation starts whenever the tab is shown (with a log) and stops while it is hidden
      new MutationObserver(() => { if (el.hidden) this.stop(); else if (this.o.getLog()) this.play(true); else this.render(); }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
      new ResizeObserver(() => { if (!el.hidden) this.render(); }).observe(el);
      window.addEventListener('resize', () => { if (!el.hidden) this.render(); });
    }

    // Play: one simulated lap every 0.25 s, 0 (the original map) -> 20, then again from lap 0; fromStart: restart at lap 0
    play(fromStart) {
      if (this.timer) { if (!fromStart) return; clearInterval(this.timer); }
      if (fromStart || this.lap >= LAPS) this.lap = 0;
      this.timer = setInterval(() => {
        if (this.el.hidden || !this.o.getLog()) { this.stop(); return; }
        this.lap = this.lap >= LAPS ? 0 : this.lap + 1;
        this.render();
      }, LAP_MS);
      this.render();
    }
    stop() {
      if (!this.timer) return;
      clearInterval(this.timer); this.timer = null;
      this._syncPlay();
    }
    _syncPlay() {
      const b = this.q('.arr-play'), on = !!this.timer;
      b.querySelector('.material-icons').textContent = on ? 'stop' : 'play_arrow';
      b.querySelector('.arr-play-t').textContent = on ? 'Stop' : 'Play';
      b.setAttribute('aria-label', on ? 'Stop' : 'Play');
    }

    // the lean angles to work: |lean| from .. to (the two ends never cross)
    _setLean(which, v) {
      v = clamp(Math.round(v), 0, 70);
      if (which === 'lo') v = Math.min(v, this.p.hi); else v = Math.max(v, this.p.lo);
      if (this.p[which] === v) { this._syncAdapt(this.ad); return; }
      this.p[which] = v; this.render();
    }
    // the ends of the lean angles to work as vertical lines at ±from / ±to on the graph: dragged left / right
    _bindDrag(cv, plot) {
      const at = e => e.clientX - cv.getBoundingClientRect().left;
      const which = x => {
        const g = plot.g; if (!g) return null;
        let best = null, bd = 9;
        [['lo', this.p.lo], ['hi', this.p.hi]].forEach(([k, v]) => [-1, 1].forEach(sg => { const dd = Math.abs(x - g.px(sg * v)); if (dd < bd || (dd === bd && k === 'hi' && v >= 35)) { bd = dd; best = k; } }));
        return best;
      };
      cv.addEventListener('pointerdown', e => {
        const w = which(at(e)); if (e.button > 0 || !w) return;
        e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        this.drag = { id: e.pointerId, w };
      });
      cv.addEventListener('pointermove', e => {
        const x = at(e);
        if (!this.drag || this.drag.id !== e.pointerId) { cv.style.cursor = which(x) ? 'ew-resize' : ''; return; }
        this._setLean(this.drag.w, Math.abs(plot.g.ix(x)));
      });
      const end = e => { if (this.drag && this.drag.id === e.pointerId) { this.drag = null; cv.style.cursor = ''; } };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
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
    setGear(g) {
      if (g === this.gear && !this.autoGear) return;
      this.autoGear = false; this.sel = new Set([g]); this.gear = g; this.render();
    }
    key(e) {
      const d = this.o.getLog(); if (!d) return false;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const gs = this.gears || GEARS, i = gs.indexOf(this.gear), g = gs[clamp(i + (e.key === 'ArrowUp' ? -1 : 1), 0, gs.length - 1)];
        this.autoGear = false; this.sel = new Set([g]); this.gear = g; this.render(); return true;
      }
      return false;
    }
    curMode(d) { return this.loggedMode(d); }               // no riding mode picker: the logged one

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
      this.F = { req: conv(d.mdReq), act: conv(d.mdAct), pre: conv(d.mdPre), red: conv(d.red), preMax, conv };   // red: the DTC reduction (md_req − md_tgt_dtc) as a force
      this.fFor = d;
      return this.F;
    }
    // the graph's forces with the Torque smoothing of the left column (f.mdSmooth samples): md_req and md_act are smoothed,
    // then converted; fx_rear_calc is smoothed the same way so it stays comparable. The logged limit uses
    // the logged values.
    _smoothed(d) {
      const k = Math.max(1, Math.round(this.o.filters().mdSmooth || 1)), F = this._forces(d);
      if (this.sFor === d && this.sK === k) return this.S;
      const mdReq = smooth(d.mdReq, k), mdAct = smooth(d.mdAct, k);
      this.S = k <= 1 ? { req: F.req, act: F.act, fx: d.fxCalc, mdReq, mdAct }
        : { req: F.conv(mdReq), act: F.conv(mdAct), fx: smooth(d.fxCalc, k), mdReq, mdAct };
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
        this.gear = this.gears.includes(2) ? 2 : this.gears.reduce((a, g) => (this.counts[g] > this.counts[a] ? g : a), this.gears[0]);   // 2nd gear by default
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
    // The adaptation starts from Limit Setup curve 12 (dem_scale_select 12) in every mode and gear, if the dataset has it.
    curveNo(mode, g) {
      const RL = this.o.riderLimit();
      if (RL && RL.curves.length >= START_CURVE) return START_CURVE;
      return RL && RL.select[mode] ? RL.select[mode][g - 1] : null;
    }
    curve(no) { const RL = this.o.riderLimit(); return RL && no >= 1 && no <= RL.curves.length ? RL.curves[no - 1] : null; }

    _syncPickers(d) {
      const mode = this.curMode(d);
      const st = this.o.subTabs;
      if (st && !this.el.hidden) {
        st.setAttribute('aria-label', 'Gears');
        setHTML(st, GEARS.map(g => {
          const have = this.gears.includes(g), no = this.curveNo(mode, g);
          return `<button role="tab" data-k="arrGear" data-v="${g}" aria-selected="${g === this.gear}"${have ? '' : ' disabled'}` +
            ` title="${have ? `Gear ${g} · its own map, starting from Limit Setup curve ${no ?? '–'}${this.off.has(g) ? ' · adaptation off' : ''}` : `Gear ${g} is not used in the corners of this log`}">` +
            `Gear ${g}${this.off.has(g) ? ' <span class="arr-tab-off">off</span>' : ''}</button>`;
        }).join(''));
      }
      const on = !this.off.has(this.gear), sw = this.q('.arr-on');
      sw.setAttribute('aria-checked', on);
      sw.title = `Adaptation in gear ${this.gear} on / off (off: the gear keeps its dataset curve)`;
      sw.querySelector('.material-icons').textContent = on ? 'toggle_on' : 'toggle_off';
      sw.querySelector('.arr-on-t').textContent = `Adaptation in gear ${this.gear}`;
    }

    // ---- limit adaptation --------------------------------------------------
    // Every gear has its own map: it starts from the gear's dataset curve (dem_scale_select) and adapts only to the data of
    // that gear. Input: the selected time section of the log (the best lap by default, log-panel.js), every corner, on the
    // throttle; every simulated lap reuses it. Per map point j (lean window: half-way to the neighbouring points, |lean|)
    // the reduction force = median actual force (md_act × i / r, torque smoothing applied) while the TC reduces
    // (md_req − md_tgt_dtc > 2 Nm), with at least 5 such samples. Then, for each point inside the lean angles to work:
    // target = reduction force × (1 + target %)  (no reduction: the dataset value);
    // new = old + clamp(rate × (target − old), ±max. change).  Points above the highest one with data (high lean, no
    // reduction there) take that point's new value. Points outside the lean angles to work keep the dataset value.
    _adapt(d, RL, cv) {
      const S = this._smoothed(d), p = this.p, f = this.o.filters();
      const off = this.off.has(cv.g);
      const key = [cv.g, off, cv.no, S.k, f.t0, f.t1, p.lo, p.hi, p.margin, p.rate, p.step, cv.row.join()].join('|');
      if (this.adFor === d && this.adKey === key) return this.ad;
      const L = RL.lean, n = L.length, win = L.map((l, j) => [j ? (L[j - 1] + l) / 2 : 0, j < n - 1 ? (l + L[j + 1]) / 2 : 90]);
      const gc = this.gearCh(d), red = i => (d.red ? d.red[i] : d.mdReq[i] - d.mdAct[i]);
      const v = L.map(() => []);
      for (let i = Math.max(0, Math.floor(f.t0 * d.rate)); i < Math.min(d.n, Math.ceil(f.t1 * d.rate)); i++) {
        if ((gc && Math.round(gc[i]) !== cv.g) || (d.tpd && d.tpd[i] <= TPD_MIN) || !(red(i) > RED_MIN) || !Number.isFinite(S.act[i])) continue;
        const x = Math.abs(d.lean[i]), j = win.findIndex(([a, b]) => x >= a && x < b);
        if (j >= 0) v[j].push(S.act[i]);
      }
      const fr = v.map(a => (a.length >= RED_SAMPLES ? median(a) : null));
      const on = j => !off && L[j] >= p.lo && L[j] <= p.hi;   // adaptation off: every point keeps the dataset value
      let last = -1; fr.forEach((v, j) => { if (v != null && on(j)) last = j; });
      const base = cv.row, maps = [base.slice()];
      let cur = base.slice();
      for (let k = 1; k <= LAPS; k++) {
        cur = cur.map((val, j) => {
          if (!on(j)) return base[j];
          const t = fr[j] != null ? fr[j] * (1 + p.margin / 100) : base[j];
          return Math.round(val + clamp(p.rate / 100 * (t - val), -p.step, p.step));
        });
        // high lean without data: the points above the highest one with data follow that point's value
        if (last >= 0) for (let j = last + 1; j < n; j++) if (on(j)) cur[j] = cur[last];
        maps.push(cur);
      }
      const lap = d.laps.find(l => Math.abs(l.a - f.t0) < 0.05 && Math.abs(l.b - f.t1) < 0.05);
      this.ad = { maps, fr, on, off, src: lap ? lap.name : 'the selected time section' }; this.adFor = d; this.adKey = key;
      return this.ad;
    }

    // the adaptation controls follow this.p / this.lap (sliders, readouts, reset icons, play button)
    _syncAdapt(ad) {
      PARAMS.forEach(([k, , , , , def, fmt]) => {
        const inp = this.side.querySelector(`input[data-p="${k}"]`);
        if (+inp.value !== this.p[k]) inp.value = this.p[k];
        this.side.querySelector(`[data-r="${k}"]`).textContent = fmt(this.p[k]);
        this.side.querySelector(`.reset-btn[data-reset="${k}"]`).hidden = this.p[k] === def;
      });
      const { lo, hi } = this.p, iLo = this.side.querySelector('input[data-l="lo"]'), iHi = this.side.querySelector('input[data-l="hi"]');
      if (+iLo.value !== lo) iLo.value = lo;
      if (+iHi.value !== hi) iHi.value = hi;
      iLo.style.zIndex = lo > 35 ? 3 : '';                    // both ends at the top: the "from" thumb stays reachable
      const fill = this.side.querySelector('.arr-dual-fill');
      fill.style.setProperty('--a', lo / 70); fill.style.setProperty('--b', hi / 70);   // thumb centres: 8 px .. width − 8 px
      this.side.querySelector('[data-r="lean"]').textContent = '|lean|, both sides';
      this.side.querySelector('.reset-btn[data-reset="lean"]').hidden = lo === LEAN_DEF[0] && hi === LEAN_DEF[1];
      const lapIn = this.q('.arr-lap');
      if (+lapIn.value !== this.lap) lapIn.value = this.lap;
      this.q('.arr-lap-read').textContent = `of ${LAPS}` + (ad ? ` · data: ${ad.src}` : '');
      this.q('.arr-adapt').classList.toggle('is-off', !ad || ad.off);
      this._syncPlay();
    }

    render() {
      const d = this.o.getLog();
      this.q('.sim-empty').hidden = !!d;
      this.q('.sim-body').hidden = !d;
      this.side.classList.toggle('is-off', !d);
      if (!d) {
        this.q('.sim-info').textContent = 'Add MoTeC data to compare.'; this.stop();
        if (!this.el.hidden && !this.autoLoaded) { this.autoLoaded = true; this.o.onSample(this.q('.sim-sample')); }   // no log: load the sample
        return;
      }
      if (this.playedFor !== d) { this.playedFor = d; if (!this.el.hidden && !this.timer) { this.play(true); return; } }   // a new log: animate
      this._gears(d);
      this._syncPickers(d);
      const mode = this.curMode(d), RL = this.o.riderLimit(), F = this._forces(d), p = this.p;
      const H = k => this.hide.has(k);
      const item = (k, html, off) => `<span data-k="${k}" role="button" tabindex="0" class="${H(k) || off ? 'is-off' : ''}" aria-pressed="${!H(k)}" title="${off ? 'Not in this log' : 'Click to hide / show'}">${html}</span>`;
      const runs = this._select(d, g => this.sel.has(g)), all = runs.flat();
      const selG = [...this.sel].sort((a, b) => a - b);
      const x = i => d.lean[i];                                 // signed lean: −70° (left) … +70° (right)
      // one map per gear: the gear clicked last first (adapted, bold); other selected gears: their dataset curve, thin
      const curves = [this.gear, ...selG.filter(g => g !== this.gear)].map(g => { const no = this.curveNo(mode, g); return { no, g, row: this.curve(no) }; });
      const cv0 = curves[0];
      const missing = !F.act ? 'This log has no md_act / i_gear / r_tire_rr: the force cannot be calculated.' : '';
      this.q(".sim-info").textContent = missing; this.q(".sim-info").hidden = !missing;   // only a missing-channel warning, no description
      const S = this._smoothed(d);
      const ad = cv0.row ? this._adapt(d, RL, cv0) : null, adRow = ad ? ad.maps[this.lap] : null;
      this._syncAdapt(ad);
      this.q('.arr-h-top').textContent = `· ${this.o.modeName(mode)} #${this.gear} · map of gear ${this.gear}` +
        (cv0.row ? ` (from curve ${cv0.no})` + (ad.off ? ' · adaptation off' : (this.lap ? ` · after lap ${this.lap}` : " · lap 0: the original map")) : cv0.no ? ` · curve ${cv0.no}: library curve in the ECU dataset, values not in the file` : ' · no Limit Setup in this dataset');

      // value axis: the same for every gear (and every lap / legend toggle): up to the highest dataset curve of any gear
      // and the forces of the selection in all gears, in steps of 1000 N
      const f = this.o.filters(), yKey = [mode, S.k, f.t0, f.t1, [...f.corners].sort().join()].join('|');
      if (this.yFor !== d || this.yKey !== yKey) {
        let top = 0;
        GEARS.forEach(g => { const row = this.curve(this.curveNo(mode, g)); if (row) top = Math.max(top, ...row); });
        const every = this._select(d, () => true).flat();
        ['req', 'act', 'fx'].map(k => S[k]).filter(Boolean).forEach(a => { const v = pct(every.map(i => a[i]).filter(Number.isFinite), 0.995); if (v > top) top = v; });
        if (F.pre) every.forEach(i => { if (d.mdPre[i] < F.preMax - 0.5 && F.pre[i] > top) top = F.pre[i]; });
        this.yMax = clamp(Math.ceil((top || 4000) * 1.05 / 1000) * 1000, 2000, 12000); this.yFor = d; this.yKey = yKey;
      }
      const Y = { min: 0, max: this.yMax, major: 500, label: 1000, minor: 100, fmt: v => fmtN(v) + ' N' };

      // shared drawing: the curve over −70 … +70 (mirrored, |lean|), the lean angles to work, their handles
      const curvePath = (c, gr, row) => { c.beginPath(); for (let lx = -70; lx <= 70; lx += 0.5) { const X = gr.px(lx), Yv = gr.py(limitAt(RL.lean, row, Math.abs(lx))); lx === -70 ? c.moveTo(X, Yv) : c.lineTo(X, Yv); } };
      const zone = (c, gr) => {
        c.fillStyle = '#000000'; c.globalAlpha = 0.5;
        // shaded: the lean angles the adaptation ignores (|lean| below "from" and above "to")
        const band = (l0, l1) => { if (l1 <= l0) return; const a = gr.px(l0), b = gr.px(l1); c.fillRect(Math.min(a, b), gr.y0, Math.abs(b - a), gr.y1 - gr.y0); };
        band(-p.lo, p.lo); band(-70, -p.hi); band(p.hi, 70);
        c.globalAlpha = 1;
      };
      const handles = (c, gr) => {
        c.save(); c.font = FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
        [p.lo, p.hi].forEach(v => [-1, 1].forEach(sg => {
          if (v === 0 && sg < 0) return;
          const X = Math.round(gr.px(sg * v)) + 0.5;
          c.strokeStyle = COL.lim; c.lineWidth = 2; c.beginPath(); c.moveTo(X, gr.y0); c.lineTo(X, gr.y1); c.stroke();
          c.fillStyle = COL.lim; c.beginPath(); c.roundRect ? c.roundRect(X - 18, gr.y0 + 2, 36, 16, 4) : c.rect(X - 18, gr.y0 + 2, 36, 16); c.fill();
          c.fillStyle = '#0c0c12'; c.fillText(`${sg < 0 && v ? '−' : ''}${v}°`, X, gr.y0 + 10.5);
        }));
        c.restore();
      };
      const dashed = (c, gr, row) => { curvePath(c, gr, row); c.strokeStyle = '#ffffff'; c.globalAlpha = 0.7; c.lineWidth = 2; c.setLineDash([3, 4]); c.stroke(); c.setLineDash([]); c.globalAlpha = 1; };

      // ---- the graph: every sample of the selection and the adapted map after this.lap laps ----
      // the graph fills the window down to the simulated lap control below it, which stays visible
      const lapCtl = this.q('.arr-lapctl'), below = lapCtl ? lapCtl.offsetHeight + 12 : 0;
      const h = Math.max(320, Math.round(window.innerHeight - (this.q('.arr-top').parentNode.getBoundingClientRect().top + window.scrollY) - 16 - below));
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
      if (adRow && cv0.row && !H('lim')) {                       // the change so far: between the original and the adapted map
        c.beginPath();
        for (let lx = -70; lx <= 70; lx += 0.5) { const X = gr.px(lx), Yv = gr.py(limitAt(RL.lean, adRow, Math.abs(lx))); lx === -70 ? c.moveTo(X, Yv) : c.lineTo(X, Yv); }
        for (let lx = 70; lx >= -70; lx -= 0.5) c.lineTo(gr.px(lx), gr.py(limitAt(RL.lean, cv0.row, Math.abs(lx))));
        c.closePath(); c.fillStyle = '#ffffff'; c.globalAlpha = 0.1; c.fill('evenodd'); c.globalAlpha = 1;
      }
      if (!H('fx') && S.fx) pts(S.fx, COL.fx, 2, 0.45);
      if (!H('act') && S.act) lines(S.act, COL.act, 2, 0.75);
      if (!H('req') && S.req) lines(S.req, COL.req, 2, 0.75);
      if (!H('pre') && F.pre) pts(F.pre, COL.pre, 4, 0.9, i => d.mdPre[i] < F.preMax - 0.5);   // only where it limits
      if (!H('red') && F.red) {                                  // DTC reduction: dots joined while the TC keeps reducing
        const on = i => d.red[i] > RED_MIN && Number.isFinite(F.red[i]);
        c.globalAlpha = 0.85; c.strokeStyle = COL.red; c.lineWidth = 2; c.lineJoin = 'round';
        runs.forEach(run => { c.beginPath(); let pen = false;
          run.forEach(i => { if (!on(i)) { pen = false; return; } const X = gr.px(x(i)), Y = gr.py(F.red[i]); pen ? c.lineTo(X, Y) : c.moveTo(X, Y); pen = true; });
          c.stroke(); });
        c.globalAlpha = 1;
        pts(F.red, COL.red, 3, 0.85, on);
      }    // DTC reduction [N], where the TC reduces
      zone(c, gr);                                               // ignored lean angles: darkens the logged data too
      curves.slice(1).forEach(cv => {                            // other selected gears' maps (dataset curve): thin dashed
        if (!cv.row || H('lim')) return;
        curvePath(c, gr, cv.row); c.strokeStyle = COL.lim; c.lineWidth = 2; c.setLineDash([6, 4]); c.stroke(); c.setLineDash([]);
      });
      if (cv0.row && !H('base')) dashed(c, gr, cv0.row);
      if (ad && !ad.off && !H('steps')) {                         // the maps after the earlier laps: dotted, older ones fainter
        for (let k = 1; k < this.lap; k++) {
          curvePath(c, gr, ad.maps[k]); c.strokeStyle = COL.lim; c.lineWidth = 2; c.lineJoin = 'round';
          c.globalAlpha = 0.25 + 0.5 * k / this.lap; c.setLineDash([1.5, 3]); c.stroke();
        }
        c.setLineDash([]); c.globalAlpha = 1;
      }
      if (adRow && !H('lim')) {                                  // the adapted map after this.lap laps: bold, its points
        curvePath(c, gr, adRow); c.strokeStyle = COL.lim; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
        RL.lean.forEach((lx, j) => [-1, 1].forEach(sg => {
          c.beginPath(); c.arc(gr.px(sg * lx), gr.py(adRow[j]), 4, 0, Math.PI * 2); c.fillStyle = ad.on(j) ? '#ffffff' : '#0c0c12'; c.fill();
          c.lineWidth = 2; c.strokeStyle = COL.lim; c.stroke();
        }));
      }
      this.top.end();
      if (adRow && !H('lim')) {                                  // values above the adapted points inside the lean angles to work
        c.font = FONT; c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
        RL.lean.forEach((lx, j) => { if (ad.on(j)) [-1, 1].forEach(sg => { const Yv = gr.py(adRow[j]); c.fillText(fmtN(adRow[j]), gr.px(sg * lx), Yv - 14 < gr.y0 + 20 ? Yv + 14 : Yv - 14); }); });
      }
      handles(c, gr);
      if (!H('lim')) curves.forEach((cv, k) => { const row = k === 0 ? adRow : cv.row; if (row) this.top.rightLabel(k === 0 ? `#${cv.g}${ad && ad.off ? ' · off' : ` · lap ${this.lap}`}` : `#${cv.g}`, gr.py(limitAt(RL.lean, row, 70)) + k * 19, COL.lim, k === 0, 17); });

      setHTML(this.q('.arr-legend-f'),
        item('lim', `<i class="sim-sw arr-sw-lim"></i>Map of gear ${this.gear} ${ad && ad.off ? '(adaptation off)' : (this.lap ? `after lap ${this.lap} (adapted)` : "· lap 0, the original map")}`, !cv0.row) +
        item('steps', `<i class="sim-sw arr-sw-step"></i>After each earlier lap`, !ad || ad.off || this.lap < 2) +
        item('base', `<i class="sim-sw arr-sw-base"></i>Curve ${cv0.no ?? '–'} in the dataset`, !cv0.row) +
        item('red', `<i class="sim-sw arr-sw-ptln" style="--c:${COL.red}"></i>DTC reduction · (md_req − md_tgt_dtc) × i / r`, !F.red) +
        item('pre', `<i class="sim-sw arr-sw-pts" style="--c:${COL.pre}"></i>Logged limit · md_tgt_prectrl × i / r, where it limits`, !F.pre) +
        item('req', `<i class="sim-sw arr-sw-ln" style="--c:${COL.req}"></i>Request · md_req × i / r`, !F.req) +
        item('act', `<i class="sim-sw arr-sw-ln" style="--c:${COL.act}"></i>Actual · md_act × i / r`, !F.act) +
        item('fx', `<i class="sim-sw arr-sw-pts" style="--c:${COL.fx}"></i>fx_rear_calc (logged)`, !d.fxCalc) +
        `<span class="arr-sm">${S.k > 1 ? `Request, actual and fx_rear_calc smoothed over ${S.k} samples` : 'Not smoothed'}</span>`);
      this.q('.arr-top').setAttribute('aria-label', `Rear wheel force over lean angle, gear ${selG.join(', ')}, with the adapted map of gear ${this.gear}`);
    }
  }

  window.ArrView = ArrView;
})();
