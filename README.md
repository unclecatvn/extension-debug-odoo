<div align="center">

<img src="extension/icons/icon-128.png" width="96" height="96" alt="Odoo Debug">

# Odoo Debug

**An in-page debug panel for Odoo developers.**<br>
Inspect records, views, RPC calls, access rights and server performance without leaving the page you are debugging.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/mfmamdbagelffoedimmjpolhalmngcjk?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)
[![Build](https://github.com/unclecatvn/extension-debug-odoo/actions/workflows/release.yml/badge.svg)](https://github.com/unclecatvn/extension-debug-odoo/actions/workflows/release.yml)
[![GitHub stars](https://img.shields.io/github/stars/unclecatvn/extension-debug-odoo?style=social)](https://github.com/unclecatvn/extension-debug-odoo)
![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![No build step](https://img.shields.io/badge/build%20step-none-success)

**English** · [Tiếng Việt](README.vi.md)

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)** · [Website](https://unclecatvn.github.io/extension-debug-odoo/) · [Features](#features) · [Usage](#usage) · [Privacy](#privacy--permissions) · [Development](#development) · [Changelog](CHANGELOG.md)

https://github.com/user-attachments/assets/a257c2f8-ee49-4b97-a7d9-72b04d7e5781

</div>

## Why

Odoo's built-in developer mode tells you *what* is on screen. Odoo Debug tells you *why*: which module added a field,
which inherited view changed the form, which RPC failed and with what traceback, which record rule blocks a user,
and which request fires 50 SQL queries. Everything lives in a draggable panel on the Odoo page itself, isolated in a
shadow DOM so it never touches Odoo's styles.

## Features

| Tab | What you get |
|---|---|
| **Record** | Identity (xmlids, `noupdate`, create / write user), every field with its type, value, module, storage, compute / related source, `groups=` and the fields it triggers a recompute of. |
| **View** | Inheritance tree of the current view (primary + extensions, priority, source file), combined arch, action details, form field modifiers (`invisible` / `readonly` / `required`) evaluated like the webclient, *Pick on page*. |
| **RPC** | Live log of JSON-RPC and JSON-2 calls from page load: timing, errors with tracebacks, and a jump to the Security tab for `AccessError`s. **Edit and send again** any call right in its detail (route and JSON body, the recorded answer below it until then) with the page's session, or start a **New Request**; **Copy as cURL** replays it outside the browser (a `call_kw` as the external API's `execute_kw`, with an API key). |
| **Code** | ORM Console: JavaScript with an ORM-like `env` (`env['sale.order'].search(…)`, `read`, `mapped`, `write`, any public method…) run **as the logged-in user**, so the server applies their ACLs, record rules and active companies. Fields read and written like in Python (`return rec.state`, `rec.state = 'sent'`). Suggests the models of the installed modules, their fields and the recordset methods while you type. Read-only by default; **Allow Writes** lets writes through, and **Auto Refresh** then reloads the view on screen. Results as a table, prints, errors with server traceback, every call made. |
| **Apps** | For a list of modules, typed or ticked in the list below an Odoo-like search bar (filters Installed / Not Installed, Apps / Extra, category, as facets; Installed when the panel opens): Activate (Update Apps List, then install with dependencies), Upgrade, Open Forms (Settings rights); ⟳ **Update Apps List** on its own, under the bar. |
| **Security** | Three parts. **User**: search any user by name or login (yourself by default) and every card follows, or log in as them in an incognito window (your session stays): their groups as a tree, each under the groups implying it (try / add / remove, needs Access Rights), risk audit. **Model**: rule by rule why each operation is allowed or blocked for that user (for yourself, with the server's exact `has_access` answer next to it), ACLs, fields hidden from the user (restricted to groups), configuration audit. **Instance**: session (db, version, `web.base.url`, `test_mode`; **Become Superuser** for Settings users), system parameters (secrets masked), checks (HTTPS, cookie flags, security headers, database manager). |
| **i18n** | **Languages** (Settings rights): activates languages and loads, or reloads, their terms for every installed app (Odoo's Add Languages wizard, Overwrite Existing Terms optional). Exports the `.pot` template and one `.po` per language for several apps (the input searches the installed modules as you type; tick them or type their names) and languages (toggles of the active ones) with Odoo's own wizard, saved straight to `Downloads/<module>/i18n/`. |
| **Menus** | The technical screens a developer opens all day, one click away without debug mode or the Technical menu: Models, Fields, Record Rules, Views, Menus, Model Data, Crons, Actions Window, Actions Server, Reports, Parameters, Sequences, Mail Templates (the list of OCA's `developer_menu`, with nothing to install; for Access Rights managers). A click opens the screen in the Odoo page, as its menu would; ↗ in a new tab. |
| **Perf** | Odoo's built-in server profiler, to find out why a screen is slow: requests slowest first, each with a diagnosis (N+1, database or Python) and what to do; the time by function of the modules (with its code line), the repeated queries and the slowest ones in words; speedscope flame graph. |

Plus: click any field name, model or xmlid in the panel to copy it, and <kbd>⌥ Alt</kbd> + click a field on the Odoo
page to copy its technical name.

### Screenshots

<table>
  <tr>
    <td width="50%"><b>View</b>: inheritance tree and combined arch<br><img src="website/screenshots/side-view.png" alt="View tab"></td>
    <td width="50%"><b>RPC</b>: every call with its timing, edited and sent again<br><img src="website/screenshots/side-rpc.png" alt="RPC tab"></td>
  </tr>
</table>

**Code**: the ORM from JavaScript, run as the logged-in user.
<img src="website/screenshots/side-code.png" alt="Code tab: an ORM search and its result table">

**Record** in full screen: the tabs move to a sidebar, blocks lose their frames, short ones sit side by side, and lists become 2-column tables with sticky headers.
<img src="website/screenshots/full-record.png" alt="Record tab in full screen">

**Security**: the picked user's groups (add / remove), and why an operation is allowed or blocked, rule by rule.
<img src="website/screenshots/full-security.png" alt="Security tab">

**Perf**: profiled requests slowest first; the selected one says what slows it down and where in the code. In full screen, as in RPC, the list stays on the left and the selected request opens on the right.
<img src="website/screenshots/full-perf.png" alt="Perf tab">

<table>
  <tr>
    <td width="50%"><b>Dark theme</b><br><img src="website/screenshots/side-security-dark.png" alt="Dark theme"></td>
  </tr>
</table>

## Installation

Install **[Odoo Debug from the Chrome Web Store](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)** and click **Add to Chrome**. It works in Chrome, Edge, Brave and other Chromium browsers (Edge asks to allow extensions from other stores first), and updates itself.

Then open any Odoo page: a round button appears on the bottom edge.

## Usage

- **Open / close**: click the round button; the panel opens beside it, on the tab you were on, scrolled where you left it. Drag the button anywhere and the panel follows it; its position is kept per Odoo instance (dropped back near the bottom edge, it sticks to it again). Nothing shows on non-Odoo sites, and the toolbar icon is greyed out there.
- **Minimize**: <kbd>−</kbd> in the panel header hides the panel back to the round button, which reopens it as it was.
- **Full screen**: <kbd>⤢</kbd> in the panel header, <kbd>Esc</kbd> or <kbd>⤡</kbd> to leave. The layout is an editor's: tabs in a sidebar, one header line, no card frames, short blocks side by side, the Code editor beside its result, RPC and Perf as a list with the selected row's detail on the right. The round button hides meanwhile (<kbd>−</kbd> brings it back). Open state and full screen survive page reloads.
- **Its own window**: <kbd>⧉</kbd> in the panel header (or *Open the Panel in Its Own Window* in the toolbar popup, or a shortcut you set in `chrome://extensions/shortcuts`) moves the panel into a separate window, to put beside the page or on another screen: you stay on the Odoo page, and the window follows it (navigation, reloads, RPCs, ⌖ Pick on Page). The page keeps only the round button, which brings the window to the front. <kbd>⧉</kbd> in the window puts the panel back into the page; closing the Odoo tab closes its window.
- **Panel size**: drag the panel's corner away from the button to any width and height (double-click it: back to the default), kept per Odoo. Wide enough, it takes the full-screen layout.
- **This page**: click the toolbar icon; it shows the page's host, Odoo version and database on one line, and its Off / Debug / Assets switch shows the page's debug mode and reloads Odoo in the one picked. **Keep it on for this Odoo** reopens every page of that instance in debug, unless its URL says otherwise (`?debug=0`).
- **Shortcuts**: <kbd>⌥ Alt</kbd>+<kbd>⇧ Shift</kbd>+<kbd>O</kbd> shows / hides the panel, <kbd>⌥ Alt</kbd>+<kbd>⇧ Shift</kbd>+<kbd>D</kbd> turns debug on / off. Change them in `chrome://extensions/shortcuts` (*Change* in the toolbar popup).
- **Cards**: each tab is a stack of cards, closed at first; a card loads its data once opened, and open / closed cards
  stay so across reloads. Click a list row to open its details (label, storage, module, full value…), again to close.
- **Copy**: click a field name, model, xmlid or parameter in the panel; <kbd>⌥ Alt</kbd> + click a form field, label,
  list cell or column header on the page, or a tracked change in the chatter (*Draft → Sent (Status)* copies `state`). Masked secret values still copy the real value.
- **Reload data**: <kbd>⟳</kbd>. Stable server data (session info, `fields_get`, users) is cached until the page
  reloads; ACLs, rules, views and record values are always re-read.
- **Settings**: click the toolbar icon (or right-click → *Options*): language (English, Tiếng Việt), color theme (Odoo system / light / dark, or an editor theme: GitHub Light / Dark, Solarized Light / Dark, Dracula, Monokai, One Dark Pro, Nord, Catppuccin Mocha).

### Compatibility

| | Supported |
|---|---|
| Odoo | 18.0, 19.0 |
| Browser | Chrome and Chromium-based browsers (Manifest V3) |
| Languages | English, Tiếng Việt |

One build serves every version: differences are detected at runtime (does the field / route exist?), never by
comparing version numbers. See [Odoo versions](#odoo-versions).

## Privacy & permissions

Odoo Debug talks only to the Odoo server of the tab you are on, with your own session. It has no backend, no
analytics and sends nothing anywhere else.

| Permission | Why |
|---|---|
| `host_permissions: <all_urls>` | Odoo runs on any domain; the panel only activates on pages detected as Odoo. |
| `scripting` | Read webclient state (current record, view, action) from the page. |
| `cookies` | Report the session cookie's flags (`Secure`, `HttpOnly`, `SameSite`) in the Security tab. The value is never read. |
| `storage` | Language and theme settings. |
| `clipboardWrite` | Copy field names, xmlids and values. |
| `downloads` | Save exported `.pot` / `.po` files to `Downloads/<module>/i18n/` (i18n tab). |
| `declarativeContent` | Enable the toolbar icon on Odoo pages only. |

Odoo data only reaches the DOM through `textContent`, and the panel page can't be framed by other sites.
`odoo.conf` is never reachable from a browser (Odoo doesn't expose it), and the extension doesn't try.

## Development

No build step, no runtime dependencies: edit, then reload the extension in `chrome://extensions`.

```bash
npm test
```

```bash
npm run i18n
```

`npm test` runs every `tests/*.test.mjs` with Node's built-in runner; `npm run i18n` extracts strings to
`extension/i18n/odoo_debug.pot` and merges them into every `.po`.

End-to-end tests load the extension in headless Chrome (Puppeteer, the only dev dependency) against a real Odoo started
with Docker; CI runs them on every pull request against Odoo 18 and 19:

```bash
npm ci
```

```bash
ODOO_VERSION=19 docker compose -f e2e/compose.yml up -d --wait
```

```bash
npm run e2e
```

`docker compose -f e2e/compose.yml down -v` drops the database; do it before switching `ODOO_VERSION`.

The screenshots in `website/screenshots/` (this README and the website) come from the same setup, with Sales and CRM demo data; retake them after a UI change:

```bash
ODOO_VERSION=18 ODOO_MODULES=sale_management,crm ODOO_ARGS= docker compose -f e2e/compose.yml up -d --wait
```

```bash
npm run screenshots
```

The intro film is recorded from the same setup: a real session with the extension, every frame Chrome paints, then edited in `tools/intro.html` (the window on a dark stage, a camera following the action, captions). It gives `website/intro.mp4`, its poster `website/intro-poster.jpg` and a 1440p master in `store/`; ffmpeg needed:

```bash
npm run intro
```

GitHub plays no video from the repository: the film at the top of this README is `website/intro.mp4` uploaded as a GitHub attachment (drag it into any comment box, copy the `user-attachments` link it gives, put it in place of the old one).

### Project structure

```
extension/                 the extension itself: exactly what the release zip contains (Load unpacked this folder)
  manifest.json
  icons/                   extension icons (make-icons.sh)
  i18n/                    odoo_debug.pot + en.po, vi.po (read at runtime, no build step)
  src/
    background.js          toolbar icon enabled on Odoo pages only (declarativeContent)
    popup/                 toolbar popup = options page: language, theme; the page's host, version, db, debug mode
    content/               hook.js (MAIN world, records JSON-RPC), bubble.js (draggable button + the panel's iframe
                           in a shadow root, forwards the recorded RPCs to it, ⌥/Alt+click copy)
    panel/                 panel.html / main.js: header, tabs, binding to the tab it is embedded in
    shared/                bridge.js (page functions, RPC, cached reads), ui.js + ui.css (DOM, widgets, styles of the panel and popup),
                           page.js (core page functions), list.js, picker.js, i18n.js, odoo.js, settings.js
    features/<tab>/        one folder per tab: record, view, rpc, code, security, translations, apps, menus, perf
      <tab>.js             the tab UI: render(section, state); big ones split into a file per part (code: suggest.js, help.js)
      page.js              functions injected into the Odoo page (self-contained, no imports)
      logic.js             pure logic, no chrome.* / DOM
website/                   project website; screenshots/ is shared with this README
tests/                     *.test.mjs, one per logic module
e2e/                       panel.e2e.mjs (Puppeteer) + compose.yml (Odoo 18 / 19 + PostgreSQL) + odoo.mjs (login, open the panel)
tools/i18n.mjs             npm run i18n: extract strings → .pot, merge into every .po
tools/screenshots.mjs      npm run screenshots: retake website/screenshots/*.png from a real Odoo
tools/intro.mjs            npm run intro: record a real session, edit it in tools/intro.html → website/intro.mp4
```

Paths below are relative to `extension/`.

### Conventions

- Every user-visible string goes through `_t('English text %s', value)` (or `N_('…')` where `_t` can't run, e.g. page
  functions); static HTML uses `data-i18n`. Run `npm run i18n` and translate the new entries in `i18n/vi.po`.
- Stable server data goes through `cached()` in `shared/bridge.js`; anything that can change while you debug is always re-read.

### Odoo versions

There is no per-version code. To support another version, check these spots and add a fallback next to the existing one:

| What differs | Where |
|---|---|
| `res.users` group field (`groups_id` → `group_ids` / `all_group_ids` in 19) | `shared/odoo.js` `pickGroupField` |
| JSON-2 API `/json/2/<model>/<method>` (19) | `content/hook.js`, `features/rpc/logic.js` |
| `ir.profile.cpu_duration` (19), profiling wizard | `features/perf/perf.js` |
| Webclient internals: `__WOWL_DEBUG__` action service, `currentState`, `odoo.loader` + `py_js`, form `archInfo` | `shared/page.js`, `features/view/page.js`, `features/security/page.js` |
| `/odoo/…` URLs (older versions: `/web#…`) | `shared/page.js` fallback |
| Server methods: `has_access`, `res.users.has_groups`, `get_metadata`, `get_views`, `/web/become` | `features/security`, `features/record`, `features/view` |
| User context with active companies (`@web/core/user` via `odoo.loader`; else `user_context` of the session, without `allowed_company_ids`) | `features/code/page.js` |

Keep pure fallbacks in `shared/odoo.js` (tested in `tests/odoo.test.mjs` at the repo root). Page functions can't import, so their
fallbacks stay inline. If one spot grows past a couple of branches, that is the time to add an adapter, not before.

### Releasing

Bump `version` in `extension/manifest.json`, add its section to [CHANGELOG.md](CHANGELOG.md) and push to `main`: CI tags
`v<version>` and publishes the zip with that section as release notes. Keep each CHANGELOG bullet on one line: GitHub release notes turn every newline into a line break.

The same run uploads the zip to the [Chrome Web Store](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk) and submits it for review (live once Google approves it; the version must be higher than the store's). The store listing itself (description, images) is still edited in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). This needs three repository secrets, set once:

1. In the [Google Cloud Console](https://console.cloud.google.com/), a project with the **Chrome Web Store API** enabled; its OAuth consent screen *External* and **In production** (in *Testing*, the token below expires after 7 days); an OAuth client ID of type **Desktop app**.
2. `npx chrome-webstore-upload-keys` with that client's ID and secret, signed in with the Google account that owns the item: it prints a refresh token.
3. Repository → Settings → Secrets and variables → Actions: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`. Without them the release skips the upload.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. `npm test` passes and `npm run i18n` leaves `extension/i18n/` unchanged (CI checks both).
2. New strings are translated in `extension/i18n/vi.po`.
3. Tested on at least one Odoo instance; say which version in the PR.

Found a bug? [Open an issue](https://github.com/unclecatvn/extension-debug-odoo/issues) with your Odoo version, the
page you were on and, if relevant, the RPC tab's error.

Opening a pull request means agreeing to the one-sentence [Contributor License Agreement](CONTRIBUTING.md#contributor-license-agreement): UncleCat may license your contribution on any terms.

## Support the project

If Odoo Debug saves you time, ⭐ [star it on GitHub](https://github.com/unclecatvn/extension-debug-odoo): it helps other Odoo developers find it.

## Author

Made by **UncleCat** · [unclecatvn.com](https://unclecatvn.com/)

## License

[Sustainable Use License](LICENSE) © 2026 UncleCat.

- **Free to use and modify** for personal or non-commercial use, or for your own company's internal work: an Odoo partner's developers can use it on their clients' projects.
- **Free to share, only free of charge and for non-commercial purposes**, with the license and copyright notices kept.
- **Not to sell**: no paid build of it on a store, no hosting or reselling it, no product or service built on it for a fee.
- Want to use it commercially in a way that isn't allowed? [Open an issue](https://github.com/unclecatvn/extension-debug-odoo/issues) or write via [unclecatvn.com](https://unclecatvn.com/) for a commercial license.
