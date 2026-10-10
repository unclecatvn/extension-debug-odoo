<div align="center">

<img src="static/icons/icon-128.png" width="96" height="96" alt="Odoo Debug">

# Odoo Debug

**Stop guessing. See why Odoo does what it does.**

A free Chrome extension to debug Odoo 18, 19 and 20, with its panel right on the Odoo page.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/mfmamdbagelffoedimmjpolhalmngcjk?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=714b67)](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk) [![License](https://img.shields.io/badge/license-Sustainable%20Use-714b67)](LICENSE)

**[Add to Chrome](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)** · [Website](https://odoo-debug.unclecatvn.com/) · [Features](#features) · [Tiếng Việt](README.vi.md)

</div>

<!-- website/intro.mp4 (npm run intro), uploaded as a GitHub attachment: GitHub plays no video from the repository.
     A new film: drag it into any comment box, put the user-attachments link it gives in place of this one. -->
https://github.com/user-attachments/assets/ff679916-475a-48bb-b372-6da66bbeddce

## Why

Odoo's developer mode shows *what* is on the screen. Odoo Debug shows *why*: which module adds a field, which inherited view made it read-only, which RPC call failed and with what traceback, which record rule blocks a user, which request fires 50 SQL queries.

It answers on the page itself, for the user you are or any user you pick. Made for Odoo developers, functional consultants handling "I can't do X" tickets, and administrators reviewing a database.

## Features

| Tab | The question it answers |
|---|---|
| **Record** | What is this field? Its type, value, module, and what recomputes it. |
| **View** | Why is this field read-only? The condition, its value right now, and the inherited view that set it. |
| **RPC** | What did that call send? Every JSON-RPC call with its timing and error; edit it and send it again, or copy it as cURL. |
| **Security** | Why can't this user open this record? The ACL or record rule that refuses, and the group that would allow it, tried before it is granted. |
| **Translations** | Where does this text come from? Its source and where to change it; `.po` coverage, export and import. |
| **Apps** | What will this install bring? Every module it installs and auto-installs, as Odoo computes it; install, upgrade, uninstall previewed. |
| **Menus** | Where is that technical screen? Models, views, rules, crons, actions… one click, without debug mode. |
| **Perf** | Why is this screen slow? Odoo's profiler read back: N+1 queries and the line running them, where the time goes, before / after a fix. |
| **Code** | What would this change do? An ORM console in JavaScript or Python, with a dry run that saves nothing. |

Screenshots of every tab: [odoo-debug.unclecatvn.com](https://odoo-debug.unclecatvn.com/#features).

### Debug workflow additions (development build)

- **RPC**: see in-flight requests and their elapsed time; filter Pending, Slow (≥ 1 s), or Errors. The same row updates when the response arrives.
- **Code → History**: inspect the last 20 completed runs, restore code without running it, or save it as a snippet. History is per database/user in panel memory; reloading or destroying the panel discards it (minimizing does not). Large outputs may be omitted with a notice.
- **Record → Compare saved records**: select 2–5 records in a list/kanban, or pin record A and navigate to B. Use **Differences only** to focus on changed fields. Reads saved server values, not unsaved form edits; binary comparison uses size only. Reload Data clears the pin.
- **Perf → Group by method**: count, total request time, median and SQL count, with individual request drilldown. Only the latest 200 fetched profiles are considered, excluding panel requests and hidden static files; concurrent request times are added, not interpreted as page load time.

## Install

1. Install **[Odoo Debug from the Chrome Web Store](https://chromewebstore.google.com/detail/odoo-debug/mfmamdbagelffoedimmjpolhalmngcjk)**. It works in Chrome, Edge, Brave and other Chromium browsers (Edge: allow extensions from other stores first), and updates itself.
2. Open a page of an Odoo 18, 19 or 20 database, logged in.
3. Click the **Odoo Debug** button at the bottom right, or press **Alt+Shift+O**. From its header the panel goes full screen or into its own window.

### Shortcuts

| Shortcut | Does |
|---|---|
| **Alt+Shift+O** | Show / hide the panel |
| **Alt+Shift+D** | Turn Odoo's debug mode on / off |
| **⌥/Alt + click** | On a field, its label, a list cell or column header, or a tracked change in the chatter: copy its technical name |

Change them, or add one that opens the panel in its own window, at `chrome://extensions/shortcuts`.

<details>
<summary>A version not on the store yet</summary>

Download `odoo-debug-v<version>.zip` from the [Releases](https://github.com/unclecatvn/extension-debug-odoo/releases), unzip it, then `chrome://extensions` → **Developer mode** → **Load unpacked**. Turn the store version off meanwhile: both would add their button to Odoo pages.

</details>

## Compatibility

- **Odoo:** 18.0, 19.0, 20.0, detected on each page
- **Browsers:** Chrome, Edge, Brave and other Chromium browsers (Manifest V3)
- **Languages:** العربية, Deutsch, English, Español, Français, Bahasa Indonesia, 日本語, Português (Brasil), Tiếng Việt, 简体中文
- **Not supported:** Odoo 17 and earlier; Firefox and Safari

## Privacy

- Talks only to the Odoo server of the tab you are on, with your own session: no backend, no analytics, no tracking.
- Reads by default. It writes only on your click, as your user: a group applied, a module installed, a translation edited, Python run in its writes mode.
- Never reads the session cookie's value, only its flags.

Every permission and what it is for: [odoo-debug.unclecatvn.com/#privacy](https://odoo-debug.unclecatvn.com/#privacy).

## Contributing

Bug reports and pull requests are welcome.

- **Found a bug?** [Open an issue](https://github.com/unclecatvn/extension-debug-odoo/issues) with the Odoo version, the page you were on and, if any, the error from the RPC tab.
- **Want to change the code?** Building from source, the checks and the pull request checklist are in [CONTRIBUTING.md](CONTRIBUTING.md); how the code is organized, in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **What changed:** [CHANGELOG.md](CHANGELOG.md).

## License

[Sustainable Use License](LICENSE) © 2026 UncleCat.

- **Free to use and modify** for personal or non-commercial use, or for your own company's internal work: an Odoo partner's developers can use it on their clients' projects.
- **Free to share, only free of charge and for non-commercial purposes**, with the license and copyright notices kept.
- **Not to sell**: no paid build of it on a store, no hosting or reselling it, no product or service built on it for a fee.

For a commercial license, [open an issue](https://github.com/unclecatvn/extension-debug-odoo/issues) or write via [unclecatvn.com](https://unclecatvn.com/).
