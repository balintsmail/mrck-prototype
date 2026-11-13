// RangeUI — the common look of the sliders, after the μ filter slider of log-panel.js: dots at the significant steps
// on the track and small scale numbers below it, and the value in a text field right of the slider. The field follows
// the slider (also when code sets range.value) and takes typed numbers; a number outside the accepted range is not
// applied: the field turns red and a hint below names the range (Esc / leaving the field restores the value).
//   RangeUI.attach(range, { unit, tick, min: () => n, max: () => n, txt })   txt: an existing text field to use
//   RangeUI.attachDual(lo, hi, { unit, tick })                               two thumbs (from / to) on one track
(function () {
  const NATIVE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const num = s => { const v = parseFloat(String(s).trim().replace(',', '.').replace('−', '-')); return /^[-−]?\d*[.,]?\d+$|^[-−]?\d+[.,]?$/.test(String(s).trim()) ? v : NaN; };
  const decOf = x => (String(x).split('.')[1] || '').length;
  const fmt = (v, step) => String(+(+v).toFixed(Math.min(4, decOf(step))));
  const lbl = v => String(+v.toFixed(6));
  // about five labelled steps: 1 / 2 / 5 × 10^n
  function niceStep(span) { const raw = span / 5, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  function ticksOf(min, max, t) {
    t = t || niceStep(max - min);
    const out = [];
    for (let v = Math.ceil(min / t - 1e-9) * t; v <= max + 1e-9; v += t) out.push(+v.toFixed(6));
    if (!out.length || out[0] - min > t / 2) out.unshift(min); else out[0] = Math.max(out[0], min);
    if (max - out[out.length - 1] > t / 2) out.push(max);
    return out;
  }
  // thumb centres travel from 8 px to (width − 8 px) on every slider here (16 px thumbs)
  const at = (v, min, max) => `calc(8px + (100% - 16px) * ${(v - min) / (max - min || 1)})`;
  function scale(min, max, tick) {
    const ts = ticksOf(min, max, tick);
    const dots = document.createElement('div'); dots.className = 'rg-dots'; dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = ts.slice(1, -1).map(v => `<i style="left:${at(v, min, max)}"></i>`).join('');
    const ticks = document.createElement('div'); ticks.className = 'rg-ticks'; ticks.setAttribute('aria-hidden', 'true');
    ticks.innerHTML = ts.map((v, k) => `<span style="left:${at(v, min, max)}"${k === 0 ? ' class="rg-first"' : k === ts.length - 1 ? ' class="rg-last"' : ''}>${lbl(v)}</span>`).join('');
    return [dots, ticks];
  }
  function field(label) {
    const txt = document.createElement('input');
    txt.type = 'text'; txt.inputMode = 'decimal'; txt.className = 'rg-val'; txt.setAttribute('aria-label', label + ' value');
    return txt;
  }
  // the text field's checks; apply(v) sets the slider (range rule: lo() .. hi())
  function bindField(txt, hint, lo, hi, apply, current) {
    const bad = on => { txt.classList.toggle('is-bad', on); txt.setAttribute('aria-invalid', on); hint.hidden = !on; if (on) hint.textContent = `Enter a number from ${lbl(lo())} to ${lbl(hi())}`; };
    txt.addEventListener('input', e => {
      const v = num(txt.value);
      if (!(v >= lo() - 1e-9 && v <= hi() + 1e-9)) { bad(true); e.stopImmediatePropagation(); return; }   // not applied
      bad(false);
      if (apply) apply(v);
    }, true);
    const restore = () => { bad(false); txt.value = current(); };
    txt.addEventListener('blur', restore);
    txt.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); restore(); txt.select(); }
      if (e.key === 'Enter') txt.blur();
    });
  }
  // code that sets range.value also updates the text field
  function follow(range, upd) {
    Object.defineProperty(range, 'value', { configurable: true, get() { return NATIVE.get.call(this); }, set(v) { NATIVE.set.call(this, v); upd(); } });
    range.addEventListener('input', upd);
  }
  const fire = range => range.dispatchEvent(new Event('input', { bubbles: true }));

  function attach(range, o = {}) {
    if (range.rgUI) return range.rgUI;
    const min = +range.min, max = +range.max, step = range.step || 1;
    const lo = o.min || (() => min), hi = o.max || (() => max);
    const track = document.createElement('div'); track.className = 'rg-track';
    range.before(track); track.appendChild(range);
    track.append(...scale(min, max, o.tick));
    const hint = document.createElement('p'); hint.className = 'rg-hint'; hint.hidden = true; hint.setAttribute('aria-live', 'polite');
    let txt = o.txt;
    if (txt) {                                        // an existing field (μ levels, +- buttons): its own handlers apply it
      txt.parentNode.classList.add('has-rg');
      txt.parentNode.appendChild(hint);
      bindField(txt, hint, lo, hi, null, () => txt.value);
      return (range.rgUI = { txt });
    }
    const row = document.createElement('div'); row.className = 'rg-row';
    track.before(row); row.appendChild(track);
    const box = document.createElement('span'); box.className = 'rg-box';
    txt = field(range.getAttribute('aria-label') || 'Slider');
    box.appendChild(txt);
    if (o.unit) { const u = document.createElement('span'); u.className = 'rg-unit'; u.textContent = o.unit; box.appendChild(u); }
    row.appendChild(box); row.after(hint);
    const upd = () => { if (document.activeElement !== txt) txt.value = fmt(range.value, step); };
    follow(range, upd); upd();
    bindField(txt, hint, lo, hi, v => { NATIVE.set.call(range, v); fire(range); }, () => fmt(range.value, step));
    return (range.rgUI = { txt });
  }

  // two thumbs on one track (the ends never cross): the "from" field accepts min .. to, the "to" field from .. max
  function attachDual(a, b, o = {}) {
    const min = +a.min, max = +a.max, step = a.step || 1, wrap = a.parentNode;
    const track = document.createElement('div'); track.className = 'rg-track rg-dual';
    wrap.before(track); track.appendChild(wrap);
    track.append(...scale(min, max, o.tick));
    const row = document.createElement('div'); row.className = 'rg-row';
    track.before(row); row.appendChild(track);
    const box = document.createElement('span'); box.className = 'rg-box';
    const ta = field(a.getAttribute('aria-label') || 'From'), tb = field(b.getAttribute('aria-label') || 'To');
    const dash = document.createElement('span'); dash.className = 'rg-unit'; dash.textContent = '–';
    box.append(ta, dash, tb);
    if (o.unit) { const u = document.createElement('span'); u.className = 'rg-unit'; u.textContent = o.unit; box.appendChild(u); }
    row.appendChild(box);
    const hint = document.createElement('p'); hint.className = 'rg-hint'; hint.hidden = true; hint.setAttribute('aria-live', 'polite');
    row.after(hint);
    [[a, ta, () => min, () => +b.value], [b, tb, () => +a.value, () => max]].forEach(([r, t, lo, hi]) => {
      const upd = () => { if (document.activeElement !== t) t.value = fmt(r.value, step); };
      follow(r, upd); upd();
      bindField(t, hint, lo, hi, v => { NATIVE.set.call(r, v); fire(r); }, () => fmt(r.value, step));
    });
    return { txt: [ta, tb] };
  }

  window.RangeUI = { attach, attachDual };
})();
