(function () {
  const D = window.MRCK_DATA;
  // Every map starts with calculated mu lines (Same for all points / Ratio), fitted to its data.
  D.targets.forEach(t => MuLines.ensure(t));
  const GEAR_COLORS = SlipChart.GEAR_COLORS;
  // STK: a map per gear (#1..#6); PRO: a map per track sector (S1..S15). "gear" in the code below is the
  // allocation column of the active variant (data.js MRCK_SLOTS: n, pre, one, many, list).
  const SL = () => window.MRCK_SLOTS();
  const slotTag = gi => SL().pre + (gi + 1);
  // slot indices as tags, runs of 3 or more joined: S1–S15, #1 #2
  const runTags = (gis, tag) => {
    const out = [];
    gis.forEach(gi => { const r = out[out.length - 1]; if (r && gi === r[1] + 1) r[1] = gi; else out.push([gi, gi]); });
    return out.flatMap(([a, b]) => (b - a >= 2 ? [`${tag(a)}–${tag(b)}`] : a === b ? [tag(a)] : [tag(a), tag(b)]));
  };
  const slotTags = gis => runTags(gis, slotTag);
  const usedSlots = (m, id) => gearLine(m).map((x, i) => (x === id ? i : -1)).filter(i => i >= 0);
  // 15 sector colours along the gear palette
  const SECTOR_COLORS = (() => {
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), n = D.SECTORS;
    return Array.from({ length: n }, (_, i) => {
      const x = i / (n - 1) * (GEAR_COLORS.length - 1), k = Math.min(GEAR_COLORS.length - 2, Math.floor(x)), f = x - k;
      const a = hex(GEAR_COLORS[k]), b = hex(GEAR_COLORS[k + 1]);
      return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * f).toString(16).padStart(2, '0')).join('');
    });
  })();
  const slotColors = () => GEAR_COLORS;               // the graph compares gears in STK and PRO
  const $ = id => document.getElementById(id);
  // PRO: the sector is a third dimension above the gear: allocPro[mode][sector][gear]; STK: allocStk[mode][gear].
  // state.cell = { mode, gear, sec } is the allocation cell in focus (sec: PRO only). A(m, g, s) reads a cell.
  const pro = () => D.variant === 'pro';
  const A = (m, g, s = state.cell.sec) => (pro() ? D.allocPro[m][s][g] : D.allocStk[m][g]);
  const setA = (m, g, s, id) => { if (pro()) D.allocPro[m][s][g] = id; else D.allocStk[m][g] = id; };
  const secTag = s => 'S' + (s + 1);
  const secSuffix = () => (pro() ? ' · ' + secTag(state.cell.sec) : '');
  const nSec = () => D.trackDet.ends.filter(x => x < 99999).length;
  // the graph's gear comparison: the maps of a riding mode along the gears (at the sector in focus in PRO)
  const lineMode = () => (state.tab === 'sectors' ? state.cell.mode : state.vmode);
  const gearLine = (m = lineMode()) => SL().list.map((g, gi) => A(m, gi));

  const state = { tab: 'modes', targetIndex: 0, muIndex: D.MU_BASE, vmode: 'Dry1' };
  // Start with no map selected on Modes / Gears / All slip target maps: every map is drawn the same
  // until one is picked (line, label, map list, allocation cell). Picking a mode or gear does not select a map.
  state.noSel = true;
  const noSel = () => state.noSel && ['modes', 'gears', 'sectors', 'maps'].includes(state.tab);
  const undo = [], redo = [];
  const snapshot = () => JSON.stringify(D.targets[state.targetIndex]);
  const restore = (json, idx) => { D.targets[idx] = JSON.parse(json); };
  const indexOf = id => D.targets.findIndex(t => t.id === id);

  const chart = new SlipChart($('chart'), {
    targets: D.targets, muRows: D.MU_ROWS, log: null,
    onEditStart() { pushUndo(); },
    // μ lines: Degressive follows the edited anchors; Ratio recalculates every other line from the edited one.
    onChange(t) { if (t.mu && t.mu.mode === 'ratio') t.mu.ref = state.muIndex; MuLines.derive(t); syncMuPanel(); },   // ratio: the edited line is the reference
    onInsert(t, idx) { MuLines.insertPoint(t, idx); },
    onEmptyClick() { deselectMap(); },
    onDelete(t, idx) { MuLines.deletePoint(t, idx); },
    onSelectMu(i) { state.muIndex = i; sync(); },
    onPick(k) { pickLevel(k); },                     // +- Buttons: a level line / label was clicked
    onSelectTarget(id) {
      state.noSel = false;
      state.targetIndex = indexOf(id);
      if (state.tab === 'gears') {
        const m = D.VEHICLE_MODES.find(x => A(x, state.cell.gear) === id);
        if (m) state.cell = { ...state.cell, mode: m };
      } else {
        const gi = gearLine().indexOf(id);
        if (gi >= 0) state.cell = { ...state.cell, mode: lineMode(), gear: gi };
      }
      sync();
    },
  });

  // Every undo entry records where and what changed (shown in the Changes panel) plus a snapshot:
  // map edits { map, json }, allocation edits (gear -> map) { alloc }.
  const cellName = (mode, gear, sec) => `${MODE_NAMES[mode] || mode} ${slotTag(gear)}${pro() ? ' ' + secTag(sec ?? state.cell.sec) : ''}`;
  function where() {
    const t = D.targets[state.targetIndex];
    if (state.tab === 'modes' || state.tab === 'sectors') {
      const m = lineMode(), g = slotTags(usedSlots(m, t.id));
      if (g.length) return `${MODE_NAMES[m]} ${g.join(', ')}${secSuffix()}`;
    }
    if (state.tab === 'gears') {
      const ms = D.VEHICLE_MODES.filter(m => A(m, state.cell.gear) === t.id).map(m => MODE_NAMES[m]);
      if (ms.length) return `${ms.join(', ')} ${slotTag(state.cell.gear)}${secSuffix()}`;
    }
    return `Map ${t.id}`;
  }
  function record(entry) { undo.push(Object.assign({ time: Date.now() }, entry)); redo.length = 0; syncHistory(); }
  // Visitor log (track.js): the current tab name goes with every event
  const track = (kind, detail) => {
    if (!window.MRCK_TRACK) return;
    const tb = document.querySelector('.tabs [role="tab"][aria-selected="true"]');
    window.MRCK_TRACK(kind, tb ? tb.textContent.trim() : null, detail);
  };
  const editedMaps = new Set();                // the first edit of each map per visit is logged
  function pushUndo(desc) {
    const id = D.targets[state.targetIndex].id;
    if (!editedMaps.has(id)) { editedMaps.add(id); track('action', `Edit map ${id}`); }
    record({ label: where(), desc: `Map ${id} · ${desc || 'slip target edited'}`, map: state.targetIndex, json: snapshot() });
  }
  function pushAllocUndo(label, desc) { if (pro()) D.trackDet.example = false; record({ label, desc, alloc: JSON.stringify(D.allocation), variant: D.variant }); }

  // --- mu line settings (All slip target maps) ---
  // Degressive: μ 1.00, max (1.60) and min (-0.25) are edited, the levels between follow a degression.
  // Ratio: every level is the level below x (1 + ratio); any line can be edited, the others follow it.
  // Custom values: every line is edited on its own.  (see mu-lines.js)
  const fmtMu = m => 'μ ' + m.toFixed(2);

  // Changing the mode refits the degression (Degressive) / keeps the edited line (Ratio), then recalculates.
  function setMu(patch) {
    const t = D.targets[state.targetIndex], m = MuLines.ensure(t);
    if (Object.keys(patch).every(k => m[k] === patch[k])) return;
    pushUndo('μ level settings');
    Object.assign(m, patch);
    if (m.mode === 'ratio') { m.ref = state.muIndex; if (!Number.isFinite(m.ratio)) m.ratio = 10; }
    MuLines.fit(t);
    MuLines.derive(t);
    if (MuLines.lockedRows(t).includes(state.muIndex)) state.muIndex = MuLines.anchors().base;
    sync();
  }
  $('muMode').onclick = e => { const b = e.target.closest('button'); if (b) setMu({ mode: b.dataset.v }); };

  // Slider + number field: Degression (0..1) or Ratio (0..25 %).
  const SLIDER = {
    deg: { name: 'Degression', min: 0, max: 1, step: 0.05, dec: 2, unit: '' },
    ratio: { name: 'Ratio', min: 0, max: 25, step: 0.5, dec: 1, unit: '%' },
  };
  let inputUndo = false;
  $('muTables').addEventListener('focusin', () => { inputUndo = false; });
  $('muTables').addEventListener('input', e => {
    const inp = e.target.closest('input'); if (!inp) return;
    const S = SLIDER[inp.dataset.kind];
    let v = parseFloat(inp.value.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    v = Math.max(S.min, Math.min(S.max, v));
    const t = D.targets[state.targetIndex], m = MuLines.ensure(t);
    if (!inputUndo) { pushUndo('μ level ' + S.name.toLowerCase()); inputUndo = true; }
    const pt = inp.dataset.pt;
    if (inp.dataset.kind === 'ratio') { m.ratio = v; m.ref = state.muIndex; }     // the selected line stays put
    else if (pt === '') m.deg = v; else m.ptDeg[+pt] = v;
    // keep the slider and number field of this value in step
    inp.closest('.mu-ctl').querySelectorAll('input').forEach(o => { if (o !== inp) o.value = o.type === 'range' ? v : fmtVal(v, S); });
    MuLines.derive(t);
    chart.render();
    if (!$('tableView').hidden) mapGrid.render();
    if (state.tab === 'sim') simView.render();          // Simulation: the μ levels and the simulated target follow at once
  });
  $('muTables').addEventListener('focusout', e => {
    const inp = e.target.closest('input[type="text"]'); if (inp) inp.value = fmtVal(valueOf(inp), SLIDER[inp.dataset.kind]);
  });
  const fmtVal = (v, S) => (Math.round(v * 100) / 100).toFixed(S ? S.dec : 2);
  function valueOf(inp) {
    const m = MuLines.ensure(D.targets[state.targetIndex]), pt = inp.dataset.pt;
    const v = inp.dataset.kind === 'ratio' ? m.ratio : pt === '' ? m.deg : m.ptDeg[+pt];
    return Number.isFinite(v) ? v : inp.dataset.kind === 'ratio' ? 10 : 0;
  }

  let muKey = '';
  function syncMuPanel() {
    const t = D.targets[state.targetIndex], m = MuLines.ensure(t);
    $('muPanel').hidden = noSel();
    [...$('muMode').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.v === m.mode));
    // ⓘ tooltip next to the μ LINES label
    const an = MuLines.anchors(), muv = D.MU_ROWS;
    const anchorsTxt = fmtMu(muv[an.base]) + ', ' + fmtMu(muv[an.max]) + ' (max) and ' + fmtMu(muv[an.min]) + ' (min)';
    $('muInfoTip').textContent =
      m.mode === 'uniform' ? 'Degressive: edit ' + anchorsTxt + '. Degression 0 = equal steps, 0.5 = each level halfway to max / min, 1 = all at max / min.'
      : m.mode === 'ratio' ? 'Fix ratio: each μ level is the level below it × (1 + ratio), e.g. 10 % → 10, 11, 12.1 %. Edit any line; the others are calculated from it.'
      : 'Custom values: every μ line is edited on its own.';

    // Rebuild the controls only when their structure changes, so sliding keeps focus.
    const key = [state.targetIndex, m.mode, t.lean.join(',')].join('|');
    const inputs = [...$('muTables').querySelectorAll('input')];
    if (key === muKey) {
      inputs.forEach(inp => {
        if (inp === document.activeElement) return;
        const v = valueOf(inp); inp.value = inp.type === 'range' ? v : fmtVal(v, SLIDER[inp.dataset.kind]);
      });
      return;
    }
    muKey = key;
    const ctl = (kind, pt, label) => {
      const S = SLIDER[kind], aria = S.name + (pt !== '' ? ' at ' + t.lean[pt] + '°' : '');
      // a single slider gets its label on top; per-point sliders keep a short label on the left
      return `<div class="mu-ctl${pt === '' ? ' stacked' : ''}"><span class="mu-lbl">${label}</span>` +
        `<input type="range" min="${S.min}" max="${S.max}" step="${S.step}" data-kind="${kind}" data-pt="${pt}" aria-label="${aria}">` +
        `<input type="text" inputmode="decimal" data-kind="${kind}" data-pt="${pt}" aria-label="${aria} value">` +
        (S.unit ? `<span class="mu-unit">${S.unit}</span>` : '') + '</div>';
    };
    let html = '';
    if (m.mode === 'uniform') html = `<div class="mu-grid">${ctl('deg', '', 'Degression')}</div>`;
    else if (m.mode === 'ratio') html = `<div class="mu-grid">${ctl('ratio', '', 'Ratio between μ levels')}</div>`;
    else if (m.mode === 'point') html = '<div class="mu-block"><div class="mu-cap">Degression per target point</div><div class="mu-grid">' +
      t.lean.map((x, j) => ctl('deg', j, x + '°')).join('') + '</div></div>';
    $('muTables').innerHTML = html;
    $('muTables').querySelectorAll('input[type="range"]').forEach(r => RangeUI.attach(r, { txt: r.parentNode.querySelector('input[type="text"]') }));   // scale + checked value field
    $('muTables').querySelectorAll('input').forEach(inp => {
      const v = valueOf(inp); inp.value = inp.type === 'range' ? v : fmtVal(v, SLIDER[inp.dataset.kind]);
    });
  }

  // --- views ---------------------------------------------------------------
  // Modes:  vehicle mode (Rain / Intermediate / Dry 1 / Dry 2) -> gear -> map, shown as the gear comparison.
  // Maps:   the 15 slip target maps themselves. Modes only point at map numbers, so an edit
  //         to a map shows up everywhere that map is used.
  const MODE_NAMES = { Rain: 'Rain', Int: 'Int', Dry1: 'Dry 1', Dry2: 'Dry 2' };

  document.querySelectorAll('.tabs [role="tab"]').forEach(b => {
    b.onclick = () => {
      // remember what the user picked in the left column of the tab being left
      if (state.tab === 'modes') state.memMode = state.vmode;
      if (state.tab === 'gears') state.memGear = state.cell.gear;
      if (state.tab === 'sectors') state.memSec = state.cell.sec;
      state.tab = b.dataset.tab; state.picker = false;
      // when a tab is opened: the last pick on that tab, else the defaults Riding modes -> Dry 1, Gears -> #2, Sectors -> S1
      if (state.tab === 'modes') { const m = state.memMode || 'Dry1'; state.vmode = m; state.cell = { ...state.cell, mode: m }; }
      if (state.tab === 'gears') state.cell = { ...state.cell, gear: state.memGear ?? 1 };
      if (state.tab === 'sectors') state.cell = { ...state.cell, sec: Math.min(state.memSec ?? 0, Math.max(0, nSec() - 1)) };
      if (state.tab === 'user') state.targetIndex = indexOf(A('Dry1', 1));   // +- Buttons: the map of Dry 1 #2
      sync();
      track('tab');
    };
  });

  // Gears view: the maps the 4 vehicle modes use in one gear, one colour per mode.
  const MODE_COLORS = { Rain: '#3f8ce8', Int: '#3fa8a4', Dry1: '#e5a634', Dry2: '#d9354b' };
  const MODE_SHORT = { Rain: 'RN', Int: 'IN', Dry1: 'D1', Dry2: 'D2' };
  const gearColumn = () => D.VEHICLE_MODES.map(m => A(m, state.cell.gear));
  const gearSeries = () => D.VEHICLE_MODES.map(m => ({
    id: A(m, state.cell.gear), name: MODE_SHORT[m], desc: MODE_NAMES[m],   // graph label short (RN / IN / D1 / D2), full name in the tooltip
    color: MODE_COLORS[m] || '#3f8ce8',
  }));
  // Left column (Gears view): gears as vertical tabs, each showing the map every mode uses.
  function selectGear(gi) {
    gi = Math.max(0, Math.min(SL().n - 1, gi));
    state.cell = { ...state.cell, gear: gi };
    state.targetIndex = indexOf(A(state.cell.mode, gi));
    sync();
  }
  // PRO Sectors tab: the sector in focus (the second row of tabs)
  function selectSec(s) {
    s = Math.max(0, Math.min(nSec() - 1, s));
    state.cell = { ...state.cell, sec: s };
    state.targetIndex = indexOf(A(state.cell.mode, state.cell.gear, s));
    sync();
  }
  function buildGearList() {
    $('gearList').innerHTML = SL().list.map((g, gi) =>
      `<button role="option" class="pk" data-g="${gi}" aria-label="${SL().one} ${gi + 1}"><span class="pk-name">${slotTag(gi)}</span><span class="pk-use"></span></button>`).join('');
  }
  buildGearList();
  $('gearList').addEventListener('click', e => { const b = e.target.closest('.pk'); if (b) selectGear(+b.dataset.g); });

  // --- Settings: reduction method ---
  $('reduction').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    D.settings.reduction = b.dataset.v; sync();
  };

  // --- Settings: DTC mode (manual 5.2) â one mode type per riding mode ---
  const DTC_MODES = ['Base setting', '25% higher gain - more restrictive', 'More restrictive for sudden, aggressive slides',
    '15% higher dynamic gain; no softcuts', 'WSBK base mode 1; μx overriding', 'WSBK base mode 2; μx overriding'];
  if (!D.settings.dtcMode) D.settings.dtcMode = { Rain: 1, Int: 1, Dry1: 1, Dry2: 1 };
  $('dtcModeTbl').innerHTML =
    `<thead><tr><th class="corner">Mode</th>${D.VEHICLE_MODES.map(m => `<th scope="col">${MODE_NAMES[m]}</th>`).join('')}</tr></thead><tbody>` +
    DTC_MODES.map((name, i) => `<tr><th scope="row"><b>${i + 1}</b>${name}</th>` +
      D.VEHICLE_MODES.map(m => `<td><label><input type="radio" name="dtc-${m}" value="${i + 1}" aria-label="${MODE_NAMES[m]}: ${name}"></label></td>`).join('') + '</tr>').join('') + '</tbody>';
  $('dtcModeTbl').addEventListener('change', e => {
    const m = e.target.name.slice(4); D.settings.dtcMode[m] = +e.target.value;
  });
  function syncDtcMode() {
    $('dtcModeTbl').querySelectorAll('input').forEach(r => { r.checked = D.settings.dtcMode[r.name.slice(4)] === +r.value; });
  }

  // --- +- Buttons: rider DTC +/- buttons, user level -7..+7 (manual 5.6) ---
  // Effective slip target = slip target × User Factor + User Offset.
  // "+" = more traction control: level k gets factor 1 − k·facStep and offset −k·offStep.
  const US = D.userShift, STEPS = D.SHIFT_STEPS;
  const SHIFT = {
    fac: { name: 'User Factor [-]', dec: 2, step: 'facStep', fill: (k, v) => 1 - k * v, slider: 'shiftFac', txt: 'shiftFacTxt' },
    off: { name: 'User Offset [%]', dec: 1, q: 0.1, step: 'offStep', fill: (k, v) => -k * v, slider: 'shiftOff', txt: 'shiftOffTxt' },
  };
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const fmtN = (v, d) => round(v, d).toFixed(d);
  const fmtStep = v => String(round(v, 3));
  const lvl = k => (k > 0 ? '+' + k : k < 0 ? '−' + -k : '0');

  // Table: spreadsheet like the allocation table (rows factor / offset, columns user level; level 0 editable too).
  const KINDS = ['fac', 'off'];
  const shiftGrid = new SheetGrid($('shiftTbl'), {
    label: 'User factor and offset per user level',
    corner: 'user level',
    rows: KINDS.map(k => SHIFT[k].name),
    cols: STEPS.map(lvl),
    // a level column header selects that level in the graph (click again: back to μ 1.00)
    onColHeader(c) { pickLevel(state.shiftLvl === STEPS[c] ? null : STEPS[c]); },
    headerActive: (kind, i) => kind === 'col' && state.shiftLvl === STEPS[i],
    get: (r, c) => US[KINDS[r]][c],
    format: (v, r) => fmtN(v, SHIFT[KINDS[r]].dec),
    parse: s => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; },
    write(cells) {
      cells.forEach(({ r, c, v }) => { US[KINDS[r]][c] = round(v, SHIFT[KINDS[r]].dec); });
      renderChart();
      return cells.length;
    },
    onMessage: msg => flash('shiftMsg', msg),
  });

  // The per-level sliders fill all levels evenly.
  function fillShift(kind, v) {
    const S = SHIFT[kind];
    US[S.step] = v;
    US[kind] = STEPS.map(k => round(S.fill(k, v), S.dec));
    syncShift(); renderChart();
  }
  Object.entries(SHIFT).forEach(([kind, S]) => {
    RangeUI.attach($(S.slider), { txt: $(S.txt) });                 // scale + checked value field (range-ui.js)
    $(S.slider).addEventListener('input', () => fillShift(kind, +$(S.slider).value));
    $(S.txt).addEventListener('input', () => { const v = parseFloat($(S.txt).value.replace(',', '.')); if (Number.isFinite(v)) fillShift(kind, S.q ? round(Math.round(v / S.q) * S.q, 3) : v); });   // offset: 0.1 % steps
    $(S.txt).addEventListener('blur', () => { $(S.txt).value = fmtStep(US[S.step]); });
  });

  function syncShift() {
    Object.entries(SHIFT).forEach(([kind, S]) => {
      if (document.activeElement !== $(S.slider)) $(S.slider).value = US[S.step];
      if (document.activeElement !== $(S.txt)) $(S.txt).value = fmtStep(US[S.step]);
    });
    shiftGrid.render();
    // column headers in the level colours of the graph
    $('shiftTbl').querySelectorAll('thead th[data-hc]').forEach(th => { th.style.setProperty('--lc', shiftColor(STEPS[+th.dataset.hc])); });
  }

  // Graph: every user level on the selected map's μ row. "−" levels (less DTC) in reds,
  // "+" levels (more DTC) in teals, stronger towards ±7. Level 0 only when it is not neutral.
  // Level colours: going up (− levels, more slip) yellow → red → purple; going down (+ levels) light → dark blue.
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  function shiftColor(k) {
    if (!k) return '#ffffff';
    const t = (Math.abs(k) - 1) / 6;                        // level ±1 -> 0, ±7 -> 1
    if (k > 0) return mix('#199eff', '#3346e0', t);
    return t < 0.5 ? mix('#e5a634', '#d9354b', t * 2) : mix('#d9354b', '#9c1f62', t * 2 - 1);
  }
  $('shiftMap').innerHTML = D.targets.map(t => `<option value="${t.id}">Map ${t.id}</option>`).join('');
  $('shiftMap').onchange = e => { state.targetIndex = indexOf(+e.target.value); sync(); };

  // Selected level (state.shiftLvl, null = the map's μ 1.00 line): drawn bold with its values; the others stay thin.
  state.shiftLvl = null;
  function pickLevel(k) { state.shiftLvl = k; renderChart(); syncShift(); }
  const shiftVals = i => D.targets[state.targetIndex].rows[state.muIndex].map(v => Math.max(0, Math.min(25.5, round(v * US.fac[i] + US.off[i], 1))));
  function shiftOverlays() {
    const t = D.targets[state.targetIndex], sel = state.shiftLvl;
    const list = STEPS.map((k, i) => ({ k, i })).filter(({ k, i }) => k !== sel && (k !== 0 || US.fac[i] !== 1 || US.off[i] !== 0)).map(({ k, i }) => {
      const fac = US.fac[i], off = US.off[i], a = Math.abs(k);
      return {
        key: 'shift' + k, lean: t.lean, dotted: false, locked: false, pick: k,
        color: shiftColor(k),
        alpha: 0.35 + a * 0.09,
        vals: shiftVals(i),
        label: lvl(k),
        tip: `User level ${lvl(k)}: × ${fmtN(fac, 2)} ${off >= 0 ? '+' : '−'} ${fmtN(Math.abs(off), 1)} %` + (k ? ` · ${k > 0 ? 'earlier, more DTC' : 'later, less DTC'}` : '') + ' · click to show its values',
      };
    });
    // a level is selected: the map's own line becomes a thin, clickable line as well
    if (sel != null) list.push({ key: 'shiftBase', lean: t.lean, dotted: false, locked: false, pick: null, color: '#3f8ce8', alpha: 1,
      vals: t.rows[state.muIndex], label: fmtMu(D.MU_ROWS[state.muIndex]), tip: 'Map line (user level 0) · click to show its values' });
    return list;
  }

  // Left column (Modes view): vehicle modes as vertical tabs, each showing its map per gear.
  function selectMode(i) {
    const m = D.VEHICLE_MODES[Math.max(0, Math.min(D.VEHICLE_MODES.length - 1, i))];
    state.vmode = m;
    state.cell = { ...state.cell, mode: m };
    sync();
  }
  $('modeList').innerHTML = D.VEHICLE_MODES.map((m, i) =>
    `<button role="option" class="pk" data-i="${i}"><span class="pk-name">${MODE_NAMES[m] || m}</span><span class="pk-use"></span></button>`).join('');
  $('modeList').addEventListener('click', e => { const b = e.target.closest('.pk'); if (b) selectMode(+b.dataset.i); });

  // Left column, contextual: the 15 maps (All slip target maps / User offset views).
  // In the All slip target maps view every other map is drawn in the background in its own colour.
  // Map colours (Map 1 = violet ... Map 15 = blue), same order as the gear colours: lowest number = bottom of the swatch
  const MAP_COLORS = ['#6506a4', '#a716b4', '#a40663', '#e22046', '#eb380b', '#eb610b', '#eba40b', '#e2cf00',
    '#87bf05', '#0cad4f', '#009750', '#00b0b7', '#189eff', '#008aee', '#0042e8'];
  const mapColor = id => MAP_COLORS[(id - 1) % MAP_COLORS.length];
  $('mapList').innerHTML = D.targets.map(t =>
    `<button role="option" class="pk" data-id="${t.id}"><span class="pk-name"><i class="sw" style="background:${mapColor(t.id)}"></i>Map <span class="num">${t.id}</span></span><span class="pk-use"></span></button>`).join('');
  $('mapList').addEventListener('click', e => {
    const b = e.target.closest('.pk'); if (!b) return;
    state.targetIndex = indexOf(+b.dataset.id); state.noSel = false; sync();
  });
  $('mapList').addEventListener('mouseover', e => {
    if (state.tab !== 'maps') return;
    const b = e.target.closest('.pk');
    chart.preview(b && indexOf(+b.dataset.id) !== state.targetIndex ? 't' + b.dataset.id : null);
  });
  $('mapList').addEventListener('mouseleave', () => { if (state.tab === 'maps') chart.preview(null); });

  // B tabs: the left-column navigation (riding modes / gears / maps) as a second row of tabs.
  function syncSubTabs(on, self) {
    const el = $('subTabs');
    el._html = null;                                          // the Adaptive Rider Request tab fills it itself (arr-view.js)
    el.hidden = !on && !(state.tab === 'arr' && logView.loaded);
    if (!on) return;
    const items = state.tab === 'modes' ? ['Dry1', 'Dry2', 'Rain', 'Int'].map(m => ({ k: 'mode', v: D.VEHICLE_MODES.indexOf(m), label: MODE_NAMES[m], sel: m === state.vmode }))
      : state.tab === 'gears' ? SL().list.map((g, gi) => ({ k: 'gear', v: gi, label: slotTag(gi), sel: gi === state.cell.gear }))
      : state.tab === 'sectors' ? Array.from({ length: nSec() }, (_, s) => ({ k: 'sec', v: s, label: secTag(s), sel: s === state.cell.sec }))
      : [{ k: 'all', v: 0, label: '<i class="sw sw-all"></i>All', sel: noSel() },   // All: no map selected, every map shown
         ...D.targets.map(t => ({ k: 'map', v: t.id, label: `<i class="sw" style="background:${mapColor(t.id)}"></i>Map ${t.id}`, sel: !noSel() && t.id === self.id }))];
    el.setAttribute('aria-label', state.tab === 'modes' ? 'Riding modes' : state.tab === 'gears' ? SL().many : state.tab === 'sectors' ? 'Sectors' : 'Slip target maps');
    el.innerHTML = items.map(it => `<button role="tab" data-k="${it.k}" data-v="${it.v}" aria-selected="${it.sel}">${it.label}</button>`).join('');
  }
  $('subTabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.k === 'arrGear') return;   // gears of Adaptive Rider Request: arr-view.js
    const v = +b.dataset.v;
    if (b.dataset.k === 'all') { state.noSel = true; sync(); return; }
    if (b.dataset.k === 'mode') selectMode(v);
    else if (b.dataset.k === 'gear') selectGear(v);
    else if (b.dataset.k === 'sec') selectSec(v);
    else { state.targetIndex = indexOf(v); state.noSel = false; sync(); }
  });
  $('subTabs').addEventListener('mouseover', e => {
    if (state.tab !== 'maps') return;
    const b = e.target.closest('button[data-k="map"]');
    chart.preview(b && indexOf(+b.dataset.v) !== state.targetIndex ? 't' + b.dataset.v : null);
  });
  $('subTabs').addEventListener('mouseleave', () => { if (state.tab === 'maps') chart.preview(null); });

  // Interpolation calculation style: a setting of each map (target.smooth) — straight segments or smooth (monotone) curves.
  $('lineStyle').onclick = e => {
    const b = e.target.closest('button'), t = D.targets[state.targetIndex];
    if (!b || (b.dataset.v === 'smooth') === !!t.smooth) return;
    pushUndo(`interpolation ${b.dataset.v}`);
    t.smooth = b.dataset.v === 'smooth'; sync();
  };

  // Arrow keys move through a vertical list of map buttons (Home / End jump to the ends).
  function listKeys(list, onMove) {
    list.addEventListener('keydown', e => {
      const items = [...list.querySelectorAll('.pk')];
      const cur = items.indexOf(document.activeElement.closest('.pk'));
      const i = cur < 0 ? items.findIndex(b => b.getAttribute('aria-selected') === 'true') : cur;
      const next = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: items.length - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      const b = items[Math.max(0, Math.min(items.length - 1, next))];
      onMove(b);
      b.focus();
    });
  }
  // Map list: moving selects the map.
  listKeys($('mapList'), b => { state.targetIndex = indexOf(+b.dataset.id); state.noSel = false; sync(); });
  listKeys($('gearList'), b => selectGear(+b.dataset.g));
  listKeys($('modeList'), b => selectMode(+b.dataset.i));

  // ↑ / ↓ buttons next to the list title, and the arrow keys when nothing else on the page
  // uses them (no table cell, input, chart point, list or menu focused).
  function stepMap(dir) {
    if (state.noSel) { state.noSel = false; sync(); return; }   // first arrow press selects the current map
    const i = Math.max(0, Math.min(D.targets.length - 1, state.targetIndex + dir));
    if (i === state.targetIndex) return;
    state.targetIndex = i;
    sync();
    const b = $('mapList').querySelector(`.pk[data-id="${D.targets[i].id}"]`);
    if (b) b.scrollIntoView({ block: 'nearest' });
  }
  // B tabs: ← / → step through the second row of tabs (in its order, "All" included), with the same
  // conditions as ↑ / ↓ below (nothing else on the page using the arrow keys).
  document.addEventListener('keydown', e => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const sub = $('subTabs');
    if (sub.hidden || state.editor || state.picker || !$('pasteMenu').hidden) return;
    const a = document.activeElement;
    if (a && a !== document.body && !sub.contains(a) && a.closest('input, select, textarea, table, svg, [role="listbox"], [role="menu"], .mu-tables')) return;
    const items = [...sub.querySelectorAll('button:not(:disabled)')];
    const cur = items.findIndex(b => b.getAttribute('aria-selected') === 'true');
    const next = items[Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)))];
    e.preventDefault();
    if (!next || next === items[cur]) return;
    const k = next.dataset.k, v = next.dataset.v;
    next.click();
    const b = sub.querySelector(`button[data-k="${k}"][data-v="${v}"]`);   // the row is rebuilt on sync
    if (b) { b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (sub.contains(a)) b.focus(); }
  });
  document.addEventListener('keydown', e => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const gearsOn = state.tab === 'gears', modesOn = state.tab === 'modes', secsOn = state.tab === 'sectors';
    if (state.editor || (!gearsOn && !modesOn && !secsOn && $('sideCtx').hidden) || state.picker || !$('pasteMenu').hidden) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.closest('input, select, textarea, table, svg, [role="listbox"], [role="menu"], .mu-tables')) return;
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    if (gearsOn) selectGear(state.cell.gear + dir);
    else if (secsOn) selectSec(state.cell.sec + dir);
    else if (modesOn) selectMode(D.VEHICLE_MODES.indexOf(state.vmode) + dir);
    else stepMap(dir);
  });
  // Display (All slip target maps): μ levels of the selected map on / off, and which other maps
  // are drawn in the background (the selected map is always shown).
  state.showMu = true;
  // Map filter: empty = every map is shown (all chips off); once chips are switched on, only those maps.
  state.mapFilter = new Set();
  const mapShown = id => state.mapFilter.size === 0 || state.mapFilter.has(id);
  $('muLevelsSw').onclick = () => { state.showMu = !state.showMu; sync(); };
  $('mapFilter').innerHTML = D.targets.map(t =>
    `<button class="chip" data-id="${t.id}" style="--mc:${mapColor(t.id)}" title="Show Map ${t.id} in the background">${t.id}</button>`).join('');
  $('mapFilter').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b || b.disabled) return;
    const id = +b.dataset.id;
    if (state.mapFilter.has(id)) state.mapFilter.delete(id); else state.mapFilter.add(id);
    sync();
  });
  $('mapFilterReset').onclick = () => { state.mapFilter.clear(); sync(); };
  function syncDisplay(self) {
    $('sideShow').hidden = state.tab !== 'maps';
    $('muLevelsSw').hidden = noSel();               // μ levels belong to a selected map
    $('muLevelsSw').setAttribute('aria-checked', state.showMu);
    $('muLevelsSw').querySelector('.material-icons').textContent = state.showMu ? 'toggle_on' : 'toggle_off';
    $('sideShow').querySelector('.side-sub').textContent = state.mapFilter.size ? `Maps to show · ${state.mapFilter.size} chosen` : 'Maps to show';
    $('mapFilterReset').hidden = !state.mapFilter.size;           // reset icon: back to all maps
    [...$('mapFilter').children].forEach(b => {
      const id = +b.dataset.id, cur = !noSel() && id === self.id;
      b.setAttribute('aria-pressed', state.mapFilter.has(id));
      b.classList.toggle('is-current', cur);
      b.disabled = cur;
      b.title = cur ? `Map ${id} is selected` : state.mapFilter.has(id) ? `Remove Map ${id} from the filter` : `Show only the chosen maps: add Map ${id}`;
    });
  }

  function allMapsOverlays() {
    const self = D.targets[state.targetIndex];
    const na = noSel();
    // Nothing selected: the maps of the filter (all when none chosen). A map selected: only the maps the user
    // added in the filter, next to it, at full strength.
    const shown = id => (na ? mapShown(id) : id !== self.id && state.mapFilter.has(id));
    return D.targets.filter(t => shown(t.id)).map(t => ({
      key: 't' + t.id, target: t.id, locked: false, dotted: false, color: mapColor(t.id),
      lean: t.lean, vals: t.rows[state.muIndex], label: 'M' + t.id, tip: `Click to edit Map ${t.id}`,
      alpha: 1, labelAlpha: 1,
    }));
  }

  // Add MOTEC data: the system file browser, MoTeC .ld files only. The file is read in the browser
  // (motec-ld.js); the panel below the graph (log-panel.js) filters it and the graph draws the result behind
  // the slip targets: left and right lean on the same side (|lean|), slip >= 0 % only.
  const logView = new LogPanel($('logPanel'), {
    muRows: D.MU_ROWS,
    geom: () => chart.g,                          // the reduction graph and timeline line up with the slip-target graph
    onChange(sel) { chart.o.log = sel; renderChart(); if (state.tab === 'sim') simView.render(); if (state.tab === 'arr') arrView.render(); },   // renderChart passes showLog, soloActive and the μ filter band
  });
  // Simulation tab: the slip target at the logged μ, per gear (its Dry 2 map) and corner of the imported log.
  const simView = new SimView($('simPanel'), {
    getLog: () => logView.d,
    slip: () => logView.slip(),                               // the logged slip, smoothed (Slip smoothing)
    filters: () => logView.f,                                 // timeline section + corners picked on the circuit map
    modes: D.VEHICLE_MODES.map(m => [m, MODE_NAMES[m]]),
    modeName: m => MODE_NAMES[m],
    colorFor: id => mapColor(id),                             // the map's own colour, as on the other tabs
    // riding mode + gear -> slip target map (allocation); PRO: at the sample's sector (i), else the sector in focus
    mapFor: (m, g, i) => D.targets[indexOf(A(m, g - 1, i != null && pro() && logView.d && logView.d.sector ? Math.round(logView.d.sector[i]) - 1 : state.cell.sec))],
    secAt: (d, i) => (pro() && d.sector ? Math.round(d.sector[i]) : null),   // PRO: a simulated pass ends where the sector changes
    muRows: D.MU_ROWS,
    onSample: b => loadSample(b),                             // empty state: Load sample data / Browse my files
    onBrowse: () => browseLog(),
    onSelect: () => sync(),                                   // riding mode / gear changed: that map becomes the edited map
    edit: {                                                   // the selected μ level of that map, dragged on the top graph
      mu: () => state.muIndex,
      locked: t => MuLines.lockedRows(t),
      start: () => pushUndo(),
      change: t => { if (t.mu && t.mu.mode === 'ratio') t.mu.ref = state.muIndex; MuLines.derive(t); sync(); },
      selectMu: r => { state.muIndex = r; sync(); },
    },
  });
  $('simSide').appendChild(simView.side);
  // Adaptive Rider Request tab: the rear wheel force of the imported log against the Limit Setup of a riding mode / gear
  const arrView = new ArrView($('arrPanel'), {
    getLog: () => logView.d,
    filters: () => logView.f,                                 // the same μ / laps / timeline / corner filters as Simulation
    modeName: m => MODE_NAMES[m],
    riderLimit: () => D.riderLimit,
    onSample: b => loadSample(b),
    onBrowse: () => browseLog(),
    subTabs: $('subTabs'),                                    // its gears as the second row of tabs
  });
  $('arrSide').appendChild(arrView.side);
  $('userSide').appendChild($('shiftPick'));              // +- Buttons: example map + factor / offset per level in the left column
  // ↑ / ↓ gear, ← / → corner, unless a field, list or dialog has the keys
  document.addEventListener('keydown', e => {
    if ((state.tab !== 'sim' && state.tab !== 'arr') || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !$('logModal').hidden) return;
    if (document.activeElement && document.activeElement.closest('input, select, textarea, [role="menu"]')) return;
    if ((state.tab === 'sim' ? simView : arrView).key(e)) e.preventDefault();
  });

  function loadLog(buf, name) {
    let data;
    try { data = MotecLd.sessionData(MotecLd.parse(buf)); } catch (err) {
      alert(`Could not read ${name}:\n${err.message}`);
      return false;
    }
    state.logName = name;
    data.gearRaw = data.gear;                       // STK filters / simulates by gear, PRO by sector (slotChannel)
    if (!data.dist) data.dist = null;
    autoTrack(data);
    slotChannel(data);
    logView.load(data, name);
    trackMap.setLog(data);
    sync();
    return true;
  }
  // Add MOTEC data first asks where the log comes from: the built-in sample (a Bol d'Or race log, anonymised copy
  // in samples/) or the user's own .ld file.
  const SAMPLE_LOG = { url: 'samples/bol-dor-sample.ld', name: "Bol d'Or sample data" };
  function setLogModal(open) {
    $('logModal').hidden = !open;
    if (open) $('logSample').focus(); else $('log').focus();
  }
  $('log').onclick = () => setLogModal(true);
  $('logModalClose').onclick = () => setLogModal(false);
  $('logModal').addEventListener('mousedown', e => { if (e.target === $('logModal')) setLogModal(false); });   // backdrop
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('logModal').hidden) setLogModal(false); });
  $('logBrowse').onclick = () => { setLogModal(false); $('logFile').value = ''; $('logFile').click(); };
  // Load sample data: from the modal or the Simulation tab's empty state (b = the clicked option, shows "Loading…")
  async function loadSample(b) {
    const sub = b.querySelector('.mo-sub'), was = sub.textContent;
    b.disabled = true; sub.textContent = 'Loading…';
    try {
      const res = await fetch(SAMPLE_LOG.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ok = loadLog(await res.arrayBuffer(), SAMPLE_LOG.name);
      if (ok) track('action', 'Load sample data');
      return ok;
    } catch (err) { alert(`Could not load the sample data:\n${err.message}`); return false; }
    finally { b.disabled = false; sub.textContent = was; }
  }
  // PRO Track detection without a log: the sample is loaded by default, so the circuit map has a track to show
  let sampleAuto = false;
  async function autoSample() {
    if (logView.loaded || sampleAuto) return;
    sampleAuto = true;
    try {
      const res = await fetch(SAMPLE_LOG.url);
      if (res.ok && loadLog(await res.arrayBuffer(), SAMPLE_LOG.name)) track('action', 'Load sample data (Track detection default)');
    } catch (err) { /* the map keeps its empty state with Add MOTEC data */ }
  }
  const browseLog = () => { $('logFile').value = ''; $('logFile').click(); };
  $('logSample').onclick = async () => { if (await loadSample($('logSample'))) setLogModal(false); };
  $('logFile').onchange = async e => {
    const f = e.target.files[0];
    if (f && loadLog(await f.arrayBuffer(), f.name)) track('action', 'Open own MoTeC log');
  };
  $('logClear').onclick = () => { state.logName = null; logView.clear(); trackMap.setLog(null); sync(); track('action', 'Remove MoTeC log'); };

  // What the graph shows, for the log filters' "Automatically adjust":
  // gears (1..6) whose slip targets are selected, and the μ range of the selected μ level (half-way to its neighbours).
  function graphGears() {
    const all = SL().list.map(g => g - 1), id = D.targets[state.targetIndex].id;
    let gs;
    if (state.tab === 'gears') gs = [state.cell.gear];
    else if (noSel()) gs = all;
    else if (state.tab === 'modes' || state.tab === 'sectors') gs = all.filter(g => gearLine()[g] === id);
    else gs = all.filter(g => D.VEHICLE_MODES.some(m => (pro() ? D.allocPro[m].slice(0, nSec()).some(r => r[g] === id) : A(m, g) === id)));   // all slip target maps / +- buttons: any riding mode (and sector)
    return (gs.length ? gs : all).map(g => g + 1);
  }
  // PRO: the sector in focus (S1 = 1) on Riding modes / Gears / Sectors also filters the logged data; elsewhere null
  const graphSecs = () => (pro() && ['modes', 'gears', 'sectors'].includes(state.tab) ? [state.cell.sec + 1] : null);
  function graphMuBand() {
    const r = D.MU_ROWS, i = state.muIndex;
    return [i > 0 ? (r[i - 1] + r[i]) / 2 : -Infinity, i < r.length - 1 ? (r[i] + r[i + 1]) / 2 : Infinity];
  }

  // --- Export MRCK: the traction-control maps and settings edited here are written into the base calibration
  // base/DatasetSTK_EBOL_10to15.bmwrc25 (valid CRCs, see bmwrc25.js) and the result is downloaded.
  const EXPORT_BASE = 'base/DatasetSTK_EBOL_10to15.bmwrc25';
  const ECU_POINTS = 10;                    // every slip target map in the ECU has 10 lean points
  // A map as the ECU stores it: ascending lean axis with exactly 10 points. Missing points are added above the
  // highest lean angle shown here (70°), every 5°, repeating the values of that highest point.
  function ecuTarget(t) {
    if (t.lean.length > ECU_POINTS) throw new Error(`Map ${t.id} has ${t.lean.length} target points; the ECU holds ${ECU_POINTS}. Delete ${t.lean.length - ECU_POINTS} point(s) first.`);
    const extra = ECU_POINTS - t.lean.length, top = t.lean[0];      // lean is descending (70 -> 0)
    const lean = [...Array.from({ length: extra }, (_, k) => top + 5 * (extra - k)), ...t.lean];
    const rows = t.rows.map(row => [...new Array(extra).fill(row[0]), ...row]);
    return { id: t.id, lean: lean.reverse(), rows: rows.map(r => r.reverse()) };
  }
  const pad2 = n => String(n).padStart(2, '0');
  function exportFile(base, baseName) {
    const now = new Date();
    const desc = baseName.replace(/\.bmwrc25$/i, '') + '_MRCK';
    const xml = Bmwrc25.exportBmwrc25(base, {
      targets: D.targets.map(ecuTarget),
      allocation: D.allocStk,               // the base file is an STK dataset: the gear allocation
      userShift: US,
      reduction: D.settings.reduction === 'cut' ? 1 : 0,
      dtcMode: D.settings.dtcMode,
      desc, date: `${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}/${now.getFullYear()}`,
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = desc + '.bmwrc25';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return xml;
  }
  // Export writes into the last imported file (everything outside traction control stays as in it), else into EXPORT_BASE.
  let imported = null;
  $('exportMrck').onclick = async () => {
    track('action', 'Export MRCK');
    if (D.variant === 'pro') alert('Export MRCK writes an STK dataset: the gear allocation is exported, the sector allocation and track detection are not (no PRO base file yet).');
    try {
      if (imported) { exportFile(imported.xml, imported.name); return; }
      const res = await fetch(EXPORT_BASE, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`base calibration not found (${EXPORT_BASE})`);
      exportFile(await res.text(), EXPORT_BASE.split('/').pop());
    } catch (err) { alert(`Export MRCK: ${err.message}`); }
  };

  // --- Import MRCK: the traction-control settings of a .bmwrc25 file replace the current ones: slip target maps,
  // allocation, +- button factor / offset, reduction method and DTC mode. The μ levels of every map become the closest
  // Degressive version: μ 1.00, the highest and the lowest μ stay as in the file, the degression is fitted to the levels
  // between them (MuLines.fit) and those are recalculated from it.
  $('importMrck').onclick = () => { $('importFile').value = ''; $('importFile').click(); };
  $('importFile').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    let xml, data;
    try {
      xml = await f.text();
      data = Bmwrc25.importBmwrc25(xml);
      const mu = data.muRows || [];
      if (mu.length !== D.MU_ROWS.length || mu.some((m, i) => Math.abs(m - D.MU_ROWS[i]) > 1e-6))
        throw new Error(`its μ levels (${mu.join(', ')}) differ from the prototype's (${D.MU_ROWS.join(', ')})`);
      if (data.targets.length !== D.targets.length) throw new Error(`it has ${data.targets.length} slip target maps, the prototype ${D.targets.length}`);
    } catch (err) { alert(`Import MRCK: could not read ${f.name}:\n${err.message}`); return; }
    if ((undo.length || redo.length) && !confirm(`Replace the traction control settings with ${f.name}?\nThe current changes and their history are discarded.`)) return;
    track('action', 'Import MRCK');
    const changed = [];
    data.targets.forEach(t => {
      t.mu = { mode: 'uniform', deg: 0, ptDeg: [] };
      const before = JSON.stringify(t.rows);
      MuLines.fit(t);
      MuLines.derive(t);
      if (JSON.stringify(t.rows) !== before) changed.push(t.id);
    });
    D.targets.splice(0, D.targets.length, ...data.targets);   // same array: the graphs and tables keep their reference
    Object.keys(data.allocation).forEach(m => { D.allocStk[m] = data.allocation[m]; });   // an STK file: the gear allocation
    Object.assign(D.userShift, data.userShift);
    Object.assign(D.settings, { reduction: data.reduction, dtcMode: data.dtcMode });
    if (data.riderLimit) D.riderLimit = data.riderLimit;     // Adaptive Rider Request: the file's force limit curves
    D.source = data.desc || f.name.replace(/\.bmwrc25$/i, '');
    imported = { xml, name: f.name };
    undo.length = 0; redo.length = 0;
    Object.assign(state, { targetIndex: 0, lastTarget: null, noSel: true, shiftLvl: null, picker: false });
    sync();
    const msg = [`Imported ${f.name}.`,
      changed.length ? `μ levels converted to Degressive (closest fit) on Map ${changed.join(', ')}.` : 'The μ levels were already Degressive.']
      .concat(data.notes).join('\n');
    alert(msg);
  };
  window.MRCK_EXPORT = { exportFile, ecuTarget };   // for testing from the console

  function doUndo(from, to) {
    const item = from.pop(); if (!item) return;
    // the opposite stack gets the current state, keeping the entry's label and time
    if (item.alloc != null) {
      if ((item.variant || 'stk') !== D.variant) setVariant(item.variant || 'stk', true);   // show the allocation that changes
      to.push(Object.assign({}, item, { alloc: JSON.stringify(D.allocation) }, item.td ? { td: JSON.stringify(TD) } : {}));
      const a = JSON.parse(item.alloc);
      Object.keys(a).forEach(m => { D.allocation[m] = a[m]; });
      if (item.td) { Object.assign(TD, JSON.parse(item.td)); trackChanged(); }
      state.targetIndex = indexOf(A(state.cell.mode, state.cell.gear));
    } else {
      to.push(Object.assign({}, item, { json: JSON.stringify(D.targets[item.map]) }));
      restore(item.json, item.map);
      state.noSel = false;
      state.targetIndex = item.map;
    }
    sync();
  }

  // --- Changes panel (header: undo · list · redo) ---------------------------
  function ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return `${s} second${s === 1 ? '' : 's'} ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.floor(m / 60);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let histTimer = null;
  // Versions on a timeline, newest on top. Each change = the version right after it; clicking one goes back
  // (or forward again) to it. Undone changes stay listed above the current version (faded) until a new edit.
  function renderHistory() {
    if (!undo.length && !redo.length) { $('histList').innerHTML = '<li class="h-empty">No changes yet</li>'; return; }
    const li = (e, k, cls) => `<li class="h-item ${cls}" data-k="${k}" tabindex="0" role="button"` +
      ` aria-label="${esc(cls === 'is-current' ? 'Current version' : 'Go to this version')}: ${esc(e.label)}${e.desc ? ', ' + esc(e.desc) : ''}">` +
      `<div class="h-main"><span class="h-label">${esc(e.label)}</span>${cls === 'is-current' ? '<span class="h-now">Current</span>' : ''}<span class="h-time">${ago(e.time)}</span></div>` +
      (e.desc ? `<div class="h-desc">${esc(e.desc)}</div>` : '') + '</li>';
    const future = redo.map((e, j) => li(e, 'r' + j, 'is-future'));                       // redo[0] = farthest ahead
    const past = undo.map((e, i) => li(e, 'u' + i, i === undo.length - 1 ? 'is-current' : '')).reverse();
    const orig = `<li class="h-item h-orig${undo.length ? '' : ' is-current'}" data-k="o" tabindex="0" role="button" aria-label="Original version">` +
      `<div class="h-main"><span class="h-label">Original version</span>${undo.length ? '' : '<span class="h-now">Current</span>'}</div>` +
      '<div class="h-desc">As loaded, before any change</div></li>';
    $('histList').innerHTML = future.join('') + past.join('') + orig;
  }
  function goToVersion(k) {
    if (k[0] === 'r') { for (let n = redo.length - +k.slice(1); n > 0; n--) doUndo(redo, undo); }
    else { const keep = k === 'o' ? 0 : +k.slice(1) + 1; while (undo.length > keep) doUndo(undo, redo); }
    renderHistory();
  }
  $('histList').addEventListener('click', e => { const it = e.target.closest('.h-item'); if (it && !it.classList.contains('is-current')) goToVersion(it.dataset.k); });
  $('histList').addEventListener('keydown', e => {
    const it = e.target.closest('.h-item');
    if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!it.classList.contains('is-current')) goToVersion(it.dataset.k); }
  });
  function setHistory(open) {
    $('history').classList.toggle('is-open', open);
    $('history').setAttribute('aria-hidden', !open);
    $('histBtn').setAttribute('aria-expanded', open);
    clearInterval(histTimer);
    if (open) { renderHistory(); histTimer = setInterval(renderHistory, 5000); }
  }
  $('histBtn').onclick = () => setHistory(!$('history').classList.contains('is-open'));
  $('histClose').onclick = () => setHistory(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('history').classList.contains('is-open')) setHistory(false); });
  document.addEventListener('mousedown', e => {
    if ($('history').classList.contains('is-open') && !e.target.closest('#history, #histBtn')) setHistory(false);
  });
  $('undo').onclick = () => doUndo(undo, redo);
  $('redo').onclick = () => doUndo(redo, undo);
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.target.closest && e.target.closest("input, textarea, select")) return;   // keep native undo while typing
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(undo, redo); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doUndo(redo, undo); }
  });

  function syncHistory() {
    $('undo').disabled = !undo.length;
    $('redo').disabled = !redo.length;
    if ($('history').classList.contains('is-open')) renderHistory();
  }

  // --- Left column: allocation table (vehicle mode × gear -> map) -------------
  // Spreadsheet-like (see sheet-grid.js). Selecting a cell opens the map picker for it;
  // Esc or a click outside the table / picker closes it (same as Done).
  state.cell = { mode: state.vmode, gear: 1, sec: 0 };   // Dry 1, #2 (PRO: S1) by default
  state.picker = false;
  const MODES = D.VEHICLE_MODES;
  const parseMap = s => { const v = Number(String(s).trim()); return Number.isInteger(v) && v >= 1 && v <= D.targets.length ? v : null; };
  function flash(el, msg) {
    $(el).textContent = msg;
    clearTimeout(flash[el]);
    if (msg) flash[el] = setTimeout(() => { $(el).textContent = ''; }, 2500);
  }
  // STK: rows riding modes, columns gears. PRO: the table shows the two dimensions the tab does not pick (the tab's own
  // one is the second row of tabs): Riding modes -> sectors × gears, Gears -> sectors × riding modes,
  // Sectors -> riding modes × gears (the other tabs: as Riding modes). cellAt(r, c): the allocation cell of a grid cell.
  const DIMS = {
    mode: { n: () => MODES.length, tag: i => MODE_NAMES[MODES[i]] || MODES[i] },
    gear: { n: () => SL().n, tag: i => slotTag(i) },
    sec: { n: () => nSec(), tag: secTag },
  };
  const allocDims = () => (!pro() ? ['mode', 'gear'] : state.tab === 'gears' ? ['sec', 'mode'] : state.tab === 'sectors' ? ['mode', 'gear'] : ['sec', 'gear']);
  function cellAt(r, c) {
    const [rd, cd] = allocDims(), v = { mode: MODES.indexOf(state.vmode), gear: state.cell.gear, sec: state.cell.sec };
    v[rd] = r; v[cd] = c;
    return { m: MODES[v.mode], g: v.gear, s: v.sec };
  }
  const cellAlloc = (r, c) => { const x = cellAt(r, c); return A(x.m, x.g, x.s); };
  function followCell(r, c) {
    const x = cellAt(r, c);
    state.cell = { mode: x.m, gear: x.g, sec: x.s };
    state.vmode = x.m;
    state.targetIndex = indexOf(A(x.m, x.g, x.s));
  }
  // a header opens the tab of its dimension with it (PRO: a row header selects that row, the line on the graph)
  function dimHeader(dim, i) {
    state.picker = false;
    if (dim === 'mode') { if (!(pro() && state.tab === 'sectors')) state.tab = 'modes'; state.vmode = MODES[i]; state.cell = { ...state.cell, mode: MODES[i] }; }
    else if (dim === 'gear') { state.tab = 'gears'; state.cell = { ...state.cell, gear: i }; }
    else { if (!pro() || !['modes', 'gears'].includes(state.tab)) state.tab = 'sectors'; state.cell = { ...state.cell, sec: i }; }
    state.targetIndex = indexOf(A(state.cell.mode, state.cell.gear));
    sync();
  }
  const dimOn = (dim, i) => !state.picker && (
    dim === 'mode' ? (state.tab === 'modes' || (pro() && state.tab === 'sectors')) && MODES[i] === (state.tab === 'sectors' ? state.cell.mode : state.vmode)
      : dim === 'gear' ? state.tab === 'gears' && i === state.cell.gear
      : pro() && ['modes', 'gears', 'sectors'].includes(state.tab) && i === state.cell.sec);
  const allocShape = () => allocDims().map(dm => Array.from({ length: DIMS[dm].n() }, (_, i) => DIMS[dm].tag(i)));
  const allocGrid = new SheetGrid($('allocTbl'), {
    label: 'Slip target allocation: map per riding mode and gear',
    startEmpty: true,                       // no cell selected at start
    rows: allocShape()[0],
    cols: allocShape()[1],
    get: (r, c) => cellAlloc(r, c),
    parse: parseMap,
    cellClass: (r, c) => (!noSel() && cellAlloc(r, c) === D.targets[state.targetIndex].id ? 'uses-edited' : ''),
    write(cells) {
      const first = cells[0], last = cells[cells.length - 1], nm = x => { const k = cellAt(x.r, x.c); return cellName(k.m, k.g, k.s); };
      pushAllocUndo(
        cells.length === 1 ? nm(first) : `${nm(first)} … ${nm(last)}`,
        cells.length === 1 ? `Map ${cellAlloc(first.r, first.c)} → ${first.v}` : `${cells.length} cells changed`);
      cells.forEach(({ r, c, v }) => { const k = cellAt(r, c); setA(k.m, k.g, k.s, v); });
      sync();
      return cells.length;
    },
    // selecting a cell shows its map on the right: Riding modes -> that mode, Gears -> that gear, maps -> that map
    onActive(r, c) { followCell(r, c); state.noSel = false; state.picker = false; sync(); },
    // Mode name -> Riding modes tab with that mode; gear header -> Gears tab; sector header -> Sectors tab (see dimHeader)
    onRowHeader(r) { dimHeader(allocDims()[0], r); },
    onColHeader(c) { dimHeader(allocDims()[1], c); },
    headerActive: (kind, i) => dimOn(allocDims()[kind === 'row' ? 0 : 1], i),
    onMessage: msg => flash('allocMsg', msg),
  });

  function closePicker() { if (state.picker) { state.picker = false; sync(); } }
  document.addEventListener('mousedown', e => {
    if (!state.picker) return;
    if (e.target.closest('#allocTbl td, #picker')) return;
    closePicker();
  });

  // The allocation table keeps its own selection (none at start), independent of the right side.
  // the table's layout follows the variant, the tab (PRO) and the number of sectors
  let allocKey = '';
  function syncSide() {
    const key = [D.variant, allocDims().join(), nSec()].join('|');
    if (key !== allocKey) {
      allocKey = key;
      const [rows, cols] = allocShape();
      allocGrid.none = true;                          // the cell layout changes: no allocation cell selected
      allocGrid.setShape(rows, cols);
      allocGrid.t.setAttribute('aria-label', `Slip target allocation: map per ${allocDims().map(dm => ({ mode: 'riding mode', gear: 'gear', sec: 'sector' })[dm]).join(' and ')}` +
        (pro() ? (state.tab === 'gears' ? `, gear ${state.cell.gear + 1}` : state.tab === 'sectors' ? `, sector ${state.cell.sec + 1}` : `, ${MODE_NAMES[state.vmode]}`) : ''));
    }
    allocGrid.render();
  }
  const editId = () => (allocGrid.none ? null : cellAlloc(allocGrid.a.r, allocGrid.a.c));
  // hovering an allocation cell thickens its map on the graph, like the selected cell
  state.hoverMap = null;
  const setHoverMap = id => { if (state.hoverMap !== id) { state.hoverMap = id; renderChart(); } };
  $('allocTbl').addEventListener('mouseover', e => {
    const td = e.target.closest('td[data-r]');
    setHoverMap(td ? cellAlloc(+td.dataset.r, +td.dataset.c) : null);
  });
  $('allocTbl').addEventListener('mouseleave', () => setHoverMap(null));

  // --- Map editor overlay: the graph, data table and μ levels panel move into the overlay while it is open
  // (the "All slip target maps" editing, for one map); closing puts them back and restores the view.
  const EDITOR_PARTS = [['chart', 'editorMain'], ['muPanel', 'editorMain'], ['tableView', 'editorMain']];
  let editorSaved = null;
  function openEditor() {
    const id = editId();
    editorSaved = {
      state: JSON.parse(JSON.stringify({ tab: state.tab, targetIndex: state.targetIndex, muIndex: state.muIndex, noSel: state.noSel,
        vmode: state.vmode, cell: state.cell, picker: state.picker })),
      scroll: window.scrollY,
      home: EDITOR_PARTS.map(([el]) => [el, $(el).parentNode, $(el).nextSibling]),
      focus: document.activeElement,
    };
    EDITOR_PARTS.forEach(([el, to]) => $(to).appendChild($(el)));
    Object.assign(state, { tab: 'maps', targetIndex: indexOf(id), muIndex: D.MU_BASE, noSel: false, picker: false, editor: true });
    $('editorTitle').textContent = `Edit Map ${id}`;
    $('editor').hidden = false;
    document.body.classList.add('no-scroll');
    sync();
    $('editorClose').focus();
  }
  function closeEditor() {
    if (!editorSaved) return;
    const sv = editorSaved; editorSaved = null;
    sv.home.forEach(([el, parent, next]) => parent.insertBefore($(el), next));
    Object.assign(state, sv.state, { editor: false });
    $('editor').hidden = true;
    document.body.classList.remove('no-scroll');
    sync();
    window.scrollTo(0, sv.scroll);
    if (sv.focus && sv.focus.focus) sv.focus.focus();
  }
  // Editor overlay: the graph takes the height that leaves the μ settings and the table head + first 3 rows
  // visible; the rest of the table is reached by scrolling the overlay body.
  function fitEditor() {
    const body = document.querySelector('#editor .editor-body'), ch = $('chart');
    const rows = $('mapTbl').querySelectorAll('tbody tr'), last = rows[Math.min(2, rows.length - 1)];
    if (!last) return;
    const cr = ch.getBoundingClientRect(), br = body.getBoundingClientRect();
    const reserve = last.getBoundingClientRect().bottom - cr.bottom;          // μ settings + table head + 3 rows
    const h = br.bottom - 16 - (cr.top + body.scrollTop) - reserve;
    document.documentElement.style.setProperty('--editor-chart-h', Math.max(260, Math.round(h)) + 'px');
  }
  $('editorClose').onclick = closeEditor;
  $('editor').addEventListener('mousedown', e => { if (e.target === $('editor')) closeEditor(); });   // click on the backdrop
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.editor && !e.target.closest('input, textarea') && !document.querySelector('#editor .sheet td input')) closeEditor();
  });


  // --- Map picker for the active cell: 15 maps + chart of all maps ----------
  const pickChart = new SlipChart($('pickChart'), {
    targets: D.targets, muRows: D.MU_ROWS, editable: false, rowsHidden: true,
    onSelectTarget(id) { assignCell(id); },
  });
  $('pickerList').innerHTML = D.targets.map(t =>
    `<button role="option" class="pk" data-id="${t.id}"><span class="pk-name">Map <span class="num">${t.id}</span></span><span class="pk-use"></span></button>`).join('');
  $('pickerList').addEventListener('click', e => { const b = e.target.closest('.pk'); if (b) assignCell(+b.dataset.id); });
  $('pickerList').addEventListener('mouseover', e => {
    const b = e.target.closest('.pk');
    pickChart.preview(b && +b.dataset.id !== cellMap() ? 't' + b.dataset.id : null);
  });
  $('pickerList').addEventListener('mouseleave', () => pickChart.preview(null));
  // Picker list: arrows highlight a map in the chart, Enter / Space assigns it (native button click).
  listKeys($('pickerList'), b => pickChart.preview(+b.dataset.id !== cellMap() ? 't' + b.dataset.id : null));
  $('pickerClose').onclick = () => { state.picker = false; sync(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.picker) { state.picker = false; sync(); } });

  const cellMap = () => A(state.cell.mode, state.cell.gear);
  function assignCell(id) {
    if (cellMap() === id) return;
    pushAllocUndo(cellName(state.cell.mode, state.cell.gear), `Map ${cellMap()} → ${id}`);
    setA(state.cell.mode, state.cell.gear, state.cell.sec, id);
    if (state.cell.mode === state.vmode) state.targetIndex = indexOf(id);
    sync();
  }

  function syncPicker() {
    $('picker').hidden = !state.picker;
    $('mainView').hidden = state.picker;
    if (!state.picker) return;
    const cur = cellMap(), where = `${MODE_NAMES[state.cell.mode]} · ${SL().one} ${state.cell.gear + 1}${pro() ? ` · Sector ${state.cell.sec + 1}` : ''}`;
    $('pickerTitle').innerHTML = `Choose map for <b>${where}</b> <span class="picker-sub">currently Map ${cur}</span>`;
    [...$('pickerList').children].forEach(b => {
      const id = +b.dataset.id, used = usage(id);
      b.setAttribute('aria-selected', id === cur);
      const from = originTxt(id);
      b.querySelector('.pk-use').innerHTML = usageHtml(id); b.title = from;
    });
    pickChart.set({
      targets: D.targets,
      targetIndex: indexOf(cur),
      muIndex: state.muIndex,
      activeLabel: 'M' + cur,
      overlays: D.targets.filter(t => t.id !== cur).map(t => ({
        key: 't' + t.id, target: t.id, locked: false, dotted: false, color: '#6b6b72',
        lean: t.lean, vals: t.rows[state.muIndex], label: 'M' + t.id,
        tip: `Click to use Map ${t.id} for ${where}`,
      })),
    });
  }

  // Where an imported map came from: 'was Map 7 · from TYPE1… · Map 1'.
  function originTxt(id) {
    const t = D.targets[indexOf(id)];
    return [t.note || '', t.was ? 'was ' + t.was : '', t.from ? 'from ' + t.from : ''].filter(Boolean).join(' · ');
  }

  // Where is a map used? e.g. "Dry 1: G5, G6 · Dry 2: G5"
  function usage(id) {
    if (pro()) return D.VEHICLE_MODES.map(m => {           // PRO: the sectors where any gear of the riding mode uses it
      const secs = []; for (let s = 0; s < nSec(); s++) if (D.allocPro[m][s].includes(id)) secs.push(s);
      return secs.length ? `${MODE_NAMES[m] || m} ${runTags(secs, secTag).join(' ')}` : null;
    }).filter(Boolean);
    return D.VEHICLE_MODES.map(m => {
      const gears = slotTags(usedSlots(m, id));
      return gears.length ? `${MODE_NAMES[m] || m} ${gears.join(' ')}` : null;
    }).filter(Boolean);
  }
  // Map usage as "Rain #1 #2 #3   Dry 1 #2 #3": one group per riding mode; empty when the map is not used
  const usageHtml = id => usage(id).map(x => `<span class="use-g">${x}</span>`).join('');
  const usageTxt = id => usage(id).join('  ');

  // --- Data table below the graph ---------------------------------------------
  // The edited map as a spreadsheet: rows μx (1.50 on top), columns lean angle.
  const NMU = D.MU_ROWS.length, muOf = r => NMU - 1 - r;
  const muRowLabels = D.MU_ROWS.map((m, r) => fmtMu(D.MU_ROWS[muOf(r)]));
  const mapGrid = new SheetGrid($('mapTbl'), {
    label: 'Slip target values [%], rows μx, columns lean angle',
    corner: 'μ<sub>x</sub> \\ lean',
    rows: muRowLabels, cols: [],
    get: (r, c) => D.targets[state.targetIndex].rows[muOf(r)][c],
    format: v => Number(v).toFixed(1),
    parse: s => { const v = parseFloat(String(s).replace(',', '.')); return Number.isFinite(v) && v >= 0 && v <= 25.5 ? Math.round(v * 10) / 10 : null; },
    cellClass: r => (muOf(r) === state.muIndex ? 'row-active' : ''),
    readOnly: r => MuLines.lockedRows(D.targets[state.targetIndex]).includes(muOf(r)),   // calculated sub levels
    write(cells) {
      const t = D.targets[state.targetIndex];
      pushUndo(`table, ${cells.length} cell${cells.length > 1 ? 's' : ''}`);
      cells.forEach(({ r, c, v }) => { t.rows[muOf(r)][c] = v; });
      // calculated μ modes: the sub levels follow the edited anchor rows
      state.muIndex = muOf(mapGrid.a.r);
      if (t.mu && t.mu.mode === 'ratio') t.mu.ref = state.muIndex;      // ratio: the edited row is the reference
      MuLines.derive(t);
      sync();
      return cells.length;
    },
    onMessage: msg => flash('tvMsg', msg),
  });
  function syncTable(t) {
    mapGrid.setShape(muRowLabels, t.lean.map(x => x + '°'));
  }

  // --- Copy / Paste a whole map (lean points, all μ rows, μ line settings) ----
  let mapClip = null;                          // { from: map id, json }
  const mapData = t => JSON.stringify({ lean: t.lean, rows: t.rows, mu: t.mu });
  function pasteInto(json, from) {
    const t = D.targets[state.targetIndex];
    if (from === t.id) { flash('tvMsg', `Map ${from} is already this map`); return; }
    pushUndo(`copied from Map ${from}`);
    Object.assign(t, JSON.parse(json));
    sync();
    flash('tvMsg', `Map ${from} copied into Map ${t.id}`);
  }
  $('copyMap').onclick = () => {
    const t = D.targets[state.targetIndex];
    mapClip = { from: t.id, json: mapData(t) };
    // also put the values on the system clipboard as a tab-separated table (Excel)
    const tsv = ['μx \\ lean\t' + t.lean.map(x => x + '°').join('\t')]
      .concat(t.rows.map((row, i) => fmtMu(D.MU_ROWS[i]) + '\t' + row.map(v => v.toFixed(1)).join('\t')).reverse()).join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(tsv).catch(() => {});
    flash('tvMsg', `Map ${t.id} copied`);
    syncPaste(t);
  };
  $('pasteMap').onclick = () => { if (mapClip) pasteInto(mapClip.json, mapClip.from); };

  // ▾ menu: copy one of the other 14 maps into this one
  function setMenu(open) {
    $('pasteMenu').hidden = !open;
    $('pasteMenuBtn').setAttribute('aria-expanded', open);
    if (!open) return;
    const cur = D.targets[state.targetIndex].id;
    $('pasteMenu').innerHTML = `<div class="menu-h">Copy into Map ${cur} from</div>` + D.targets.filter(t => t.id !== cur).map(t => {
      const used = usage(t.id);
      return `<button role="menuitem" data-id="${t.id}"><span class="menu-name">Map ${t.id}</span><span class="menu-use">${usageHtml(t.id)}</span></button>`;
    }).join('');
    $('pasteMenu').querySelector('button').focus();
  }
  $('pasteMenuBtn').onclick = () => setMenu($('pasteMenu').hidden);
  $('pasteMenu').addEventListener('click', e => {
    const b = e.target.closest('button[data-id]'); if (!b) return;
    const src = D.targets[indexOf(+b.dataset.id)];
    setMenu(false);
    pasteInto(mapData(src), src.id);
  });
  $('pasteMenu').addEventListener('keydown', e => {
    const items = [...$('pasteMenu').querySelectorAll('button')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus(); }
    if (e.key === 'Escape') { setMenu(false); $('pasteMenuBtn').focus(); }
  });
  document.addEventListener('mousedown', e => { if (!$('pasteMenu').hidden && !e.target.closest('#pasteWrap')) setMenu(false); });

  function syncPaste(t) {
    $('pasteMap').disabled = !mapClip;
    $('pasteMap').title = mapClip ? `Paste Map ${mapClip.from} into Map ${t.id}` : 'Copy a map first';
  }



  // Clicking a neutral part of the app (empty background, labels, empty chart area) deselects the map.
  function deselectMap() {
    if (state.noSel || !['modes', 'gears', 'sectors', 'maps'].includes(state.tab)) return;
    state.noSel = true;
    sync();
  }
  // clicks that do NOT deselect: controls and content; the header and the empty parts of the tab rows do deselect
  const INTERACTIVE = 'button, input, select, textarea, a, label, table, svg, canvas, [role="listbox"], [role="menu"], [role="tab"], ' +
    '.picker, .history, .menu, .slip-tip, .mu-ctl, .editor, .modal, .lp-range, .seg';
  document.addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;   // the chart reports its own empty clicks
    deselectMap();
  });
  // The graph fills the viewport height, leaving room for the head and first row of the table below it
  // (all of the short +- Buttons table). css: --main-top (left column height), --chart-h.
  function fitMain() {
    const root = document.documentElement.style;
    root.setProperty('--main-top', Math.round($('mainView').getBoundingClientRect().top + window.scrollY) + 'px');
    const ch = $('chart');
    if (state.editor) { fitEditor(); return; }   // the graph sits in the editor overlay
    if (ch.hidden) return;
    // the log panel sits between the graph and the table; it is scrolled to and does not shrink the graph
    const lp = $('logPanel'), lpHidden = lp.hidden;
    lp.hidden = true;
    fitChart(ch);
    lp.hidden = lpHidden;
  }
  function fitChart(ch) {
    const root = document.documentElement.style;
    const left = ['modes', 'gears', 'sectors', 'maps'].includes(state.tab);
    const topOf = () => ch.getBoundingClientRect().top + window.scrollY;
    let reserve = 0, top = topOf();
    if (left) {
      // Every tab with a left column gets the same graph size: room for the legend and the table head + first row,
      // also when they are hidden (no map selected).
      const tv = $('tableView'), lg = $('chartLegend');
      const keep = [tv.hidden, lg.hidden];
      tv.hidden = lg.hidden = false;                // measured without painting, restored below
      const rows = $('mapTbl').querySelectorAll('tbody tr');
      if (rows[0]) fitMain.tbl = rows[0].getBoundingClientRect().bottom - ch.getBoundingClientRect().bottom;
      reserve = fitMain.tbl || 96;
      [tv.hidden, lg.hidden] = keep;
    } else if (!$('shiftPanel').hidden) reserve = $('shiftTbl').getBoundingClientRect().bottom - ch.getBoundingClientRect().bottom;
    const h = window.innerHeight - top - reserve - 16;
    root.setProperty('--chart-h', Math.max(300, Math.round(h)) + 'px');
  }
  window.addEventListener('resize', fitMain);
  // Left column (beside the graph, ≥ 1000px): reaches down to SIDE_GAP above the window bottom, the same gap as above
  // it, so its divider line runs to the bottom; it is sticky, so this follows the scroll position.
  const SIDE_GAP = 12;
  function fitSide() {
    const side = document.querySelector('.side');
    if (!side || side.hidden || window.innerWidth < 1000) { if (side) side.style.height = side.style.top = ''; return; }
    const row = $('subTabs').hidden ? document.querySelector('.tabbar') : $('subTabs');   // the tab row stuck at the top
    side.style.top = row.offsetHeight + SIDE_GAP + 'px';
    side.style.height = Math.max(120, Math.round(window.innerHeight - side.getBoundingClientRect().top - SIDE_GAP)) + 'px';
  }
  window.addEventListener('resize', fitSide);
  window.addEventListener('scroll', fitSide, { passive: true });

  // --- STK / PRO (header switch). STK: slip target map per gear. PRO: per acceleration sector of the track
  // detection (manual 5.5, 9). Each variant keeps its own allocation; the Gears tab becomes Sectors, and the logged
  // data is filtered and simulated by the sector the ECU would have been in (from the lap distance).
  function setVariant(v, quiet) {
    if (v === D.variant) return;
    D.variant = v;
    D.allocation = v === 'pro' ? D.allocPro : D.allocStk;
    state.cell = { ...state.cell, sec: Math.min(state.cell.sec || 0, Math.max(0, nSec() - 1)) };
    state.picker = false;
    [...$('variant').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
    $('tabTrack').hidden = v !== 'pro';             // Track detection tab: PRO only
    $('tabSectors').hidden = v !== 'pro';           // Sectors tab: PRO only (Riding modes, Gears, Sectors)
    if (v !== 'pro' && (state.tab === 'track' || state.tab === 'sectors')) state.tab = 'modes';
    if (logView.d) { slotChannel(logView.d); logView.slotsChanged(); }
    if (!quiet) track('action', `Switch to ${v.toUpperCase()}`);
    sync();
  }
  $('variant').onclick = e => { const b = e.target.closest('button'); if (b) setVariant(b.dataset.v); };

  // Track detection (manual 9): the lap distance is reset at the lap trigger beacon (lap start); the out lap is measured
  // back from the beacon. The acceleration sector is the first one whose end lies beyond the lap distance (equal ends:
  // the higher sector), and it only changes while the bike is off the throttle (drag; here: decelerating, accx < 0).
  const TD = D.trackDet, UNUSED = 99999;
  function lapDistance(d) {
    if (!d.dist) return null;
    const out = new Float32Array(d.n), at = t => d.dist[Math.min(d.n - 1, Math.max(0, Math.floor(t * d.rate)))];
    d.laps.forEach(l => {
      const i0 = Math.max(0, Math.floor(l.a * d.rate)), i1 = Math.min(d.n, Math.ceil(l.b * d.rate));
      const base = l.name === 'Out lap' ? at(l.b) - TD.lapLen : at(l.a);
      for (let i = i0; i < i1; i++) out[i] = d.dist[i] - base;
    });
    return out;
  }
  function sectorChannel(d) {
    if (!TD.on) return new Float32Array(d.n).fill(TD.failsafe);
    const p = lapDistance(d);
    if (!p) return null;
    const ends = TD.ends, n = ends.length, out = new Float32Array(d.n);
    let cur = 1;
    for (let i = 0; i < d.n; i++) {
      let k = 0;
      while (k < n && ends[k] <= p[i]) k++;
      const want = Math.min(n, k + 1);
      if (want !== cur && (!d.accx || d.accx[i] < 0)) cur = want;   // the sector changes in drag only
      out[i] = cur;
    }
    return out;
  }
  // d.gear: the gear (log filters, simulation); d.sector: the sector the ECU would be in (PRO: its maps and filter)
  function slotChannel(d) {
    d.sector = d.laps && d.laps.length ? sectorChannel(d) : null;
    d.gear = d.gearRaw;
  }
  // Sectors from the logged corners (fastest lap): sector k = corner k and the straight after it, ending where the
  // rider brakes for the next corner; the last corner's sector ends at the line. Max 15 (later corners share S15).
  // The maps follow the STK allocation: each sector gets the map its riding mode uses in the gear of that kind of corner,
  // from its slowest speed (data.js SECTOR_CLASS), so similar corners get similar maps.
  function sectorsFromLog(d) {
    if (!d || !d.dist || !d.refLap || !d.corners.length) return null;
    const at = t => d.dist[Math.min(d.n - 1, Math.max(0, Math.floor(t * d.rate)))];
    const lapLen = Math.round(at(d.refLap.b) - at(d.refLap.a));
    const brakes = d.corners.map(c => Math.round(at(c.ref[0][0]) - at(d.refLap.a))).filter(x => x > 0 && x < lapLen).sort((a, b) => a - b);
    const n = Math.min(D.SECTORS, brakes.length);
    const ends = brakes.slice(1, n).concat([lapLen]);
    // slowest speed of each sector on the fastest lap -> corner class -> STK gear column
    const a = Math.floor(d.refLap.a * d.rate), b = Math.min(d.n, Math.floor(d.refLap.b * d.rate)), base = d.dist[a];
    const vmin = ends.map(() => Infinity);
    if (d.vref) for (let i = a; i < b; i++) {
      const p = d.dist[i] - base; let k = 0;
      while (k < ends.length - 1 && ends[k] <= p) k++;
      vmin[k] = Math.min(vmin[k], d.vref[i]);
    }
    const cls = vmin.map(v => D.sectorClass(Number.isFinite(v) ? v : 120));
    return { lapLen, ends, cls, count: n };
  }
  const padEnds = e => e.concat(new Array(D.SECTORS - e.length).fill(UNUSED));
  function applySectors(sec) {
    TD.lapLen = sec.lapLen; TD.ends = padEnds(sec.ends);
    D.VEHICLE_MODES.forEach(m => { D.allocPro[m] = D.proAlloc(m, sec.cls); });
  }
  // A log loaded while the sectors are the untouched example (or empty): lap length, sectors and maps from it
  function autoTrack(d) {
    if (!TD.example && TD.ends.some(x => x < UNUSED)) return;
    const sec = sectorsFromLog(d);
    if (sec) applySectors(sec);
  }

  // --- Track detection tab (PRO): circuit map + settings + sector table ---------------------------------------
  // Every change of the sectors is one history entry (sector ends + the PRO allocation, which moves with them).
  function pushTrackUndo(label, desc) {
    TD.example = false;
    record({ label, desc, alloc: JSON.stringify(D.allocPro), variant: 'pro', td: JSON.stringify(TD) });
  }
  const used = () => TD.ends.filter(x => x < UNUSED);
  const MIN_SECTOR = 10;                                   // [m] shortest sector the map editing makes
  const SEC_COLORS = Array.from({ length: D.SECTORS }, (_, i) => MAP_COLORS[(i * 4) % MAP_COLORS.length]);   // neighbours far apart on the colour wheel
  // sector ends and the PRO allocation in one go: ends = used ends (ascending, last = finish), alloc[m] = one map per sector
  function setSectors(ends, alloc) {
    TD.ends = padEnds(ends);
    D.VEHICLE_MODES.forEach(m => { const a = alloc[m].slice(0, ends.length).map(r => r.slice()); while (a.length < D.SECTORS) a.push(a[a.length - 1].slice()); D.allocPro[m] = a; });
  }
  const allocCopy = () => Object.fromEntries(D.VEHICLE_MODES.map(m => [m, D.allocPro[m].map(r => r.slice())]));   // per sector: the map of each gear
  const fmtM = v => `${Math.round(v).toLocaleString('en-US')} m`;
  // merge the sectors on both sides of split k; dropRight: the right one's map goes (else the left one's)
  function removeSplit(k, dropRight = true) {
    const e = used(), al = allocCopy();
    if (k < 0 || k >= e.length - 1) return;
    e.splice(k, 1);
    D.VEHICLE_MODES.forEach(m => al[m].splice(dropRight ? k + 1 : k, 1));
    setSectors(e, al);
  }
  function removeSector(s0) {
    const n = used().length;
    if (n <= 1) { flash('tdMsg', 'The last sector cannot be removed'); return; }
    pushTrackUndo(`Sector S${s0 + 1}`, 'sector removed, merged into its neighbour');
    if (s0 > 0) removeSplit(s0 - 1, true); else removeSplit(0, false);
    state.tpSel = { type: 'sector', s: Math.max(0, s0 - 1) };
    trackChanged();
  }
  function removeSplitAt(k) {
    pushTrackUndo(`Split S${k + 1} | S${k + 2}`, `split at ${fmtM(used()[k])} removed`);
    removeSplit(k, true);
    state.tpSel = { type: 'sector', s: k };
    trackChanged();
  }
  function splitAt(p) {
    const e = used(), al = allocCopy();
    if (e.length >= D.SECTORS) { flash('tdMsg', `All ${D.SECTORS} sectors are in use: remove one first`); return; }
    p = Math.round(p);
    let s0 = 0;
    while (s0 < e.length - 1 && e[s0] <= p) s0++;
    const from = s0 ? e[s0 - 1] : 0;
    if (p - from < MIN_SECTOR || e[s0] - p < MIN_SECTOR) { flash('tdMsg', 'Too close to a split'); return; }
    pushTrackUndo(`Sector S${s0 + 1}`, `split at ${fmtM(p)}`);
    e.splice(s0, 0, p);
    D.VEHICLE_MODES.forEach(m => al[m].splice(s0, 0, al[m][s0].slice()));   // both halves keep the sector's maps (every gear)
    setSectors(e, al);
    state.tpSel = { type: 'split', k: s0 };
    trackChanged();
  }
  // Dragging split k to lap distance p: splits it passes are removed, with the sectors they covered completely.
  let dragSnap = null;
  function dragSplit(k, p, phase) {
    if (phase === 'start') { dragSnap = { ends: used(), alloc: allocCopy() }; pushTrackUndo(`Split S${k + 1} | S${k + 2}`, 'moved'); return; }
    if (phase === 'end') { dragSnap = null; trackChanged(); return; }
    if (!dragSnap) return;
    const e0 = dragSnap.ends, fin = e0[e0.length - 1];
    const x = Math.round(Math.max(MIN_SECTOR, Math.min(fin - MIN_SECTOR, p)));
    const gone = new Set(), goneAlloc = new Set();
    e0.forEach((v, j) => {
      if (j > k && j < e0.length - 1 && v <= x) { gone.add(j); goneAlloc.add(j); }   // passed forwards: sector j covered
      if (j < k && v >= x) { gone.add(j); goneAlloc.add(j + 1); }                     // passed backwards: sector j + 1 covered
    });
    const e = e0.map((v, j) => (j === k ? x : v)).filter((v, j) => !gone.has(j));
    const al = Object.fromEntries(D.VEHICLE_MODES.map(m => [m, dragSnap.alloc[m].filter((v, j) => !goneAlloc.has(j))]));
    setSectors(e, al);
    state.tpSel = { type: 'split', k: k - [...gone].filter(j => j < k).length };
    syncTrack();
    const last = undo[undo.length - 1];
    if (last && gone.size) last.desc = `moved to ${fmtM(x)}, ${gone.size} sector${gone.size > 1 ? 's' : ''} removed`;
    else if (last) last.desc = `moved to ${fmtM(x)}`;
  }
  const trackMap = new TrackMap($('tpMap'), {
    onSelect(sel) { state.tpSel = sel; syncTrack(); },
    onSplit: p => splitAt(p),
    onDrag: dragSplit,
    emptyHtml: () => '<p>Load MoTeC data with GPS to draw the circuit and edit the sectors on it.</p><button class="tm-load"><span class="material-icons" aria-hidden="true">add</span>Add MOTEC data</button>',
  });
  $('tpMap').addEventListener('click', e => { if (e.target.closest('.tm-load')) setLogModal(true); });
  $('tpSplit').onclick = () => { const sl = state.tpSel; if (sl && sl.type === 'sector' && sl.p != null) splitAt(sl.p); };
  $('tpRemove').onclick = () => { const sl = state.tpSel; if (sl && sl.type === 'sector') removeSector(sl.s); };
  $('tpRemoveSplit').onclick = () => { const sl = state.tpSel; if (sl && sl.type === 'split') removeSplitAt(sl.k); };
  document.addEventListener('keydown', e => {
    if (state.tab !== 'track' || (e.key !== 'Delete' && e.key !== 'Backspace') || !state.tpSel) return;
    if (document.activeElement && document.activeElement.closest('input, textarea, table')) return;
    e.preventDefault();
    if (state.tpSel.type === 'split') removeSplitAt(state.tpSel.k); else removeSector(state.tpSel.s);
  });

  const TD_FIELDS = [
    ['lapLen', 'Total lap length [m]', 0, 20000],
    ['pitEnd', 'Lap distance at pit lane end [m]', 0, 20000],
    ['pitSector', 'Sector at pit lane end', 1, D.SECTORS],
    ['initDist', 'Lap distance initial value [m]', 0, 20000],
    ['failsafe', 'Failsafe sector', 1, D.SECTORS],
  ];
  $('tdFields').innerHTML = TD_FIELDS.map(([k, label]) =>
    `<label>${label}<input type="text" inputmode="numeric" data-k="${k}"></label>`).join('');
  $('tdFields').addEventListener('change', e => {
    const inp = e.target.closest('input'); if (!inp) return;
    const [k, label, lo, hi] = TD_FIELDS.find(f => f[0] === inp.dataset.k);
    const v = Math.round(Number(inp.value.replace(',', '.')));
    if (Number.isFinite(v) && v !== TD[k]) { pushTrackUndo('Track detection', `${label} ${TD[k]} → ${v}`); TD[k] = Math.max(lo, Math.min(hi, v)); }
    trackChanged();
  });
  // Sector table: from / to [m] (to is editable). The maps are not here: in the full app the sectors also carry
  // engine brake and rider request settings, so the allocation stays on the allocation tables.
  const TD_COLS = ['From [m]', 'To [m]'];
  const tdGrid = new SheetGrid($('tdEnds'), {
    startEmpty: true,
    label: 'Sectors: lap distance from / to [m]',
    rows: Array.from({ length: D.SECTORS }, (_, i) => 'S' + (i + 1)), cols: TD_COLS,
    get: (r, c) => {
      const e = used();
      if (r >= e.length) return '';
      return c === 0 ? (r ? e[r - 1] : 0) : e[r];
    },
    format: v => (v === '' ? '–' : String(v)),
    parse: s => { const v = Math.round(Number(String(s).trim().replace(',', '.'))); return Number.isFinite(v) && v >= 0 ? v : null; },
    readOnly: (r, c) => c === 0 || r >= used().length || (c === 1 && r === used().length - 1),   // the last sector ends at the line
    cellClass: (r, c) => [r >= used().length ? 'td-unused' : '', state.tpSel && state.tpSel.type === 'sector' && state.tpSel.s === r ? 'row-active' : ''].join(' '),
    write(cells) {
      const e = used(), al = allocCopy();
      let n = 0;
      cells.forEach(({ r, c, v }) => {
        if (r >= e.length) return;
        if (c === 1) {
          const lo = (r ? e[r - 1] : 0) + MIN_SECTOR, hi = e[r + 1] - MIN_SECTOR;
          if (!(v >= lo && v <= hi)) { flash('tdMsg', `S${r + 1} must end between ${lo} and ${hi} m`); return; }
          e[r] = v; n++;
        }
      });
      if (!n) return 0;
      pushTrackUndo(cells.length === 1 ? `Sector S${cells[0].r + 1}` : 'Sectors', `${n} cell${n > 1 ? 's' : ''} changed`);
      setSectors(e, al);
      trackChanged();
      sync();
      return n;
    },
    onActive(r) { if (r < used().length) { state.tpSel = { type: 'sector', s: r }; syncTrack(); } },
    onMessage: msg => flash('tdMsg', msg),
  });
  $('tdOn').onclick = () => { pushTrackUndo('Track detection', TD.on ? 'switched off' : 'switched on'); TD.on = !TD.on; trackChanged(); };
  $('tdFromLog').onclick = () => {
    const sec = sectorsFromLog(logView.d);
    if (!sec) { flash('tdMsg', logView.d ? 'This log has no distance (s_track) or no full lap' : 'Load MoTeC data first'); return; }
    pushTrackUndo('Sectors', `${sec.count} sectors from the logged corners`);
    applySectors(sec);
    state.tpSel = null;
    trackChanged(); sync();
    flash('tdMsg', `${sec.count} sectors from the corners of ${state.logName}, maps from the STK allocation`);
  };
  $('tdReset').onclick = () => {
    pushTrackUndo('Sectors', 'cleared: one sector for the whole lap');
    setSectors([TD.lapLen], allocCopy());
    state.tpSel = null;
    trackChanged(); sync();
  };
  function trackChanged() {
    if (logView.d) { slotChannel(logView.d); if (D.variant === 'pro') logView.slotsChanged(); }
    syncTrack();
    if (state.tab === 'sim') simView.render();
  }
  function syncTrack() {
    const e = used();
    if (state.tpSel && ((state.tpSel.type === 'sector' && state.tpSel.s >= e.length) || (state.tpSel.type === 'split' && state.tpSel.k >= e.length - 1))) state.tpSel = null;
    const sl = state.tpSel;
    $('trackPanel').classList.toggle('is-off', !TD.on);
    $('tdOn').setAttribute('aria-checked', TD.on);
    $('tdOn').querySelector('.material-icons').textContent = TD.on ? 'toggle_on' : 'toggle_off';
    $('tdOffNote').hidden = TD.on;
    $('tdFields').querySelectorAll('input').forEach(inp => { if (inp !== document.activeElement) inp.value = TD[inp.dataset.k]; });
    $('tdFromLog').disabled = !logView.d;
    tdGrid.render();
    // selection bar above the map
    let txt = `${e.length} sector${e.length > 1 ? 's' : ''} · lap ${fmtM(TD.lapLen)} · click a sector or a split`;
    if (sl && sl.type === 'sector') {
      const from = sl.s ? e[sl.s - 1] : 0, to = e[sl.s];
      txt = `S${sl.s + 1} · ${fmtM(from)} – ${fmtM(to)} (${fmtM(to - from)})`;
    } else if (sl && sl.type === 'split') txt = `Split S${sl.k + 1} | S${sl.k + 2} at ${fmtM(e[sl.k])} · drag it along the track`;
    $('tpSel').textContent = txt;
    $('tpSplit').hidden = !(sl && sl.type === 'sector' && sl.p != null);
    $('tpRemove').hidden = !(sl && sl.type === 'sector') || e.length <= 1;
    $('tpRemoveSplit').hidden = !(sl && sl.type === 'split');
    if (state.tab === 'track') trackMap.set({ ends: e, lapLen: TD.lapLen, sel: sl, colors: SEC_COLORS, labels: e.map((x, i) => 'S' + (i + 1)) });
  }

  function sync() {
    // Simulation: the edited map is the one of the simulated riding mode and gear
    if (state.tab === 'sim') { simView.currentGear(); state.targetIndex = indexOf(simView.map.id); state.noSel = false; }
    // a different map starts on its μ 1.00 level
    if (state.targetIndex !== state.lastTarget) { state.muIndex = D.MU_BASE; state.lastTarget = state.targetIndex; }
    // deselecting the map goes back to the default view: every map shown (maps added to the filter are cleared)
    if (state.noSel && !state.wasNoSel) state.mapFilter.clear();
    // no map selected: the maps are always shown on their μ 1.00 level
    if (noSel()) state.muIndex = D.MU_BASE;
    state.wasNoSel = state.noSel;
    requestAnimationFrame(() => { fitMain(); fitSide(); });
    if (state.cell.sec >= nSec()) state.cell = { ...state.cell, sec: Math.max(0, nSec() - 1) };   // PRO: sectors removed
    const modes = state.tab === 'modes', gears = state.tab === 'gears', secs = state.tab === 'sectors';
    const alloc = gearLine();
    // In Modes (PRO: and Sectors) the edited map is always one the riding mode uses along the gears,
    // in Gears one of the maps the 4 modes use in the selected gear.
    if ((modes || secs) && !alloc.includes(D.targets[state.targetIndex].id)) state.targetIndex = indexOf(alloc[state.cell.gear] ?? alloc[0]);
    if (gears && !gearColumn().includes(D.targets[state.targetIndex].id)) state.targetIndex = indexOf(A(state.cell.mode, state.cell.gear));
    const self = D.targets[state.targetIndex];
    MuLines.ensure(self);
    // a calculated sub level cannot be the edited row: fall back to μ 1.00
    if (MuLines.lockedRows(self).includes(state.muIndex)) state.muIndex = MuLines.anchors().base;

    const tab = state.tab;
    document.querySelectorAll('.tabs [role="tab"]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
    const top = ['modes', 'gears', 'sectors', 'maps'].includes(tab);   // these tabs: navigation as the second row of tabs
    $('sideModes').hidden = !modes || top;
    $('sideGears').hidden = !gears || top;
    syncSubTabs(top, self);
    [...$('gearList').children].forEach(b => {
      const gi = +b.dataset.g;
      b.setAttribute('aria-selected', gi === state.cell.gear);
      b.querySelector('.pk-use').textContent = D.VEHICLE_MODES.map(m => `${MODE_NAMES[m]} M${A(m, gi)}`).join(' · ');
    });
    $('sideCtx').hidden = !(tab === 'maps' && !top);
    // Map details (left column) for the selected map: riding-mode usage, μ levels calculation, interpolation style
    $('mapDetails').hidden = !['modes', 'gears', 'sectors', 'maps', 'sim'].includes(tab) || noSel();
    // legend under the graph, in the selected line's colour
    $('chartLegend').hidden = !['modes', 'gears', 'sectors', 'maps'].includes(tab) || noSel();
    $('mdName').innerHTML = `<i class="sw" style="background:${mapColor(self.id)}"></i>Map ${self.id}`;
    $('mdUse').innerHTML = usageHtml(self.id);
    $('mdUse').hidden = !usage(self.id).length;
    [...$('lineStyle').children].forEach(b => b.setAttribute('aria-pressed', (b.dataset.v === 'smooth') === !!self.smooth));
    $('mapList').classList.toggle('show-sw', tab === 'maps');
    [...$('mapList').children].forEach(b => {
      const id = +b.dataset.id, used = usage(id);
      b.setAttribute('aria-selected', !noSel() && id === self.id);
      b.style.setProperty('--mc', mapColor(id));   // every map keeps its own colour, also when selected
      const from = originTxt(id);
      b.querySelector('.pk-use').innerHTML = usageHtml(id);
      b.title = from;
    });
    $('settingsPanel').hidden = tab !== 'settings';
    // Settings has no left column (no map list, no allocation table): full width
    // no left column on Settings / +- Buttons, nor on Simulation until MoTeC data is loaded (empty state)
    const noSide = tab === 'settings' || tab === 'track' || ((tab === 'sim' || tab === 'arr') && !logView.loaded);
    // +- Buttons: left column = example map + factor / offset per level, then the logged data adjusters
    document.querySelector('.layout').classList.toggle('user-mode', tab === 'user');
    $('userSide').hidden = tab !== 'user';
    document.querySelector('.side').hidden = noSide;
    document.querySelector('.layout').classList.toggle('no-side', noSide);
    // Simulation: left column = its selectors, the timeline / circuit map of the logged data and the map details
    // Adaptive Rider Request: the same layout, with its own selectors (no map details)
    document.querySelector('.layout').classList.toggle('sim-mode', tab === 'sim' || tab === 'arr');
    document.querySelector('.layout').classList.toggle('arr-mode', tab === 'arr');   // no μ filter there (log-panel μ slider hidden)
    $('simSide').hidden = tab !== 'sim';
    $('arrSide').hidden = tab !== 'arr';
    // +- Buttons: map chosen from a dropdown above the graph
    $('shiftPick').hidden = tab !== 'user';
    $('shiftMap').value = self.id;
    [...$('shiftMap').options].forEach(o => { const u = usageTxt(+o.value); o.textContent = `Map ${o.value}` + (u ? ` ${u}` : ''); });
    $('shiftPanel').hidden = tab !== 'user';
    $('log').hidden = tab === 'settings' || tab === 'track';           // Export MRCK stays on every tab
    // The map's data table is always shown below the graph (Modes, Gears, All slip target maps).
    const tableOn = modes || gears || secs || tab === 'maps';
    $('chart').hidden = tab === 'settings';
    $('tableView').hidden = !tableOn || noSel();
    $('copyMap').hidden = $('pasteWrap').hidden = !tableOn || noSel() || top || tab === 'sim';   // riding modes / gears / maps: Import and Export only
    syncPaste(self);
    [...$('reduction').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.v === D.settings.reduction));
    syncDtcMode();
    syncTrack();
    syncShift();
    [...$('modeList').children].forEach(b => {
      const m = D.VEHICLE_MODES[+b.dataset.i];
      b.setAttribute('aria-selected', m === state.vmode);
      b.querySelector('.pk-use').textContent = gearLine(m).map((id, gi) => `${slotTag(gi)} M${id}`).join(' · ');
    });
    const logged = logView.loaded;
    $('log').setAttribute('aria-pressed', logged);
    $('logName').textContent = logged ? state.logName : 'Add MOTEC data';
    $('log').title = logged ? 'Import another log file' : '';
    $('logClear').hidden = !logged || tab === 'settings';    // log adjusters: in the left column; at the top of the log panel on tabs without one (+- Buttons)
    if (logView.side.parentNode !== $('sideLog')) $('sideLog').appendChild(logView.side);   // log adjusters: always in the left column
    logView.setContext({ visible: tab !== 'settings', gears: graphGears(), secs: graphSecs(), muBand: graphMuBand(), gearsAll: tab === 'maps' || tab === 'user', smoothKind: tab === 'arr' ? 'torque' : 'slip' });

    syncChartTitle(self);
    syncHistory();
    syncMuPanel();
    syncSide();
    syncDisplay(self);
    if (tableOn) syncTable(self);
    syncPicker();
    // Simulation: its own panel instead of the graph view
    $('mainView').hidden = state.picker || tab === 'sim' || tab === 'arr' || tab === 'track';
    $('trackPanel').hidden = tab !== 'track';
    if (tab === 'track') autoSample();
    $('tpLegend').hidden = !logView.loaded;
    $('simPanel').hidden = tab !== 'sim';
    if (tab === 'sim') { simView.render(); if (logView.loaded) logView._redrawSoon(); }
    $('arrPanel').hidden = tab !== 'arr';
    if (tab === 'arr') { arrView.render(); if (logView.loaded) logView._redrawSoon(); }   // its timeline / circuit map sit in the left column
    renderChart();
  }

  // Label above the graph: what it shows — the maps of a riding mode / gear / all maps, or the selected map.
  // Legend entries hide / show their data type on the graph (click again to show it); applies to every view.
  state.hide = new Set();
  document.querySelectorAll('.chart-legends [data-k]').forEach(el => {
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    el.title = 'Click to hide / show';
    const toggle = () => { const k = el.dataset.k; state.hide.has(k) ? state.hide.delete(k) : state.hide.add(k); renderChart(); };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  function syncChartTitle(self) {
    const tab = state.tab, el = $('chartTitle');
    el.hidden = tab === 'settings' || tab === 'track' || state.picker;
    // the selected μ level is kept lowercase (the label is upper case, which would turn μ into "Μ")
    const muTxt = ` · <span class="lc">${esc(fmtMu(D.MU_ROWS[state.muIndex]))}</span>`;
    let html;
    if (tab === 'user') html = `+- button levels · slip target map ${self.id}${muTxt}`;
    else if (!noSel()) {
      const w = where();
      html = `Slip target map ${self.id}` + (w !== `Map ${self.id}` ? ` · ${esc(w)}` : '') + muTxt;
    } else if (tab === 'modes') html = `${esc(MODE_NAMES[state.vmode])} slip target maps${secSuffix()}`;
    else if (tab === 'gears') html = `${SL().one} ${slotTag(state.cell.gear)} slip target maps${secSuffix()}`;
    else if (tab === 'sectors') html = `Sector ${state.cell.sec + 1} · ${esc(MODE_NAMES[state.cell.mode])} slip target maps`;
    else html = state.mapFilter.size ? `Slip target maps ${[...state.mapFilter].sort((a, b) => a - b).join(', ')}` : 'All slip target maps';
    el.innerHTML = html;
    $('legendMu').textContent = `Map at ${fmtMu(D.MU_ROWS[state.muIndex])}`;   // the bold line = the selected μ level
  }

  // Riding modes / Gears / All slip target maps share one plot size: room for the longest right-hand
  // label any of them can show (gear groups like "#1, #2, #3", mode groups like "Rain, Int", "μ 1.00").
  function sharedLabelChars() {
    const grouped = names => { const by = {}; names.forEach(([id, n]) => (by[id] = by[id] || []).push(n)); return Object.values(by).map(a => a.join(', ').length); };
    const lens = [6];
    D.VEHICLE_MODES.forEach(m => lens.push(...grouped(gearLine(m).map((id, gi) => [id, slotTag(gi)]))));
    for (let gi = 0; gi < SL().n; gi++) lens.push(...grouped(D.VEHICLE_MODES.map(m => [A(m, gi), MODE_NAMES[m]])));
    return Math.max(...lens);
  }

  function renderChart() {
    const user = state.tab === 'user', maps = state.tab === 'maps', na = noSel();
    const lvlSel = user && state.shiftLvl != null;
    chart.set({
      targets: D.targets,
      targetIndex: state.targetIndex,
      muIndex: state.muIndex,
      showLog: logView.show,
      // MoTeC data shown and a map selected: only that map is drawn (no other maps or their labels),
      // and its μ band covers only the μ range of the log's μ filter
      soloActive: logView.show && !na,
      muBand: logView.muFilter,
      alloc: gearLine().slice(),
      compare: state.tab === 'modes' || state.tab === 'gears' || state.tab === 'sectors',
      series: state.tab === 'gears' ? gearSeries() : state.tab === 'modes' || state.tab === 'sectors' ? gearLine().map((id, gi) =>
        ({ id, name: slotTag(gi), desc: `${SL().one} ${gi + 1}`, color: slotColors()[gi] })) : null,
      editable: !user && !na,       // the user offset preview is read-only; nothing to edit without a selection
      noActive: na,
      rowsHidden: user || na || (maps && !state.showMu) || state.hide.has('mu'),
      muHidden: (maps && !state.showMu) || state.hide.has('mu'),
      hide: Object.fromEntries([...state.hide].map(k => [k, true])),   // legend toggles (points, active, logSlip, logTgt, accel)
      activeColor: maps ? mapColor(D.targets[state.targetIndex].id) : lvlSel ? shiftColor(state.shiftLvl) : null,   // selected map keeps its own colour
      activeLabel: lvlSel ? lvl(state.shiftLvl) : null,
      activeVals: lvlSel ? shiftVals(STEPS.indexOf(state.shiftLvl)) : null,   // +- Buttons: the selected level is the bold line
      lockedRows: MuLines.lockedRows(D.targets[state.targetIndex]),
      labelChars: user ? 0 : sharedLabelChars(),
      // maps of the selected and the hovered allocation cell are drawn thicker, if they are on the graph
      emphTargets: user || state.editor ? [] : [editId(), state.hoverMap].filter(x => x != null),
      noGlow: user,                                   // +- Buttons: no gradient under the selected line
      plainLabels: user,                              // +- Buttons: level labels as text
      overlays: user ? shiftOverlays() : maps && !state.editor ? allMapsOverlays() : [],   // other maps in the background; the editor overlay shows only the edited map
    });
    $('logLegend').hidden = !logView.show;           // logged data legend in the title row, while the data is shown
    document.querySelectorAll('.chart-legends [data-k]').forEach(el => {   // hidden data types: faded, struck through
      const off = state.hide.has(el.dataset.k);
      el.classList.toggle('is-off', off);
      el.setAttribute('aria-pressed', !off);
    });
    // legend swatches in the selected line's colour
    $('chartLegend').style.setProperty('--lc', chart.curves && chart.curves.active ? chart.curves.active.color : '#3f8ce8');
  }
  sync();
})();
