# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions: [Semantic Versioning](https://semver.org/). Each release on GitHub uses its section below as release notes.

## [Unreleased]

### Added

- **Menus tab**: the technical screens a developer opens all day, one click away without debug mode or the Technical menu: Models, Fields, Record Rules, Views, Menus, Model Data, Crons, Actions Window, Actions Server, Reports, Parameters, Sequences, Mail Templates (the list of OCA's `developer_menu`, with nothing to install). A click opens the screen in the Odoo page, as its menu would (leaving full screen, so it shows); ↗ opens it in a new tab. Each row gives the model and, in full screen, the action's xmlid, both copied on click. For Access Rights managers; Mail Templates only shows with the mail module.
- **i18n › Languages**: activates one or more languages and loads, or reloads, their terms for every installed app, with Odoo's Add Languages wizard (Overwrite Existing Terms optional). Needs Settings rights; the active languages are chips that toggle their code in the field. The export below lists the new languages right away.

### Changed

- **Toolbar popup**: "This page" shows the Odoo version and database next to the host (one line, an icon each), and the debug mode switch reads Off / Debug / Assets.
- **Security**: plainer labels than `groups=` in the model part ("Hidden fields", "Allowed groups", "not restricted to any group").
- Text fields show focus with their border only, no ring around them.
- **Apps › search bar like Odoo's**: each facet has a coloured label (a funnel for a filter, the field name for the category), its values joined by an italic *or*, and ×; when they fill a line the input goes to the next one and ▾ stays as tall as the bar. The filters start at Installed each time the panel opens (they used to be remembered, so a cleared filter stayed cleared).
- **Apps › ⟳ Update Apps List** beside the count: Odoo's Update Apps List on its own, the new modules join the list at once (no page reload), the typed modules and the filters kept.
- **The Translations tab is titled i18n**: shorter in the tab strip, and what the folder it exports to is called.
- **Filter counts on their own line** under their input, on the right (Apps, i18n, Record › Fields, Security › Groups and System Parameters, Perf): the input gets the whole width.
- **Apps / i18n lists**: a module's name and title are one line, cut with a single … at its end (the title goes first, the row never overflows); hovering the row shows it whole, drawn over the version, ↗ staying on top.
- **Card titles stay short**; what they used to spell out goes in an ⓘ after the title, shown on hover or keyboard focus: ACL (`ir.model.access`, the rows in green apply to the user), System parameters (`ir.config_parameter`, secrets masked), View › Form fields (invisible / readonly / required, evaluated on the record shown), Perf › Repeated queries (N+1 suspects). Long titles are shorter, their detail in the ⓘ: Identity (was Identity & metadata), Hidden fields (Fields hidden from the user), Model audit (Model configuration audit), Inherited views (Inherited views — <type>), i18n › Languages (Activate / Update Languages). Titles are in Title Case, like Odoo's labels (Context & Domain, User Risks, Why Allowed / Blocked…).
- **RPC and Perf: times are on the browser's clock** (its timezone), no longer in UTC: the time of a call, of a profiled request, and the "since" of the recording.

### Removed

- The Show / Hide Panel button of the toolbar popup: the round button on the page does it.
- The call counter on the RPC tab: the tab itself lists the calls.

### Fixed

- Rows with buttons on the right (Security › Groups and System parameters, View › inherited views) keep the buttons in their own column again, top-aligned, instead of wrapping under a long name: the style had been renamed away in 1.2.0.
- Code tab › Guide: suggestions take the fields of the variable's model (the last `env[…]` model only when the variable isn't understood), as they have for a while.
- **RPC tab in an incognito window** (where Security logs in as the picked user): the calls the page made after the panel opened never showed, e.g. the `name_search` of a many2one being typed in; the tab kept what the page had recorded before, nothing when the panel reopened with the page. ⌖ Pick on Page (View) never came back either. Chrome sends an incognito tab's extension messages to the regular profile, not to the panel in that tab: the page now hands them to its own panel directly.
- **Errors from non-Odoo sites listed under Odoo Debug** in chrome://extensions, e.g. "Connecting to 'https://ad.doubleclick.net/…' violates the following Content Security Policy directive": the RPC recorder wrapped `fetch` and XHR on every site, so a request the site's own CSP blocked was blamed on the extension. It now hooks them only on Odoo pages, once `odoo` is defined; elsewhere the page is left untouched.

## [1.3.0] - 2026-10-01

### Added

- **Security: log in as the picked user, in an incognito window.** Clicking their name (next to the search box) opens Odoo's login page in a private window with their login filled in and brings you back to the current page once logged in: you type their password there (2FA included), your own session stays as it is. The extension never sees the password. Incognito windows share their cookies, so one other user at a time per Odoo.
- **Keyboard shortcuts**: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> shows / hides the panel, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> turns debug mode on / off. The toolbar popup lists them, and *Change* opens Chrome's shortcut settings.
- **Debug mode kept on per Odoo**: *Keep it on for this Odoo* in the toolbar popup reopens every page of that instance in debug (or assets), after a module upgrade or from a bookmark too. A URL with `?debug=0` is left alone, and picking *off* stops keeping it.
- **RPC: edit a call and send it again, or send a new one.** *Edit & Resend* on a logged call opens its route and JSON body for editing; *Send* (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>) posts it with the page's session and shows the result or the error with its traceback below. *New Request* starts from a `search_read` on the current model, for any route of the JSON-RPC API. *Copy as cURL* (on a logged call, or of what is being edited) replays it outside the browser: a `call_kw` becomes the external API's `execute_kw` on `/jsonrpc` with an API key from `$ODOO_API_KEY`, any other route keeps the session cookie from `$ODOO_SESSION`. A call's detail now reads actions, parameters, then the result (the error first when it failed), and editing turns the parameters into the editor in place.
- **⌥ Alt + click a tracked change in the chatter copies the field's technical name**: on *Draft → Sent (Status)*, `state`. The chatter only shows the label: the name comes from the model's fields with that label (both are named when two share it, the first is copied).

### Fixed

- **⌥ Alt + click on the label of a readonly field copied nothing** (e.g. *Customer* on a confirmed sales order): a readonly field has no input for the label to point at, the name now comes from the label itself.
- **The panel and the Odoo Debug button stopped answering after the extension was updated** (Chrome Web Store update or a reload while developing): the tabs already open kept the old content scripts, the panel hung on *Connecting…* and neither − nor the button worked until the page was reloaded. The extension now injects its scripts again into the open tabs when it is installed or updated.

## [1.2.0] - 2026-09-30

### Added

- **Color themes, like an editor's**: besides Odoo's system / light / dark, the toolbar popup offers GitHub Light, Solarized Light, GitHub Dark, Dracula, Monokai, One Dark Pro, Nord, Solarized Dark and Catppuccin Mocha. The whole panel follows, syntax colours of the Code tab included, in every open panel at once.
- **RPC and Perf in full screen: list on the left, detail on the right**, like the Network tab of the devtools. The selected row is highlighted and its detail (parameters and result, or the SQL analysis) stays in sight while the list scrolls. Beside the page, rows still unfold in place; switching between the two keeps the open row.
- **Security: which group would allow it?** A blocked operation in *Why allowed / blocked* lists the groups that would allow it (from the model's ACLs and record rules), the ones adding the fewest groups first, with what else they imply.
- **Security: try a group before adding it.** *Try* simulates a group on the user without writing anything: every card below (why allowed / blocked, ACLs, risks) is recomputed with it, then *Apply* adds the tried groups in one write or *Discard* drops them. It replaces *+ Add*.

### Changed

- **A modern, minimal look**: neutral greys with Odoo's purple as the only accent, a line icon on every tab, rounded cards with a chevron, segmented controls and softer focus rings. Beside the page, the tabs become one bar of icons (the active one shows its name, the others on hover). In full screen, the sidebar runs from the top and holds the brand, with icon + name tabs, and the content sits on a grey canvas: each block a white panel, lists with a tinted header row and roomier rows, row actions (↗) quiet until hovered.
- **Full screen layout**: the tabs move to a sidebar on the left, the header fits on one line (brand, model, id, view, buttons), and the content sits on one plane without card frames, only rows keep a line between them. Short blocks sit side by side (View: Action | Context; Security: Groups | User risks, ACL | Fields hidden, Session | System parameters), key / value blocks show three pairs per line, and the Code editor sits beside its result.
- **The panel follows the round button** while it is dragged: beside it, aligned on its top in the upper half of the window and on its bottom in the lower half (it used to stay on the bottom edge).
- **The round button hides in full screen**: it covered the panel's bottom right corner (Open Forms, Export & Download). <kbd>−</kbd> brings it back.

### Fixed

- **Record › Fields**: a long value (JSON, HTML…) no longer spills over the rows below it; it stops at three lines with an ellipsis, the full value opens with a click on the row.

## [1.1.0] - 2026-09-29

### Added

- **Security › user search**: find any user by name or login in a search box (matches listed under it, ↑ ↓ Enter or a click), instead of a long select. **My User** comes back to yours.
- **Security › Groups**: the picked user's groups, with one filter box that also lists the groups they don't have while typing, each with **+ Add**. **Remove** shows on the groups nothing else implies; an implied group is marked as such and says which group implies it (Odoo would add it back). Writing needs Access Rights and asks first.

### Changed

- **Access and Security are one tab (Security)**, in three parts: **User** (search, groups, risks), the current **model** for that user (why allowed / blocked, ACLs, fields hidden by `groups=`, configuration audit) and the **Instance** (session with Become Superuser, system parameters, checks). Another user's groups, ACLs and record rules can be read, not only yours.
- **Why allowed / blocked** shows the server's exact `has_access` answer next to each simulated verdict when the picked user is you (the separate Effective access card is gone). The Access tab's record rules table is gone too: this card lists every rule for the picked user.

### Removed

- **Account switching** in the Security tab: Switch to This User (incognito login) and Impersonate in This Session (OCA `impersonate_login`). **Become Superuser** stays, in the Session card (Settings users only).

### Fixed

- **Security › Why allowed / blocked**: the four verdict boxes no longer overflow the panel when an ACL or model name is long.

## [1.0.0] - 2026-09-29

### Added

- **Code tab › ORM Console**: JavaScript with an ORM-like `env` (`env['sale.order'].search(…)`, `.read()`, `.mapped()`, `.write()`, any public method…) run in the Odoo page with the logged-in session, so the server applies that user's access rights, record rules and active companies. Fields read like in Python (`return rec.state`, `rec.partner_id.name`, prefetched when iterating a recordset) and written by assignment (`rec.state = 'sent'`, a `write` sent in order with the other calls). Suggestions while typing: the models of the installed modules after `env['`, their fields in strings and after a dot (following relations: `partner_id.country_id.`), the recordset methods. Read-only by default (writes are blocked before they are sent); **Allow Writes** lets them through, each committed at once. Results as a table, prints, errors with line and server traceback, and the list of calls made. The code is kept per Odoo server (origin). With **Auto Refresh** ticked (offered once Allow Writes is), the view on screen reloads its data after writes (Odoo's `soft_reload`, like web_refresher).
- **Minimize** (− in the panel header): hides the panel back to the round button, which reopens it as it was.

- **Code editor** instead of a plain textarea: syntax colours, line numbers, the suggestions open under the caret, and typing is smarter: `(`, `[`, `{` and quotes come in pairs (typing the closer skips it, Backspace between a pair deletes both, a selection is wrapped), Enter keeps the indent and puts the closer of `{ }` on its own line, Tab indents. Undo (⌘/Ctrl+Z) works through all of it.
- **Code tab layout**: the editor fills the tab, under one bar (▶ Run, Allow Writes, Auto Refresh, the user it runs as, Guide). The result has its own scrolling area below it, headed by a sticky status line (ok / error, read-only, ms, calls). The guide (available variables, recordset API, examples) is hidden until Guide is pressed. Long lines wrap instead of scrolling sideways, each keeping its line number.

### Changed

- Every tab in sight, nothing to scroll: beside the page the 9 tabs are laid out 5 + 4, in full screen on one row.
- The debug mode switch (`off` / `debug` / `assets`) moves from the panel header to the toolbar popup, which shows the page's current mode.
- Tabs have no side padding (cards edge to edge), and a tab with a single card shows it without a title to click.
- **Perf tab** in one card: status and Start / Stop on one line, a one-line note, then the requests with a filter and a count. Rows read like the RPC tab (method + model), with id · time · CPU below; the panel's own requests (ir.profile reads, session info) are left out.
- **Apps tab** in one card: the modules to act on are typed or ticked in the list below an Odoo-like search bar. Its filters are Odoo's own (Installed / Not Installed, Apps / Extra, and the category), shown as facets inside the bar (× or Backspace removes one) and picked from ▾; Installed by default, remembered.
- **Translations tab**: one input for the apps to export: the word being typed searches the installed modules (name or title) listed below it, ticking one puts its name in the input, Enter picks the match; typing the names still works. Languages are toggles (the active ones, the chosen first, two rows that scroll when there are many, the choice remembered), next to a locked Template (.pot) chip; the list takes the panel's height and a full-width button at the bottom says how many files it will download.

### Fixed

- **Code tab suggestions** follow the variable: after `partners = env['res.partner']…` and `orders = env['sale.order']…`, `partners.` offers res.partner fields (it used the last `env[…]` written). Also understood: `const x = rec.partner_id`, `for (const l of order.order_line)`, `env.user.` / `env.company.`, and `orders.mapped('…')` / `partners.filtered_domain([['…` (the fields of that variable). Dragging the scrollbar of a long list no longer closes it. Picking a suggestion with Tab / Enter while a Vietnamese input method (Telex) is composing the word no longer types it twice (`search_readsearch`), and skipping a closing `']` no longer leaves the list of models open for Enter to pick from.

## [0.1.1] - 2026-09-29

### Added

- **Translations tab**: exports the translation template (`.pot`) and the `.po` of each language for several apps (`;`-separated), and downloads every file to `Downloads/<module>/i18n/`. Needs the new `downloads` permission.
- **Switch to This User** (Security › View as user): opens an incognito window on the current page, at Odoo's login of the picked user (their password is typed there); the current session is untouched. With the OCA module `impersonate_login`, "Impersonate in This Session" and "Back to My User" are offered too.
- **Apps tab**: for a `;`-separated list of modules, Activate (Update Apps List, then install them all with their dependencies), Upgrade, or Open Forms (one new tab per module); each module's state is listed below. The Installed modules card moved there from the Access tab.

### Changed

- Lists in every tab show one line per row: the details below it (label, storage, module, domain, query…) open on a click on the row and close on the next one. Clicking a name still copies it. The wide 2-column table (760px+) keeps them in its second column.
- Every collapsible section (user_context, Companies, combined arch, parameters / result, queries…) starts closed.
- Every card of every tab starts closed and loads its data only once opened; the cards left open (or closed) stay so after ⟳ Reload Data, a reload of the page or the panel.
- Rows with an action button (↗) keep it in a right-hand column, lined up on every row.
- Button labels and tooltips capitalised like Odoo's ("Export & Download", "Reload Data"…). ⟳ Reload Data also empties the Translations form.
- Icon without the green dot.
- The Perf tab is now the last one.
- The panel is pinned to the bottom of the window (beside the button), so its header never goes off screen. The button sits on the bottom edge too until dragged elsewhere; dropped back near that edge, it sticks to it again.
- After a reload, the panel comes back on the tab you were on, scrolled where you left it (each tab keeps its own position).

## [0.1.0] - 2026-09-28

First public release. Chrome extension (Manifest V3) for Odoo 18 / 19 developers, no build step.

### Added

- **In-page panel**: a draggable round button on Odoo pages opens the panel next to it (shadow DOM + iframe, so Odoo's CSS and the panel's never mix). Position kept per Odoo instance; open state and full screen kept across reloads.
- **Full screen** (⤢, Esc to leave). From 760px wide, every list becomes a 2-column table with sticky column names.
- **Record tab**: identity & metadata (xmlids, noupdate, create/write user), every field with its definition, value, module, index, groups, and which fields it triggers a recompute of.
- **View tab**: inheritance tree of the current view (primary + extensions, priority, file), combined arch, action details, form field modifiers (invisible / readonly / required) evaluated like the webclient, "Pick on page".
- **RPC tab**: live log of JSON-RPC and JSON-2 calls, recorded from page load; errors with tracebacks, "why was it blocked?" jump to the Security tab for AccessErrors.
- **Access tab**: session (db, version, web.base.url, test_mode), effective rights, ACLs, record rules, groups, system parameters (secret-looking values masked) and installed modules.
- **Security tab**: simulate another user's rights, explain why an operation is allowed or blocked rule by rule, fields hidden by `groups=`, model configuration audit, instance checks (HTTPS, cookie flags, security headers, database manager, list_db).
- **Perf tab**: Odoo's built-in server profiler: start/stop, profiled requests, SQL summary with repeated queries (N+1 suspects), slowest queries, speedscope link.
- **Copy anywhere**: click a field name, model, xmlid or parameter value in the panel; ⌥/Alt + click a field, label, list cell or column header on the Odoo page to copy its technical name.
- **Toolbar popup** (also the options page): language (English, Tiếng Việt), theme (system / light / dark), show / hide the panel. The toolbar icon is only enabled on Odoo pages.
- **i18n**: gettext `.po` catalogs read at runtime, `npm run i18n` to extract and merge.
- **CI / release**: GitHub Actions run syntax checks, tests and the i18n check; bumping the manifest version on `main` tags and publishes a release zip.

### Security

- Odoo data only reaches the DOM through `textContent`; the session cookie value is never read (flags only).
- The panel page is a `use_dynamic_url` web-accessible resource, so other sites can't frame it.
- `odoo.conf` is not readable from a browser by design; nothing in the extension tries to.

[1.3.0]: https://github.com/unclecatvn/extension-debug-odoo/releases/tag/v1.3.0
[1.2.0]: https://github.com/unclecatvn/extension-debug-odoo/releases/tag/v1.2.0
[1.1.0]: https://github.com/unclecatvn/extension-debug-odoo/releases/tag/v1.1.0
[1.0.0]: https://github.com/unclecatvn/extension-debug-odoo/releases/tag/v1.0.0
[0.1.1]: https://github.com/unclecatvn/extension-debug-odoo/releases/tag/v0.1.1
[0.1.0]: https://github.com/unclecatvn/extension-debug-odoo/releases/tag/v0.1.0
