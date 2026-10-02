// SheetGrid — small spreadsheet-like table: active cell, rectangular selection (click, Shift+click,
// drag, Shift+arrows), type to edit (Enter / Tab / Esc, F2, double-click), Ctrl+C / Ctrl+V as
// tab-separated text (Excel compatible). Values are owned by the caller through callbacks.
(function () {
  class SheetGrid {
    constructor(table, o) {
      this.t = table;
      this.o = Object.assign({
        rows: [], cols: [], corner: '',
        get: () => '', format: v => String(v), parse: s => s,
        readOnly: () => false, write: () => 0, onActive() {}, cellClass: () => '',
        onRowHeader: null, onColHeader: null,   // optional: headers become clickable
        headerActive: () => false,              // ('row'|'col', index) -> highlighted header
        activeButton: null,          // { html, label(r, c), onClick(r, c) } shown in the active cell
        onMessage() {}, label: '',
      }, o);
      this.a = { r: 0, c: 0 };       // active cell (anchor)
      this.e = { r: 0, c: 0 };       // other corner of the selection
      this.editing = null;
      table.tabIndex = 0;
      table.classList.add('sheet');
      table.setAttribute('role', 'grid');
      if (this.o.label) table.setAttribute('aria-label', this.o.label);
      this.build();
      this._bind();
    }

    get nr() { return this.o.rows.length; }
    get nc() { return this.o.cols.length; }
    rect() {
      const { a, e } = this;
      return { r0: Math.min(a.r, e.r), r1: Math.max(a.r, e.r), c0: Math.min(a.c, e.c), c1: Math.max(a.c, e.c) };
    }
    clamp(r, c) { return { r: Math.max(0, Math.min(this.nr - 1, r)), c: Math.max(0, Math.min(this.nc - 1, c)) }; }

    // Rebuild when rows / columns change (e.g. a target point was added).
    setShape(rows, cols) {
      const same = rows.length === this.nr && cols.length === this.nc &&
        rows.every((x, i) => x === this.o.rows[i]) && cols.every((x, i) => x === this.o.cols[i]);
      this.o.rows = rows; this.o.cols = cols;
      if (!same) { this.a = this.clamp(this.a.r, this.a.c); this.e = this.clamp(this.e.r, this.e.c); this.build(); }
      else this.render();
    }

    build() {
      const o = this.o, btn = o.activeButton;
      this.t.innerHTML =
        `<thead><tr><th class="corner">${o.corner}</th>${o.cols.map((c, i) => `<th scope="col" data-hc="${i}"${o.onColHeader ? ' class="hdr-click"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>` +
        o.rows.map((rl, r) => `<tr><th scope="row" data-hr="${r}"${o.onRowHeader ? ' class="hdr-click"' : ''}>${rl}</th>` + o.cols.map((cl, c) =>
          `<td role="gridcell" data-r="${r}" data-c="${c}">` +
          (btn ? `<button class="sg-btn" tabindex="-1">${btn.html}</button>` : '') +
          '<span class="num"></span></td>').join('') + '</tr>').join('') + '</tbody>';
      this.render();
    }

    render() {
      const s = this.rect(), o = this.o, single = s.r0 === s.r1 && s.c0 === s.c1;
      this.t.querySelectorAll('th[data-hr]').forEach(th => th.classList.toggle('hdr-on', !!o.headerActive('row', +th.dataset.hr)));
      this.t.querySelectorAll('th[data-hc]').forEach(th => th.classList.toggle('hdr-on', !!o.headerActive('col', +th.dataset.hc)));
      this.t.querySelectorAll('td[data-r]').forEach(td => {
        const r = +td.dataset.r, c = +td.dataset.c;
        const active = r === this.a.r && c === this.a.c;
        const inSel = r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1;
        td.querySelector('.num').textContent = o.format(o.get(r, c), r, c);
        td.className = o.cellClass(r, c) || '';
        td.setAttribute('aria-selected', inSel);
        td.setAttribute('aria-readonly', !!o.readOnly(r, c));
        td.classList.toggle('ro', !!o.readOnly(r, c));
        td.classList.toggle('is-active', active);
        td.classList.toggle('in-sel', inSel && !single);
        td.classList.toggle('sel-t', inSel && r === s.r0);
        td.classList.toggle('sel-b', inSel && r === s.r1);
        td.classList.toggle('sel-l', inSel && c === s.c0);
        td.classList.toggle('sel-r', inSel && c === s.c1);
        const b = td.querySelector('.sg-btn');
        if (b && o.activeButton) { b.title = o.activeButton.label(r, c); b.setAttribute('aria-label', b.title); }
      });
    }

    // Move the active cell (or extend the selection).
    setActive(r, c, extend, silent) {
      ({ r, c } = this.clamp(r, c));
      if (extend) { this.e = { r, c }; this.render(); return; }
      this.a = { r, c }; this.e = { r, c };
      this.render();
      if (!silent) this.o.onActive(r, c);
    }

    _bind() {
      const t = this.t;
      let drag = false;
      t.addEventListener('mousedown', ev => {
        const th = ev.target.closest('th[data-hr], th[data-hc]');
        if (th && ev.button === 0) {
          if (th.dataset.hr != null && this.o.onRowHeader) { ev.preventDefault(); this.o.onRowHeader(+th.dataset.hr); }
          if (th.dataset.hc != null && this.o.onColHeader) { ev.preventDefault(); this.o.onColHeader(+th.dataset.hc); }
          return;
        }
        const td = ev.target.closest('td[data-r]'); if (!td || ev.button !== 0) return;
        if (this.editing) this.commit();
        const r = +td.dataset.r, c = +td.dataset.c;
        if (ev.target.closest('.sg-btn')) { ev.preventDefault(); t.focus(); this.o.activeButton.onClick(r, c); return; }
        ev.preventDefault(); t.focus();
        this.setActive(r, c, ev.shiftKey);
        drag = true;
      });
      t.addEventListener('mouseover', ev => {
        if (!drag) return;
        const td = ev.target.closest('td[data-r]'); if (td) this.setActive(+td.dataset.r, +td.dataset.c, true);
      });
      document.addEventListener('mouseup', () => { drag = false; });
      t.addEventListener('dblclick', ev => { if (ev.target.closest('td[data-r]')) this.edit(this.o.format(this.o.get(this.a.r, this.a.c))); });

      t.addEventListener('keydown', ev => {
        if (this.editing) return;
        const { a } = this, end = ev.shiftKey ? this.e : a;
        const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
        if (mv) { ev.preventDefault(); this.setActive(end.r + mv[0], end.c + mv[1], ev.shiftKey); return; }
        if (ev.key === 'Tab') { ev.preventDefault(); this.setActive(a.r, a.c + (ev.shiftKey ? -1 : 1)); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); if (ev.shiftKey) this.setActive(a.r - 1, a.c); else this.edit(this.o.format(this.o.get(a.r, a.c))); return; }
        if (ev.key === 'F2') { ev.preventDefault(); this.edit(this.o.format(this.o.get(a.r, a.c))); return; }
        if (/^[0-9.,\-]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); this.edit(ev.key); }
      });

      document.addEventListener('copy', ev => {
        if (document.activeElement !== t) return;
        const s = this.rect(), lines = [];
        for (let r = s.r0; r <= s.r1; r++) {
          const row = []; for (let c = s.c0; c <= s.c1; c++) row.push(this.o.format(this.o.get(r, c), r, c));
          lines.push(row.join('\t'));
        }
        ev.clipboardData.setData('text/plain', lines.join('\n'));
        ev.preventDefault();
        const n = (s.r1 - s.r0 + 1) * (s.c1 - s.c0 + 1);
        this.o.onMessage(`${n} cell${n > 1 ? 's' : ''} copied`);
      });
      document.addEventListener('paste', ev => {
        if (document.activeElement !== t) return;
        const text = ev.clipboardData.getData('text/plain'); if (!text) return;
        ev.preventDefault();
        const block = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t').map(x => this.o.parse(x)));
        const s = this.rect(), cells = [];
        if (block.length === 1 && block[0].length === 1) {
          // one value fills the whole selection
          for (let r = s.r0; r <= s.r1; r++) for (let c = s.c0; c <= s.c1; c++) cells.push({ r, c, v: block[0][0] });
        } else {
          block.forEach((row, i) => row.forEach((v, j) => cells.push({ r: s.r0 + i, c: s.c0 + j, v })));
          this.a = { r: s.r0, c: s.c0 };
          this.e = this.clamp(s.r0 + block.length - 1, s.c0 + Math.max(...block.map(b => b.length)) - 1);
        }
        const n = this._write(cells);
        this.o.onMessage(n ? `${n} cell${n > 1 ? 's' : ''} pasted` : 'Nothing pasted — values out of range or read-only');
      });
    }

    _write(cells) {
      const ok = cells.filter(x => x.r < this.nr && x.c < this.nc && x.v != null && !this.o.readOnly(x.r, x.c));
      const n = ok.length ? this.o.write(ok) : 0;
      this.render();
      return n;
    }

    // Inline editor in the active cell.
    edit(initial) {
      const { r, c } = this.a;
      if (this.o.readOnly(r, c)) { this.o.onMessage('This cell is calculated and cannot be edited'); return; }
      const td = this.t.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
      const inp = document.createElement('input');
      inp.className = 'sg-edit'; inp.inputMode = 'decimal'; inp.value = initial;
      inp.setAttribute('aria-label', `${this.o.rows[r]} ${this.o.cols[c]}`);
      td.appendChild(inp);
      this.editing = { r, c, inp };
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
      inp.addEventListener('keydown', ev => {
        // Arrow keys save the cell and move, like Excel while typing into a cell.
        const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
        if (mv) { ev.preventDefault(); ev.stopPropagation(); this.commit(); this.setActive(r + mv[0], c + mv[1]); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); this.commit(); this.setActive(r + (ev.shiftKey ? -1 : 1), c); }
        else if (ev.key === 'Tab') { ev.preventDefault(); this.commit(); this.setActive(r, c + (ev.shiftKey ? -1 : 1)); }
        else if (ev.key === 'Escape') { ev.preventDefault(); this.cancel(); }
        ev.stopPropagation();
      });
      inp.addEventListener('blur', () => { if (this.editing && this.editing.inp === inp) this.commit(); });
    }
    cancel() {
      if (!this.editing) return;
      const { inp } = this.editing; this.editing = null; inp.remove(); this.t.focus();
    }
    commit() {
      if (!this.editing) return;
      const { r, c, inp } = this.editing; this.editing = null;
      const v = this.o.parse(inp.value);
      inp.remove();
      this.t.focus();
      if (v == null) { this.o.onMessage('Value out of range'); this.render(); return; }
      if (v !== this.o.get(r, c)) this._write([{ r, c, v }]);
    }
  }

  window.SheetGrid = SheetGrid;
})();
