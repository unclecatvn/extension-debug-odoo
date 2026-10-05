import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archFields, fieldSteps, moduleOf, specsOf, summarize } from '../../../../src/features/view/arch.logic.ts';

const base = `<form string="Invoice">
  <sheet>
    <group name="header">
      <field name="partner_id" required="1"/>
      <field name="payment_term_id" invisible="not partner_id"/>
    </group>
    <field name="state" invisible="1"/>
  </sheet>
</form>`;

const ext = `<data>
  <field name="partner_id" position="after">
    <field name="team_id"/>
    <field name="state" position="move"/>
  </field>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="readonly">state != 'draft'</attribute>
    <attribute name="groups">account.group_account_invoice</attribute>
  </xpath>
  <field name="payment_term_id" position="replace"/>
  <group name="header" position="inside">
    <div class="o_row"><field name="partner_id" invisible="is_company" context="{'show': partner_id}"/></div>
    <field name="user_id" groups="base.group_no_one"/>
  </group>
  <field name="team_id" position="attributes">
    <attribute name="invisible">not partner_id</attribute>
  </field>
</data>`;

test('specs of an extension: position, target, what each brings or changes', () => {
  const specs = specsOf(ext);
  assert.deepEqual(specs.map((s) => `${s.line}:${s.position}:${s.target.label}:${s.target.field}`), [
    '2:after:field partner_id:partner_id', "6:attributes://field[@name='partner_id']:partner_id",
    '10:replace:field payment_term_id:payment_term_id', '11:inside:group[header]:null', '15:attributes:field team_id:team_id']);
  assert.deepEqual(specs[0]!.adds.map((a) => `${a.tag}:${a.name}:${a.moved}`), ['field:team_id:false', 'field:state:true']);
  assert.deepEqual(specs[1]!.attributes.map((a) => `${a.name}=${a.value}`), ["readonly=state != 'draft'", 'groups=account.group_account_invoice']);
  assert.deepEqual(specsOf(base), []); // a base view has none
  assert.deepEqual(specsOf('<xpath expr="//sheet" position="inside"><field name="x"/></xpath>').map((s) => s.position), ['inside']); // root spec
});

test('a view in numbers', () => {
  assert.deepEqual(summarize(base), { base: true, fields: 3, moved: 0, attributes: 0, removed: 0, others: 0 });
  // after: team_id (+1 field) and a move; replace with nothing: 1 removed; inside: a div (other) + user_id (+1 field)
  assert.deepEqual(summarize(ext), { base: false, fields: 2, moved: 1, attributes: 3, removed: 1, others: 1 });
});

test('the steps of a field through a view', () => {
  const s = (arch: string, f: string) => fieldSteps(arch, f).map((x) => `${x.line}:${x.kind}:${x.detail}`);
  assert.deepEqual(s(base, 'partner_id'), ['4:places:group[header]', '5:reads:invisible of field payment_term_id']);
  assert.deepEqual(s(ext, 'partner_id'), [
    '2:neighbour:after: team_id, state', "6:changes:readonly=\"state != 'draft'\"", '8:restricts:account.group_account_invoice',
    '12:adds:inside group[header]', '16:reads:invisible of field team_id']); // its own placement's attributes are not "reading" it
  assert.deepEqual(s(ext, 'state'), ['4:moves:after field partner_id', "7:reads:readonly of //field[@name='partner_id']"]);
  assert.deepEqual(s(ext, 'payment_term_id'), ['10:removes:']);
  assert.deepEqual(s(ext, 'user_id'), ['13:adds:inside group[header]', '13:restricts:base.group_no_one']);
  assert.deepEqual(s(ext, 'team_id'), ['3:adds:after field partner_id', '15:changes:invisible="not partner_id"']);
  assert.deepEqual(s(ext, 'nothing'), []);
});

test('modules and fields of a view', () => {
  assert.equal(moduleOf('sale.view_order_form'), 'sale');
  assert.equal(moduleOf(false), null);
  assert.deepEqual(archFields(base), ['partner_id', 'payment_term_id', 'state']);
});
