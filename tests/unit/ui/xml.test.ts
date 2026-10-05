import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prettyXml, xmlTokens } from '../../../src/ui/xml.ts';

const arch = `<form string="Order"><!-- note -->
  <field name="amount" invisible="amount > 0 and state != 'draft'"
         readonly="1"/>
  <attribute name="groups">base.group_user</attribute>
</form>`;

test('tokens: every character kept, in order', () => {
  const toks = xmlTokens(arch);
  assert.equal(toks.map((t) => t.text).join(''), arch);
  assert.deepEqual(toks.slice(0, 7).map((t) => `${t.type}:${t.text}`),
    ['punct:<', 'tag:form', 'text: ', 'attr:string', 'punct:=', 'value:"Order"', 'punct:>']);
  assert.ok(toks.some((t) => t.type === 'comment' && t.text === '<!-- note -->'));
  assert.ok(toks.some((t) => t.type === 'value' && t.text === `"amount > 0 and state != 'draft'"`)); // '>' inside a value
  assert.deepEqual(xmlTokens('</form>').map((t) => t.type), ['punct', 'tag', 'punct']);
  assert.deepEqual(xmlTokens('plain text').map((t) => t.type), ['text']);
});

test('pretty: one element per line, short texts inline, attributes on one line, values untouched', () => {
  assert.equal(prettyXml(arch), [
    '<form string="Order">',
    '  <!-- note -->',
    `  <field name="amount" invisible="amount > 0 and state != 'draft'" readonly="1"/>`,
    '  <attribute name="groups">base.group_user</attribute>',
    '</form>',
  ].join('\n'));
  assert.equal(prettyXml('<a><b></b><c>x</c><d><e/></d></a>'), '<a>\n  <b></b>\n  <c>x</c>\n  <d>\n    <e/>\n  </d>\n</a>');
  assert.equal(prettyXml('<a domain="[(\'x\', \'=\',\n  1)]"/>'), '<a domain="[(\'x\', \'=\',\n  1)]"/>'); // a value spanning lines stays as written
});

test('element tree: nesting, attributes, own text, lines', async () => {
  const { xmlTree, walk } = await import('../../../src/ui/xml.ts');
  const t = xmlTree(`<data>
  <field name="a" position="attributes">
    <attribute name="invisible">x &gt; 1</attribute>
  </field>
  <!-- <field name="hidden"/> -->
  <xpath expr="//group" position="inside"><field name="b"/></xpath>
</data>`)!;
  assert.equal(t.name, 'data');
  assert.deepEqual(t.children.map((c) => `${c.line}:${c.name}`), ['2:field', '6:xpath']);
  const attr = t.children[0]!.children[0]!;
  assert.deepEqual([attr.attrs.name, attr.text, attr.parent?.attrs.name], ['invisible', 'x > 1', 'a']);
  assert.deepEqual([...walk(t)].map((e) => e.name), ['data', 'field', 'attribute', 'xpath', 'field']);
  assert.equal(xmlTree('no element'), null);
});
