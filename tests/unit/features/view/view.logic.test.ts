import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archTags, buildViewTree, restrictedNodes } from '../../../../src/features/view/view.logic.ts';
import type { IrUiView } from '../../../../src/odoo/models.ts';

const v = (id: number, inherit: number | null, mode: 'primary' | 'extension', priority = 16, active = true): IrUiView =>
  ({ id, name: `v${id}`, xml_id: `m.v${id}`, inherit_id: inherit ? [inherit, `v${inherit}`] : false, mode, priority, active, arch_fs: false });

test('the inheritance tree, as Odoo combines it', () => {
  const views = [
    v(1, null, 'primary'), // root form
    v(2, 1, 'extension', 20), v(3, 1, 'extension', 10), // applied by priority: 3 then 2
    v(4, 2, 'extension'), // extension of an extension
    v(5, 1, 'primary'), // another form built on 1: not part of 1, but 1 is part of it
    v(6, 5, 'extension'),
    v(7, 1, 'extension', 16, false), // inactive: in the tree, shown as not applied
    v(8, 3, 'extension', 10), v(9, 3, 'extension', 10), // same priority: by id
  ];
  const ids = (cur: number) => buildViewTree(views, cur).map(({ view, depth }) => `${'·'.repeat(depth)}${view.id}`);
  assert.deepEqual(ids(1), ['1', '·3', '··8', '··9', '·7', '·2', '··4']); // primary 5 (and its 6) not applied to 1
  assert.deepEqual(ids(5), ['1', '·3', '··8', '··9', '·7', '·2', '··4', '·5', '··6']); // 5 = 1 + its own extensions
  assert.deepEqual(ids(4), ids(1)); // from an extension: the tree of the view it ends up in
  assert.deepEqual(buildViewTree(views, 99), []);
  // an inherit_id loop (refused by Odoo's constraint) doesn't hang it
  assert.equal(buildViewTree([v(1, 2, 'extension'), v(2, 1, 'extension')], 1).length, 2);
});

const arch = `<data>
  <!-- <field name="partner_id"/> commented out -->
  <xpath expr="//field[@name='partner_id']" position="after">
    <field name="partner_shipping_id"
           invisible="not partner_id or state in ('sale', 'done')"
           groups="account.group_delivery_invoice_address"/>
  </xpath>
  <field name="partner_id" position="attributes">
    <attribute name="readonly">state != 'draft'</attribute>
  </field>
  <field name="amount_total" invisible="amount_total > 0 and partner_id_count"/>
  <button name="action_confirm" string="Confirm" groups="sales_team.group_sale_manager,!base.group_portal"/>
</data>`;

test('start tags of an arch: multi-line, > inside values, comments skipped', () => {
  const tags = archTags(arch);
  assert.deepEqual(tags.map((t) => `${t.line}:${t.name}`), ['1:data', '3:xpath', '4:field', '8:field', '9:attribute', '11:field', '12:button']);
  assert.equal(tags[2]!.attrs.invisible, "not partner_id or state in ('sale', 'done')");
  assert.equal(tags[5]!.attrs.invisible, 'amount_total > 0 and partner_id_count');
  assert.equal(archTags('<field name="a" string="&quot;x&quot; &amp; y"/>')[0]!.attrs.string, '"x" & y');
});

test('elements restricted to groups, also by an extension on its parent\'s element', () => {
  const ext = `<data>
  <field name="parent_id" position="attributes">
    <attribute name="groups">base.group_no_one</attribute>
    <attribute name="invisible">is_company</attribute>
  </field>
  <xpath expr="//field[@name='vat']" position="attributes"><attribute name="groups" add="account.group_account_user" separator=","/></xpath>
</data>`;
  assert.deepEqual(restrictedNodes(ext).map(({ line, tag, name, groups }) => ({ line, tag, name, groups })), [
    { line: 3, tag: 'field', name: 'parent_id', groups: 'base.group_no_one' },
    { line: 6, tag: 'xpath', name: "//field[@name='vat']", groups: 'account.group_account_user' },
  ]);
});

test('elements restricted to groups', () => {
  assert.deepEqual(restrictedNodes(arch).map(({ line, tag, name, groups }) => ({ line, tag, name, groups })), [
    { line: 4, tag: 'field', name: 'partner_shipping_id', groups: 'account.group_delivery_invoice_address' },
    { line: 12, tag: 'button', name: 'action_confirm', groups: 'sales_team.group_sale_manager,!base.group_portal' },
  ]);
});
