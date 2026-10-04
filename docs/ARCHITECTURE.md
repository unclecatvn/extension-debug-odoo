# Odoo Debug — architecture

How the extension is built, for whoever works on it. Using it: [README](../README.md).

## Status

| Part | State |
|---|---|
| Toolchain: TS 7 (one project per execution context), esbuild, Node tests, CI checks | ✅ |
| Odoo version layer (`src/odoo/`): detection, adapters 18.0 / 19.0 / 20.0, self-check | ✅ |
| Entrypoints: service worker, RPC recorder + relay, launcher button, panel shell, popup | ✅ |
| Tab RPC: log, filter, Edit & Resend, New Request, Copy as cURL (18: `/jsonrpc` execute_kw · 19: `/json/2`, named arguments) | ✅ unit tests; Chrome against a simulated 18 / 19 |
| Tab Record: identity, every field (definition, value, recomputes), filter + quick filters, copy a value / the record as JSON, ↗ many2one, selection labels | ✅ unit tests; Chrome against a simulated 18 / 19, admin and user |
| Tab View, told as a story: ① overview (view, file, modules, menu, action, record, fields) ② how the view is built (views in the order Odoo applies them, what each does, own arch; form / search) ③ one field (now, its story through the views, its groups) ④ action & context ⑤ combined arch | ✅ unit tests; Chrome against a simulated 18 / 19 webclient, admin and user |
| Tab Security, as permission tables: a bar (the user searched on the server, archived too; their companies; a user to compare; groups being tried) then five views: Record (ACL, global / group / parent rules × read · write · create · delete, the result, the server's answer; the groups that would allow a refusal and what else they open; an AccessError from the RPC tab or pasted) · By model (the user's rights on every model, folded under the module creating it — its oldest xmlid, not the first of `ir.model.modules`, sorted by name — each module summed up in words; a model opens a sentence, the ACLs granting it group by group, the rules limiting it; what tried groups add; differences with the compared user) · This model (ACLs, rules, restricted fields, configuration check) · Groups (a list by application — each user's relation, ACL models, rules, users — and the group opened beside it: inheritance, its ACLs, its rules with their domains evaluated for the user, its users, what adding it would open; try, add, remove; copy the compared user's groups, previewed) · System | ✅ unit tests; Chrome against a simulated 18 / 19, admin and user |
| Tab Translations, as tables: Find a text (typed or picked on the page → code term and its module .po, field label, selection, menu, action, record value, view term; its English source; where to change it) · Record (translated fields × languages, by term for html; edit) · View (the screen's views' terms × languages; edit) · Modules (.po coverage per language, the missing terms; export .pot / .po to Downloads; import a .po) · Languages (active, yours, users; activate, update, use one) | ✅ unit tests; Chrome against a simulated 18 / 19 |
| Tab Apps: Odoo's search bar (filters as facets) over every module; pick several → Activate (Update Apps List, install with dependencies), Upgrade, Open Forms; ⚠ manifest on disk newer than the database; a module opened beside the list: description (`description_html` in a sandboxed frame), manifest, depends / used by (what installing it brings: `button_install` replayed, auto_install included, checked identical to Odoo's on 16 apps × 18 / 19), a dependency diagram (SVG, layered, needs / install brings / used by, the chain to a module highlighted), its xmlids by kind, models created / extended, uninstall previewed by `base.module.uninstall` (confirm, then type its name) · Pending: apply or cancel the operations left waiting (18 runs them along with the next one, 19 refuses one) | ✅ unit tests; every server call against a throwaway 18 / 19 database; the panel driven in headless Chrome (CDP) |
| Tab Menus: the technical screens of OCA's `developer_menu` (Models, Fields, Record Rules, Views, Menus, Model Data, Crons, Actions Window / Server, Reports, Parameters, Sequences, Mail Templates; the ones whose action exists), for Access Rights managers; a click opens the action in the page (`doAction`, breadcrumbs cleared), ↗ in a new tab | ✅ unit tests; driven in headless Chrome against a throwaway 18 database |
| Tab Perf, Odoo's own profiler (`ir.profile`): start / stop for the session (Odoo's wizard when the database doesn't allow it yet), the collectors (SQL; Python stacks; QWeb); the requests of a session (the panel's own left out: its calls carry `odoo_debug_panel=1`, which a JSON route ignores); a request opened: totals (queries, SQL, total, Python ≈, CPU on 19), the lines of code sending queries, N+1 suspects, the slowest, against a baseline (before / after a fix), flame graph (19: side by side); a call of the RPC tab profiled on its own ("⏱ Profile"); clean up (this session, yours, all) | ✅ unit tests; driven in headless Chrome against throwaway 18 / 19 databases |
| Tab Code, an ORM console in two languages, as the logged-in user, on the screen's record / records / model (as a server action): JavaScript in the page (an ORM-like env over call_kw; read-only, dry run — writing calls listed, not sent — or writes) and Python on the server (a temporary `ir.actions.server`, `safe_eval`; a dry run rolled back for real, an error rolls everything back; Settings rights); results shown by type (recordsets, rows typed by `fields_get`, dates in the user's time zone…; CSV / Markdown / JSON); snippets built-in and saved per Odoo; colours, completion, smart typing | ✅ unit tests; driven in headless Chrome against throwaway 18 / 19 databases |
| Odoo 20.0: every tab's server calls, routes and webclient internals checked against the 20.0 sources; ir.access read as ACLs + rules (`odoo/access.ts`), no bin_size, get_str, formatted_read_group, the uninstall wizard's applications | ✅ unit tests; not yet run against a live 20 database |
| E2E against Odoo 18.0 / 19.0 (Docker) | ⏳ |

## Develop

```sh
npm install
npm run watch        # dist/ rebuilt on save; chrome://extensions → Load unpacked → dist/ (⟳ after a change)
npm run check        # typecheck + tests + build + injected / markup / imports checks (what CI runs)
npm run i18n         # .pot / .po after adding a translatable string
```

Disable the JavaScript version of Odoo Debug while this one is loaded: both would add their button to Odoo pages.

## Layout

```
src/
  entrypoints/                 what the manifest loads, one folder each (index.*); nothing else lives here
    background/                  service worker: toolbar icon, shortcuts, content scripts injected again after an update
    rpc-recorder/                MAIN world, document_start: records the page's JSON-RPC calls
    rpc-relay/                   ISOLATED world: forwards what the MAIN world reports to the panel
    launcher/                    ISOLATED world: the Odoo Debug button and the panel frame (+ launcher.tpl.html, launcher.css)
    panel/                       the panel shell: header, tab bar (index.html, index.ts, panel.tpl.html)
    popup/                       toolbar popup and options page (index.html, index.ts, popup.tpl.html)
  features/                    the panel's tabs
    registry.ts                  the tab list and the TabModule contract
    <tab>/                       <tab>.tab.ts · <tab>.tpl.html · <tab>.logic.ts · <tab>.injected.ts
  odoo/                        everything about Odoo: version.ts, adapter.ts, adapters/v18.ts · v19.ts, detect.ts,
                               models.ts (records), rpc.ts (JSON-RPC client), reads.ts (shared server reads)
  injected/                    functions run IN the Odoo page, shared by several features: page-state, json-rpc,
                               debug-mode, navigation
  extension/                   talking to Chrome: run-in-tab, page-cache, settings, cookies
  ui/                          the panel's UI kit: template.ts, components.ts + components.tpl.html, panel.css,
                               form-state.ts, dom.ts
  i18n/                        _t(), .po loading
  contracts/                   what every context shares: json.ts, messages.ts (pure)
  types/                       ambient declarations only: odoo-page.d.ts (window.odoo), page-events.d.ts, assets.d.ts
tests/
  unit/                        unit tests, the same tree as src/: tests/unit/odoo/version.test.ts ↔ src/odoo/version.ts
  e2e/                         against a real Odoo 18 / 19 (Docker), with the first ported tab
static/                        manifest.json, icons, i18n/*.po: copied to dist/ as they are
assets/                        sources of static files (icon.svg → static/icons/*.png)
scripts/                       build, check-page-fns, check-markup, check-imports, i18n (run by Node as .ts)
```

Dependencies point one way: `entrypoints → features → ui · odoo · extension · injected · i18n → contracts`. A tab never
imports another tab; only `features/registry.ts` imports the tabs (`npm run check:imports`).

## Execution contexts

An MV3 extension runs in several contexts, each with its own APIs. Each is a TypeScript project
(`tsconfig.<context>.json`, built together by `tsc -b`), so a file is checked against what **its** context provides:

| Context | Files | May use | The compiler rejects |
|---|---|---|---|
| `page` | `entrypoints/rpc-recorder`, `injected/`, `*.injected.ts` | DOM, `window.odoo` | `chrome.*` (absent in the MAIN world) |
| `worker` | `entrypoints/background` | `chrome.*` | the DOM (a worker has none) |
| `content` | `entrypoints/launcher`, `entrypoints/rpc-relay` | DOM, `chrome.runtime` / `storage` | `window.odoo` (invisible from the ISOLATED world) |
| `app` | `entrypoints/panel`, `entrypoints/popup`, `features/`, `ui/`, `odoo/`, `extension/`, `i18n/` | DOM, every `chrome.*` | `window.odoo` (only through injected functions) |
| `contracts` · `dom` | `contracts/` · `ui/template.ts` | nothing · the DOM | anything else |
| `node` | `scripts/`, `tests/` | Node | — |

## Tests

`src/` holds only code that ships. Tests live in `tests/`: `tests/unit/` mirrors the `src/` tree (the test of
`src/<path>/<name>.ts` is `tests/unit/<path>/<name>.test.ts`), `tests/e2e/` drives the built extension against a real
Odoo. Unit tests cover pure code (`*.logic.ts`, `odoo/`, `contracts/`…); what needs Chrome or Odoo is the e2e's job.

## File names

The suffix says what a file is and where it runs:

| Suffix | Is | Context |
|---|---|---|
| `index.ts` | an entrypoint (only under `entrypoints/`) | its own |
| `*.tab.ts` | a tab: renders it, wires its events (`TabModule`) | app |
| `*.logic.ts` | pure functions of a feature, unit-tested | app |
| `*.injected.ts` | functions run in the Odoo page | page |
| `*.tpl.html` | `<template>` markup the code next to it clones | — |

No barrel `index.ts` re-exporting a folder: import the file you need. Named exports only, except the text of
`*.tpl.html` / imported `.css` files (a default export by the bundler, declared in `types/assets.d.ts`).

## Odoo versions

Supported: **18.0**, **19.0** and **20.0**. `src/odoo/` holds every difference between them:

- `version.ts` reads `server_version_info` and picks the adapter: the version's own, else the closest older one
  (saas~19.x → 19, a newer major → 20, flagged *untested* in the header), else the oldest (*unsupported*).
- `adapter.ts` is the contract; `adapters/v18.ts`, `adapters/v19.ts` and `adapters/v20.ts` implement it, each value
  checked against that version's sources.
- `detect.ts` → `odoo()` detects once per page load, then **self-checks** the fields the adapter relies on with
  `fields_get`: a customized database that differs from its major shows in the header instead of failing in a tab.

Features never test a version number or probe a field themselves: they read `odoo().adapter`. A difference with no
equivalent at all on a version is declared by the tab (`supports()` in `features/registry.ts`) and shown instead of
the tab. Adding a version = a new `adapters/v<major>.ts` + its number in `SUPPORTED`; the compiler lists what it must
answer.

## Rules

- **Markup in templates, behaviour in code.** Every piece of UI is a `<template data-tpl="name">` in a `*.tpl.html`
  next to the code that uses it; the elements the code fills carry `data-ref="key"`. Code clones it with
  `ui/template.ts` and fills the refs, whose element types it declares (`tpl('pill', { pill: HTMLSpanElement })`) and
  which are checked on the first clone. Labels are translated with `data-i18n` in the template. `npm run check:markup`
  fails on `innerHTML` / `createElement` in a `.ts` (except non-UI helpers marked `markup-ok:`).
- **Injected functions** reach the Odoo page as their own source text only: nothing from outside them but browser
  globals and types. `npm run check:page` bundles them as the build does and fails otherwise.
- Odoo data reaches the DOM through `textContent` only. One exception: a module's description (Apps), Odoo's own
  sanitized `description_html`, shown in a sandboxed `<iframe srcdoc>` with no `allow-scripts` (nothing in it runs).
- `entrypoints/rpc-recorder` runs on every site: no imports but types (the build fails above 4 KB).
- Erasable TypeScript only (no `enum`, `namespace`, parameter properties): Node runs tests and scripts as they are.
