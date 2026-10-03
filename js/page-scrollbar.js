// Page scrollbar drawn over the content (the browser's own one is hidden, so it takes no width), in the style of the
// left column's scrollbar: 12px wide, 6px rounded thumb, no track or arrows. Shown only while the page scrolls.
// Drag the thumb, or press above / below it to page up / down.
(function () {
  const HEADER = 0;                                      // full window height (the header scrolls away)
  const bar = document.createElement('div');
  bar.className = 'page-scroll';
  bar.setAttribute('aria-hidden', 'true');               // the page still scrolls with the wheel, keys and touch
  bar.innerHTML = '<div class="page-scroll-thumb"></div>';
  document.body.appendChild(bar);
  const thumb = bar.firstChild, root = document.documentElement;

  let geo = null;
  function update() {
    const view = window.innerHeight, total = root.scrollHeight, track = view - HEADER;
    if (total <= view + 1) { bar.hidden = true; geo = null; return; }
    bar.hidden = false;
    const h = Math.max(32, track * view / total), maxTop = track - h, maxScroll = total - view;
    geo = { h, maxTop, maxScroll };
    thumb.style.height = h + 'px';
    thumb.style.transform = `translateY(${(window.scrollY / maxScroll) * maxTop}px)`;
  }

  let drag = null;
  thumb.addEventListener('pointerdown', e => {
    if (!geo || e.button > 0) return;
    e.preventDefault();
    drag = { y: e.clientY, s: window.scrollY };
    try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    bar.classList.add('is-dragging');
  });
  thumb.addEventListener('pointermove', e => {
    if (!drag || !geo) return;
    window.scrollTo(0, drag.s + (e.clientY - drag.y) * geo.maxScroll / geo.maxTop);
  });
  const end = () => { drag = null; bar.classList.remove('is-dragging'); };
  thumb.addEventListener('pointerup', end);
  thumb.addEventListener('pointercancel', end);
  bar.addEventListener('pointerdown', e => {            // on the empty part: one page towards the pointer
    if (e.target !== bar || !geo) return;
    const above = e.clientY < thumb.getBoundingClientRect().top;
    window.scrollBy({ top: (above ? -1 : 1) * (window.innerHeight - HEADER) * 0.9, behavior: 'smooth' });
  });

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  new ResizeObserver(update).observe(document.body);    // content growing / shrinking (tabs, log panel, tables)
  update();
})();
