// Security tab: the pieces its views share. Markup: security.tpl.html. Every table is a matrix(): one symbol language
// everywhere: ✓ allowed / matches, ✗ refused / no match, · does not apply, ? unknown; +✓ what a tried group adds.
import { N_, translateDom, _t } from '../../i18n/i18n.ts';
import type { OdooAdapter } from '../../odoo/adapter.ts';
import { MODES, type Mode } from '../../odoo/models.ts';
import { errBox, pill, type PillKind } from '../../ui/components.ts';
import { domainView, pyCode } from '../../ui/domain-view.ts';
import { templates } from '../../ui/template.ts';
import { symbol } from '../../ui/matrix.ts';
import { tip } from '../../ui/tooltip.ts';
import { keyGroups, searchUsers } from './security.data.ts';
import { shortError, type Finding, type Level } from './security.logic.ts';
import html from './security.tpl.html';

export const tpl = templates(html, translateDom);

const MODE_LABEL: Record<Mode, string> = { read: N_('Read'), write: N_('Write'), create: N_('Create'), unlink: N_('Delete') };
export const modeLabel = (m: Mode) => _t(MODE_LABEL[m]);
export const modeHeads = () => MODES.map(modeLabel);

const LEVEL: Record<Level, string> = { high: N_('HIGH'), med: N_('MEDIUM'), low: N_('LOW'), info: N_('INFO') };

export function findings(list: readonly Finding[]): HTMLElement {
  if (!list.length) return tpl('okline').root;
  const { list: ul } = tpl('findings', { list: HTMLUListElement }).refs;
  for (const f of list) {
    const r = tpl('finding', { item: HTMLLIElement, pill: HTMLSpanElement, text: HTMLSpanElement }).refs;
    r.item.classList.add(f.level);
    r.pill.replaceWith(pill(_t(LEVEL[f.level]), f.level as PillKind));
    r.text.textContent = f.msg;
    ul.append(r.item);
  }
  return ul;
}

export function button(text: string, onClick: () => void, kind: 'btn' | 'chip' = 'btn', title = ''): HTMLButtonElement {
  const { button: b } = tpl(kind === 'btn' ? 'button' : 'chip', { button: HTMLButtonElement }).refs;
  b.textContent = text;
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

export function box(...nodes: (Node | string | null | undefined | false)[]): HTMLDivElement {
  const { box: b } = tpl('box', { box: HTMLDivElement }).refs;
  b.append(...nodes.filter((n): n is Node | string => !!n));
  return b;
}

export const title = (text: string) => { const { title: t } = tpl('sub-title', { title: HTMLHeadingElement }).refs; t.textContent = text; return t; };

export function plainList(items: readonly string[]): HTMLUListElement {
  const { list } = tpl('plain-list', { list: HTMLUListElement }).refs;
  for (const text of items) { const { item } = tpl('plain-item', { item: HTMLLIElement }).refs; item.textContent = text; list.append(item); }
  return list;
}

/** Shows an error in `out` (a refused write: Access Rights needed). */
export const errBoxTo = (out: HTMLElement, e: unknown) => out.replaceChildren(errBox(e));

const MARK_TIP = {
  has: N_('Has this group: set on the user'),
  implied: N_('Has this group through another one (implied)'),
  no: N_('Doesn\'t have this group'),
  tried: N_('Being tried: simulated, nothing written'),
} as const;

/** A membership mark: ● has it, ◐ through another group, ○ hasn't, + being tried; its meaning on hover (`text`:
 * a more precise one). */
export function mark(kind: 'has' | 'implied' | 'no' | 'tried', text = ''): HTMLSpanElement {
  const { mark: m } = tpl('mark', { mark: HTMLSpanElement }).refs;
  m.textContent = { has: '●', implied: '◐', no: '○', tried: '+' }[kind];
  m.classList.add(kind);
  return tip(m, text || _t(MARK_TIP[kind]));
}

/** A rule opened: its domain as written, as evaluated for the user, why it couldn't be checked. */
export function domainDetail(domain: string, ev: { domain: unknown } | { error: string } | undefined, why?: string): Node {
  const d = tpl('rule-detail', { box: HTMLDivElement, domain: HTMLElement, evRow: HTMLDivElement, evaluated: HTMLElement, note: HTMLDivElement }).refs;
  d.domain.replaceWith(pyCode(domain));
  if (ev && 'domain' in ev) d.evaluated.replaceWith(domainView(ev.domain));
  else d.evRow.remove();
  const text = why ? _t(why) : ev && 'error' in ev ? _t('cannot evaluate: %s', shortError(_t(ev.error))) : '';
  if (text) d.note.textContent = text;
  else d.note.remove();
  return d.box;
}

/** Key / value lines, each value as its type reads best: a boolean as ✓ / ✗, a number or identifier in code font. */
export function facts(entries: [string, unknown][]): HTMLElement {
  const { list } = tpl('facts', { list: HTMLDListElement }).refs;
  for (const [k, v] of entries) {
    const f = tpl('fact', { label: HTMLElement, value: HTMLElement }).refs;
    f.label.textContent = k;
    if (typeof v === 'boolean') f.value.append(symbol(v));
    else if (v instanceof Node) f.value.append(v);
    else { f.value.textContent = v == null || v === '' ? '—' : String(v); f.value.classList.add('mono'); }
    list.append(f.label.parentElement!);
  }
  return list;
}

// ---------- users ----------

/**
 * A user search box: typing searches res.users on the server (name or login, 20 matches, archived too when ticked);
 * ↑ ↓ Enter or a click picks one. 250 ms between searches; an older answer never replaces a newer one.
 */
/** `archived`: archived users too (the bar's box, shared by its searches). */
export function userSearch(a: OdooAdapter, archived: { value: boolean }, placeholder: string, onPick: (uid: number) => void): HTMLElement {
  const r = tpl('user-search', { root: HTMLSpanElement, input: HTMLInputElement, list: HTMLUListElement }).refs;
  r.input.placeholder = placeholder;
  r.input.setAttribute('aria-label', placeholder);
  let shown: { id: number }[] = [];
  let sel = 0;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const markSel = () => [...r.list.children].forEach((li, i) => {
    li.setAttribute('aria-selected', String(i === sel));
    if (i === sel) li.scrollIntoView({ block: 'nearest' });
  });
  const search = async () => {
    const q = r.input.value.trim();
    const n = ++seq;
    if (!q) { shown = []; r.list.hidden = true; return; }
    const [users, keys] = await Promise.all([searchUsers(q, archived.value, a).catch(() => []), keyGroups()]);
    if (n !== seq) return;
    const publicId = keys.get('base.group_public');
    shown = users;
    sel = 0;
    r.list.replaceChildren(...users.map((u) => {
      const it = tpl('suggest-item', { item: HTMLLIElement, name: HTMLSpanElement, meta: HTMLSpanElement }).refs;
      it.name.textContent = u.name;
      const groups = (u[a.users.allGroupsField] as number[] | undefined) ?? [];
      it.meta.textContent = [u.login, u.share && (publicId != null && groups.includes(publicId) ? _t('public') : _t('portal')), !u.active && _t('archived')].filter(Boolean).join(' · ');
      it.item.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(u.id); }); // before the blur hides the list
      return it.item;
    }));
    r.list.hidden = !users.length;
    markSel();
  };
  r.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
  r.input.addEventListener('focus', () => { if (shown.length) r.list.hidden = false; });
  r.input.addEventListener('blur', () => { r.list.hidden = true; });
  r.input.addEventListener('keydown', (e) => {
    if (r.list.hidden || !shown.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; markSel(); }
    else if (e.key === 'Enter') { const hit = shown[sel]; if (hit) onPick(hit.id); }
    else if (e.key === 'Escape') { e.stopPropagation(); r.list.hidden = true; } // not the panel's Esc (leave full screen)
  });
  return r.root;
}

/** Logs in as `login` in an incognito window (its own cookies: your session here stays), on Odoo's login page with
 * their login filled in, back to `url` after; the password (2FA too) is typed there. Through /web/session/logout: an
 * incognito window still logged in as someone else would skip the login page. */
export function loginAs(name: string, login: string, db: string, url: string, out: HTMLElement): HTMLButtonElement {
  const { origin, pathname, search, hash } = new URL(url);
  const target = `/web/login?${new URLSearchParams({ db, login, redirect: pathname + search + hash })}`;
  const b = button(name, () => {
    chrome.windows.create({ incognito: true, url: `${origin}/web/session/logout?redirect=${encodeURIComponent(target)}` })
      .catch((e: unknown) => out.replaceChildren(errBox(e)));
  }, 'btn', _t('Log in as %s in an incognito window', name));
  b.className = 'user-name';
  return b;
}
