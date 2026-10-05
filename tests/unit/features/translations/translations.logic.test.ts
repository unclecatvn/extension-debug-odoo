import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import {
  b64ToBytes, bytesToB64, findWebTerms, gunzip, missingIn, normalize, parsePo, poPath, poStats, resolveLangs, translationRows, untar,
} from '../../../../src/features/translations/translations.logic.ts';

const PO = `# Translation of Odoo Server.
msgid ""
msgstr ""
"Project-Id-Version: Odoo Server 18.0\\n"

#. module: sale
#: model:ir.model.fields,field_description:sale.field_sale_order__name
msgid "Order Reference"
msgstr "Mã đơn"

#. module: sale
#: code:addons/sale/models/sale_order.py:0
#, python-format
msgid ""
"A long "
"message with \\"quotes\\""
msgstr ""

#. module: sale
#, fuzzy
msgid "Quotation"
msgstr "Báo giá"
`;

test('a .po: entries (multi-line strings, quotes, references), the header left out, coverage', () => {
  const e = parsePo(PO);
  assert.deepEqual(e.map((x) => [x.msgid, x.msgstr, x.fuzzy]), [
    ['Order Reference', 'Mã đơn', false], ['A long message with "quotes"', '', false], ['Quotation', 'Báo giá', true]]);
  assert.deepEqual(e[0]!.refs, ['model:ir.model.fields,field_description:sale.field_sale_order__name']);
  assert.deepEqual(poStats(e), { total: 3, translated: 1, fuzzy: 1, missing: 1 });
});

test('file paths of the export, languages', () => {
  assert.deepEqual(poPath('sale/i18n/vi_VN.po'), { module: 'sale', lang: 'vi_VN' });
  assert.deepEqual(poPath('sale/i18n/sale.pot'), { module: 'sale', lang: '__new__' });
  assert.equal(poPath('README'), null);
  assert.deepEqual(resolveLangs(['vi_vn', 'xx'], ['en_US', 'vi_VN']), { codes: ['vi_VN'], unknown: ['xx'] });
  assert.equal(normalize('  Confirm\n  Order '), 'Confirm Order');
});

test('the export archive: base64 → gunzip → files', async () => {
  // a one-file ustar, as Python's tarfile writes it
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  const body = enc.encode('msgid "x"\nmsgstr "y"\n');
  header.set(enc.encode('sale/i18n/vi.po'), 0);
  header.set(enc.encode(body.length.toString(8).padStart(11, '0')), 124);
  header[156] = 48;
  const tar = new Uint8Array(512 + 512 + 1024);
  tar.set(header, 0);
  tar.set(body, 512);
  const b64 = bytesToB64(new Uint8Array(gzipSync(tar)));
  const files = untar(await gunzip(b64ToBytes(b64)));
  assert.deepEqual(files.map((f) => [f.name, new TextDecoder().decode(f.data)]), [['sale/i18n/vi.po', 'msgid "x"\nmsgstr "y"\n']]);
});

test("a field's translations: whole or by term, missing ones", () => {
  const whole = translationRows([{ lang: 'en_US', source: 'Desk', value: 'Desk' }, { lang: 'vi_VN', source: 'Desk', value: 'Bàn' }, { lang: 'fr_FR', source: 'Desk', value: null }], false);
  assert.deepEqual(whole.map((r) => [r.source, [...r.values]]), [['Desk', [['en_US', 'Desk'], ['vi_VN', 'Bàn'], ['fr_FR', null]]]]);
  const terms = translationRows([{ lang: 'vi_VN', source: 'Hello', value: 'Xin chào' }, { lang: 'vi_VN', source: 'Bye', value: '' }], true);
  assert.deepEqual(terms.map((r) => [r.source, r.values.get('vi_VN')]), [['Hello', 'Xin chào'], ['Bye', null]]);
  assert.equal(missingIn(whole, ['en_US', 'vi_VN', 'fr_FR']), 1);
});

test('a text found among the code translations: exact, else containing it', () => {
  const modules = { sale: { messages: [{ id: 'Confirm Order', string: 'Xác nhận đơn' }, { id: 'Send', string: 'Gửi' }] }, web: { messages: [{ id: 'Discard', string: 'Huỷ bỏ' }] } };
  assert.deepEqual(findWebTerms(modules, ' Xác nhận   đơn '), [{ module: 'sale', msgid: 'Confirm Order', msgstr: 'Xác nhận đơn', exact: true }]);
  assert.deepEqual(findWebTerms(modules, 'nhận').map((t) => [t.msgid, t.exact]), [['Confirm Order', false]]);
  assert.deepEqual(findWebTerms(modules, ''), []);
});
