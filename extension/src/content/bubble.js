// ISOLATED-world content script: a draggable Odoo Debug button, on the bottom edge of the page until dragged elsewhere
// (dropped back on that edge, it sticks to it again). Clicking it opens the panel (src/panel/panel.html) in an iframe
// next to it, following it: beside the button, aligned on its top (upper half of the window) or its bottom (lower half). Shown on Odoo pages only.
// Its size: dragged from the corner away from the button (double-click there: back to the default), kept per Odoo.
// Also: ⌥/Alt + click on a field of the page, or on a tracked change in the chatter, copies its technical name, and the
// RPCs recorded by hook.js go to the panel.
(() => {
  const SIZE = 40; // button, px
  const GAP = 8;
  const SNAP = 24; // dropped this close to the bottom edge: the button sticks to it again
  const POS_KEY = 'odoo-debug-pos'; // localStorage of the site, one per Odoo instance: { x, y, bottom } (bottom: on the bottom edge)
  const OPEN_KEY = 'odoo-debug-open'; // sessionStorage: the panel reopens after a reload (debug switch, /web/become)
  const FULL_KEY = 'odoo-debug-full'; // sessionStorage too: full screen survives a reload
  const SIZE_KEY = 'odoo-debug-size'; // localStorage, like the position: { w, h } of the panel dragged to that size
  const MIN = { w: 320, h: 260 };
  const store = (s, k, v) => { try { v == null ? s.removeItem(k) : s.setItem(k, v); } catch { /* storage blocked */ } };
  const load = (s, k) => { try { return s.getItem(k); } catch { return null; } };

  let root, btn, frame, grip, pos, size;
  let full = false;
  let popout = null; // port of the panel's own window (src/background.js opens it), while it is open

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
      .frame { position: fixed; z-index: 2147483646; width: var(--w, 420px); height: min(var(--h, 720px), calc(100vh - ${2 * GAP}px));
        max-width: calc(100vw - ${2 * GAP}px); border-radius: 14px; overflow: hidden; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 12px 40px rgba(0,0,0,.22); }
      .frame[hidden] { display: none; }
      .frame.full { width: calc(100vw - ${2 * GAP}px); height: calc(100vh - ${2 * GAP}px); max-width: none; }
      iframe { display: block; width: 100%; height: 100%; border: 0; }
      .sizing iframe { pointer-events: none; } /* the pointer stays ours while it crosses the panel */
      /* the resize grip: the corner away from the button (data-at: t/b + l/r), an arc inside the panel's rounded corner */
      .grip { position: absolute; z-index: 1; width: 16px; height: 16px; touch-action: none; opacity: .6; }
      .grip:hover, .sizing .grip { opacity: 1; }
      .grip::after { content: ''; position: absolute; width: 12px; height: 12px; border: 0 solid #8f8a99; }
      .grip[data-at=br] { right: 0; bottom: 0; cursor: nwse-resize; } .grip[data-at=br]::after { right: 4px; bottom: 4px; border-width: 0 2px 2px 0; border-bottom-right-radius: 10px; }
      .grip[data-at=tl] { left: 0; top: 0; cursor: nwse-resize; } .grip[data-at=tl]::after { left: 4px; top: 4px; border-width: 2px 0 0 2px; border-top-left-radius: 10px; }
      .grip[data-at=tr] { right: 0; top: 0; cursor: nesw-resize; } .grip[data-at=tr]::after { right: 4px; top: 4px; border-width: 2px 2px 0 0; border-top-right-radius: 10px; }
      .grip[data-at=bl] { left: 0; bottom: 0; cursor: nesw-resize; } .grip[data-at=bl]::after { left: 4px; bottom: 4px; border-width: 0 0 2px 2px; border-bottom-left-radius: 10px; }
      .full .grip { display: none; }
      .toast { position: fixed; z-index: 2147483647; padding: 4px 8px; border-radius: 6px; pointer-events: none;
        background: #1f1d24; color: #fff; font: 600 12px ui-monospace, Menlo, monospace; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    </style><button type="button" title="Odoo Debug · ⌥/Alt + click a field (or a change in the chatter): copy its name" aria-label="Odoo Debug" aria-expanded="false"><img alt=""></button><div class="frame" hidden><div class="grip" title="Drag to resize · double-click: default size"></div></div>`;
    btn = root.querySelector('button');
    frame = root.querySelector('.frame');
    grip = root.querySelector('.grip');
    root.querySelector('img').src = chrome.runtime.getURL('icons/icon-48.png');
    document.documentElement.append(host);

    try { pos = JSON.parse(load(localStorage, POS_KEY)); } catch { /* bad value */ }
    if (pos && typeof pos.bottom !== 'boolean') pos = { x: pos.x, bottom: true }; // saved by a version before the bottom edge
    try { size = JSON.parse(load(localStorage, SIZE_KEY)); } catch { /* bad value */ }
    applySize();
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
        else if (ev.type === 'pointerup') press();
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
    btn.addEventListener('click', (e) => { if (e.detail === 0) press(); }); // keyboard (Enter / Space)
    grip.addEventListener('pointerdown', resize);
    grip.addEventListener('dblclick', () => { size = null; store(localStorage, SIZE_KEY, null); applySize(); place(); });

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
    const below = by + SIZE / 2 < innerHeight / 2;
    const top = below ? by : by + SIZE - h;
    grip.dataset.at = (below ? 'b' : 't') + (left < pos.x ? 'l' : 'r'); // the free corner: it grows away from the button
    Object.assign(frame.style, { left: `${clamp(left, GAP, innerWidth - w - GAP)}px`, top: `${clamp(top, GAP, innerHeight - h - GAP)}px`, bottom: '' });
  }

  /** The dragged size (CSS keeps it inside the window), or the default one. */
  function applySize() {
    frame.style.setProperty('--w', size?.w ? `${size.w}px` : '');
    frame.style.setProperty('--h', size?.h ? `${size.h}px` : '');
  }

  /** Drags the grip: the panel grows from it, its side on the button stays put (place() keeps it there). */
  function resize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const at = frame.getBoundingClientRect();
    const [v, h] = grip.dataset.at;
    const start = { x: e.clientX, y: e.clientY };
    frame.classList.add('sizing');
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      size = {
        w: Math.round(Math.min(Math.max(at.width + (h === 'l' ? -dx : dx), MIN.w), innerWidth - 2 * GAP)),
        h: Math.round(Math.min(Math.max(at.height + (v === 't' ? -dy : dy), MIN.h), innerHeight - 2 * GAP)),
      };
      applySize();
      place();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      frame.classList.remove('sizing');
      if (size) store(localStorage, SIZE_KEY, JSON.stringify(size));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
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

  /** The round button: the panel in the page, or its own window brought to the front while that one is open. */
  function press() {
    if (popout) chrome.runtime.sendMessage({ type: 'odoo-popout' }).catch(() => {});
    else toggle();
  }

  function toggle(open = frame.hidden) {
    // The panel is only created on first open: nothing runs (no RPC) until then.
    if (open && !frame.querySelector('iframe')) {
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
    document.addEventListener(type, (e) => {
      frame?.querySelector('iframe')?.contentWindow?.postMessage({ type, detail: e.detail }, PANEL);
      popout?.postMessage({ type, detail: e.detail });
    });
  }

  // The panel's own window connects on opening and after each page load: the panel in the page closes (and its iframe
  // goes: one panel at a time, no RPC twice). Closing the window disconnects; the button opens the panel here again.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'odoo-popout') return;
    popout = port;
    port.onDisconnect.addListener(() => { if (popout === port) popout = null; });
    if (!btn) return; // not mounted yet: it will start closed (the open state was cleared when it popped out)
    toggle(false);
    frame.querySelector('iframe')?.remove();
  });

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
    if (msg?.type !== 'odoo-toggle' || !btn) return; // { open: false }: the panel's minimize button; { open: true }: its window docking back
    if (msg.open == null && popout) return press(); // shortcut, toolbar popup: the window, while it is open
    toggle(msg.open ?? frame.hidden);
    if (msg.open === false) btn.focus(); // keyboard users land on the button that reopens it
  });
})();
