import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forgetRun, history, last, selectScope } from '../../../../src/features/code/code.state.ts';

test('rendering the same scope preserves output and mode; switching identity clears them even during a run', () => {
  selectScope('one');
  last.error = new Error('old');
  last.mode.js = 'write';
  last.running = true;
  last.runningScope = 'one';
  selectScope('one');
  assert.equal((last.error as Error).message, 'old');
  assert.equal(last.mode.js, 'write');
  selectScope('two');
  assert.equal(last.error, null);
  assert.equal(last.result, null);
  assert.deepEqual(last.mode, { js: 'read', python: 'dry' });
  assert.equal(last.running, true, 'a new scope must not start a concurrent run');
  assert.equal(last.runningScope, 'one');
  last.running = false;
  last.runningScope = null;
});

test('reload data forgets the live run but preserves session-only automatic history', () => {
  selectScope('one');
  history.add({ scope: 'one', code: 'return 1', lang: 'js', mode: 'read', screen: { model: null, resId: null, ids: [] },
    fmt: { origin: 'https://one.test', lang: 'en_US', tz: 'UTC' }, startedAt: 1, completedAt: 2, durationMs: 1,
    outcome: { error: new Error('failed') }, refreshed: null });
  last.error = new Error('failed');
  last.mode.js = 'write';
  forgetRun();
  assert.equal(last.error, null);
  assert.equal(last.mode.js, 'read');
  assert.equal(history.list('one').length, 1);
  history.clear('one');
});
