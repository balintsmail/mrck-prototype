// TrackMap — the Track detection tab's circuit map (PRO): the fastest lap of the loaded MoTeC log from GPS, cut into the
// acceleration sectors by lap distance. The app owns the sector ends; this draws them and reports what the user does:
//   click a sector -> onSelect({ type: 'sector', s, p })   (s = sector index, p = lap distance of the click [m])
//   click a split  -> onSelect({ type: 'split', k })       (k = index of the sector end)
//   double-click   -> onSplit(p)
//   drag a split   -> onDrag(k, p, phase)                   phase 'start' | 'move' | 'end'
//   empty click    -> onSelect(null)
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const PAD = 34, SPLIT_LEN = 34;   // split lines cross the track and both side lines
  // two 4px lines beside the track: inside front brake pressure (yellow), outside throttle tpd (red);
  // their opacity follows the value (0 = transparent)
  const RAIL_OFF = 9, BRAKE_FULL = 0.8, TPD_FULL = 95, STEPS = 20;

  class TrackMap {
    constructor(el, opts) {
      this.el = el;
      this.o = opts;
      this.pts = null;            // [{ x, y, p }] in metres (x east, y north), p = lap distance
      this.view = null;           // { ends, lapLen, sel, colors, labels }
      el.innerHTML = '<svg class="tm-svg" role="group" aria-label="Circuit map with the track detection sectors"></svg><div class="tm-empty" hidden></div>';
      this.svg = el.querySelector('svg');
      this.empty = el.querySelector('.tm-empty');
      this._bind();
      new ResizeObserver(() => this.render()).observe(el);
    }

    // d: sessionData of the log (needs GPS, distance and the reference lap). Returns false when the map cannot be drawn.
    setLog(d) {
      this.pts = null;
      if (d && d.lat && d.lon && d.dist && d.refLap) {
        const a = Math.floor(d.refLap.a * d.rate), b = Math.min(d.n, Math.floor(d.refLap.b * d.rate));
        const base = d.dist[a], lat0 = d.lat[Math.floor((a + b) / 2)] * Math.PI / 180;
        const pts = [];
        let last = -Infinity;
        for (let i = a; i < b; i++) {
          if (!d.lat[i] || !d.lon[i]) continue;               // no GPS fix
          const p = d.dist[i] - base;
          if (p - last < 3) continue;                          // one point every 3 m
          last = p;
          pts.push({ x: d.lon[i] * 111320 * Math.cos(lat0), y: d.lat[i] * 110540, p,
            br: d.brake ? d.brake[i] : 0, tp: d.tpd ? d.tpd[i] : 0 });
        }
        if (pts.length > 20) {
          this.pts = pts;
          // brake line: full yellow from 80 % of the highest front brake pressure on this lap; throttle: full red above 95 %
          this.brFull = Math.max(...pts.map(q => q.br)) * BRAKE_FULL || 1;
        }
      }
      this.render();
      return !!this.pts;
    }

    set(view) { this.view = view; this.render(); }

    // the track point nearest to a client position: { i, p }
    nearest(cx, cy) {
      const r = this.svg.getBoundingClientRect(), x = cx - r.left, y = cy - r.top;
      let best = 0, bd = Infinity;
      this.scr.forEach((q, i) => { const dd = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (dd < bd) { bd = dd; best = i; } });
      return { i: best, p: this.pts[best].p, dist: Math.sqrt(bd) };
    }
    // index of the track point at lap distance p
    at(p) {
      let lo = 0, hi = this.pts.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (this.pts[m].p < p) lo = m + 1; else hi = m; }
      return lo;
    }

    render() {
      const v = this.view, svg = this.svg;
      const W = this.el.clientWidth, H = this.el.clientHeight;
      this.empty.hidden = !!this.pts;
      svg.style.display = this.pts ? '' : 'none';
      if (!this.pts) { this.empty.innerHTML = this.o.emptyHtml ? this.o.emptyHtml() : ''; return; }
      if (!v || !W || !H) return;
      // fit the lap into the box, north up
      const xs = this.pts.map(q => q.x), ys = this.pts.map(q => q.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const k = Math.min((W - 2 * PAD) / (x1 - x0 || 1), (H - 2 * PAD) / (y1 - y0 || 1));
      const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
      this.scr = this.pts.map(q => [ox + (q.x - x0) * k, oy + (y1 - q.y) * k]);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('width', W); svg.setAttribute('height', H);

      const ends = v.ends, n = ends.length;          // used sector ends, ascending; the last one is the finish line
      const xy = i => this.scr[Math.max(0, Math.min(this.scr.length - 1, i))];
      const path = (i0, i1) => {
        const pts = [];
        for (let i = i0; i <= i1; i++) pts.push(xy(i).map(c => c.toFixed(1)).join(','));
        return pts.join(' ');
      };
      let html = '';
      // brake (inside) and throttle (outside) lines: per point normal, pointing into the circuit for the brake line.
      // Points with the same opacity step are joined into one polyline.
      const N = this.scr.length;
      let area = 0;
      for (let i = 0; i < N; i++) { const a = this.scr[i], b = this.scr[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1]; }
      const inSign = area > 0 ? 1 : -1;            // screen y down: positive area = clockwise on screen, interior on the right
      const norm = this.scr.map((q, i) => {
        const a = this.scr[Math.max(0, i - 1)], b = this.scr[Math.min(N - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        return [-dy / l * inSign, dx / l * inSign];   // unit normal into the circuit
      });
      const rail = (cls, side, alphaOf) => {
        let out = '', run = [], lvl = 0;
        const flush = () => { if (run.length > 1 && lvl > 0) out += `<polyline class="${cls}" points="${run.join(' ')}" style="opacity:${(lvl / STEPS).toFixed(2)}"/>`; };
        for (let i = 0; i < N; i++) {
          const q = this.scr[i], n = norm[i];
          const pt = `${(q[0] + n[0] * RAIL_OFF * side).toFixed(1)},${(q[1] + n[1] * RAIL_OFF * side).toFixed(1)}`;
          const l = Math.round(Math.max(0, Math.min(1, alphaOf(this.pts[i]))) * STEPS);
          if (l !== lvl) { run.push(pt); flush(); run = [run[run.length - 1]]; lvl = l; }
          run.push(pt);
        }
        flush();
        return out;
      };
      html += rail('tm-brake', 1, q => q.br / this.brFull);
      html += rail('tm-tpd', -1, q => q.tp / TPD_FULL);
      // sectors: one polyline each, from the previous end (or the line) to its end
      const bounds = [];
      for (let s = 0; s < n; s++) {
        const i0 = s ? this.at(ends[s - 1]) : 0, i1 = s === n - 1 ? this.scr.length - 1 : this.at(ends[s]);
        bounds.push([i0, i1]);
        const sel = v.sel && v.sel.type === 'sector' && v.sel.s === s;
        const pts = path(i0, Math.max(i0 + 1, i1));
        html += `<polyline class="tm-sec${sel ? ' is-sel' : ''}" data-s="${s}" points="${pts}" />`;
        html += `<polyline class="tm-hit" data-s="${s}" points="${pts}" />`;
      }
      // sector numbers beside the middle of each sector, pushed outwards from the track
      const cx = W / 2, cy = H / 2;
      bounds.forEach(([i0, i1], s) => {
        const m = xy(Math.round((i0 + i1) / 2)), a = xy(Math.max(i0, Math.round((i0 + i1) / 2) - 3)), b = xy(Math.min(i1, Math.round((i0 + i1) / 2) + 3));
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if ((m[0] - cx) * nx + (m[1] - cy) * ny < 0) { nx = -nx; ny = -ny; }
        const tx = m[0] + nx * 30, ty = m[1] + ny * 30;   // clear of the brake / throttle lines
        const sel = v.sel && v.sel.type === 'sector' && v.sel.s === s;
        html += `<g class="tm-lbl${sel ? ' is-sel' : ''}" data-s="${s}" transform="translate(${tx.toFixed(1)},${ty.toFixed(1)})">` +
          `<rect x="-15" y="-9" width="30" height="18" rx="3"/><text y="4">${esc(v.labels[s])}</text></g>`;
      });
      // start / finish line (lap trigger beacon) and the splits (perpendicular to the track, draggable)
      const tick = (i, cls, attrs) => {
        const p = xy(i), a = xy(i - 2), b = xy(i + 2);
        let nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const l = Math.hypot(nx, ny) || 1; nx = nx / l * SPLIT_LEN / 2; ny = ny / l * SPLIT_LEN / 2;
        const ln = `x1="${(p[0] - nx).toFixed(1)}" y1="${(p[1] - ny).toFixed(1)}" x2="${(p[0] + nx).toFixed(1)}" y2="${(p[1] + ny).toFixed(1)}"`;
        return `<g class="${cls}" ${attrs}><line class="tm-split-hit" ${ln}/><line class="tm-split-line" ${ln}/><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5"/></g>`;
      };
      html += tick(0, 'tm-finish', 'aria-label="Start / finish (lap trigger beacon)"');
      for (let s = 0; s < n - 1; s++) {
        const sel = v.sel && v.sel.type === 'split' && v.sel.k === s;
        html += tick(this.at(ends[s]), `tm-split${sel ? ' is-sel' : ''}`, `data-k="${s}" role="button" aria-label="Split between S${s + 1} and S${s + 2} at ${Math.round(ends[s])} m"`);
      }
      // the clicked point of the selected sector: where "Split here" cuts
      if (v.sel && v.sel.type === 'sector' && v.sel.p != null) {
        const p = xy(this.at(v.sel.p));
        html += `<circle class="tm-cut" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="6"/>`;
      }
      svg.innerHTML = html;
    }

    _bind() {
      const svg = this.svg;
      let drag = null;
      svg.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !this.pts) return;
        const sp = e.target.closest('.tm-split');
        if (sp) {
          e.preventDefault();
          drag = { k: +sp.dataset.k, moved: false, x: e.clientX, y: e.clientY };
          svg.setPointerCapture(e.pointerId);
          this.o.onSelect({ type: 'split', k: drag.k });
          return;
        }
        const sec = e.target.closest('[data-s]');
        if (sec) { const n = this.nearest(e.clientX, e.clientY); this.o.onSelect({ type: 'sector', s: +sec.dataset.s, p: n.p }); return; }
        this.o.onSelect(null);
      });
      svg.addEventListener('pointermove', e => {
        if (!drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
        if (!drag.moved) { drag.moved = true; this.o.onDrag(drag.k, null, 'start'); svg.classList.add('is-dragging'); }
        this.o.onDrag(drag.k, this.nearest(e.clientX, e.clientY).p, 'move');
      });
      const end = () => {
        if (!drag) return;
        if (drag.moved) this.o.onDrag(drag.k, null, 'end');
        drag = null; svg.classList.remove('is-dragging');
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      svg.addEventListener('dblclick', e => {
        if (!this.pts || e.target.closest('.tm-split')) return;
        const n = this.nearest(e.clientX, e.clientY);
        if (n.dist < 30) this.o.onSplit(n.p);
      });
    }
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  window.TrackMap = TrackMap;
})();
