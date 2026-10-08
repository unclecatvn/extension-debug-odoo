// Security tab, view "System": the logged-in session (whoever is simulated above), Become Superuser, the system
// parameters (secrets masked), and a check of what the instance exposes on the web: HTTPS, the session cookie's flags,
// security headers, the database manager (read from its markup: the same in every language), list_db, the version.
// odoo.conf itself is never served over HTTP: it holds admin_passwd and db_password.
import { cookieFlags } from '../../extension/cookies.ts';
import { cached, uncache } from '../../extension/page-cache.ts';
import { exec, execOrThrow } from '../../extension/run-in-tab.ts';
import { _t } from '../../i18n/i18n.ts';
import { pageGo } from '../../injected/navigation.ts';
import { sessionInfo } from '../../odoo/reads.ts';
import { call } from '../../odoo/rpc.ts';
import { fill, filterBox } from '../../ui/cards.ts';
import { copyable, details, empty, odooLink, pre } from '../../ui/components.ts';
import { jsonView } from '../../ui/json-view.ts';
import { frag, note } from '../../ui/parts.ts';
import { pageCompanies, pageProbe } from './security.injected.ts';
import { checkInstance, companyTree, managerState, type UserCompanies } from './security.logic.ts';
import type { SecurityCtx } from './security.state.ts';
import { filterMatrix, matrix, type MxRow } from '../../ui/matrix.ts';
import { box, button, facts, findings, title, tpl } from './security.ui.ts';

const SECRET = /secret|passw|token|api_?key|private_?key/i; // a key-name heuristic: the value still shows when the row opens

export function systemView(body: HTMLElement, c: SecurityCtx) {
  body.append(
    section(_t('Session'), session),
    section(_t('System parameters (ir.config_parameter)'), () => params(c.page.origin)),
    section(_t('Instance check'), (again) => instanceCheck(c, again)),
  );
}

/** A titled section, built at once; `again` builds it anew. */
function section(name: string, build: (again: () => void) => Promise<Node>): Node {
  const content = box();
  content.classList.add('sys-section'); // one rhythm inside (panel.css)
  const run = () => fill(content, () => build(run));
  run();
  return frag(title(name), content);
}

async function session(): Promise<Node> {
  const i = await sessionInfo();
  return frag(
    facts([
      [_t('User'), `${i.name} (#${i.uid})`], ['login', i.username], ['db', i.db], ['version', i.server_version],
      ['is_admin', i.is_admin], ['is_system', i.is_system],
      ['web.base.url', i['web.base.url']], ['test_mode', !!i.test_mode], // test_mode = odoo.conf test_enable
    ]),
    title('user_context'), jsonView(i.user_context, 1),
    await companies(i.user_companies),
    i.is_system && button(_t('Become Superuser'), () => {
      if (confirm(_t('Switch the current session to superuser (bypasses every rule)?'))) void exec(pageGo, '/web/become');
    }, 'btn', _t('Odoo\'s built-in /web/become route, base.group_system only')),
  );
}

/** The user's companies (get_session_info → user_companies) as a tree: default ★, on in the page's switcher, and the
 * parents shown only because a child is allowed. */
async function companies(uc: unknown): Promise<Node> {
  const data = uc as UserCompanies | undefined;
  if (!data?.allowed_companies) return frag(title(_t('Companies')), uc == null ? note(_t('Not in the session info.')) : jsonView(uc, 1));
  const on = new Set(await exec(pageCompanies).then((r) => (Array.isArray(r) ? r : []), () => []));
  const rows = companyTree(data).map(({ company: co, depth, allowed }): MxRow => ({
    label: [`${depth ? `${'\u00a0\u00a0\u00a0'.repeat(depth - 1)}└ ` : ''}${co.name}`],
    sub: allowed ? undefined : _t('parent only: the user is not in it'),
    kind: allowed ? undefined : 'off',
    cells: [String(co.id), co.id === data.current_company ? { v: true, title: _t('The user\'s default company') } : { v: 'na', title: _t('Not the default company') },
      allowed && on.has(co.id) ? { v: true, title: _t('On in the page\'s company switcher') } : { v: 'na', title: allowed ? _t('Off in the page\'s company switcher') : _t('The user is not in this company') }],
  }));
  const legend = note(_t('Default: the company the user starts in. On: enabled in the page\'s switcher, read by record rules.'));
  legend.classList.add('legend');
  return frag(title(_t('Companies')), matrix(_t('Company'), ['ID', _t('Default'), _t('On')], [{ rows }]), legend);
}

/** base.group_system only: said instead of an AccessError. Not cached: edited while debugging. */
async function params(origin: string): Promise<Node> {
  if (!(await sessionInfo()).is_system) return empty(_t('Needs Settings rights (base.group_system).'));
  const rows = await call<{ id: number; key: string; value: string }[]>('ir.config_parameter', 'search_read', [[]], { fields: ['key', 'value'], order: 'key' });
  if (!rows.length) return empty(_t('No parameter.'));
  const table = matrix(_t('Key'), [''], [{
    rows: rows.map((pr): MxRow => {
      const secret = SECRET.test(pr.key);
      return {
        label: [copyable(pr.key)],
        sub: secret ? '••••••' : pr.value || '—', // the full value (a secret too) when the row opens
        q: `${pr.key} ${secret ? '' : pr.value}`,
        cells: [odooLink(origin, `ir.config_parameter/${pr.id}`)],
        detail: () => box(copyable(pr.value, 'mono', _t('Copy the value')), pre(pr.value)),
      };
    }),
  }]);
  const { bar } = tpl('toolbar', { bar: HTMLDivElement }).refs;
  const { text: count } = tpl('count', { text: HTMLSpanElement }).refs;
  const f = filterBox([], _t('Filter key / value'));
  const apply = () => { count.textContent = _t('%s of %s parameters', filterMatrix(table, f.input.value), rows.length); };
  f.input.addEventListener('input', apply);
  bar.append(f.input, count);
  apply();
  return frag(bar, table);
}

async function instanceCheck(c: SecurityCtx, again: () => void): Promise<Node> {
  const [probe, cookie] = await cached('security probe', () => Promise.all([execOrThrow(pageProbe, 'Check failed'), cookieFlags(c.page.url)]));
  const checked = { ...probe, manager: probe.manager && managerState(probe.manager.status, probe.manager.html) };
  return frag(findings(checkInstance(checked, cookie ?? null)),
    details(_t('Raw data'), pre({ ...checked, manager: probe.manager && { ...checked.manager, html: `${probe.manager.html.length} chars` }, cookie })),
    button(_t('Check Again'), () => { uncache('security probe'); again(); }, 'chip'));
}
