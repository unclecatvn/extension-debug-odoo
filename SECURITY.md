# Security policy

## Supported versions

Only the latest release is supported: the browser stores update an installed extension on their own, and fixes are not backported.

## Reporting a vulnerability

Please do not open a public issue. [Report it privately on GitHub](https://github.com/unclecatvn/extension-debug-odoo/security/advisories/new), or write via [unclecatvn.com](https://unclecatvn.com/) if you cannot.

Say which versions of the extension, Odoo and the browser you used, how to reproduce it, and what an attacker gains. Use a test database: no real customer data or credentials.

Odoo Debug is a free project, with no bug bounty and no guaranteed response time. A confirmed issue is fixed in a new release and published as a GitHub security advisory, crediting you if you wish.

## Scope

The extension runs on every site, with the `scripting` and `cookies` permissions, so these count as vulnerabilities:

- A web page or Odoo content (a record's value, a view, a translation, an RPC response) running script in the panel or reaching the extension's privileged APIs.
- A page that is not Odoo getting anything from the extension.
- The extension sending anything anywhere but the Odoo server of the tab you are on.
- The extension exposing the session cookie's value.
- The extension writing to Odoo without your click, or beyond your user's rights.

These do not:

- Vulnerabilities in Odoo itself: [report them to Odoo](https://www.odoo.com/security-report).
- What your Odoo user can already do. The Code tab runs what you type, and a group applied or a module installed takes effect, on your click and with your rights.
- Attacks that need an already compromised browser or computer.
