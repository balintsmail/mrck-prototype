// MuLines — how the μx rows of a slip-target map are made.
//
// Anchors (edited by the user): μ 1.00 (base), the highest μ (max, e.g. 1.60) and the lowest μ (min, e.g. -0.25).
// Sub levels between them (0.20 apart) are calculated with a degression d (0..1):
//   each sub level covers a share r of the remaining distance to its anchor,
//   r = max(1 / remaining steps, d)
//   d = 0   -> equal steps (linear)
//   d = 0.5 -> every level halfway between the previous one and the anchor (50 %, 75 %, 87.5 % ...)
//   d = 1   -> every sub level at the anchor value
// mode: 'uniform' one d for all target points, 'point' one d per target point,
//       'fixed' no calculation (every row edited on its own).
(function () {
  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;

  // Indices of the anchor rows for a list of μ values.
  function anchors(mu) {
    const idx = v => mu.findIndex(x => Math.abs(x - v) < 1e-6);
    const base = idx(1) >= 0 ? idx(1) : Math.floor(mu.length / 2);
    const min = 0;                         // lowest μ (e.g. -0.25) is the min anchor
    return { min, base, max: mu.length - 1 };
  }
  const MU = () => (window.MRCK_DATA ? window.MRCK_DATA.MU_ROWS : [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6]);
  const A = () => anchors(MU());

  // Rows calculated in a calculated mode (everything except the three anchors).
  function lockedRows(t) {
    const m = t.mu;
    if (!m || m.mode === 'fixed' || m.mode === 'ratio') return [];   // ratio: every line can be edited
    const a = A();
    return t.rows.map((r, i) => i).filter(i => i !== a.min && i !== a.base && i !== a.max);
  }

  function ensure(t) {
    if (!t.mu) {
      t.mu = { mode: 'uniform', deg: 0, ptDeg: [] };
      fit(t);
      derive(t);
    }
    return t.mu;
  }

  // Fractions (0..1 of the way from the base to the anchor) of n steps with degression d.
  function fractions(n, d) {
    const out = [];
    let f = 0;
    for (let k = 1; k <= n; k++) {
      const r = k === n ? 1 : Math.max(1 / (n - k + 1), d);
      f += (1 - f) * r;
      out.push(f);
    }
    return out;
  }

  function degAt(m, j) {
    const v = m.mode === 'uniform' ? m.deg : m.ptDeg[j];
    return Number.isFinite(v) ? v : 0;
  }

  // Ratio mode: every μ level is the level below it x (1 + ratio); levels below the reference
  // line divide by it. Any line can be the reference (m.ref = the line being edited).
  //   ratio 10 %: 10 -> 11 -> 12.1 %   (values capped to 0..25.5 %)
  function deriveRatio(t) {
    const m = t.mu, rows = t.rows, ref = Math.max(0, Math.min(rows.length - 1, m.ref ?? A().base));
    const q = 1 + (Number.isFinite(m.ratio) ? m.ratio : 10) / 100;
    rows.forEach((row, i) => {
      if (i === ref) return;
      for (let j = 0; j < row.length; j++) row[j] = r1(Math.max(0, Math.min(25.5, rows[ref][j] * q ** (i - ref))));
    });
  }

  // Recompute the sub levels from the anchors.
  function derive(t) {
    const m = t.mu;
    if (!m || m.mode === 'fixed') return;
    if (m.mode === 'ratio') { deriveRatio(t); return; }
    const a = A(), rows = t.rows, n = rows[a.base].length;
    for (let j = 0; j < n; j++) {
      const d = degAt(m, j), b = rows[a.base][j];
      const up = fractions(a.max - a.base, d), dn = fractions(a.base - a.min, d);
      for (let k = 1; k < a.max - a.base; k++) rows[a.base + k][j] = r1(b + up[k - 1] * (rows[a.max][j] - b));
      for (let k = 1; k < a.base - a.min; k++) rows[a.base - k][j] = r1(b + dn[k - 1] * (rows[a.min][j] - b));
    }
    rows.forEach(r => { r.length = n; });
  }

  // Pick the degression (0..1 in 0.05 steps) that keeps the current sub levels closest,
  // so switching to a calculated mode moves the lines as little as possible.
  function bestDeg(t, pts) {
    const a = A(), rows = t.rows;
    let best = 0, bestErr = Infinity;
    for (let s = 0; s <= 20; s++) {
      const d = s / 20;
      const up = fractions(a.max - a.base, d), dn = fractions(a.base - a.min, d);
      let err = 0;
      pts.forEach(j => {
        const b = rows[a.base][j];
        for (let k = 1; k < a.max - a.base; k++) err += (rows[a.base + k][j] - (b + up[k - 1] * (rows[a.max][j] - b))) ** 2;
        for (let k = 1; k < a.base - a.min; k++) err += (rows[a.base - k][j] - (b + dn[k - 1] * (rows[a.min][j] - b))) ** 2;
      });
      if (err < bestErr - 1e-9) { bestErr = err; best = d; }
    }
    return best;
  }
  function fit(t) {
    const m = t.mu;
    if (!m || m.mode === 'fixed' || m.mode === 'ratio') return;   // ratio keeps its own value (default 10 %)
    const n = t.rows[0].length;
    if (m.mode === 'uniform') m.deg = bestDeg(t, [...Array(n).keys()]);
    else m.ptDeg = [...Array(n).keys()].map(j => bestDeg(t, [j]));
  }

  // Keep per-point values aligned when target points are added or removed.
  function insertPoint(t, idx) {
    const m = t.mu; if (!m) return;
    const arr = m.ptDeg;
    if (arr.length < idx) return;
    const a = arr[idx - 1] ?? 0, c = arr[idx] ?? a;
    arr.splice(idx, 0, r2((a + c) / 2));
  }
  function deletePoint(t, idx) {
    const m = t.mu; if (m) m.ptDeg.splice(idx, 1);
  }

  window.MuLines = { ensure, derive, fit, insertPoint, deletePoint, anchors: A, lockedRows, fractions };
})();
