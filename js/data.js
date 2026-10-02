// Slip Target data model — DTC (RCK25 manual ch. 5.4).
// Each target is a map: one lean-angle axis [deg] shared by all mu_x rows,
// and one slip-target curve [%] per mu_x row.
(function () {
  // Imported calibration (js/dataset.js, generated from a .bmwrc25 file) when present,
  // otherwise the demo data below.
  const DS = window.MRCK_DATASET || null;
  const MU_ROWS = DS ? DS.MU_ROWS.slice() : [0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
  const MU_BASE = Math.max(0, MU_ROWS.indexOf(1));      // 'mu 1.00' row = default edited row

  // Build a target from a lean axis and the values for each mu row.
  function makeTarget(id, lean, rows) {
    return { id, name: 'Target ' + id, lean: lean.slice(), rows: rows.map(r => r.slice()) };
  }

  // Target #1 — works setting as drawn in the design reference.
  const T1_LEAN = [70, 60, 50, 38.5, 20, 0];
  const T1_ROWS = [
    [0, 0, 4.9, 7.4, 8, 8],       // mu 0.25
    [0, 0, 6.1, 9.2, 10, 10],     // mu 0.50
    [0, 0, 7.4, 11, 12, 12],      // mu 0.75
    [1, 1, 9, 13, 14, 14],        // mu 1.00
    [4, 4, 11.3, 15, 16, 16],     // mu 1.25
    [7, 7, 13.7, 17.1, 18, 18],   // mu 1.50
  ];

  // Derive other rows from a mu 1.00 curve using the same spacing as target #1.
  function deriveRows(mu1) {
    return T1_ROWS.map((row, i) => row.map((v, j) => {
      const d = v - T1_ROWS[3][j];
      return Math.max(0, Math.min(20, +(mu1[j] + d).toFixed(1)));
    }));
  }

  // Drop breakpoints that lie on the straight line between their neighbours in every μ row
  // (the lean axis is shared). The curves keep exactly the same shape; the end points stay.
  function simplify(t) {
    const onLine = i => t.rows.every(row => {
      const [x0, x1, x2] = [t.lean[i - 1], t.lean[i], t.lean[i + 1]];
      const y = row[i - 1] + (row[i + 1] - row[i - 1]) * (x1 - x0) / (x2 - x0);
      return Math.abs(y - row[i]) < 0.001;             // only exactly straight (values have 0.1 % steps)
    });
    for (let i = 1; i < t.lean.length - 1;) {
      if (onLine(i)) { t.lean.splice(i, 1); t.rows.forEach(row => row.splice(i, 1)); }
      else i++;
    }
    return t;
  }

  // Imported maps keep their own μ rows exactly: they use their saved μ-line setting, or "Custom values"
  // (a calculated mode would refit and overwrite them). Demo maps start calculated.
  const importedMu = () => ({ mode: 'fixed', deg: 0, ptDeg: [] });
  // (simplify() is no longer applied: the dataset keeps exactly the points it was reduced to.)
  const targets = DS ? DS.targets.map(t => Object.assign(makeTarget(t.id, t.lean, t.rows), { mu: t.mu ? JSON.parse(JSON.stringify(t.mu)) : importedMu(), from: t.from || null, was: t.was || null, note: t.note || null, smooth: !!t.smooth })) : [
    makeTarget(1, T1_LEAN, T1_ROWS),
    makeTarget(2, T1_LEAN, T1_ROWS),
    makeTarget(3, [70, 60, 50, 40, 20, 0], deriveRows([4, 4, 11.3, 15, 14.5, 14.5])),
    makeTarget(4, [70, 60, 53, 40, 20, 0], deriveRows([2, 2, 11, 16, 16, 16])),
    makeTarget(5, [70, 60, 50, 40, 20, 0], deriveRows([7, 7, 13.7, 17.1, 18, 18])),
    makeTarget(6, [70, 60, 52, 40, 20, 0], deriveRows([5, 5, 12.5, 16.5, 17, 17])),
  ];
  // Demo targets 7..15: progressively softer / harder variants of #1.
  if (!DS) for (let id = 7; id <= 15; id++) {
    const k = id - 11; // -4..+4
    const mu1 = T1_ROWS[3].map((v, j) => Math.max(0, +(v + k * (j < 2 ? 0.5 : 0.8)).toFixed(1)));
    targets.push(makeTarget(id, T1_LEAN, deriveRows(mu1)));
  }

  // Deterministic PRNG for the simulated log data.
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Simulated MoTeC log: corner exits (phi_lean falling, slip rising), sampled
  // as [lean, slip, mu_x]. Traces cluster around mu rows so the overlay follows
  // the active row.
  function makeLog() {
    const r = rng(25);
    const traces = [];
    MU_ROWS.forEach((mu, mi) => {
      const count = 7 + (mi === MU_BASE ? 5 : 0);
      for (let t = 0; t < count; t++) {
        const start = 56 + r() * 5;
        const end = r() < 0.4 ? 32 + r() * 14 : r() * 6;
        const peak = (DS ? 5 + mi * 1.1 : Math.max(2, T1_ROWS[mi][3])) * (0.7 + r() * 0.5);
        const tail = 0.2 + r() * 0.5;                          // slip level once upright
        const pts = [];
        let lean = start, noise = 0, drift = 0;
        while (lean > end) {
          const p = (start - lean) / (start - 40);            // 0 at apex, 1 at ~40 deg
          drift = drift * 0.97 + (r() - 0.5) * 0.35;
          const base = p < 1 ? peak * Math.pow(p, 0.8)
            : peak * (tail + (1 - tail) * Math.exp(-(40 - lean) / 8)) + drift;
          noise = noise * 0.6 + (r() - 0.5) * (lean > 40 ? 3.2 : 1.2);
          const spike = r() < 0.04 ? r() * 3.5 : 0;
          const slip = Math.max(0, Math.min(19.5, base + noise + spike));
          pts.push([+lean.toFixed(2), +slip.toFixed(2), +(mu + (r() - 0.5) * 0.2).toFixed(3)]);
          lean -= lean > 40 ? 0.12 + r() * 0.3 : 0.25 + r() * 0.6;
        }
        traces.push({ mu, pts });
      }
    });
    return traces;
  }

  // Slip Target Allocation (STK): slip-target map id per gear 1..6, per vehicle mode.
  const VEHICLE_MODES = ['Rain', 'Int', 'Dry1', 'Dry2'];
  const allocation = DS ? JSON.parse(JSON.stringify(DS.allocation)) : {
    Rain: [8, 8, 8, 9, 9, 9],
    Int:  [10, 10, 10, 11, 11, 11],
    Dry1: [1, 1, 3, 4, 5, 5],
    Dry2: [1, 2, 3, 4, 5, 6],
  };

  // DTC settings (manual 5.2): fast-path torque reduction method.
  const settings = DS ? Object.assign({}, DS.settings) : { reduction: 'retard' };

  // Rider slip shift via the LHS +/- buttons (manual 5.6): user level -7..+7, index 0 = level -7.
  // Effective slip target = slip target * User Factor + User Offset.
  // "+" = more traction control (lower slip): works defaults +1 -> x0.96 / -0.4 %, -7 -> x1.28 / +2.8 %.
  const SHIFT_STEPS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
  const userShift = DS ? JSON.parse(JSON.stringify(DS.userShift)) : {
    facStep: 0.04, offStep: 0.4,
    fac: SHIFT_STEPS.map(k => +(1 - k * 0.04).toFixed(2)),
    off: SHIFT_STEPS.map(k => +(-k * 0.4).toFixed(1)),
  };

  window.MRCK_DATA = { source: DS ? DS.source : null, MU_ROWS, MU_BASE, targets, VEHICLE_MODES, allocation, settings, SHIFT_STEPS, userShift, log: makeLog() };
})();
