// MotecLd — reads MoTeC i2 logger files (.ld) in the browser, no dependencies.
// Format notes and how the decoder was validated against an i2 CSV export: docs/motec-ld-format.md
(function () {
  const latin1 = new TextDecoder('latin1');

  function str(u8, off, len) {
    if (off + len > u8.length) return '';
    let e = off;
    while (e < off + len && u8[e] !== 0) e++;
    return latin1.decode(u8.subarray(off, e)).trim();
  }

  function half(h) {
    const s = h >> 15 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) return s * m * 2 ** -24;
    if (e === 31) return m ? NaN : s * Infinity;
    return s * (1 + m / 1024) * 2 ** (e - 15);
  }

  // Parse the file header and the linked list of channel headers. Channel data is decoded on demand.
  function parse(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), size = buf.byteLength;
    if (size < 0x700 || dv.getUint32(0, true) !== 0x40) throw new Error('Not a MoTeC .ld file');
    const metaPtr = dv.getUint32(8, true), eventPtr = dv.getUint32(0x24, true);
    const meta = {
      device: str(u8, 0x4A, 8),
      date: str(u8, 0x5E, 16),          // dd/mm/yyyy
      time: str(u8, 0x7E, 16),
      venue: str(u8, 0x15E, 64),
      event: eventPtr ? str(u8, eventPtr, 64) : '',
      session: eventPtr ? str(u8, eventPtr + 64, 64) : '',
    };
    const channels = [];
    for (let p = metaPtr, guard = 0; p && guard < 10000; guard++) {
      if (p + 124 > size) throw new Error('Damaged .ld file (channel header out of range)');
      const c = {
        dataPtr: dv.getUint32(p + 8, true),
        n: dv.getUint32(p + 12, true),
        typeA: dv.getUint16(p + 18, true),
        type: dv.getUint16(p + 20, true),
        freq: dv.getUint16(p + 22, true),
        shift: dv.getInt16(p + 24, true),
        mul: dv.getInt16(p + 26, true),
        scale: dv.getInt16(p + 28, true),
        dec: dv.getInt16(p + 30, true),
        name: str(u8, p + 32, 32),
        short: str(u8, p + 64, 8),
        unit: str(u8, p + 72, 12),
      };
      channels.push(c);
      p = dv.getUint32(p + 4, true);
    }

    // Engineering value = (raw / scale * 10^-dec + shift) * mul
    function decode(c) {
      if (c.data) return c.data;
      const isFloat = c.typeA === 7, bytes = c.type;
      if (!(bytes === 2 || bytes === 4) || ![0, 3, 5, 7].includes(c.typeA)) throw new Error(`Unsupported data type ${c.typeA}/${c.type} in channel ${c.name}`);
      if (c.dataPtr + c.n * bytes > size) throw new Error(`Damaged .ld file (data of ${c.name} out of range)`);
      const k = 10 ** -c.dec / (c.scale || 1), out = new Float32Array(c.n);
      for (let i = 0, o = c.dataPtr; i < c.n; i++, o += bytes) {
        const raw = isFloat ? (bytes === 4 ? dv.getFloat32(o, true) : half(dv.getUint16(o, true)))
          : (bytes === 4 ? dv.getInt32(o, true) : dv.getInt16(o, true));
        out[i] = (raw * k + c.shift) * c.mul;
      }
      return (c.data = out);
    }

    const byName = new Map();
    channels.forEach(c => { if (!byName.has(c.name)) byName.set(c.name, c); });
    return {
      meta,
      channels,
      has: name => byName.has(name),
      // { name, unit, freq, n, data: Float32Array } or null
      channel(name) {
        const c = byName.get(name);
        return c ? { name: c.name, unit: c.unit, freq: c.freq, n: c.n, data: decode(c) } : null;
      },
    };
  }

  // Everything the slip-target view uses from a log, resampled (sample and hold) to the rate of phi_lean / slip / mu_x_rear:
  // { rate, n, duration, lean (signed deg), slip [%], mu, gear, tgt (ECU slip target [%]), red (DTC torque reduction [Nm]),
  //   redSource, vref, laps [{ a, b, name, full }], corners [{ n, ranges: [[a, b], ...] }], meta }.
  // Optional channels are null when the log does not have them.
  const REQUIRED = ['phi_lean', 'slip', 'mu_x_rear'];
  function sessionData(ld) {
    const missing = REQUIRED.filter(n => !ld.has(n));
    if (missing.length) throw new Error('Channel(s) missing from this log: ' + missing.join(', '));
    const [L, S, M] = REQUIRED.map(n => ld.channel(n));
    const rate = Math.max(L.freq, S.freq, M.freq);
    const duration = Math.min(L.n / L.freq, S.n / S.freq, M.n / M.freq);
    const n = Math.floor(duration * rate);
    const resample = c => {
      if (!c) return null;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = c.data[Math.min(c.n - 1, Math.floor(i * c.freq / rate))];
      return out;
    };
    const opt = name => (ld.has(name) ? ld.channel(name) : null);
    const d = { rate, n, duration, meta: ld.meta, lean: resample(L), slip: resample(S), mu: resample(M) };
    d.gear = resample(opt('Gear'));
    d.tgt = resample(opt('slip_tgt'));
    d.vref = resample(opt('v_ref'));
    d.lat = resample(opt('GPS Latitude'));        // track map (0 = no GPS fix)
    d.lon = resample(opt('GPS Longitude'));
    // DTC torque reduction: its own channel when logged, else requested torque − DTC torque target (never below 0)
    if (ld.has('md_dtc_reduction')) { d.red = resample(ld.channel('md_dtc_reduction')); d.redSource = 'md_dtc_reduction'; }
    else if (ld.has('md_req') && ld.has('md_tgt_dtc')) {
      const req = resample(ld.channel('md_req')), dtc = resample(ld.channel('md_tgt_dtc'));
      d.red = req.map((v, i) => Math.max(0, v - dtc[i]));
      d.redSource = 'md_req − md_tgt_dtc';
    } else { d.red = null; d.redSource = null; }
    d.laps = findLaps(opt('Running Lap Time'), duration);
    d.corners = findCorners(d, opt('s_track'));
    return d;
  }

  // Laps from the beacon times: at the first sample after "Running Lap Time" resets,
  // beacon = sample time − running lap time (matches i2's markers to ~1 ms).
  function findLaps(rlt, duration) {
    const marks = [];
    if (rlt) for (let i = 1; i < rlt.n; i++) {
      const prev = rlt.data[i - 1], cur = rlt.data[i];
      if (cur < prev - 0.5 || (prev === 0 && cur > 0)) {
        const t = i / rlt.freq - cur;
        if (t > 1 && t < duration - 1) marks.push(t);
      }
    }
    const b = [0, ...marks, duration], laps = [], segs = b.length - 1;
    for (let k = 0; k < segs; k++) {
      let name = 'Lap ' + k, full = true;
      if (segs >= 2 && k === 0) { name = 'Out lap'; full = false; }
      else if (segs >= 3 && k === segs - 1) { name = 'In lap'; full = false; }
      if (segs === 1) { name = 'Session'; full = false; }
      laps.push({ a: b[k], b: b[k + 1], name, full });
    }
    return laps;
  }

  // Corners: stretches of |lean| >= 15° that reach 30°, split where the bike changes side (chicanes). They are numbered
  // in track order on the fastest full lap; the corners of the other laps get the number of the reference corner at the
  // same lap distance (s_track, within 100 m) and on the same side. No full lap: no corners.
  const C_EDGE = 15, C_PEAK = 30, C_MIN_S = 0.5, C_TOL_M = 100, C_TOL_S = 3;
  function findCorners(d, sTrack) {
    const full = d.laps.filter(l => l.full);
    if (!full.length) return [];
    const ref = full.reduce((p, l) => (l.b - l.a < p.b - p.a ? l : p));
    const { lean, rate, n } = d;
    const segs = [];
    let s = null;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(lean[i]), side = lean[i] > 0 ? 1 : -1;
      if (s && (a < C_EDGE || side !== s.side)) { segs.push(s); s = null; }
      if (a >= C_EDGE) {
        if (!s) s = { i0: i, i1: i, side, peak: a, ip: i };
        s.i1 = i;
        if (a > s.peak) { s.peak = a; s.ip = i; }
      }
    }
    if (s) segs.push(s);
    const corners = segs.filter(c => c.peak >= C_PEAK && (c.i1 - c.i0) / rate >= C_MIN_S);
    // position along the lap: metres from the lap start (time when there is no s_track); the out lap is
    // measured back from its end (the beacon), as it does not start on the start line
    const dist = sTrack ? t => sTrack.data[Math.min(sTrack.n - 1, Math.floor(t * sTrack.freq))] : t => t;
    const tol = sTrack ? C_TOL_M : C_TOL_S;
    const refLen = dist(ref.b) - dist(ref.a);
    const lapOf = t => d.laps.find(l => t >= l.a && t < l.b) || d.laps[d.laps.length - 1];
    const pos = t => { const l = lapOf(t); return l.name === 'Out lap' ? refLen - (dist(l.b) - dist(t)) : dist(t) - dist(l.a); };
    // a corner matches a reference corner when its apex lies within the reference corner's extent (± tolerance),
    // so long corners match even when the apex moves along the arc
    const refs = corners.filter(c => c.ip / rate >= ref.a && c.ip / rate < ref.b)
      .map((c, k) => ({ n: k + 1, side: c.side, at0: pos(c.i0 / rate), at1: pos(c.i1 / rate), ranges: [],
        ref: [c.i0 / rate, (c.i1 + 1) / rate], apex: c.ip / rate }));     // where it is on the reference lap (track map)
    d.refLap = ref;
    corners.forEach(c => {
      const p = pos(c.ip / rate);
      let best = null, bd = Infinity;
      refs.forEach(r => {
        if (r.side !== c.side || p < r.at0 - tol || p > r.at1 + tol) return;
        const dd = Math.abs((r.at0 + r.at1) / 2 - p);
        if (dd < bd) { bd = dd; best = r; }
      });
      if (best) best.ranges.push([c.i0 / rate, (c.i1 + 1) / rate]);
    });
    return refs.map(r => ({ n: r.n, ranges: r.ranges, ref: r.ref, apex: r.apex }));
  }

  window.MotecLd = { parse, sessionData };
})();
