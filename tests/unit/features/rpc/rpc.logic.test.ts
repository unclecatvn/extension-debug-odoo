import assert from 'node:assert/strict';
import { test } from 'node:test';
import { json2Body, parseRpc, parseRpcResponse, prettyJson, toCurl } from '../../../../src/features/rpc/rpc.logic.ts';
import type { RawRpc } from '../../../../src/contracts/messages.ts';
import { ADAPTERS } from '../../../../src/odoo/detect.ts';

const raw = (url: string, body: unknown, method = 'POST', status = 200, response = '{"jsonrpc":"2.0","result":true}'): RawRpc =>
  ({ method, url, body: typeof body === 'string' ? body : JSON.stringify(body), status, ms: 12, at: 't', response });
const { 18: v18, 19: v19 } = ADAPTERS;

test('recorded calls → log entries', () => {
  // call_kw
  let e = parseRpc(raw('https://x.com/web/dataset/call_kw/res.partner/web_read',
    { jsonrpc: '2.0', params: { model: 'res.partner', method: 'web_read', args: [[1]], kwargs: { specification: {} } } }))!;
  assert.equal(e.model, 'res.partner'); assert.equal(e.method, 'web_read'); assert.deepEqual(e.args, [[1]]); assert.equal(e.ms, 12);
  assert.equal(e.result, true);
  // other JSON route, with an error response
  e = parseRpc(raw('https://x.com/web/action/load', { jsonrpc: '2.0', params: { action_id: 5 } }, 'POST', 200,
    '{"jsonrpc":"2.0","error":{"data":{"name":"odoo.exceptions.AccessError","message":"no"}}}'))!;
  assert.equal(e.method, '/web/action/load'); assert.deepEqual(e.args, { action_id: 5 }); assert.equal(e.errorType, 'odoo.exceptions.AccessError');
  // body cut by the recorder (> 200 KB): still logged, model/method from the URL
  const cut = JSON.stringify({ jsonrpc: '2.0', params: { model: 'ir.attachment', method: 'create', args: [{ datas: 'A'.repeat(300) }] } }).slice(0, 100);
  e = parseRpc(raw('https://x.com/web/dataset/call_kw/ir.attachment/create', cut))!;
  assert.equal(e.model, 'ir.attachment'); assert.equal(e.method, 'create'); assert.match(String(e.args), /^\{"jsonrpc".*…$/);
  e = parseRpc(raw('https://x.com/web/dataset/call_button/sale.order/action_confirm', cut))!;
  assert.equal(e.method, 'action_confirm');
  // ignored
  assert.equal(parseRpc(raw('https://x.com/web/image', 'x')), null);
  assert.equal(parseRpc(raw('https://x.com/web/dataset/call_kw', {}, 'GET')), null);
  // the request as sent, for Edit & Resend
  e = parseRpc(raw('https://x.com/web/dataset/call_kw/res.partner/read?x=1', { jsonrpc: '2.0', params: { model: 'res.partner', method: 'read', args: [[1]] } }))!;
  assert.equal(e.route, '/web/dataset/call_kw/res.partner/read?x=1');
  // no response at all (fetch rejected, XHR error / timeout / abort): an error, not an empty result
  e = parseRpc({ ...raw('https://x.com/web/dataset/call_kw/res.partner/read', { jsonrpc: '2.0', params: { model: 'res.partner', method: 'read', args: [[1]] } }, 'POST', 0, ''), error: 'TypeError: Failed to fetch' })!;
  assert.equal(e.error, 'TypeError: Failed to fetch'); assert.equal(e.errorType, 'network'); assert.equal(e.method, 'read'); assert.equal('result' in e, false);
});

test('Odoo 19 JSON-2 calls: ids apart from the named arguments; errors as 4xx/5xx JSON objects', () => {
  const e = parseRpc(raw('https://x.com/json/2/sale.order/action_confirm', { ids: [3], context: { lang: 'en_US' } }, 'POST', 200, 'true'))!;
  assert.equal(e.model, 'sale.order'); assert.equal(e.method, 'action_confirm');
  assert.deepEqual(e.args, [3]); assert.deepEqual(e.kwargs, { context: { lang: 'en_US' } }); assert.equal(e.result, true);
  // documentation/19.0 external_api → Response: { name, message, arguments, context, debug }
  assert.deepEqual(parseRpcResponse('{"name":"werkzeug.exceptions.Unauthorized","message":"Invalid apikey","arguments":["Invalid apikey",401],"context":{},"debug":"TB"}', 401),
    { error: 'Invalid apikey', traceback: 'TB', errorType: 'werkzeug.exceptions.Unauthorized' });
});

test('JSON-RPC answers', () => {
  assert.deepEqual(parseRpcResponse('{"jsonrpc":"2.0","result":[1]}', 200), { result: [1] });
  assert.deepEqual(parseRpcResponse('{"jsonrpc":"2.0","error":{"message":"Odoo Server Error","data":{"message":"boom","debug":"TB"}}}', 200),
    { error: 'boom', traceback: 'TB', errorType: undefined });
  assert.deepEqual(parseRpcResponse('<html>', 502), { error: 'HTTP 502' });
  assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyJson('{"cut'), '{"cut'); // not JSON: as is
});

const kw = (model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } });

test('Copy as cURL on Odoo 18: call_kw → /jsonrpc execute_kw, the API key in place of the password', () => {
  const body = kw('res.partner', 'search_read', [[['name', '=', "O'Neil"]]], { limit: 1 });
  assert.deepEqual(toCurl({ origin: 'https://x.com', route: '/web/dataset/call_kw/res.partner/search_read', body, db: 'prod', uid: 2, api: v18.api }), {
    text: "curl 'https://x.com/jsonrpc' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw " +
      `'{"jsonrpc":"2.0","method":"call","params":{"service":"object","method":"execute_kw","args":["prod",2,"'"$ODOO_API_KEY"'","res.partner","search_read",[[["name","=","O'\\''Neil"]]],{"limit":1}]}}'`,
    warnings: [],
  });
  // any other route: the session cookie, on every version
  for (const api of [v18.api, v19.api]) {
    assert.equal(toCurl({ origin: 'https://x.com', route: '/web/action/load', body: '{"params":{"action_id":5}}', api }).text,
      "curl 'https://x.com/web/action/load' \\\n  -H 'Content-Type: application/json' \\\n  -b \"session_id=$ODOO_SESSION\" \\\n  --data-raw '{\"params\":{\"action_id\":5}}'");
  }
});

test('Copy as cURL on Odoo 19: call_kw → /json/2, every argument named (documentation/19.0 external_api)', () => {
  const write = kw('res.partner', 'write', [[7], { name: 'Deco' }], { context: { lang: 'en_US' } });
  const sig = v19.api.kind === 'json2' ? v19.api.signatures : {};
  assert.deepEqual(toCurl({ origin: 'https://x.com', route: '/web/dataset/call_kw/res.partner/write', body: write, db: 'prod', api: v19.api, signature: sig.write }), {
    text: "curl 'https://x.com/json/2/res.partner/write' \\\n  -X POST \\\n  --oauth2-bearer \"$ODOO_API_KEY\" \\\n  -H 'X-Odoo-Database: prod' \\\n  -H 'Content-Type: application/json' \\\n" +
      `  -d '{"ids":[7],"context":{"lang":"en_US"},"vals":{"name":"Deco"}}'`,
    warnings: [],
  });
  // @api.model: no ids (the server answers 422 to ids on an @api.model method)
  const sr = kw('res.partner', 'search_read', [[['is_company', '=', true]], ['name']], { limit: 5 });
  assert.match(toCurl({ origin: 'https://x.com', route: '/web/dataset/call_kw/res.partner/search_read', body: sr, api: v19.api, signature: sig.search_read }).text,
    /-d '\{"domain":\[\["is_company","=",true\]\],"fields":\["name"\],"limit":5\}'$/);
  // unknown method with a positional argument: guessed ids, the argument kept under a placeholder, warnings in the command
  const odd = toCurl({ origin: 'https://x.com', route: '/web/dataset/call_button/sale.order/action_x', body: kw('sale.order', 'action_x', [[3], 'now']), api: v19.api, signature: null });
  assert.equal(odd.warnings.length, 2);
  assert.match(odd.text, /^# ⚠ Signature of sale\.order\.action_x unknown/);
  assert.match(odd.text, /-d '\{"ids":\[3\],"__arg1__":"now"\}'$/);
  // a JSON-2 call replays as it is
  assert.match(toCurl({ origin: 'https://x.com', route: '/json/2/res.partner/read', body: '{"ids":[1],"fields":["name"]}', api: v19.api }).text,
    /^curl 'https:\/\/x\.com\/json\/2\/res\.partner\/read' \\\n {2}-X POST \\\n {2}--oauth2-bearer "\$ODOO_API_KEY"/);
});

test('JSON-2 bodies: ids, context, then named arguments; keyword arguments as they are', () => {
  assert.deepEqual(json2Body([[1, 2], ['name']], { load: null }, { params: ['fields', 'load'], model: false }),
    { body: { ids: [1, 2], fields: ['name'], load: null }, unnamed: [] });
  assert.deepEqual(json2Body([], { name: 'x' }, { params: ['name'], model: true }), { body: { name: 'x' }, unnamed: [] });
  assert.deepEqual(json2Body([[5]], {}, null), { body: { ids: [5] }, unnamed: [] }); // unknown: a list of ints is the ids
  assert.deepEqual(json2Body(['abc'], {}, null), { body: { __arg1__: 'abc' }, unnamed: [1] }); // …anything else is not
});

test('the call a request targets (to look its signature up)', async () => {
  const { callTarget } = await import('../../../../src/features/rpc/rpc.logic.ts');
  assert.deepEqual(callTarget('/web/dataset/call_kw/res.partner/write', kw('res.partner', 'write', [[1], {}])), { model: 'res.partner', method: 'write' });
  assert.equal(callTarget('/web/action/load', '{"params":{"action_id":5}}'), null);
  assert.equal(callTarget('/web/dataset/call_kw/x/y', '{"cut'), null);
});

test('bodies and answers cut by the recorder are flagged', () => {
  const big = 'x'.repeat(200_000);
  const e = parseRpc({ ...raw('https://x.com/web/dataset/call_kw/res.partner/web_search_read', big, 'POST', 200, `{"jsonrpc":"2.0","result":{"records":[${'1,'.repeat(100_000)}`), body: big })!;
  assert.equal(e.bodyCut, true);
  assert.equal(e.answerCut, true);
  assert.equal(typeof e.result, 'string');
  const ok = parseRpc(raw('https://x.com/web/dataset/call_kw/res.partner/read', { jsonrpc: '2.0', params: { model: 'res.partner', method: 'read', args: [[1]] } }))!;
  assert.deepEqual([ok.bodyCut, ok.answerCut], [false, false]);
});
