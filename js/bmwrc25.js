// Export to an M Race Calibration file (.bmwrc25, XML): the traction-control (DTC) parts of a base
// calibration are replaced with the prototype's settings; everything else in the file stays as it is.
//
// Every <map> / <characteristic> carries a CRC-16/X-25 (poly 0x1021 reflected, init 0xFFFF, xorout 0xFFFF)
// of its raw ECU data. Found from the team's files:
//   characteristic             [active, value]                        (torque_reduction_method: 1 byte)
//   slip_target_N              ... lean axis (16-bit BE x10), 23 bytes (μ axis), values (1 byte x10, row by row)
//   slip_target_alloc_<mode>   ... values (1 byte, map number, row by row)
//   slip_shift_fak             ... values (16-bit BE x2048)
//   slip_shift_ofst            ... values (signed 16-bit BE x100)
//   traction_control_mode      ... values (1 byte code per mode; codes known relative to mode 1 for modes 1..3)
// The data before the values (axes, header) is not needed: the CRC state after it is worked back from the
// base file's own CRC, and the CRC is linear, so a changed lean axis is corrected with its XOR difference.
(function () {
  const step = (c, b) => { c ^= b; for (let i = 0; i < 8; i++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1; return c; };
  const unstep = (c, b) => { for (let i = 0; i < 8; i++) c = c & 0x8000 ? (((c ^ 0x8408) << 1) | 1) & 0xffff : (c << 1) & 0xffff; return c ^ b; };
  const run = (c, bytes) => { for (const b of bytes) c = step(c, b); return c; };
  const back = (c, bytes) => { for (let i = bytes.length - 1; i >= 0; i--) c = unstep(c, bytes[i]); return c; };
  const x25 = bytes => run(0xffff, bytes) ^ 0xffff;

  const q = (v, s) => Math.round(v * s);
  const u8 = s => v => [q(v, s) & 255];
  const be16 = s => v => { const r = q(v, s) & 0xffff; return [r >> 8, r & 255]; };
  const DTC_CODE = { 1: 0, 2: 3, 3: 11 };            // mode code XOR the code of mode 1
  const dtc = v => { if (!(v in DTC_CODE)) throw new Error(`DTC mode ${v}: no ECU file with this mode was available to learn its code (modes 1-3 can be exported)`); return [DTC_CODE[v]]; };

  // numbers as M Race Calibration writes them: float32, 6 significant digits
  const fmt = v => String(Number(Math.fround(v).toPrecision(6)));

  function mapBlock(xml, name) {
    const re = new RegExp(`(<map name="${name}">)([\\s\\S]*?)(</map>)`);
    const m = xml.match(re);
    if (!m) throw new Error(`The base file has no map "${name}"`);
    const body = m[2];
    const x = body.match(/<suppoints_x[^>]*>([^<]*)</)[1].split(',').map(Number);
    const rows = [];
    body.replace(/<y(\d+)>([^<]*)<\/y\1>/g, (_, i, r) => { rows[+i] = r.split(',').map(Number); });
    const crc = parseInt(body.match(/<crc>([^<]*)</)[1], 16);
    return { re, body, x, rows, crc };
  }

  // Replace a map's values (and optionally its lean axis) and recalculate its CRC.
  function setMap(xml, name, rows, encode, axis) {
    const b = mapBlock(xml, name);
    if (rows.length !== b.rows.length || rows.some((r, i) => r.length !== b.rows[i].length))
      throw new Error(`${name}: size ${rows.length}x${rows[0].length} does not match the base file (${b.rows.length}x${b.rows[0].length})`);
    const flat = rs => rs.flat().flatMap(encode);
    let state = back(b.crc ^ 0xffff, flat(b.rows));    // CRC state before the values
    let body = b.body;
    if (axis) {                                        // lean axis: 16-bit BE x10, followed by 23 bytes (μ axis)
      if (axis.length !== b.x.length) throw new Error(`${name}: ${axis.length} lean points, the ECU map has ${b.x.length}`);
      const enc = a => a.flatMap(be16(10));
      const d = enc(b.x).map((v, i) => v ^ enc(axis)[i]);
      state ^= run(0, [...d, ...new Array(23).fill(0)]);
      body = body.replace(/(<suppoints_x[^>]*>)[^<]*(<)/, `$1${axis.map(fmt).join(',')}$2`);
    }
    const crc = run(state, flat(rows)) ^ 0xffff;
    body = body.replace(/<y(\d+)>[^<]*<\/y\1>/g, (_, i) => `<y${i}>${rows[+i].map(fmt).join(',')}</y${i}>`)
               .replace(/<crc>[^<]*</, `<crc>${crc.toString(16)}<`);
    return xml.replace(b.re, (_, a, __, c) => a + body + c);
  }

  function setCharacteristic(xml, name, value) {
    const re = new RegExp(`(<characteristic name="${name}">[\\s\\S]*?<active>)([^<]*)(</active>\\s*<value>)[^<]*(</value>\\s*<crc>)[^<]*(</crc>)`);
    const m = xml.match(re);
    if (!m) throw new Error(`The base file has no setting "${name}"`);
    const crc = x25([+m[2] & 255, value & 255]);
    return xml.replace(re, `$1$2$3${value}$4${crc.toString(16)}$5`);
  }

  // data: { targets: [{ id, lean: [10 ascending], rows: [μ row][10] }], allocation: { Rain: [6], ... },
  //         userShift: { fac: [15], off: [15] }, reduction: 0 | 1, dtcMode: { Rain, Int, Dry1, Dry2 }, desc, date }
  function exportBmwrc25(xml, data) {
    data.targets.forEach(t => {
      xml = setMap(xml, `slip_target_${t.id}`, t.rows.map(r => r.map(v => q(v, 10) / 10)), u8(10), t.lean.map(v => q(v, 10) / 10));
    });
    const sectors = n => new Array(15).fill(n);
    [['Rain', 'rain'], ['Int', 'int'], ['Dry1', 'dry1'], ['Dry2', 'dry2']].forEach(([m, key]) => {
      xml = setMap(xml, `slip_target_alloc_${key}`, data.allocation[m].map(sectors), u8(1));
    });
    xml = setMap(xml, 'traction_control_mode', ['Rain', 'Int', 'Dry1', 'Dry2'].map(m => sectors(data.dtcMode[m])), dtc);
    const shiftRows = (vals, s) => new Array(15).fill(0).map(() => vals.map(v => q(v, s) / s));
    xml = setMap(xml, 'slip_shift_fak', shiftRows(data.userShift.fac, 2048), be16(2048));
    xml = setMap(xml, 'slip_shift_ofst', shiftRows(data.userShift.off, 100), be16(100));
    xml = setCharacteristic(xml, 'torque_reduction_method', data.reduction);
    if (data.desc) xml = xml.replace(/<desc>[^<]*<\/desc>/, `<desc>${data.desc.replace(/[<&]/g, '')}</desc>`);
    if (data.date) xml = xml.replace(/<date>[^<]*<\/date>/, `<date>${data.date}</date>`);
    return xml;
  }

  window.Bmwrc25 = { exportBmwrc25, x25 };
})();
