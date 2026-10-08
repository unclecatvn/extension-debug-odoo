import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { RawRpc } from '../../../../src/contracts/messages.ts';

const source = stripTypeScriptTypes(readFileSync(new URL('../../../../src/entrypoints/rpc-recorder/index.ts', import.meta.url), 'utf8'));
const body = '{"jsonrpc":"2.0","params":{"model":"res.partner","method":"read","args":[[1]]}}';
const deferred = <T>() => { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture(fetcher: typeof fetch = async () => new Response('{}')) {
  class XHR extends EventTarget {
    status = 0;
    responseText = '';
    responseType = '';
    throws = false;
    open(_method: string, _url: string) {}
    send(_body: string) { if (this.throws) throw new Error('send failed'); }
    end(type = 'load', text = '{"jsonrpc":"2.0","result":true}', status = 200) {
      this.status = status;
      this.responseText = text;
      this.dispatchEvent(new Event(type));
      this.dispatchEvent(new Event('loadend'));
    }
  }
  const document = new EventTarget();
  const events: RawRpc[] = [];
  document.addEventListener('odoo-debug-rpc', (e) => events.push(JSON.parse((e as CustomEvent<string>).detail)));
  let now = 0;
  const window = { odoo: { csrf_token: 'token', debug: '' }, fetch: fetcher, __odooDebugHook: undefined as undefined | { buf: RawRpc[]; fetch: typeof fetch } };
  const context = { window, document, XMLHttpRequest: XHR, CustomEvent, Request, URL, location: { href: 'https://example.test/web' }, performance: { now: () => now, timeOrigin: 12345 }, Date, Math };
  runInNewContext(source, context);
  return { XHR, window, events, document, source, context, tick: (ms: number) => { now += ms; }, buf: window.__odooDebugHook!.buf };
}

for (const type of ['load', 'error', 'timeout', 'abort']) test(`XHR ${type}: starts immediately and completes the same buffered entry`, () => {
  const f = fixture();
  const xhr = new f.XHR();
  xhr.open('POST', '/web/dataset/call_kw');
  xhr.send(body);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0]!.phase, 'pending');
  assert.equal(f.events[0]!.body, body);
  const initial = f.buf[0]!;
  f.tick(175);
  xhr.end(type, type === 'load' ? '{"jsonrpc":"2.0","result":true}' : '', type === 'load' ? 200 : 0);
  assert.equal(f.events.length, 2);
  assert.equal(f.events[1]!.phase, 'complete');
  assert.equal(f.events[1]!.id, f.events[0]!.id);
  assert.equal(f.events[1]!.ms, 175);
  assert.equal(f.events[1]!.error, type === 'load' ? undefined : `XHR ${type}`);
  assert.equal(f.buf.length, 1);
  assert.equal(f.buf[0], initial);
});

test('reusing an XHR removes prior listeners; synchronous send failures finalize and rethrow', () => {
  const f = fixture();
  const xhr = new f.XHR();
  for (let i = 0; i < 2; i++) { xhr.open('POST', '/web/dataset/call_kw'); xhr.send(body); xhr.end(); }
  assert.equal(f.events.length, 4);
  assert.notEqual(f.events[0]!.id, f.events[2]!.id);
  xhr.open('POST', '/web/dataset/call_kw');
  xhr.throws = true;
  assert.throws(() => xhr.send(body), /send failed/);
  assert.equal(f.events.at(-1)!.phase, 'complete');
  assert.match(f.events.at(-1)!.error!, /send failed/);
});

test('fetch starts before resolution and completes after response body; caller receives original response', async () => {
  const wait = deferred<Response>();
  const f = fixture(() => wait.promise);
  const request = f.window.fetch('/web/dataset/call_kw', { method: 'POST', body });
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0]!.phase, 'pending');
  const response = new Response('{"jsonrpc":"2.0","result":true}', { status: 200 });
  f.tick(400);
  wait.resolve(response);
  assert.equal(await request, response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.events.length, 2);
  assert.equal(f.events[1]!.phase, 'complete');
  assert.equal(f.events[1]!.id, f.events[0]!.id);
  assert.equal(f.events[1]!.ms, 400);
  assert.equal(f.buf.length, 1);
});

test('fetch rejection/abort finalizes then rethrows the same failure', async () => {
  const wait = deferred<Response>();
  const f = fixture(() => wait.promise);
  const request = f.window.fetch('/web/dataset/call_kw', { method: 'POST', body });
  const err = new DOMException('Aborted', 'AbortError');
  wait.reject(err);
  await assert.rejects(request, (e) => e === err);
  assert.equal(f.events.at(-1)!.phase, 'complete');
  assert.match(f.events.at(-1)!.error!, /AbortError/);
});

test('failed fetch response body capture finalizes instead of leaving the request pending', async () => {
  const f = fixture(async () => ({ status: 200, clone: () => ({ text: async () => { throw new Error('body failed'); } }) }) as unknown as Response);
  await f.window.fetch('/web/dataset/call_kw', { method: 'POST', body });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.events.at(-1)!.phase, 'complete');
  assert.match(f.events.at(-1)!.error!, /body failed/);
});

test('buffer limits cover pending calls, text size and evicted completions; IDs differ by page load', () => {
  const f = fixture();
  const calls = [];
  for (let i = 0; i < 301; i++) { const x = new f.XHR(); x.open('POST', '/web/dataset/call_kw'); x.send(body); calls.push(x); }
  assert.equal(f.buf.length, 300);
  const oldest = f.buf[0]!.id;
  calls[0]!.end();
  assert.equal(f.buf.length, 300);
  assert.equal(f.buf[0]!.id, oldest);
  const other = fixture();
  const x = new other.XHR(); x.open('POST', '/web/dataset/call_kw'); x.send(body);
  assert.notEqual(f.events[0]!.id, other.events[0]!.id);
  for (const x of calls) x.end('load', 'x'.repeat(200_100));
  assert.ok(f.buf.every((e) => e.response.length <= 200_000));
  assert.ok(f.buf.reduce((n, e) => n + e.body.length + e.response.length, 0) <= 20e6);
});

test('non-RPC requests pass through, reinjection preserves hook, and ready/field lookup hooks remain', async () => {
  const f = fixture();
  const xhr = new f.XHR(); xhr.open('GET', '/web/image'); xhr.send(''); xhr.end();
  assert.equal(f.events.length, 0);
  const hook = f.window.__odooDebugHook;
  runInNewContext(source, f.context);
  assert.equal(f.window.__odooDebugHook, hook);
  let ready = false;
  f.document.addEventListener('odoo-debug-ready', () => { ready = true; });
  f.document.dispatchEvent(new Event('DOMContentLoaded'));
  assert.equal(ready, true);
  const fields = new Promise<string>((resolve) => f.document.addEventListener('odoo-debug-field-names', (e) => resolve((e as CustomEvent<string>).detail)));
  f.document.dispatchEvent(new CustomEvent('odoo-debug-field-of', { detail: 'Name' }));
  assert.equal(await fields, '[]');
});

test('response clone failure preserves the fetch response and records capture failure', async () => {
  const response = { status: 200, clone: () => { throw new Error('clone failed'); } } as unknown as Response;
  const f = fixture(async () => response);
  assert.equal(await f.window.fetch('/web/dataset/call_kw', { method: 'POST', body }), response);
  assert.equal(f.events.at(-1)!.phase, 'complete');
  assert.match(f.events.at(-1)!.error!, /clone failed/);
});

test('unminified recorder stays within the every-page 4096-byte budget', async () => {
  const { build } = await import('esbuild');
  const result = await build({ entryPoints: ['src/entrypoints/rpc-recorder/index.ts'], bundle: true,
    target: 'chrome120', platform: 'browser', format: 'iife', minify: false, legalComments: 'none', charset: 'utf8', write: false });
  assert.ok(result.outputFiles[0]!.contents.length <= 4096, `recorder: ${result.outputFiles[0]!.contents.length} bytes`);
});
