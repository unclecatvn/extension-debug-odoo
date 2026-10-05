import assert from 'node:assert/strict';
import { cached, clearCache } from '../../../src/extension/page-cache.ts';

let n = 0;
const fail = () => { n++; return Promise.reject(new Error('x')); };
await assert.rejects(cached('k', fail));
await assert.rejects(cached('k', fail));
assert.equal(n, 2); // failures are not kept

const one = cached('ok', async () => 1);
assert.equal(cached('ok', async () => 2), one);
clearCache();
assert.equal(await cached('ok', async () => 3), 3);

// an old promise failing after clearCache() must not evict the newer entry
let reject: (e: Error) => void = () => {};
const old = cached('r', () => new Promise<never>((_, r) => { reject = r; }));
clearCache();
const fresh = cached('r', async () => 'new');
reject(new Error('old'));
await assert.rejects(old);
assert.equal(cached('r', async () => 'other'), fresh);
