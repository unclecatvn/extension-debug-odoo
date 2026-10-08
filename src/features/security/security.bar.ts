// Security tab, the bar above every view: the user the tab is about (searched on the server, yourself by default),
// the companies their switcher has on (record rules read them), the user compared with, the groups being tried
// (simulated until applied), and what the last write changed.
import { _t } from '../../i18n/i18n.ts';
import { MODES } from '../../odoo/models.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { pill } from '../../ui/components.ts';
import { groupGraph, writeGroups, type Simulated } from './security.data.ts';
import { afterWrite, stopTrying, type SecurityCtx } from './security.state.ts';
import { box, button, errBoxTo, loginAs, modeLabel, tpl, userSearch } from './security.ui.ts';

export function securityBar(parent: HTMLElement, c: SecurityCtx) {
  const { s } = c;
  const r = tpl('bar', { bar: HTMLDivElement, facts: HTMLDListElement }).refs;
  const fact = (label: string) => {
    const f = tpl('fact', { label: HTMLElement, value: HTMLElement }).refs;
    f.label.textContent = label;
    r.facts.append(f.label.parentElement!);
    return f.value;
  };
  const archived = { value: s.archived, set: (v: boolean) => { s.archived = v; } };
  const out = box();

  // the user
  const user = fact(_t('User'));
  const pick = (uid: number) => {
    s.uid = uid;
    if (s.compare === uid) s.compare = null; // not compared with themselves
    s.tried.clear(); s.baseline = null; s.companies = null; s.before = null;
    c.rerender();
  };
  user.append(userSearch(c.a, archived, _t('Search a user by name or login…'), pick));
  const comps = fact(_t('Companies')); // under the user: their switcher; removed when they have one company
  void c.sim.then(async (sim) => {
    const w = await who(sim, c, out);
    if (!sim.isMe) w.append(button(_t('My User'), () => { s.uid = null; if (s.compare === sim.user.id) s.compare = null; s.tried.clear(); s.baseline = null; s.companies = null; c.rerender(); }, 'chip'));
    user.prepend(w);
    if (sim.user.company_ids.length > 1) companies(comps, sim, c);
    else comps.parentElement!.remove();
  }, () => {});

  // the user compared
  const cmp = fact(_t('Compare with'));
  if (c.other) {
    void c.other.then(async (o) => {
      const w = await who(o, c, out);
      w.append(button('×', () => { s.compare = null; c.rerender(); }, 'chip', _t('Stop comparing')));
      cmp.append(w);
    }, () => {});
  } else {
    cmp.append(userSearch(c.a, archived, _t('Another user, to compare…'), (uid) => {
      void c.sim.then((sim) => { if (uid !== sim.user.id) { s.compare = uid; c.rerender(); } });
    }));
  }
  // archived users too, in both searches: one box under them
  const arch = tpl('archived', { label: HTMLLabelElement, box: HTMLInputElement }).refs;
  arch.box.checked = archived.value;
  arch.box.addEventListener('change', () => archived.set(arch.box.checked));
  arch.label.title = _t('Include archived users in both searches');
  fact('').append(arch.label);

  parent.append(r.bar);
  void c.sim.then(async (sim) => {
    if (sim.tried.size) r.bar.append(await tryBar(sim, c, out));
    const applied = appliedLine(c, sim);
    if (applied) r.bar.append(applied);
    r.bar.append(out);
  }, () => {});
}

/** Name (a click logs in as them, incognito: someone else, active), login, id, groups, what they are. */
async function who(sim: Simulated, c: SecurityCtx, out: HTMLElement) {
  const r = tpl('who', { root: HTMLSpanElement, name: HTMLSpanElement, meta: HTMLSpanElement }).refs;
  const u = sim.user;
  if (!sim.isMe && u.active) r.name.replaceWith(loginAs(u.name, u.login, (await sessionInfo()).db, c.page.url, out));
  else { r.name.textContent = u.name; r.name.classList.add('strong'); }
  r.meta.textContent = _t('%s · #%s · %s groups', u.login, u.id, sim.groupIds.size);
  r.meta.title = r.meta.textContent; // one line under the name, cut when long (panel.css)
  r.root.append(...[
    sim.isMe && pill(_t('me'), 'accent'),
    sim.superuser && pill(_t('superuser'), 'err'),
    u.share && pill(sim.has('base.group_public') ? _t('public') : _t('portal')),
    !u.active && pill(_t('archived'), 'med'),
  ].filter((x): x is HTMLSpanElement => !!x));
  return r.root;
}

/** The companies on, as in the user's switcher: toggled here, ★ the current one (the first on). */
function companies(value: HTMLElement, sim: Simulated, c: SecurityCtx) {
  const on = new Set(sim.companies);
  for (const id of sim.user.company_ids) {
    const b = button(`${id === sim.companies[0] ? '★ ' : ''}${sim.companyNames.get(id) ?? `#${id}`}`, () => {
      const next = on.has(id) ? sim.companies.filter((x) => x !== id) : [...sim.companies, id];
      if (!next.length) return;
      c.s.companies = next;
      c.rerender();
    }, 'chip', id === sim.companies[0] ? _t('The current company (the first one on)') : '');
    b.setAttribute('aria-pressed', String(on.has(id)));
    value.append(b);
  }
  const note = sim.pageCompanies ? _t('as in the page\'s switcher') : !sim.isMe && !c.s.companies ? _t('their default company (their switcher isn\'t visible here)') : '';
  if (note) { const n = box(note); n.className = 'muted'; value.append(n); }
}

async function tryBar(sim: Simulated, c: SecurityCtx, out: HTMLElement) {
  const graph = await groupGraph(c.a);
  const r = tpl('trybar', { text: HTMLSpanElement, apply: HTMLButtonElement, discard: HTMLButtonElement }).refs;
  const names = [...sim.tried].map((g) => graph.name(g)).join(', ');
  r.text.textContent = _t('Trying %s in every view: simulated, nothing is written.', names);
  r.apply.addEventListener('click', () => {
    if (confirm(_t('Add %s to %s?', names, sim.user.name))) {
      afterWrite(c, sim.user.id, () => writeGroups(sim.user.id, [...sim.tried].map((g) => [4, g]), c.a)).catch((e: unknown) => errBoxTo(out, e));
    }
  });
  r.discard.addEventListener('click', () => stopTrying(c));
  return r.text.parentElement!;
}

/** After a write: what it changed on the record, said once. */
function appliedLine(c: SecurityCtx, sim: Simulated) {
  const before = c.s.before;
  if (!before || before.uid !== sim.user.id || !c.subject || before.model !== c.subject.model || before.resId !== c.subject.resId) return null;
  c.s.before = null;
  const r = tpl('applied', { text: HTMLSpanElement, close: HTMLButtonElement }).refs;
  r.text.textContent = _t('Applied…');
  void c.assessment?.then((x) => {
    const now = x.verdicts.length ? x.verdicts.map((v) => v.ok) : x.server ?? [];
    const sym = (v: boolean | null | undefined) => (v === true ? '✓' : v === false ? '✗' : '?');
    const changes = MODES.flatMap((m, i) => (before.verdicts[i] !== now[i] ? [`${modeLabel(m)} ${sym(before.verdicts[i])} → ${sym(now[i])}`] : []));
    r.text.textContent = changes.length ? _t('Applied on %s: %s', `${before.model}${before.resId ? ` #${before.resId}` : ''}`, changes.join(' · '))
      : _t('Applied: access to this record didn\'t change.');
  });
  r.close.addEventListener('click', () => r.text.parentElement!.remove());
  return r.text.parentElement!;
}
