// Security tab, in three parts: the user (searched and picked at the top, yourself by default: groups to add / remove, risks),
// the current model for that user (why allowed / blocked, ACLs, hidden fields, audit), and this Odoo (session, system
// parameters, instance check).
// odoo.conf itself is never exposed over HTTP by Odoo: it holds admin_passwd and db_password.
import { rulesFor, modeVerdict, unblockers, ruleEvalContext, auditModel, checkInstance, userRisks } from './logic.js';
import { pageEvalDomains, pageProbe } from './page.js';
import { MODES, pickGroupField } from '../../shared/odoo.js';
import { pageGo } from '../../shared/page.js';
import { exec, call, cached, uncache, sessionInfo, fieldsOf, readAcls, readRules, cookieFlags } from '../../shared/bridge.js';
import { el, pre, pill, triPill, details, empty, errBox, kv, block, card, expandable, filteredList, copyable, odooLink, listHead, splitRow } from '../../shared/ui.js';
import { _t, N_ } from '../../shared/i18n.js';

const KEY_GROUPS = ['group_system', 'group_erp_manager', 'group_no_one', 'group_portal', 'group_public'];
const LABEL = { high: N_('HIGH'), med: N_('MEDIUM'), low: N_('LOW'), info: N_('INFO') };
const LETTER = { read: 'R', write: 'W', create: 'C', unlink: 'D' };
// ponytail: key-name heuristic, the value still shows when the row is expanded
const SECRET = /secret|passw|token|api_?key|private_?key/i;
const targets = new Map(); // origin → simulated uid (none = the logged-in user); the panel moves between instances
const trials = new Map(); // origin → Set of group ids being tried on that user: simulated only, written on Apply

const findings = (list) => list.length
  ? el('ul', { class: 'findings' }, list.map((f) => el('li', { class: f.level }, pill(_t(LABEL[f.level]), f.level), el('span', {}, f.msg))))
  : el('div', { class: 'okline' }, _t('✓ No issue found.'));

/** Every group, with closure(id) → Set of the group + all it implies. */
const groupGraph = () => cached('group graph', async () => {
  const gfields = await fieldsOf('res.groups');
  const impf = ['all_implied_ids', 'trans_implied_ids'].find((f) => f in gfields); // 19 / 18
  const all = await call('res.groups', 'search_read', [[]], { fields: ['full_name', impf], order: 'full_name' });
  const byId = new Map(all.map((g) => [g.id, g]));
  return { all, impf, byId, closure: (id) => new Set([id, ...(byId.get(id)?.[impf] || [])]) }; // 19 counts the group itself
});

/** The simulated user: profile, groups (implied included, tried groups too), the ones really held (`realIds`),
 * the writable group field `wf`, base group xmlids. */
async function loadTarget(origin) {
  const [info, ufields] = await Promise.all([sessionInfo(), fieldsOf('res.users')]);
  const uid = targets.get(origin) ?? info.uid;
  const gf = pickGroupField(ufields);
  const wf = ['group_ids', 'groups_id'].find((f) => f in ufields); // 19: all_group_ids is computed, group_ids holds the direct ones
  const opt = ['totp_enabled', 'api_key_ids', 'employee_id', 'employee_ids'].filter((f) => f in ufields);
  const [[u], users, xml] = await Promise.all([
    call('res.users', 'read', [[uid], ['name', 'login', 'active', 'share', 'partner_id', 'company_id', 'company_ids', gf, wf !== gf && wf, ...opt].filter(Boolean)],
      { context: { active_test: false } }),
    cached('users', () => call('res.users', 'search_read', [[]], { fields: ['name', 'login', 'share'], order: 'share, name', limit: 1000 })), // ponytail: first 1000 active users
    cached('key groups', () => call('ir.model.data', 'search_read',
      [[['module', '=', 'base'], ['model', '=', 'res.groups'], ['name', 'in', KEY_GROUPS]]], { fields: ['name', 'res_id'] })),
  ]);
  const [p] = await call('res.partner', 'read', [[u.partner_id[0]], ['commercial_partner_id']]).catch(() => [{}]);
  u.commercial_partner_id = p.commercial_partner_id?.[0] || u.partner_id[0];
  const realIds = new Set(u[gf] || []);
  const tried = trials.get(origin) || new Set();
  const groupIds = new Set(realIds);
  if (tried.size) {
    const { closure } = await groupGraph();
    for (const g of tried) for (const h of closure(g)) groupIds.add(h);
  }
  const groupXml = new Map(xml.map((x) => [x.res_id, `base.${x.name}`]));
  const has = (name) => xml.some((x) => x.name === name && groupIds.has(x.res_id));
  return { me: info.uid, uid, u, wf, users, realIds, tried, groupIds, groupXml, has };
}

/** Search box over the users (name / login): typing lists the matches under it, a click or Enter picks one. */
function userSearch(users, pick) {
  let shown = [], sel = 0;
  const list = el('ul', { class: 'suggest', role: 'listbox', hidden: true });
  const mark = () => [...list.children].forEach((li, i) => {
    li.setAttribute('aria-selected', i === sel);
    if (i === sel) li.scrollIntoView({ block: 'nearest' });
  });
  const input = el('input', {
    type: 'search', placeholder: _t('Search a user by name or login…'), 'aria-label': _t('Search a user by name or login…'),
    oninput: () => {
      const q = input.value.trim().toLowerCase();
      shown = users.filter((x) => `${x.name} ${x.login}`.toLowerCase().includes(q)).slice(0, 50); // ponytail: first 50 matches, type more to narrow
      sel = 0;
      list.replaceChildren(...shown.map((x) => el('li', { role: 'option', onmousedown: (e) => { e.preventDefault(); pick(x.id); } }, // mousedown: before the blur hides the list
        el('span', { class: 'name' }, x.name), el('span', { class: 'muted' }, `${x.login}${x.share ? ' · portal' : ''}`))));
      list.hidden = !shown.length;
      mark();
    },
    onfocus: () => input.dispatchEvent(new Event('input')),
    onblur: () => { list.hidden = true; },
    onkeydown: (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); }
      else if (e.key === 'Enter' && shown[sel]) pick(shown[sel].id);
      else if (e.key === 'Escape') { e.stopPropagation(); list.hidden = true; } // not the panel's Esc (leave full screen)
    },
  });
  return el('div', { class: 'user-search' }, input, list);
}

/** Logs in as the picked user in an incognito window (its own cookies: your session here stays), on Odoo's login page
 * with their login filled in, back to the current page after. The password is typed there, in Odoo's form, 2FA too.
 * Through /web/session/logout: an incognito window still logged in as someone else would skip the login page. */
function loginAs(u, db, url, out) {
  const { origin, pathname, search, hash } = new URL(url);
  const login = `/web/login?${new URLSearchParams({ db, login: u.login, redirect: pathname + search + hash })}`;
  const go = () => chrome.windows.create({ incognito: true, url: `${origin}/web/session/logout?redirect=${encodeURIComponent(login)}` })
    .catch((e) => out.replaceChildren(errBox(e)));
  return el('button', { class: 'user-name', title: _t('Log in as %s in an incognito window', u.name), onclick: go }, el('b', {}, u.name));
}

const section = (s, title) => s.append(el('h2', { class: 'section' }, title));

export function renderSecurity(s, state) {
  const { model, resId, origin } = state;
  const t = loadTarget(origin);
  const rerender = () => { s.replaceChildren(); renderSecurity(s, state); };
  const pick = (uid) => { targets.set(origin, uid); trials.delete(origin); rerender(); };
  const tryGroup = (id, on = true) => { // on = false: stop trying it
    const tried = trials.get(origin) || new Set();
    if (on) tried.add(id); else tried.delete(id);
    trials.set(origin, tried);
    rerender();
  };

  // ---------- the user every card below is about ----------
  section(s, _t('User'));
  card(s, async () => {
    const { u, uid, me, users, groupIds } = await t;
    const out = el('div', {}); // the incognito window's error, if any
    return el('div', {},
      el('div', { class: 'picker' }, userSearch(users, pick),
        uid !== me ? el('button', { class: 'chip', onclick: () => { targets.delete(origin); trials.delete(origin); rerender(); } }, _t('My User')) : null),
      el('div', { class: 'user-line' }, uid !== me && u.active ? loginAs(u, (await sessionInfo()).db, state.url, out) : el('b', {}, u.name), uid === me ? pill(_t('me'), 'accent') : null, u.share ? pill('portal') : null,
        el('span', { class: 'muted' }, _t('%s · #%s · %s (%s companies) · %s groups', u.login, u.id, u.company_id?.[1] || '', u.company_ids.length, groupIds.size))),
      el('div', { class: 'note' }, _t('Simulates the selected user\'s rights without logging in as them (reading other users\' groups needs admin rights).'),
        uid !== me && u.active ? ` ${_t('Click their name to log in as them in an incognito window: your session here stays.')}` : ''),
      out);
  });
  block(s, 'groups', _t('Groups'), () => groupsBlock(t, origin, tryGroup, rerender));
  block(s, 'user-risks', _t('User Risks'), async () => {
    const { u, has } = await t;
    return findings(userRisks(u, has));
  });

  if (model) {
    section(s, `${model}${resId ? ` #${resId}` : ''}`);
    const modelSec = Promise.all([readAcls(model), readRules(model), fieldsOf(model)]);

    block(s, 'why', _t('Why Allowed / Blocked'), () => whyBlock(model, resId, t, modelSec, tryGroup));

    block(s, 'acl', _t('ACL'), async () => {
      const [{ groupIds }, [rows]] = await Promise.all([t, modelSec]);
      if (!rows.length) return empty(_t('No ACL.'));
      return el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, _t('ACL / group')), MODES.map((m) => el('th', { class: 'c' }, LETTER[m])))),
        el('tbody', {}, rows.map((a) => el('tr', { class: !a.group_id || groupIds.has(a.group_id[0]) ? 'mine' : '' },
          el('td', {}, a.name, el('div', { class: 'muted' }, a.group_id ? a.group_id[1] : _t('(all users)'))),
          MODES.map((m) => el('td', { class: 'c' }, a[`perm_${m}`] ? '✓' : ''))))));
    }, _t('ir.model.access: the rows in green apply to the user.'));

    block(s, 'hidden-fields', _t('Hidden Fields'), async () => {
      const [{ uid, tried }, [, , fields]] = await Promise.all([t, modelSec]);
      const restricted = Object.entries(fields).filter(([, f]) => f.groups);
      if (!restricted.length) return empty(_t('No field is restricted to groups.'));
      // ponytail: has_groups is the server's answer on the real groups; tried groups are not counted here
      const specs = [...new Set(restricted.map(([, f]) => f.groups))];
      const ok = new Map(await Promise.all(specs.map(async (sp) => [sp, await call('res.users', 'has_groups', [[uid], sp]).catch(() => null)])));
      restricted.sort(([, a], [, b]) => Number(ok.get(a.groups)) - Number(ok.get(b.groups)));
      return el('div', {}, tried.size ? el('p', { class: 'note' }, _t('Real groups only: the tried groups are not counted here.')) : null,
        listHead(_t('Field · label · for this user'), _t('Allowed groups')), el('ul', { class: 'list' }, restricted.map(([name, f]) => expandable(el('li', {},
        el('div', { class: 'row' }, copyable(name), el('span', { class: 'grow muted' }, f.string),
          triPill(ok.get(f.groups), [_t('visible'), _t('hidden'), '?'])),
        el('div', { class: 'meta' }, f.groups))))));
    }, _t('Fields restricted to groups, and whether the selected user can see each one.'));

    block(s, 'model-audit', _t('Model Audit'), async () => {
      const [{ groupXml }, [acls, rules, fields]] = await Promise.all([t, modelSec]);
      return findings(auditModel({ fields, acls, rules, groupXml }));
    }, _t('The model\'s security setup: ACLs without a group or granted to portal / public users, no multi-company rule, sensitive-looking fields open to every user.'));
  }

  // ---------- this Odoo: the logged-in session, whoever is picked above ----------
  section(s, _t('Instance'));
  block(s, 'session', _t('Session'), async () => {
    const i = await sessionInfo();
    return el('div', {},
      kv({
        user: `${i.name} (#${i.uid})`, login: i.username, db: i.db, version: i.server_version, admin: i.is_admin, system: i.is_system,
        'web.base.url': i['web.base.url'] || '—', test_mode: !!i.test_mode, // test_mode = odoo.conf test_enable
      }),
      details('user_context', pre(i.user_context)), details(_t('Companies'), pre(i.user_companies)),
      i.is_system ? el('div', { class: 'mt' }, el('button', {
        class: 'btn', title: _t('Odoo\'s built-in /web/become route, base.group_system only'),
        onclick: () => confirm(_t('Switch the current session to superuser (bypasses every rule)?')) && exec(pageGo, '/web/become'),
      }, _t('Become Superuser'))) : null);
  });

  // base.group_system only: say so instead of showing an AccessError.
  block(s, 'params', _t('System Parameters'), async () => {
    if (!(await sessionInfo()).is_system) return empty(_t('Needs Settings rights (base.group_system).'));
    const rows = await call('ir.config_parameter', 'search_read', [[]], { fields: ['key', 'value'], order: 'key' }); // not cached: edited while debugging
    const items = rows.map((p) => {
      const secret = SECRET.test(p.key);
      const li = el('li', {},
        splitRow(copyable(p.key), odooLink(origin, `ir.config_parameter/${p.id}`)),
        el('div', { class: 'meta mono' }, p.value ? copyable(p.value, '', secret ? '••••••' : p.value) : '')); // copies the real value, even masked
      li.dataset.q = `${p.key} ${secret ? '' : p.value}`.toLowerCase();
      return expandable(li, () => pre(p.value));
    });
    return items.length ? filteredList(items, _t('Filter key / value'), N_('%s parameters'), N_('%s/%s parameters'), listHead(_t('Key'), _t('Value'))) : empty(_t('No parameter.'));
  }, _t('ir.config_parameter: secret-looking values are masked, a click on one still copies it.'));

  block(s, 'instance', _t('Instance Check'), async () => {
    const [probe, cookie] = await cached('probe', async () => {
      const r = await Promise.all([exec(pageProbe), cookieFlags(state.url)]);
      if (!r[0] || r[0].error) throw new Error(r[0]?.error || _t('Check failed'));
      return r;
    });
    return el('div', {}, findings(checkInstance(probe, cookie)),
      el('div', { class: 'pad-bottom' },
        details(_t('Raw Data'), pre({ ...probe, cookie })),
        el('button', { class: 'chip mt', onclick: () => { uncache('probe'); rerender(); } }, _t('Check Again'))));
  });
}

/** The user's groups, implied included, the groups being tried, then (while filtering) the groups they don't have:
 * try one (every card below is then simulated with it, nothing written until Apply), or remove a group nothing else
 * implies (removing an implied one is undone by Odoo). Writing needs Access Rights (base.group_erp_manager). */
async function groupsBlock(t, origin, tryGroup, rerender) {
  const { uid, u, wf, realIds, tried, groupIds } = await t;
  const { all, impf, byId } = await groupGraph();
  const impliedBy = new Map(); // group id → names of the user's other real groups implying it
  for (const g of all) {
    if (!realIds.has(g.id)) continue;
    for (const h of g[impf]) if (h !== g.id) impliedBy.set(h, [...(impliedBy.get(h) || []), g.full_name]); // 19 counts the group itself
  }
  const box = el('div', {});
  const write = (cmds) => call('res.users', 'write', [[uid], { [wf]: cmds }]).then(() => { trials.delete(origin); rerender(); }, (e) => box.append(errBox(e)));
  const names = (ids) => [...ids].map((id) => byId.get(id)?.full_name || id).join(', ');
  const row = (g) => {
    const held = realIds.has(g.id), trying = !held && groupIds.has(g.id);
    const by = impliedBy.get(g.id);
    const action = held ? (by ? pill(_t('implied')) : el('button', { class: 'chip', onclick: () => confirm(_t('Remove %s from %s?', g.full_name, u.name)) && write([[3, g.id]]) }, _t('Remove')))
      : !trying ? el('button', { class: 'chip', title: _t('Simulate this group below, nothing is written'), onclick: () => tryGroup(g.id) }, _t('Try'))
      : tried.has(g.id) ? el('button', { class: 'chip', title: _t('Stop trying it'), onclick: () => tryGroup(g.id, false) }, '×')
      : pill(_t('implied'));
    if (by) action.title = _t('Implied by %s', by.join(', '));
    const li = el('li', { class: held ? '' : trying ? 'trying' : 'addable' }, splitRow(el('span', {}, g.full_name, trying ? pill(_t('trying'), 'accent') : null), action));
    li.dataset.q = g.full_name.toLowerCase();
    return { li, shown: held || trying };
  };
  // held first, then tried, then the rest
  const rank = (g) => (realIds.has(g.id) ? 0 : groupIds.has(g.id) ? 1 : 2);
  const rows = [...all].sort((a, b) => rank(a) - rank(b)).map(row);
  const shown = rows.filter((r) => r.shown).length;
  const count = el('span', { class: 'muted' }, _t('%s groups', shown));
  const input = el('input', {
    type: 'search', placeholder: _t('Filter or try a group…'), 'aria-label': _t('Filter or try a group…'),
    oninput: () => {
      const q = input.value.trim().toLowerCase();
      for (const r of rows) r.li.hidden = !r.li.dataset.q.includes(q) || (!r.shown && !q); // groups to try: only while searching
      count.textContent = q ? _t('%s/%s groups', rows.filter((r) => r.shown && !r.li.hidden).length, shown) : _t('%s groups', shown);
    },
  });
  for (const r of rows) r.li.hidden = !r.shown;
  const bar = tried.size ? el('div', { class: 'trybar' },
    el('span', { class: 'grow' }, _t('Trying %s: every card below is simulated with it.', names(tried))),
    el('button', { class: 'chip', onclick: () => confirm(_t('Add %s to %s?', names(tried), u.name)) && write([...tried].map((id) => [4, id])) }, _t('Apply')),
    el('button', { class: 'chip', onclick: () => { trials.delete(origin); rerender(); } }, _t('Discard'))) : null;
  box.append(bar || '', el('div', { class: 'toolbar' }, input, count), el('ul', { class: 'list groups' }, rows.map((r) => r.li)));
  return box;
}

async function whyBlock(model, resId, t, modelSec, tryGroup) {
  const [{ u, uid, me, tried, groupIds }, [acls, rules]] = await Promise.all([t, modelSec]);
  // your own user, real groups: the server's exact answer too (has_access runs as the logged-in user only)
  const server = uid === me && !tried.size ? Promise.all(MODES.map((op) => call(model, 'has_access', [resId ? [resId] : [], op]).catch(() => null))) : null;
  const modesOf = (r) => MODES.filter((m) => rulesFor([r], groupIds, m).length);
  // every rule, not only the applicable ones: the groups that would unblock a mode need them all
  const evals = await exec(pageEvalDomains, rules.map((r) => r.domain_force), ruleEvalContext(u));
  const evaluated = new Map(); // ruleId → domain, evaluated for the simulated user
  const passed = new Map(); // ruleId → the record matches it
  const note = new Map(); // ruleId → why it could not be checked
  // filtered_domain is @api.private (not callable over RPC), so test each domain with search_count.
  // ponytail: runs under the viewer's own rules; if the viewer can't see the record, nothing can be checked.
  const count = (dom) => call(model, 'search_count', [[['id', '=', resId], ...dom]], { context: { active_test: false } });
  const visible = resId ? await count([]).catch(() => 0) : 0;
  await Promise.all(rules.map(async (r, i) => {
    const ev = (Array.isArray(evals) && evals[i]) || { error: evals?.error || N_('no result') };
    if (ev.error) return note.set(r.id, _t('cannot evaluate: %s', _t(ev.error)));
    evaluated.set(r.id, ev.domain);
    if (!resId) return;
    if (!visible) return note.set(r.id, _t('You cannot read this record yourself, so its rules cannot be checked.'));
    try { passed.set(r.id, (await count(ev.domain)) > 0); } catch (e) { note.set(r.id, e.message); }
  }));

  const gids = [...new Set(rules.flatMap((r) => r.groups))];
  const gname = new Map((gids.length ? await call('res.groups', 'read', [gids, ['full_name']]) : []).map((g) => [g.id, g.full_name]));

  const exact = await server;
  const verdicts = MODES.map((mode) => modeVerdict({ u, groupIds, acls, rules, mode, resId, passed }));
  const graph = verdicts.some((v) => v.ok === false) ? await groupGraph() : null;
  // a blocked mode: the groups that would allow it, fewest new groups first, one click to try
  const fixes = (mode) => {
    const found = unblockers({ u, groupIds, acls, rules, mode, resId, passed, closure: graph.closure }).slice(0, 3); // ponytail: the 3 cheapest
    const name = (id) => graph.byId.get(id)?.full_name || `#${id}`;
    return el('div', { class: 'fix' }, found.length ? [_t('Try:'), ...found.map((f) => el('button', {
      class: 'chip', title: f.adds.length > 1 ? _t('Also adds %s', f.adds.filter((g) => g !== f.id).map(name).join(', ')) : '', onclick: () => tryGroup(f.id),
    }, f.adds.length > 1 ? `${name(f.id)} +${f.adds.length - 1}` : name(f.id)))] : _t('No single group allows it.'));
  };
  const verdict = el('div', { class: 'verdict' }, MODES.map((mode, i) => {
    const { ok, why } = verdicts[i];
    const srv = exact && triPill(exact[i], [_t('server ✓'), _t('server ✗'), _t('server ?')]);
    if (srv) srv.title = _t('has_access, run by the server as you');
    return el('div', { class: ok === true ? 'allow' : ok === false ? 'deny' : '' },
      el('div', { class: 'row' }, el('b', {}, mode), el('span', { class: 'grow' }), srv,
        triPill(ok, [_t('ALLOWED'), _t('BLOCKED'), _t('UNKNOWN')], 'med')),
      el('div', { class: 'why' }, why), ok === false ? fixes(mode) : null);
  }));

  const ruleItems = rules.map((r) => {
    const modes = modesOf(r).map((m) => LETTER[m]).join('');
    return expandable(el('li', { class: modes ? '' : 'inactive' },
      el('div', { class: 'row' }, el('span', { class: 'grow' }, el('b', {}, r.name)),
        modes ? pill(modes, 'accent') : pill(_t('not applicable')),
        modes && resId ? triPill(note.has(r.id) ? null : passed.get(r.id), undefined, 'med') : null),
      el('div', { class: 'meta' }, r.global ? 'global' : r.groups.map((g) => gname.get(g) || g).join(', ')),
      el('div', { class: 'meta mono' }, r.domain_force || '[]'),
      evaluated.has(r.id) ? el('div', { class: 'mono' }, `→ ${JSON.stringify(evaluated.get(r.id))}`) : null,
      note.has(r.id) ? el('div', { class: 'error' }, note.get(r.id)) : null));
  });

  return el('div', {}, verdict,
    rules.length ? el('div', {}, listHead(_t('Rule · operations · result'), _t('Groups · domain')), el('ul', { class: 'list' }, ruleItems))
      : empty(_t('This model has no record rule.')),
    el('p', { class: 'note pad-bottom' },
      _t('Assumes the user selected every allowed company. Rules of parent models through _inherits are not counted. This is a simulation; for your own user, “server” is the exact answer (has_access).')));
}
