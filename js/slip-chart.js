// SlipChart — interactive 2D slip-target curve editor (lean angle vs slip).
// Renders into any sized container; typography keeps the reference sizes at
// ~600px wide and scales gently between 360px and 1200px+.
(function () {
  const C = {
    bg: '#0c0c12',
    blue: '#3f8ce8',               // default graph colour (same as G5)
    grid: '#ffffff',
    text: '#ffffff',
    log: '#545459',
    danger: '#d73526',
    // Compare mode: one colour per gear (G1..G6); a map takes the colour of the lowest gear using it
    gears: ['#9c1f62', '#d9354b', '#e5a634', '#3fa8a4', '#3f8ce8', '#3346e0'],
  };
  const X_MAX = 70, X_MIN = 0, Y_MAX = 20, SLIP_MAX = 25.5;   // axis 0..20 %, grows (whole %) when a value is higher; values up to 25.5 %
  const NS = 'http://www.w3.org/2000/svg';
  const FADE = 0.5;                     // opacity of non-hovered curves while previewing another one
  let uidSeq = 0;

  const fmtPct = v => (Math.round(v * 10) % 10 === 0 ? Math.round(v) : v.toFixed(1)) + '%';
  const fmtDeg = v => (Math.round(v * 10) % 10 === 0 ? Math.round(v) : v.toFixed(1)) + '°';
  const fmtMu = m => 'μ ' + m.toFixed(2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (x, x0, x1, y0, y1) => y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  const r1 = v => Math.round(v * 10) / 10;
  // Google Material Symbols (Outlined) glyph, drawn as SVG text via the icon font's ligatures.
  const icon = (name, x, y, size, color) =>
    `<text class="mi" x="${Math.round(x * 100) / 100}" y="${Math.round(y * 100) / 100}" font-size="${size}" fill="${color}" text-anchor="middle" dominant-baseline="central">${name}</text>`;

  // Smooth lines: monotone cubic (Fritsch–Carlson) through the target points. Rounds the
  // corners without overshooting, so a curve never goes above / below its neighbouring points.
  function monoSlopes(xs, ys) {
    const n = xs.length, d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    if (n < 2) return m;
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return m;
  }
  // Curve as [lean, value] points: the target points (straight) or a dense sampling (smooth).
  function curvePoints(lean, vals, smooth, per = 16) {
    if (!smooth || lean.length < 3) return lean.map((x, i) => [x, vals[i]]);
    const xs = lean.map(x => -x), m = monoSlopes(xs, vals), out = [];   // x must increase: use -lean
    for (let i = 0; i < xs.length - 1; i++) {
      const h = xs[i + 1] - xs[i];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        const y = (2 * t3 - 3 * t2 + 1) * vals[i] + (t3 - 2 * t2 + t) * h * m[i] +
          (-2 * t3 + 3 * t2) * vals[i + 1] + (t3 - t2) * h * m[i + 1];
        out.push([-(xs[i] + t * h), y]);
      }
    }
    out.push([lean[lean.length - 1], vals[vals.length - 1]]);
    return out;
  }
  // Value of the (straight or smooth) curve at a lean angle inside segment j.
  function curveAt(lean, vals, smooth, j, x) {
    if (!smooth || lean.length < 3) return lerp(x, lean[j], lean[j + 1], vals[j], vals[j + 1]);
    const xs = lean.map(v => -v), m = monoSlopes(xs, vals), h = xs[j + 1] - xs[j], t = (-x - xs[j]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * vals[j] + (t3 - 2 * t2 + t) * h * m[j] + (-2 * t3 + 3 * t2) * vals[j + 1] + (t3 - t2) * h * m[j + 1];
  }

  // Distance from P to segment AB, plus the projection parameter u in [0,1].
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const u = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return { d: Math.hypot(px - ax - u * dx, py - ay - u * dy), u };
  }

  class SlipChart {
    constructor(el, opts) {
      this.el = el;
      this.o = Object.assign({
        targetIndex: 0, muIndex: 3, showLog: false, alloc: null, compare: false,
        editable: true, hover: null,
        onEditStart() {}, onChange() {}, onSelectMu() {}, onSelectTarget() {}, onPick() {},
        onInsert() {}, onDelete() {}, onEmptyClick() {},
      }, opts);
      this.uid = 'sc' + (++uidSeq);
      this.hv = this.o.hover != null ? { type: 'point', i: this.o.hover } : null;
      this.sel = null;                  // point index showing the delete button
      this.drag = null;
      this.focusIdx = null;
      this.svg = document.createElementNS(NS, 'svg');
      this.svg.setAttribute('class', 'slip-chart');
      this.svg.setAttribute('role', 'application');
      this.svg.setAttribute('aria-label', 'Slip target editor: slip [%] over lean angle [deg]');
      this.tip = document.createElement('div');
      this.tip.className = 'slip-tip';
      this.tip.setAttribute('role', 'tooltip');
      el.append(this.svg, this.tip);
      this._bind();
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(el);
    }

    set(patch) {
      if ('targetIndex' in patch && patch.targetIndex !== this.o.targetIndex) this.sel = null;
      Object.assign(this.o, patch);
      this.render();
    }
    // Highlight one of the other curves from outside (e.g. hovering a list), or clear with null.
    preview(key) {
      const curve = key && this.curves && this.curves.list.find(c => c.key === key);
      const next = curve ? { type: 'curve', key, curve } : null;
      if (this._sameHit(next, this.hv)) return;
      this.hv = next;
      this.render();
    }

    get target() { return this.o.targets[this.o.targetIndex]; }
    get vals() { return this.target.rows[this.o.muIndex]; }

    // ---- geometry -------------------------------------------------------
    _layout(labelChars = 6) {
      const W = Math.max(280, this.el.clientWidth);
      const H = Math.max(240, this.el.clientHeight || W * 0.93);
      const s = clamp(W / 600, 0.9, 1.3);
      const lfs = (this.o.compare || this.o.labelChars ? 10 : 9.5) * s;   // labelChars: fixed label room, same plot on every view
      const pad = { l: 40 * s, r: Math.max(46 * s, 14 * s + labelChars * lfs * 0.62), t: 26 * s, b: 30 * s };
      const g = { W, H, s, x0: pad.l, x1: W - pad.r, y0: pad.t, y1: H - pad.b };
      g.px = x => g.x0 + (X_MAX - x) / (X_MAX - X_MIN) * (g.x1 - g.x0);
      g.yMax = this.yMax || Y_MAX;
      g.py = y => g.y1 - y / g.yMax * (g.y1 - g.y0);
      g.ix = px => X_MAX - (px - g.x0) / (g.x1 - g.x0) * (X_MAX - X_MIN);
      g.iy = py => (g.y1 - py) / (g.y1 - g.y0) * g.yMax;
      g.xStep = (g.x1 - g.x0) / 14 >= 26 * s ? 5 : 10;
      g.yStep = (g.y1 - g.y0) / g.yMax >= 13 * s ? 1 : 2;
      g.minorX = (g.x1 - g.x0) / 70 >= 4;        // 1 deg minor lines if >= 4px apart
      g.minorY = (g.y1 - g.y0) / (g.yMax * 5) >= 3.5;     // 0.2 % minor lines
      return g;
    }

    // Curves other than the one being edited, for the current mode.
    _curves() {
      const t = this.target, mi = this.o.muIndex;
      const list = [];
      // In a calculated μ mode (mu-lines.js) the sub levels between μ 1.00 and max / min are
      // calculated (this.o.lockedRows) and cannot be selected; the anchor rows can.
      const locked = this.o.lockedRows || [];
      const isLocked = i => locked.includes(i);
      const muTip = (m, i) => (isLocked(i)
        ? `${fmtMu(m)} is calculated from μ 1.00 and the max / min level (degression)`
        : `Click to edit the ${fmtMu(m)} row`);
      // Default mode is always blue; gear colours are used in compare mode only.
      const alloc = this.o.alloc || [];
      const mapColor = this.o.activeColor || C.blue;
      let active = { key: 'active', color: mapColor, label: this.o.activeLabel || fmtMu(this.o.muRows[mi]) };
      if (!this.o.compare) {
        if (!this.o.rowsHidden) this.o.muRows.forEach((m, i) => {
          if (i === mi) return;
          list.push({ key: 'mu' + i, mu: i, lean: t.lean, vals: t.rows[i], color: mapColor,
            label: fmtMu(m), tip: muTip(m, i), locked: isLocked(i),
            dotted: isLocked(i), points: !isLocked(i) });   // calculated: dotted / editable: 6px circles
        });
        // Read-only preview curves (e.g. user offset steps), dashed, with their own labels.
        const smOf = id => { const x = this.o.targets.find(tt => tt.id === id); return x ? !!x.smooth : !!t.smooth; };
        (this.o.overlays || []).forEach(ov => list.push(Object.assign({ locked: true, dotted: true, smooth: smOf(ov.target) }, ov)));
      } else {
        // Compared series: by default one per gear (from alloc); callers can pass their own
        // `series` [{ id: map, name, color, desc }] (e.g. the 4 vehicle modes of one gear).
        // Series sharing a map share one curve, coloured by the first of them.
        const series = this.o.series || alloc.map((id, gi) => ({ id, name: '#' + (gi + 1), desc: 'Gear ' + (gi + 1), color: C.gears[gi] }));
        const groups = [];
        series.forEach((sr, si) => {
          const hit = groups.find(gr => gr.id === sr.id);
          if (hit) hit.items.push(sr); else groups.push({ id: sr.id, order: si, items: [sr], color: sr.color });
        });
        active = null;
        groups.forEach(gr => {
          const label = gr.items.map(x => x.name).join(', ');
          const descTxt = gr.items.map(x => x.desc).join(', ');
          if (gr.id === t.id && !this.o.noActive) { active = { key: 'active', color: gr.color, label, gradient: true }; return; }
          const ct = this.o.targets.find(x => x.id === gr.id);
          list.push({ key: 't' + gr.id, target: gr.id, order: gr.order, lean: ct.lean, vals: ct.rows[mi], smooth: !!ct.smooth, color: gr.color,
            label, gradient: true, tip: `Click to edit Map ${gr.id} (${descTxt})` });
        });
        // Draw later series first so the first ones (lower gear numbers) end up on top.
        list.sort((a, b) => b.order - a.order);
        if (!active) active = { key: 'active', color: C.blue, label: 'M' + t.id };
        // Other mu rows of the edited map: dotted 1px, unlabelled, drawn below the gear curves.
        if (!this.o.muHidden && !this.o.noActive) this.o.muRows.forEach((m, i) => {
          if (i === mi) return;
          list.unshift({ key: 'mu' + i, mu: i, lean: t.lean, vals: t.rows[i], color: active.color,
            dotted: true, tip: muTip(m, i), locked: isLocked(i),
            // μ 1.00 stays labelled (clickable) while another level is selected; with MoTeC data (soloActive) every level is
            label: m === 1 || this.o.soloActive ? fmtMu(m) : undefined });
        });
        if (this.o.soloActive) active.label += ' · ' + fmtMu(this.o.muRows[mi]);   // the bold line among the μ labels
      }
      Object.assign(active, { lean: t.lean, vals: this.o.activeVals || t.rows[mi], gradient: true });   // activeVals: read-only stand-in (e.g. a selected +- level)
      // soloActive (a map is selected while MoTeC data is shown): the other maps' lines and labels are hidden
      return { list: this.o.soloActive ? list.filter(c => c.target == null) : list, active };
    }

    // ---- render ---------------------------------------------------------
    render() {
      // Curves first: the right margin grows to fit the longest right-hand label.
      const { list, active } = this.curves = this._curves();
      // Y axis: 0..20 %, or up to the highest value (whole %) when a curve goes above 20 %
      const top = Math.max(0, ...list.concat(active).filter(c => c.vals).map(c => Math.max(...c.vals)));
      this.yMax = Math.max(Y_MAX, Math.ceil(top - 1e-9));
      const longest = Math.max(0, ...list.filter(c => c.label).map(c => c.label.length), (active.label || '').length);
      const g = this.g = this._layout(this.o.labelChars ? Math.max(longest, this.o.labelChars) : longest);
      const { s } = g;
      const t = this.target, mi = this.o.muIndex, mu = this.o.muRows[mi];
      const ac = active.color;
      const hv = this.hv;
      const previewKey = hv && hv.type === 'curve' && !hv.curve.locked ? hv.key : null;
      // Hover transitions: the SVG is rebuilt on each change, so elements are first
      // written in the previous visual state (prev) and switched to the new one after
      // a style flush — CSS transitions then animate the difference.
      const prev = this._vis || { fade: null, big: [], cross: false, add: false, del: false };
      const op = key => (prev.fade && key !== prev.fade ? FADE : 1);
      const fx = key => `data-fk="${key}" style="opacity:${op(key)}"`;
      // curves / labels with their own base opacity (e.g. background maps 25 %, names 50 %); the hovered one is full
      const fxa = (key, a) => `data-fk="${key}" data-a="${a}" style="opacity:${prev.fade === key ? 1 : op(key) * a}"`;
      const out = [];
      const f = n => Math.round(n * 100) / 100;
      const id = this.uid;

      this.svg.setAttribute('viewBox', `0 0 ${f(g.W)} ${f(g.H)}`);
      this.svg.setAttribute('width', g.W);
      this.svg.setAttribute('height', g.H);

      // Grid: dotted 1px dots, major 30 % opacity, 2px gaps (5 deg / 1 %), minor 15 %, 3px gaps (1 deg / 0.2 %)
      // Lines sit on pixel centres so every 1px dot renders crisp instead of blurring over 2px.
      const pc = v => Math.round(v - 0.5) + 0.5;
      let major = '', minor = '';
      for (let x = X_MAX; x >= X_MIN; x--) {
        const d = `M${pc(g.px(x))} ${pc(g.y0)}V${pc(g.y1)}`;
        if (x % 5 === 0) major += d; else if (g.minorX) minor += d;
      }
      for (let k = 0; k <= g.yMax * 5; k++) {
        const d = `M${pc(g.x0)} ${pc(g.py(k / 5))}H${pc(g.x1)}`;
        if (k % 5 === 0) major += d; else if (g.minorY) minor += d;
      }
      out.push(`<defs><clipPath id="${id}-plot"><rect x="${f(g.x0)}" y="${f(g.y0 - 1)}" width="${f(g.x1 - g.x0)}" height="${f(g.y1 - g.y0 + 1)}"/></clipPath></defs>`);
      out.push(`<g fill="none" stroke="${C.grid}" stroke-width="1">` +
        `<path d="${minor}" stroke-dasharray="1 3" stroke-opacity=".15"/>` +
        `<path d="${major}" stroke-dasharray="1 2" stroke-opacity=".3"/></g>`);

      // Axis labels
      const axisFs = 10 * s;
      for (let y = 0; y <= g.yMax; y += g.yStep)
        out.push(`<text class="ax" x="${f(g.x0 - 20 * s)}" y="${f(g.py(y))}" text-anchor="end" dominant-baseline="central" font-size="${axisFs}">${y}%</text>`);
      for (let x = X_MAX; x >= X_MIN; x -= g.xStep)
        out.push(`<text class="ax" x="${f(g.px(x))}" y="${f(g.y1 + 17 * s)}" text-anchor="middle" dominant-baseline="central" font-size="${axisFs}">${x}°</text>`);

      if (this.o.showLog && this.o.log) out.push(this._logPath(g));

      const tsm = !!t.smooth;          // interpolation style is a setting of each map (target.smooth)
      const pts = (lean, vals, sm = tsm) => curvePoints(lean, vals, sm);
      const line = (lean, vals, sm = tsm) => pts(lean, vals, sm).map(([x, y], i) => `${i ? 'L' : 'M'}${f(g.px(x))} ${f(g.py(y))}`).join('');

      // 80px gradient under the selected line only: 25 % of the line colour fading to transparent.
      // Each segment gets a parallelogram whose gradient runs perpendicular to the
      // segment, scaled so opacity depends only on the vertical distance below the line.
      const gradient = (c, key) => {
        const D = 80 * s, defs = [], shapes = [], P = pts(c.lean, c.vals, c.smooth ?? tsm);
        for (let j = 0; j < P.length - 1; j++) {
          const ax = g.px(P[j][0]), ay = g.py(P[j][1]), bx = g.px(P[j + 1][0]), by = g.py(P[j + 1][1]);
          const len = Math.hypot(bx - ax, by - ay);
          if (len < 0.01 || bx <= ax) continue;
          const nx = -(by - ay) / len, ny = (bx - ax) / len, L = D * ny;
          const gid = `${id}-${key}-${j}`;
          const bx2 = j < P.length - 2 ? bx + 0.5 : bx;          // tiny overlap hides seams between slices
          defs.push(`<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f(ax)}" y1="${f(ay)}" x2="${f(ax + nx * L)}" y2="${f(ay + ny * L)}"><stop offset="0" stop-color="${c.color}" stop-opacity=".25"/><stop offset="1" stop-color="${c.color}" stop-opacity="0"/></linearGradient>`);
          shapes.push(`<path d="M${f(ax)} ${f(ay)}L${f(bx2)} ${f(by)}L${f(bx2)} ${f(by + D)}L${f(ax)} ${f(ay + D)}Z" fill="url(#${gid})"/>`);
        }
        return `<defs>${defs.join('')}</defs><g clip-path="url(#${id}-plot)" ${fx(key)} pointer-events="none">${shapes.join('')}</g>`;
      };
      // μ levels: 10 % band of the edited map's colour between its top and bottom μ rows; with a μ filter (20 %)
      // (muBand [lo, hi], the log's μ slider) only between the map's values at those μ (interpolated between rows).
      const na = !!this.o.noActive;            // no map selected: draw every map the same, nothing bold / editable
      if ((this.o.compare || !this.o.rowsHidden) && !this.o.muHidden && !na) {
        const mr = this.o.muRows, band = this.o.muBand || [-Infinity, Infinity];
        const rowAt = m => {
          if (m <= mr[0]) return t.rows[0];
          if (m >= mr[mr.length - 1]) return t.rows[mr.length - 1];
          const i = mr.findIndex((v, k) => m >= v && m <= mr[k + 1]), u = (m - mr[i]) / (mr[i + 1] - mr[i]);
          return t.rows[i].map((v, j) => v + (t.rows[i + 1][j] - v) * u);
        };
        const top = pts(t.lean, rowAt(band[1])), bot = pts(t.lean, rowAt(band[0])).reverse();
        const d = top.map(([x, y], i) => `${i ? 'L' : 'M'}${f(g.px(x))} ${f(g.py(y))}`).join('') +
          bot.map(([x, y]) => `L${f(g.px(x))} ${f(g.py(y))}`).join('') + 'Z';
        out.push(`<path d="${d}" fill="${active.color}" fill-opacity="${this.o.muBand ? '.2' : '.1'}" ${fx('active')} pointer-events="none"/>`);   // μ filtered: 20 %
      }
      if (!na && !this.o.noGlow) out.push(gradient(active, 'active'));

      // Other curves (thin); the hovered one is emphasised
      list.forEach(c => {
        const em = c.target != null && (this.o.emphTargets || []).includes(c.target) ? 2 : 1;   // maps of the selected / hovered allocation cells: 2x thicker
        const w0b = c.dotted ? 1.5 : s, w1b = c.dotted ? 2.5 : 2 * s;
        const w0 = w0b * em, w1 = w1b * em, w = prev.fade === c.key ? w1 : w0;
        const dots = c.dotted ? ' stroke-dasharray="4 8"' : '';
        const a = c.alpha ?? 1, o = prev.fade === c.key ? 1 : op(c.key) * a;
        out.push(`<path d="${line(c.lean, c.vals, c.smooth ?? tsm)}" stroke="${c.color}" stroke-width="${w}"${dots} fill="none" data-fk="${c.key}" data-a="${a}" data-w0="${w0}" data-w1="${w1}" style="opacity:${o};stroke-width:${w}px" pointer-events="none"/>`);
        // editable but not selected lines: 6px circles at their target points
        if (c.points) out.push(`<g data-fk="${c.key}" style="opacity:${op(c.key)}" pointer-events="none">` +
          c.lean.map((x, j) => `<circle cx="${f(g.px(x))}" cy="${f(g.py(c.vals[j]))}" r="3" fill="${C.bg}" stroke="${c.color}" stroke-width="1.5"/>`).join('') + '</g>');
      });

      const hi = na ? null : (this.drag ? this.drag.i : (hv && hv.type === 'point' ? hv.i : null));
      if (na) this.delPos = null;
      if (!na) {
      // Active curve
      const vals = active.vals;
      out.push(`<path d="${line(t.lean, vals)}" stroke="${ac}" stroke-width="${3.5 * s}" stroke-linejoin="round" stroke-linecap="round" fill="none" ${fx('active')} pointer-events="none"/>`);

      // Crosshair for hovered / dragged point
      const dash = `${3 * s} ${3 * s}`;
      if (hi != null && hi < t.lean.length) {
        const cx = g.px(t.lean[hi]), cy = g.py(vals[hi]);
        out.push(`<g data-appear style="opacity:${prev.cross ? 1 : 0}">`);
        out.push(`<path d="M${f(g.x0)} ${f(cy)}H${f(cx)}M${f(cx)} ${f(cy)}V${f(g.y1)}" stroke="${ac}" stroke-width="${s}" stroke-dasharray="${dash}" fill="none"/>`);
        out.push(`<circle cx="${f(g.x0)}" cy="${f(cy)}" r="${2.5 * s}" fill="${ac}"/>`);
        out.push(`<circle cx="${f(cx)}" cy="${f(g.y1)}" r="${2.5 * s}" fill="${ac}"/>`);
        if (hi > 0 && hi < t.lean.length - 1)
          out.push(`<text class="lbl-mu" x="${f(cx + 5 * s)}" y="${f(g.y1 - 7 * s)}" font-size="${9.5 * s}" fill="${ac}">${fmtDeg(t.lean[hi])}</text>`);
        out.push('</g>');
      }

      // Points + value labels
      out.push(`<g ${fx('active')}>`);
      vals.forEach((v, i) => {
        const cx = g.px(t.lean[i]), cy = g.py(v);
        const r = (prev.big.includes(i) ? 8 : 5) * s;
        const ly = cy - 22 * s < g.y0 - 14 * s ? cy + 22 * s : cy - 22 * s;
        out.push(`<text class="val" x="${f(cx)}" y="${f(ly)}" text-anchor="middle" dominant-baseline="central" font-size="${11 * s}">${fmtPct(v)}</text>`);
        // read-only (e.g. +- Buttons): small 10px dots in the line colour instead of white edit handles
        if (!this.o.editable) { out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="5" fill="${ac}" pointer-events="none"/>`); return; }
        out.push(`<circle class="pt" data-i="${i}" cx="${f(cx)}" cy="${f(cy)}" r="${r}" style="r:${r}px" fill="#fff" stroke="${ac}" stroke-width="${2 * s}"` +
          (this.o.editable ? ` tabindex="0" role="slider" aria-label="Breakpoint ${fmtDeg(t.lean[i])}" aria-valuemin="0" aria-valuemax="${SLIP_MAX}" aria-valuenow="${v}" aria-valuetext="${fmtPct(v)} at ${fmtDeg(t.lean[i])}"` : '') + '/>');
      });
      out.push('</g>');

      // Add-point handle on the hovered segment
      if (hv && hv.type === 'add' && !this.drag) {
        const cx = g.px(hv.lean), cy = hv.py, r = 8 * s;
        out.push(`<g class="add" data-appear style="opacity:${prev.add ? 1 : 0}" pointer-events="none"><circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${ac}" stroke="${C.bg}" stroke-width="${1.5 * s}"/>` +
          icon('add', cx, cy, 14 * s, '#fff') + '</g>');
      }

      // Delete button next to the selected point
      this.delPos = null;
      if (this.sel != null && this.sel > 0 && this.sel < t.lean.length - 1 && !this.drag) {
        const cx = g.px(t.lean[this.sel]) + 26 * s, cy = g.py(vals[this.sel]) - 22 * s;
        const hot = hv && hv.type === 'del';
        this.delPos = [cx, cy];
        out.push(`<g class="del" data-appear style="opacity:${prev.del ? 1 : 0}" pointer-events="none"><circle cx="${f(cx)}" cy="${f(cy)}" r="${9 * s}" fill="${hot ? C.danger : '#1b1b20'}" stroke="${hot ? C.danger : '#3d3d41'}" stroke-width="${s}"/>` +
          icon('delete', cx, cy, 13 * s, hot ? '#fff' : C.danger) + '</g>');
      }
      }

      // Right-hand labels with collision avoidance
      const lfs = (this.o.compare ? 10 : 9.5) * s, gap = lfs * 1.15;
      const labels = list.filter(c => c.label).map(c => ({ c, y: c.vals.at(-1) })).concat(na ? [] : [{ c: active, y: active.vals.at(-1), active: true }]);
      labels.forEach(l => (l.py = g.py(l.y)));
      labels.sort((a, b) => a.py - b.py);
      for (let i = 1; i < labels.length; i++)
        if (labels[i].py - labels[i - 1].py < gap) labels[i].py = labels[i - 1].py + gap;
      for (let i = labels.length - 1; i >= 0; i--) {
        const max = i === labels.length - 1 ? g.y1 : labels[i + 1].py - gap;
        if (labels[i].py > max) labels[i].py = max;
      }
      this.labelRects = [];
      labels.forEach(l => {
        const x = g.x1 + 10 * s, w = l.c.label.length * lfs * 0.62;
        if (!l.active) this.labelRects.push({ key: l.c.key, x0: x - 3 * s, x1: x + w + 3 * s, y0: l.py - gap / 2, y1: l.py + gap / 2 });
        out.push(`<text class="rl" x="${f(x)}" y="${f(l.py)}" dominant-baseline="central" font-size="${lfs}" fill="${l.c.color}" ${l.active ? fx('active') : fxa(l.c.key, l.c.labelAlpha ?? 1)}` +
          `${previewKey === l.c.key ? ' text-decoration="underline"' : ''}>${l.c.label}</text>`);
      });

      this.svg.innerHTML = out.join('');
      this.svg.classList.toggle('is-dragging', !!this.drag);

      // Flush styles, then move every element to its new state (CSS transitions, 0.2 s).
      const big = [hi, this.sel].filter(i => i != null);
      this._vis = { fade: previewKey, big, cross: hi != null, add: !!this.svg.querySelector('.add'), del: !!this.delPos };
      this.svg.getBoundingClientRect();
      this.svg.querySelectorAll('[data-fk]').forEach(el => {
        const k = el.dataset.fk;
        const a = el.dataset.a ? +el.dataset.a : 1;           // own base opacity; the hovered curve is shown full
        el.style.opacity = k === previewKey ? 1 : (previewKey ? FADE : 1) * a;
        if (el.dataset.w0) el.style.strokeWidth = (previewKey === k ? el.dataset.w1 : el.dataset.w0) + 'px';
      });
      this.svg.querySelectorAll('.pt').forEach(el => { el.style.r = (big.includes(+el.dataset.i) ? 8 : 5) * s + 'px'; });
      this.svg.querySelectorAll('[data-appear]').forEach(el => { el.style.opacity = 1; });
      if (this.focusIdx != null) {
        const p = this.svg.querySelector(`.pt[data-i="${this.focusIdx}"]`);
        if (p && document.activeElement !== p) p.focus({ preventScroll: true });
      }
    }

    // Imported MoTeC log (filtered by the app, see log-panel.js): o.log = { traces, target }, each a list of
    // [[|lean|, slip %], ...] runs. Logged slip: thin grey line with x markers; ECU slip target: dotted white line.
    _logPath(g) {
      const key = [g.W, g.H, g.yMax].join('|');
      if (this._logKey === key && this._logSrc === this.o.log) return this._logSvg;
      const f = n => Math.round(n * 10) / 10;
      const r = 1.1 * g.s;
      const { traces = [], target = [] } = this.o.log;
      const count = traces.reduce((a, tr) => a + tr.length, 0);
      const every = Math.max(1, Math.ceil(count / 8000));        // x markers thinned out on very long selections
      const poly = (runs, mark) => {
        let d = '', m = '', k = 0;
        runs.forEach(run => {
          let pen = false;
          run.forEach(([x, y]) => {
            if (x > X_MAX || x < X_MIN) { pen = false; return; }
            const X = f(g.px(x)), Y = f(g.py(y));
            d += (pen ? 'L' : 'M') + X + ' ' + Y;
            if (mark && k++ % every === 0) m += `M${f(X - r)} ${f(Y - r)}l${f(2 * r)} ${f(2 * r)}m0 ${f(-2 * r)}l${f(-2 * r)} ${f(2 * r)}`;
            pen = true;
          });
        });
        return [d, m];
      };
      const [d, m] = poly(traces, true), [td] = poly(target, false);
      this._logKey = key; this._logSrc = this.o.log;
      this._logSvg = `<g class="log" fill="none" pointer-events="none" clip-path="url(#${this.uid}-plot)">` +
        `<g stroke="${C.log}"><path d="${d}" stroke-width="${0.75 * g.s}" stroke-linejoin="round"/><path d="${m}" stroke-width="${0.6 * g.s}" opacity=".8"/></g>` +
        `<path d="${td}" stroke="#fff" stroke-width="${1.25 * g.s}" stroke-dasharray="${1.5 * g.s} ${2.5 * g.s}" stroke-linecap="round" opacity=".85"/></g>`;
      return this._logSvg;
    }

    // ---- hit testing ----------------------------------------------------
    _local(e) {
      const r = this.svg.getBoundingClientRect();
      return [(e.clientX - r.left) * (this.g.W / r.width), (e.clientY - r.top) * (this.g.H / r.height)];
    }

    // What is under (px, py)? Priority: delete button, point, add handle, label, other curve.
    _hit(px, py) {
      const g = this.g, s = g.s, t = this.target, vals = this.vals, smooth = !!t.smooth;
      // Read-only charts skip the editing targets but still report curves (tooltips / selection).
      if (this.o.editable) {
      if (this.delPos && Math.hypot(px - this.delPos[0], py - this.delPos[1]) < 11 * s)
        return { type: 'del', i: this.sel };

      let best = null, bd = 13 * s;
      t.lean.forEach((x, i) => {
        const d = Math.hypot(g.px(x) - px, g.py(vals[i]) - py);
        if (d < bd) { bd = d; best = i; }
      });
      if (best != null) return { type: 'point', i: best };

      for (let j = 0; j < t.lean.length - 1; j++) {
        const ax = g.px(t.lean[j]), ay = g.py(vals[j]), bx = g.px(t.lean[j + 1]), by = g.py(vals[j + 1]);
        let lean;
        if (smooth) {
          // smooth: pointer must be within the segment's lean range and close to the curve vertically
          if (px < ax || px > bx) continue;
          const lx = g.ix(px);
          if (Math.abs(g.py(curveAt(t.lean, vals, true, j, lx)) - py) > 8 * s) continue;
          lean = Math.round(lx);
        } else {
          const { d, u } = segDist(px, py, ax, ay, bx, by);
          if (d > 8 * s) continue;
          lean = Math.round(g.ix(ax + u * (bx - ax)));
        }
        if (lean > t.lean[j] - 1 || lean < t.lean[j + 1] + 1) break;   // no whole degree free here
        const y = curveAt(t.lean, vals, smooth, j, lean);
        const hx = g.px(lean), hy = g.py(y);
        if (Math.hypot(hx - ax, hy - ay) < 14 * s || Math.hypot(hx - bx, hy - by) < 14 * s) break;
        return { type: 'add', seg: j, lean, py: hy };
      }
      }

      const lr = this.labelRects.find(r => px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1);
      if (lr) return this._curveHit(lr.key);

      let cb = null, cd = 6 * s;
      this.curves.list.forEach(c => {
        const P = curvePoints(c.lean, c.vals, c.smooth ?? smooth);
        for (let j = 0; j < P.length - 1; j++) {
          const { d } = segDist(px, py, g.px(P[j][0]), g.py(P[j][1]), g.px(P[j + 1][0]), g.py(P[j + 1][1]));
          if (d < cd) { cd = d; cb = c.key; }
        }
      });
      return cb ? this._curveHit(cb) : null;
    }

    _curveHit(key) { return { type: 'curve', key, curve: this.curves.list.find(c => c.key === key) }; }

    _sameHit(a, b) {
      if (!a || !b || a.type !== b.type) return a === b;
      return a.type === 'add' ? a.lean === b.lean && a.seg === b.seg : (a.i === b.i && a.key === b.key);
    }

    _showTip(hit, e) {
      const txt = !hit ? '' :
        hit.type === 'point' ? 'Adjust this target point with drag & drop' :
        hit.type === 'add' ? 'Click to add a target point' :
        hit.type === 'del' ? 'Delete this target point' :
        hit.curve.tip;
      if (!txt || !e || this.drag) { this.tip.classList.remove('is-on'); return; }
      const r = this.el.getBoundingClientRect();
      this.tip.textContent = txt;
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const w = this.tip.offsetWidth;
      this.tip.style.left = clamp(x - w / 2, 0, r.width - w) + 'px';
      this.tip.style.top = (y - this.tip.offsetHeight - 12) + 'px';
      this.tip.classList.add('is-on');
    }

    // ---- editing --------------------------------------------------------
    // Drag snaps to whole degrees (lean) and 0.1 % (slip).
    _dragTo(i, lean, slip) {
      const t = this.target, n = t.lean.length;
      if (i > 0 && i < n - 1) {
        // Lean axis is shared by all mu rows of the map; keep breakpoints ordered, >= 1 deg apart.
        const lo = Math.ceil(t.lean[i + 1] + 1), hi = Math.floor(t.lean[i - 1] - 1);
        if (lo <= hi) t.lean[i] = clamp(Math.round(lean), lo, hi);
      }
      this.vals[i] = clamp(r1(slip), 0, SLIP_MAX);
      this.o.onChange(t);
      this.render();
    }

    _nudge(i, dLean, dSlip) {
      const t = this.target, n = t.lean.length;
      if (dLean && i > 0 && i < n - 1)
        t.lean[i] = clamp(r1(t.lean[i] + dLean), r1(t.lean[i + 1] + 1), r1(t.lean[i - 1] - 1));
      if (dSlip) this.vals[i] = clamp(r1(this.vals[i] + dSlip), 0, SLIP_MAX);
      this.o.onChange(t);
      this.render();
    }

    // Insert a breakpoint in every mu row (shared lean axis), keeping each row's shape.
    _insert(seg, lean) {
      const t = this.target, j = seg;
      // new point lies on the curve as drawn (straight or smooth), so the shape does not change
      t.rows.forEach(row => row.splice(j + 1, 0, r1(curveAt(t.lean, row, !!t.smooth, j, lean))));
      t.lean.splice(j + 1, 0, lean);
      this.o.onInsert(t, j + 1);
      this.o.onChange(t);
      return j + 1;
    }

    _delete(i) {
      const t = this.target;
      if (i <= 0 || i >= t.lean.length - 1) return;
      this.o.onEditStart();
      t.lean.splice(i, 1);
      t.rows.forEach(row => row.splice(i, 1));
      this.o.onDelete(t, i);
      this.sel = null; this.hv = null; this.focusIdx = null;
      this.o.onChange(t);
      this.render();
    }

    _select(curve) {
      this.hv = null; this.sel = null;
      this.tip.classList.remove('is-on');
      if ('pick' in curve) this.o.onPick(curve.pick);   // app-defined selectable overlays
      else if (curve.mu != null) this.o.onSelectMu(curve.mu); else this.o.onSelectTarget(curve.target);
    }

    _bind() {
      const svg = this.svg;
      svg.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const [px, py] = this._local(e);
        const hit = this._hit(px, py);
        // empty chart area: drop the point selection and tell the app (it deselects the map)
        if (!hit) { if (this.sel != null) { this.sel = null; this.render(); } this.o.onEmptyClick(); return; }
        if (!this.o.editable && hit.type !== 'curve') return;
        e.preventDefault();
        if (hit.type === 'del') { this._delete(hit.i); return; }
        if (hit.type === 'curve') { if (!hit.curve.locked) this._select(hit.curve); return; }
        if (hit.type === 'add' && e.pointerType === 'touch' && !this._sameHit(hit, this.hv)) {
          this.hv = hit; this.render(); return;       // first tap reveals the +, second adds
        }
        let i = hit.i, added = false;
        if (hit.type === 'add') { this.o.onEditStart(); i = this._insert(hit.seg, hit.lean); added = true; }
        svg.setPointerCapture(e.pointerId);
        const g = this.g;
        this.drag = { i, id: e.pointerId, sx: px, sy: py, moved: false, added,
          dx: g.px(this.target.lean[i]) - px, dy: g.py(this.vals[i]) - py };
        this.hv = { type: 'point', i };
        this.focusIdx = i;
        this._showTip(null);
        this.render();
      });
      svg.addEventListener('pointermove', e => {
        const [px, py] = this._local(e);
        const dr = this.drag;
        if (dr && e.pointerId === dr.id) {
          if (!dr.moved && Math.hypot(px - dr.sx, py - dr.sy) < 3) return;
          if (!dr.moved) { dr.moved = true; this.sel = null; if (!dr.added) this.o.onEditStart(); }
          const g = this.g;
          this._dragTo(dr.i, g.ix(px + dr.dx), g.iy(py + dr.dy));
          return;
        }
        if (e.pointerType === 'touch') return;
        const hit = this._hit(px, py);
        if (!this._sameHit(hit, this.hv)) { this.hv = hit; this.render(); }
        svg.style.cursor = !hit ? '' : hit.type === 'point' ? 'grab' : hit.type === 'curve' && hit.curve.locked ? 'default' : 'pointer';
        this._showTip(hit, e);
      });
      const end = e => {
        const dr = this.drag;
        if (!dr || e.pointerId !== dr.id) return;
        this.drag = null;
        // A click (no drag) on an existing point toggles its delete button.
        if (!dr.moved && !dr.added) this.sel = this.sel === dr.i ? null : dr.i;
        if (e.pointerType === 'touch') this.hv = null;
        this.render();
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('pointerleave', () => {
        this._showTip(null);
        if (!this.drag && this.hv && this.o.hover == null) { this.hv = null; this.render(); }
      });
      svg.addEventListener('focusin', e => {
        const p = e.target.closest('.pt');
        if (p && +p.dataset.i !== this.focusIdx) { this.focusIdx = +p.dataset.i; this.hv = { type: 'point', i: this.focusIdx }; this.render(); }
      });
      svg.addEventListener('focusout', e => {
        if (!svg.contains(e.relatedTarget) && !this.drag) {
          this.focusIdx = null;
          if (this.o.hover == null) this.hv = null;
          requestAnimationFrame(() => { if (!svg.contains(document.activeElement)) this.render(); });
        }
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && this.sel != null) { this.sel = null; this.render(); }
      });
      svg.addEventListener('keydown', e => {
        const p = e.target.closest('.pt');
        if (!p) return;
        const i = +p.dataset.i, big = e.shiftKey;
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this._delete(i); return; }
        let dL = 0, dS = 0;
        if (e.key === 'ArrowUp') dS = big ? 1 : 0.1;
        else if (e.key === 'ArrowDown') dS = big ? -1 : -0.1;
        else if (e.key === 'ArrowLeft') dL = big ? 5 : 1;       // axis runs 70 -> 0
        else if (e.key === 'ArrowRight') dL = big ? -5 : -1;
        else return;
        e.preventDefault();
        this.o.onEditStart();
        this._nudge(i, dL, dS);
      });
    }
  }

  SlipChart.GEAR_COLORS = C.gears;
  window.SlipChart = SlipChart;
})();
