// ISOLATED-world content script: a draggable Odoo Debug button, on the bottom edge of the page until dragged elsewhere
// (dropped back on that edge, it sticks to it again). Clicking it opens the panel (entrypoints/panel) in an iframe next
// to it, following it: beside the button, aligned on its top (upper half of the window) or its bottom (lower half).
// Shown on Odoo pages only; the toolbar popup toggles it too. The frame resizes from its free edges (grips), its size
// kept per Odoo instance. The panel can also live in its own window (entrypoints/background/detached-panel.ts): the
// frame then empties and the button brings that window to the front. Also: ⌥/Alt + click on a field of the page
// copies its technical name.
import { isExtMessage, type ExtMessage } from '../../contracts/messages.ts';
import { templates } from '../../ui/template.ts';
import html from './launcher.tpl.html';
import css from './launcher.css';
import { DEFAULT_SIZE, maxSize, placeFrame, readSize, resized, type Anchor, type Grip, type Side, type Size } from './geometry.ts';

const tpl = templates(html); // no translation: the page is not in the panel's language

/** Where the button sits: on the bottom edge (x only) or anywhere it was dropped. */
type Pos = { x: number; bottom: true } | { x: number; y: number; bottom: false };

(() => {
  const SIZE = 40; // button, px
  const GAP = 8;
  const SNAP = 24; // dropped this close to the bottom edge: the button sticks to it again
  const POS_KEY = 'odoo-debug-pos'; // localStorage of the site, one per Odoo instance
  const OPEN_KEY = 'odoo-debug-open'; // sessionStorage: the panel reopens after a reload (debug switch, /web/become)
  const FULL_KEY = 'odoo-debug-full'; // sessionStorage too: full screen survives a reload
  const SIZE_KEY = 'odoo-debug-size'; // localStorage of the site, like the position: { w, h } of the frame
  const store = (s: Storage, k: string, v: string | null) => { try { if (v == null) s.removeItem(k); else s.setItem(k, v); } catch { /* storage blocked */ } };
  const load = (s: Storage, k: string) => { try { return s.getItem(k); } catch { return null; } };

  let mounted: { root: ShadowRoot; btn: HTMLButtonElement; frame: HTMLDivElement; title: string } | null = null;
  let pos: Pos | null = null;
  let full = false;
  let size: Size = readSize(load(localStorage, SIZE_KEY));
  let detached = false; // the panel is in its own window
  const ask = <R>(msg: ExtMessage) => chrome.runtime.sendMessage<ExtMessage, R>(msg);

  function mount() {
    if (mounted) return mounted;
    const host = document.createElement('odoo-debug-root'); // markup-ok: the shadow host, a custom element of its own
    host.style.setProperty('--size', `${SIZE}px`); // launcher.css sizes with the values place() computes with
    host.style.setProperty('--gap', `${GAP}px`);
    const root = host.attachShadow({ mode: 'closed' }); // Odoo's CSS can't reach in, ours can't leak out
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    const { root: launcher, refs } = tpl('launcher', {
      button: HTMLButtonElement, icon: HTMLImageElement, frame: HTMLDivElement, gripX: HTMLDivElement, gripY: HTMLDivElement, gripXY: HTMLDivElement,
    });
    const { button: btn, frame } = refs;
    refs.icon.src = chrome.runtime.getURL('icons/icon-48.png');
    root.append(launcher);
    document.documentElement.append(host);
    mounted = { root, btn, frame, title: btn.title };
    applySize();
    for (const [grip, el] of [['x', refs.gripX], ['y', refs.gripY], ['xy', refs.gripXY]] as const) resizeWith(el, grip);
    refs.gripXY.addEventListener('dblclick', () => { size = DEFAULT_SIZE; applySize(); place(); store(localStorage, SIZE_KEY, null); });

    pos = readPos();
    place();
    addEventListener('resize', place);
    addEventListener('click', altClick, true); // capture: before Odoo opens the record / focuses the input

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !pos) return;
      const at = btn.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, px: at.left, py: at.top };
      let moved = false;
      btn.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return; // a click wobbles a little
        moved = true;
        pos = { x: start.px + dx, y: start.py + dy, bottom: false };
        place();
      };
      const up = (ev: PointerEvent) => {
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        if (moved && pos) {
          if (!pos.bottom && pos.y >= innerHeight - SIZE - GAP - SNAP) pos = { x: pos.x, bottom: true }; // back on the bottom edge
          place();
          store(localStorage, POS_KEY, JSON.stringify(pos));
        } else if (ev.type === 'pointerup') toggle();
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    });
    btn.addEventListener('click', (e) => { if (e.detail === 0) toggle(); }); // keyboard (Enter / Space)

    if (load(sessionStorage, FULL_KEY)) setFull(true);
    if (load(sessionStorage, OPEN_KEY)) toggle(true);
    // the panel may be in its own window since before this page load
    void ask<boolean>({ type: 'odoo-detached-state' }).then((on) => { if (on) setDetached(true); }, () => {});
    return mounted;
  }

  /** The frame's size, from what the user dragged it to (CSS keeps it inside the window). */
  function applySize() {
    mounted?.frame.style.setProperty('--panel-w', `${size.w}px`);
    mounted?.frame.style.setProperty('--panel-h', `${size.h}px`);
  }

  /** Dragging `el` resizes the frame from its free edges (geometry.ts → resized); the size is saved on release. */
  function resizeWith(el: HTMLElement, grip: Grip) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !mounted) return;
      e.preventDefault();
      const { frame } = mounted;
      const start = { x: e.clientX, y: e.clientY, size: { w: frame.offsetWidth, h: frame.offsetHeight } };
      const side = frame.dataset.side as Side;
      const anchor = frame.dataset.anchor as Anchor;
      el.setPointerCapture(e.pointerId);
      frame.classList.add('resizing'); // the iframe would swallow the pointer otherwise
      const move = (ev: PointerEvent) => {
        size = resized(start.size, ev.clientX - start.x, ev.clientY - start.y, grip, side, anchor, maxSize({ w: innerWidth, h: innerHeight }, GAP));
        applySize();
        place();
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        frame.classList.remove('resizing');
        store(localStorage, SIZE_KEY, JSON.stringify(size));
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  function readPos(): Pos | null {
    try {
      const p = JSON.parse(load(localStorage, POS_KEY) || 'null') as { x?: unknown; y?: unknown; bottom?: unknown } | null;
      if (!p || typeof p.x !== 'number') return null;
      if (p.bottom !== false || typeof p.y !== 'number') return { x: p.x, bottom: true }; // also: saved before the bottom edge
      return { x: p.x, y: p.y, bottom: false };
    } catch { return null; } // bad value
  }

  /** Keeps the button on screen (on the bottom edge unless dragged away) and the panel beside it, on the side with more room. */
  function place() {
    if (!mounted || !innerWidth) return; // no layout yet (e.g. a tab opened in the background): the resize listener comes back
    const { btn, frame } = mounted;
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
    const p: Pos = pos && Number.isFinite(pos.x) ? pos : { x: innerWidth - SIZE - 16, bottom: true }; // default: bottom right
    p.x = clamp(p.x, GAP, innerWidth - SIZE - GAP);
    pos = p;
    if (p.bottom) Object.assign(btn.style, { left: `${p.x}px`, top: '', bottom: `${GAP}px` }); // follows the edge on resize
    else Object.assign(btn.style, { left: `${p.x}px`, top: `${clamp(p.y, GAP, innerHeight - SIZE - GAP)}px`, bottom: '' });
    btn.hidden = false;
    if (frame.hidden) return;
    btn.hidden = full; // full screen: the button would cover the panel's corner (its − and Esc bring the button back)
    if (full) {
      Object.assign(frame.style, { left: `${GAP}px`, top: `${GAP}px`, bottom: '' });
      return;
    }
    // follows the button (also while dragging it): beside it, its top edge on the button's top in the upper half of the
    // window, its bottom edge on the button's bottom below; the size as rendered (CSS keeps it inside the window)
    const at = placeFrame({ x: p.x, y: btn.getBoundingClientRect().top, size: SIZE }, { w: frame.offsetWidth, h: frame.offsetHeight },
      { w: innerWidth, h: innerHeight }, GAP);
    Object.assign(frame.style, { left: `${at.left}px`, top: `${at.top}px`, bottom: '' });
    frame.dataset.side = at.side; // the grips go on the free edges (launcher.css)
    frame.dataset.anchor = at.anchor;
  }

  /** Technical name of the field under `t`: form widget (or its label), list cell or list column header. */
  function fieldName(t: Element): string | null {
    const label = t.closest<HTMLLabelElement>('label[for]');
    const input = label && document.getElementById(label.htmlFor);
    // a readonly field renders no input carrying the label's id, Odoo's `${name}_${n}`
    if (label && !input && label.matches('.o_form_label')) return label.htmlFor.replace(/_\d+$/, '');
    const n = (input || t).closest<HTMLElement>('.o_field_widget[name], td.o_data_cell[name], th[data-name]');
    return n ? n.getAttribute('name') || n.dataset.name || null : null;
  }

  /** Label of the field on the chatter tracking line under `t` ("Draft → Sent (Status)": Status), or null. */
  function trackingLabel(t: Element): string | null {
    const s = t.closest('.o-mail-Message-tracking')?.querySelector('.o-mail-Message-trackingField')?.textContent?.trim();
    return s ? s.replace(/^\((.*)\)$/, '$1') : null;
  }

  /** Technical names of the current model's fields labelled `label` (the chatter shows only the label), asked to the
   * rpc-recorder (MAIN world: Odoo's field service); [] when it doesn't answer (a tab open before an update). */
  function namesOf(label: string): Promise<string[]> {
    return new Promise((resolve) => {
      const done = (e: CustomEvent<string>) => { clearTimeout(timer); resolve(JSON.parse(e.detail) as string[]); };
      const timer = setTimeout(() => { document.removeEventListener('odoo-debug-field-names', done); resolve([]); }, 3000);
      document.addEventListener('odoo-debug-field-names', done, { once: true });
      document.dispatchEvent(new CustomEvent('odoo-debug-field-of', { detail: label }));
    });
  }

  async function altClick(e: MouseEvent) {
    if (!e.altKey || e.button !== 0 || !(e.target instanceof Element)) return;
    const name = fieldName(e.target);
    const label = name ? null : trackingLabel(e.target);
    if (!name && !label) return;
    e.preventDefault(); // ⌥+click on a link would download it
    e.stopImmediatePropagation();
    const at = { x: e.clientX, y: e.clientY };
    const names = name ? [name] : await namesOf(label!);
    if (!names.length) return toast(`✗ ${label}`, at);
    // ponytail: two fields with the same label: the first is copied, the toast names both
    toast(`${(await copy(names[0]!)) ? '✓' : '✗'} ${names.join(' · ')}`, at);
  }

  async function copy(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* not a secure context (http://), or refused */ }
    const prev = document.activeElement;
    const ta = Object.assign(document.createElement('textarea'), { value: text }); // markup-ok: off-screen copy helper, not UI
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (prev instanceof HTMLElement) prev.focus();
    return ok;
  }

  function toast(text: string, at: { x: number; y: number }) {
    if (!mounted) return;
    const { root: t } = tpl('toast');
    t.textContent = text;
    Object.assign(t.style, { left: `${Math.min(at.x + 12, innerWidth - 240)}px`, top: `${at.y + 12}px` });
    mounted.root.append(t);
    setTimeout(() => t.remove(), 1200);
  }

  function toggle(open?: boolean) {
    const { btn, frame } = mount();
    if (detached) { // the panel is in its own window: bring it to the front (gone meanwhile: back in the page)
      if (open === false) return;
      void ask<boolean>({ type: 'odoo-focus-panel' }).then((focused) => {
        if (focused) return;
        setDetached(false);
        toggle(true);
      }, () => { setDetached(false); toggle(true); });
      return;
    }
    const show = open ?? frame.hidden;
    // The panel is only created on first open: nothing runs (no RPC) until then. (The frame holds its grips already.)
    if (show && !frame.querySelector('iframe')) {
      const { iframe } = tpl('panel-frame', { iframe: HTMLIFrameElement }).refs;
      iframe.src = chrome.runtime.getURL('panel/index.html');
      frame.append(iframe);
    }
    frame.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    store(sessionStorage, OPEN_KEY, show ? '1' : null);
    place();
  }

  /** The panel left for its own window (on), or came back (off): the frame empties (its panel would keep running and
   * logging next to the window's), the button marks it and then brings the window to the front. */
  function setDetached(on: boolean) {
    detached = on;
    if (!mounted) return;
    const { btn, frame } = mounted;
    if (on) {
      frame.hidden = true;
      frame.querySelector('iframe')?.remove();
      store(sessionStorage, OPEN_KEY, null);
    }
    btn.classList.toggle('detached', on);
    btn.title = on ? btn.dataset.titleDetached || mounted.title : mounted.title;
    btn.setAttribute('aria-expanded', 'false');
    place();
  }

  /** Full screen: the panel covers the page, the button hides until it is minimized. */
  function setFull(on: boolean) {
    full = on;
    mounted?.frame.classList.toggle('full', on);
    store(sessionStorage, FULL_KEY, on ? '1' : null);
    place();
  }

  /** Debug mode kept on for this Odoo (toolbar popup): a page opened without ?debug= reloads with it. An explicit
   * ?debug= (also empty or 0: turned off on purpose) is left alone. */
  async function autoDebug(debug: string) {
    const u = new URL(location.href);
    if (debug || u.searchParams.has('debug')) return;
    const { autoDebug: on = {} } = (await chrome.storage.local.get('autoDebug').catch(() => ({}))) as { autoDebug?: Record<string, string> };
    const mode = on[location.origin];
    if (!mode) return;
    u.searchParams.set('debug', mode);
    location.replace(u);
  }

  // Injected again by entrypoints/background after an update: the copy before it is orphaned (its chrome.* calls fail, the panel
  // hangs on Connecting… and neither − nor the button work), so it makes way. The page is loaded already: no ready event
  // will come, the DOM tells it is Odoo (webclient, or a frontend page), as for the toolbar icon.
  for (const old of document.querySelectorAll('odoo-debug-root')) old.remove();
  if (document.readyState !== 'loading' && document.querySelector('body.o_web_client, #wrapwrap')) mount();
  document.addEventListener('odoo-debug-ready', (e) => { void autoDebug(e.detail); mount(); });
  chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
    if (!isExtMessage(msg)) return;
    if (msg.type === 'odoo-full') { // from the panel: { on } sets it, no `on` just asks; the answer is the current state
      if (mounted && typeof msg.on === 'boolean') setFull(msg.on);
      reply(full);
    } else if (msg.type === 'odoo-toggle') { // { open }: from the panel's minimize button; none: the toolbar popup / shortcut
      toggle(msg.open);
      if (msg.open === false) mounted?.btn.focus(); // keyboard users land on the button that reopens it
    } else if (msg.type === 'odoo-detached') { // from the background: the panel left for its window, or came back
      mount();
      setDetached(msg.on);
    }
  });
})();
