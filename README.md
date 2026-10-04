# Odoo Debug

**Stop guessing. See why Odoo does what it does.** An in-page debug panel for Odoo 18.0, 19.0 and 20.0: a Chrome extension
(Manifest V3) that opens beside the screen you are on and explains it — the record, the view, the calls to the server,
who may do what, and the translations.

[Tiếng Việt](README.vi.md) · [User guide](https://unclecatvn.github.io/extension-debug-odoo/) · [Architecture](docs/ARCHITECTURE.md)

## The problem

Odoo's own debug mode shows *that* something happens, rarely *why*:

- **A user can't open or edit a record.** The AccessError names a model and, at best, a rule. Finding which ACL is
  missing, which record rule refuses the record, what its domain evaluates to for that user, and which group would fix
  it — without granting more than needed — means reading `ir.model.access`, `ir.rule` and `res.groups` by hand.
- **A field is hidden, read-only or missing on a form.** Its modifiers come from several views inherited from several
  modules, in an order only `ir.ui.view._combine` knows.
- **A screen is slow or a call fails.** The browser's network tab shows JSON-RPC payloads, not the model, method and
  server error behind them, nor a way to replay the call against the external API.
- **A text is not translated.** Is it a field value, a view term, or a code string in some module's `.po`? Each is fixed
  somewhere else.

Odoo Debug answers these on the screen itself, as tables, for the user you are — or any user you pick.

## Who it is for

- **Odoo developers** debugging their modules: fields, computes, view inheritance, RPC calls, record rules.
- **Functional consultants and system operators** handling "I can't do X" tickets: rights per user, record and model,
  what a group grants, comparing two users, translations.
- **Administrators** reviewing a database: who holds sensitive groups, what each group opens, how the instance is
  exposed on the web.

## What it shows

| Tab | What for |
|---|---|
| **Record** | Every field of the record: definition, value by type, what recomputes it, quick filters, copy as JSON |
| **View** | The view told as a story: which views from which modules build it, in Odoo's order; one field through them; the combined arch |
| **RPC** | The page's JSON-RPC calls with timing and errors; edit and resend; Copy as cURL for the external API (18: `/jsonrpc`, 19 / 20: `/json/2`) |
| **Security** | Rights as tables: a record's ACLs and rules × read / write / create / delete, with domains evaluated for the user; rights on every model; groups, what each grants and who has it; try a group before granting it; compare users |
| **Translations** | Where a text comes from and where to change it; a record's and a view's translations per language; `.po` coverage, export and import; languages |
| **Apps** | Modules as Odoo's Apps menu has them (same filters, as facets): pick several, then Activate (Update Apps List + install with dependencies), Upgrade or open their forms; ⚠ when a manifest on disk is newer than the database. A module opened: its description (`index.html` or README), manifest, dependencies both ways (what installing it brings, auto-installed modules included, as Odoo computes it) and as a diagram, its data and models, uninstall previewed with Odoo's own wizard; operations left pending, applied or cancelled (Settings rights) |
| **Menus** | The technical screens a developer opens all day, one click away without debug mode or the Technical menu: Models, Fields, Record Rules, Views, Menus, Model Data, Crons, Actions Window, Actions Server, Reports, Parameters, Sequences, Mail Templates (the list of OCA's `developer_menu`, with nothing to install; for Access Rights managers). A click opens the screen in the Odoo page, as its menu would; ↗ in a new tab. |
| **Perf** | Odoo's own profiler, read back: start / stop for your session, then each request's SQL, the lines of code sending them, N+1 suspects, the slowest queries; compare with a baseline (before / after a fix); profile one call of the RPC tab on its own; flame graph; clean up (Settings rights) |
| **Code** | An ORM console as the logged-in user, on the record opened / selected (`record`, `records`, `model`): **JavaScript** in the page (`env['sale.order'].search(…)`, read-only, dry run or writes) or **Python** on the server as a temporary server action (a dry run is rolled back for real; Settings rights); results shown by type (records, rows typed by their fields, dates in your time zone) and copied as CSV / Markdown / JSON; snippets; completion of models, fields and methods |

The version of Odoo is detected on each page, and every difference between 18.0, 19.0 and 20.0 the panel depends on lives in
one place (`src/odoo/adapters/`).

## Demo

<!-- Paste the demo video here, e.g. a YouTube link: [![Odoo Debug demo](thumbnail.png)](https://www.youtube.com/watch?v=…)
     or an .mp4 uploaded to a GitHub issue / release: https://github.com/user-attachments/assets/… -->
> 🎬 Demo video coming soon. Meanwhile, screenshots of every tab are on the
> [Odoo Debug page](https://unclecatvn.github.io/extension-debug-odoo/).

## User guide

The guide — features tab by tab, shortcuts, privacy — is at
**https://unclecatvn.github.io/extension-debug-odoo/**.

Shortcuts: **Alt+Shift+O** shows / hides the panel, **Alt+Shift+D** turns Odoo's debug mode on / off (change them at
`chrome://extensions/shortcuts`).

## Install

In **Chrome** (or Edge, Brave, any Chromium browser). The extension is not on the Chrome Web Store: it is installed
from its release, unpacked.

1. **Download** `odoo-debug-v<version>.zip` from the [Releases](https://github.com/ngochung207/extension-debug-odoo/releases) and unzip it into a folder you keep (Chrome loads
   the extension from there: don't delete it).
2. **Load it in Chrome**
   1. Open `chrome://extensions`.
   2. Turn on **Developer mode** (top right).
   3. Click **Load unpacked** and choose the unzipped folder (the one holding `manifest.json`).
   4. If the JavaScript version of Odoo Debug is installed, turn it off: both would add their button to Odoo pages.
3. **Use it**: open any page of an Odoo 18, 19 or 20 database (logged in), then click the **Odoo Debug** button at the
   bottom right of the page, or press **Alt+Shift+O**. From its header the panel goes full screen or into its own
   window (for a second screen).
4. **Update it**: unzip the new release over the same folder, click ⟳ on the extension's card in `chrome://extensions`,
   then reload the Odoo page.

## Build from source

Requirements: **Node.js 22.18 or later**.

```sh
git clone -b ts https://github.com/ngochung207/extension-debug-odoo.git
cd extension-debug-odoo
npm install
npm run build   # → dist/: Load unpacked this folder (step 2 above)
```

After pulling new code: `npm run build`, then ⟳ in `chrome://extensions` and reload the Odoo page.

### Working on it

```sh
npm run watch   # rebuilds dist/ on every save (then ⟳ in chrome://extensions)
npm run check   # what CI runs: type check, unit tests, build, page-function / markup / import checks
npm run i18n    # refreshes the .pot / .po after adding a translatable string
```

How the code is organized, the rules it follows and how the Odoo versions are handled:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

To release: bump `version` in `static/manifest.json`, add its section to [CHANGELOG.md](CHANGELOG.md), push. CI checks,
builds and publishes `odoo-debug-v<version>.zip` in the Releases (a pre-release from the `ts` branch).

## License

Odoo Debug is free software: you can redistribute it and/or modify it under the terms of the
**GNU Lesser General Public License v3.0** ([LICENSE](LICENSE), which builds on the GNU GPL v3.0 in [COPYING](COPYING)),
the license of Odoo Community. It contains no Odoo source code: it talks to Odoo through its web routes and RPC.

Copyright © 2026 Trinh Ngoc Hung.
