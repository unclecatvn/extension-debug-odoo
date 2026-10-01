// ISOLATED-world content script: a draggable Odoo Debug button, on the bottom edge of the page until dragged elsewhere
// (dropped back on that edge, it sticks to it again). Clicking it opens the panel (src/panel/panel.html) in an iframe
// next to it, following it: beside the button, aligned on its top (upper half of the window) or its bottom (lower half). Shown on Odoo pages only.
// Also: ⌥/Alt + click on a field of the page, or on a tracked change in the chatter, copies its technical name, and the
// RPCs recorded by hook.js go to the panel.
(() => {
  const SIZE = 40; // button, px
  const GAP = 8;
  const SNAP = 24; // dropped this close to the bottom edge: the button sticks to it again
  const POS_KEY = 'odoo-debug-pos'; // localStorage of the site, one per Odoo instance: { x, y, bottom } (bottom: on the bottom edge)
  const OPEN_KEY = 'odoo-debug-open'; // sessionStorage: the panel reopens after a reload (debug switch, /web/become)
  const FULL_KEY = 'odoo-debug-full'; // sessionStorage too: full screen survives a reload
  const store = (s, k, v) => { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* storage blocked */ } };
  const load = (s, k) => { try { return s.getItem(k); } catch { return null; } };

  let root, btn, frame, pos;
  let full = false;

  function mount() {
    if (btn) return;
    const host = document.createElement('odoo-debug-root');
    root = host.attachShadow({ mode: 'closed' }); // Odoo's CSS can't reach in, ours can't leak out
    root.innerHTML = `<style>
      :host { all: initial; }
      button { position: fixed; z-index: 2147483647; width: ${SIZE}px; height: ${SIZE}px; padding: 0; border: 0; border-radius: 50%;
        background: #714b67; box-shadow: 0 2px 8px rgba(0,0,0,.35); cursor: grab; touch-action: none; display: grid; place-items: center; }
      button:active { cursor: grabbing; }
      button[hidden] { display: none; }
      button:focus-visible { outline: 3px solid #d5a6c8; outline-offset: 2px; }
      img { width: 24px; height: 24px; pointer-events: none; }
      .frame { position: fixed; z-index: 2147483646; width: 420px; height: min(720px, calc(100vh - ${2 * GAP}px));
        max-width: calc(100vw - ${2 * GAP}px); border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 40px rgba(0,0,0,.22); }
      .frame[hidden] { display: none; }
      .frame.full { width: calc(100vw - ${2 * GAP}px); height: calc(100vh - ${2 * GAP}px); max-width: none; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
      .toast { position: fixed; z-index: 2147483647; padding: 4px 8px; border-radius: 6px; pointer-events: none;
        background: #1f1d24; color: #fff; font: 600 12px ui-monospace, Menlo, monospace; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    </style><button type="button" title="Odoo Debug · ⌥/Alt + click a field (or a change in the chatter): copy its name" aria-label="Odoo Debug" aria-expanded="false"><img alt=""></button><div class="frame" hidden></div>`;
    btn = root.querySelector('button');
    frame = root.querySelector('.frame');
    root.querySelector('img').src = chrome.runtime.getURL('icons/icon-48.png');
    document.documentElement.append(host);

    try { pos = JSON.parse(load(localStorage, POS_KEY)); } catch { /* bad value */ }
    if (pos && typeof pos.bottom !== 'boolean') pos = { x: pos.x, bottom: true }; // saved by a version before the bottom edge
    place();
    addEventListener('resize', place);
    addEventListener('click', altClick, true); // capture: before Odoo opens the record / focuses the input

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !pos) return;
      const at = btn.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, px: at.left, py: at.top };
      let moved = false;
      btn.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return; // a click wobbles a little
        moved = true;
        pos = { x: start.px + dx, y: start.py + dy, bottom: false };
        place();
      };
      const up = (ev) => {
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        if (moved) {
          if (pos.y >= innerHeight - SIZE - GAP - SNAP) pos = { x: pos.x, bottom: true }; // back on the bottom edge
          place();
          store(localStorage, POS_KEY, JSON.stringify(pos));
        }
        else if (ev.type === 'pointerup') toggle();
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
    btn.addEventListener('click', (e) => { if (e.detail === 0) toggle(); }); // keyboard (Enter / Space)

    if (load(sessionStorage, FULL_KEY)) setFull(true);
    if (load(sessionStorage, OPEN_KEY)) toggle(true);
  }

  /** Keeps the button on screen (on the bottom edge unless dragged away) and the panel beside it, on the side with more room. */
  function place() {
    if (!innerWidth) return; // no layout yet (e.g. a tab opened in the background): the resize listener comes back
    if (!Number.isFinite(pos?.x)) pos = { x: innerWidth - SIZE - 16, bottom: true }; // default: bottom right
    const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
    pos.x = clamp(pos.x, GAP, innerWidth - SIZE - GAP);
    if (pos.bottom) Object.assign(btn.style, { left: `${pos.x}px`, top: '', bottom: `${GAP}px` }); // follows the edge on resize
    else Object.assign(btn.style, { left: `${pos.x}px`, top: `${clamp(pos.y, GAP, innerHeight - SIZE - GAP)}px`, bottom: '' });
    btn.hidden = false;
    if (frame.hidden) return;
    btn.hidden = full; // full screen: the button would cover the panel's corner (its − and Esc bring the button back)
    if (full) return Object.assign(frame.style, { left: `${GAP}px`, top: `${GAP}px`, bottom: '' });
    const w = frame.offsetWidth;
    const h = frame.offsetHeight; // CSS: at most 100vh - 2 gaps, so the clamp below keeps the header on screen
    const left = pos.x + SIZE / 2 > innerWidth / 2 ? pos.x - w - GAP : pos.x + SIZE + GAP;
    const by = btn.getBoundingClientRect().top;
    // follows the button (also while dragging): its top edge on the button's top in the upper half, its bottom edge on the button's bottom below
    const top = by + SIZE / 2 < innerHeight / 2 ? by : by + SIZE - h;
    Object.assign(frame.style, { left: `${clamp(left, GAP, innerWidth - w - GAP)}px`, top: `${clamp(top, GAP, innerHeight - h - GAP)}px`, bottom: '' });
  }

  /** Technical name of the field under `t`: form widget (or its label), list cell or list column header. */
  function fieldName(t) {
    const label = t.closest?.('label[for]');
    const input = label && document.getElementById(label.htmlFor);
    // a readonly field renders no input carrying the label's id, Odoo's `${name}_${n}`
    if (label && !input && label.matches('.o_form_label')) return label.htmlFor.replace(/_\d+$/, '');
    const n = (input || t).closest?.('.o_field_widget[name], td.o_data_cell[name], th[data-name]');
    return n ? n.getAttribute('name') || n.dataset.name : null;
  }

  /** Label of the field on the chatter tracking line under `t` ("Draft → Sent (Status)": Status), or null. */
  function trackingLabel(t) {
    const s = t.closest?.('.o-mail-Message-tracking')?.querySelector('.o-mail-Message-trackingField')?.textContent.trim();
    return s ? s.replace(/^\((.*)\)$/, '$1') : null;
  }

  /** Technical names of the current model's fields labelled `label`: the chatter shows only the label. Asked to hook.js
   * (MAIN world: Odoo's field service); [] when it doesn't answer (a tab open before an update, until reloaded). */
  function namesOf(label) {
    return new Promise((resolve) => {
      const done = (e) => { clearTimeout(timer); resolve(JSON.parse(e.detail)); };
      const timer = setTimeout(() => { document.removeEventListener('odoo-debug-field-names', done); resolve([]); }, 3000);
      document.addEventListener('odoo-debug-field-names', done, { once: true });
      document.dispatchEvent(new CustomEvent('odoo-debug-field-of', { detail: label }));
    });
  }

  async function altClick(e) {
    if (!e.altKey || e.button !== 0) return;
    const name = fieldName(e.target);
    const label = !name && trackingLabel(e.target);
    if (!name && !label) return;
    e.preventDefault(); // ⌥+click on a link would download it
    e.stopImmediatePropagation();
    const at = { x: e.clientX, y: e.clientY };
    const names = name ? [name] : await namesOf(label);
    if (!names.length) return toast(`✗ ${label}`, at);
    // ponytail: two fields with the same label: the first is copied, the toast names both
    toast(`${await copy(names[0]) ? '✓' : '✗'} ${names.join(' · ')}`, at);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* not a secure context (http://), or refused */ }
    const prev = document.activeElement;
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    prev?.focus?.();
    return ok;
  }

  function toast(text, at) {
    const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: text });
    Object.assign(t.style, { left: `${Math.min(at.x + 12, innerWidth - 240)}px`, top: `${at.y + 12}px` });
    root.append(t);
    setTimeout(() => t.remove(), 1200);
  }

  function toggle(open = frame.hidden) {
    // The panel is only created on first open: nothing runs (no RPC) until then.
    if (open && !frame.firstChild) {
      frame.append(Object.assign(document.createElement('iframe'), { src: chrome.runtime.getURL('src/panel/panel.html'), title: 'Odoo Debug', allow: 'clipboard-write' }));
    }
    frame.hidden = !open;
    btn.setAttribute('aria-expanded', open);
    store(sessionStorage, OPEN_KEY, open ? '1' : null);
    place();
  }

  /** Full screen: the panel covers the page, the button hides until it is minimized. */
  function setFull(on) {
    full = on;
    frame.classList.toggle('full', on);
    store(sessionStorage, FULL_KEY, on ? '1' : null);
    place();
  }

  /** Debug mode kept on for this Odoo (toolbar popup): a page opened without ?debug= reloads with it. An explicit
   * ?debug= (also empty or 0: turned off on purpose) is left alone. */
  async function autoDebug(debug) {
    const u = new URL(location.href);
    if (debug || u.searchParams.has('debug')) return;
    const { autoDebug: on = {} } = await chrome.storage.local.get('autoDebug').catch(() => ({}));
    if (!on[location.origin]) return;
    u.searchParams.set('debug', on[location.origin]);
    location.replace(u);
  }

  // RPCs recorded by hook.js and field picks (both MAIN world) go to the panel of this tab by postMessage, not through
  // chrome.runtime: in an incognito window its messages go to the extension's regular profile, never to the panel here.
  // No panel yet → dropped (hook.js keeps a buffer).
  const PANEL = new URL(chrome.runtime.getURL('')).origin;
  for (const type of ['odoo-debug-rpc', 'odoo-debug-pick']) {
    document.addEventListener(type, (e) => frame?.firstChild?.contentWindow?.postMessage({ type, detail: e.detail }, PANEL));
  }

  // Injected again by background.js after an update: the copy before it is orphaned (its chrome.* calls fail, the panel
  // hangs on Connecting… and neither − nor the button work), so it makes way. The page is loaded already: no ready event
  // will come, the DOM tells it is Odoo (webclient, or a frontend page), as for the toolbar icon.
  for (const old of document.querySelectorAll('odoo-debug-root')) old.remove();
  if (document.readyState !== 'loading' && document.querySelector('body.o_web_client, #wrapwrap')) mount();
  document.addEventListener('odoo-debug-ready', (e) => { autoDebug(e.detail); mount(); });
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'odoo-full') { // from the panel: { on } sets it, no `on` just asks; the answer is the current state
      if (btn && typeof msg.on === 'boolean') setFull(msg.on);
      return reply(full);
    }
    if (msg?.type !== 'odoo-toggle' || !btn) return; // { open: false }: from the panel's minimize button
    toggle(msg.open ?? frame.hidden);
    if (msg.open === false) btn.focus(); // keyboard users land on the button that reopens it
  });
})();
