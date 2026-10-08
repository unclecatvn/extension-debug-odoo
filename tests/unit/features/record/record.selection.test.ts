import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { pageRecordSelection } from '../../../../src/injected/record-selection.ts';

function selection(nodes: unknown[], overrides: Record<string, unknown> = {}) {
  const props = { resModel: 'res.partner', ...overrides.props as object };
  const controller = { props, view: { type: 'list' }, ...overrides };
  const root = { env: { services: { action: { currentController: controller } } }, __owl__: { children: nodes } };
  return JSON.parse(JSON.stringify(runInNewContext(`(${pageRecordSelection.toString()})()`, {
    window: { odoo: { __WOWL_DEBUG__: { root } } }, location: { origin: 'https://fixture.test', href: 'https://fixture.test/odoo', pathname: '/odoo' }, performance: { timeOrigin: 1 },
  })));
}
const list = (ids: unknown[], model = 'res.partner', all = false) => ({ component: { model: { root: { resModel: model, selection: ids.map((resId) => ({ resId })), isDomainSelected: all } } } });

test('selection reader is self-contained and preserves every selected ID for validation', () => {
  assert.deepEqual(selection([list([1, 2, 2, 3, 4, 5, 6, 'new_1'])]).ids, [1, 2, 2, 3, 4, 5, 6, 'new_1']);
  assert.equal(selection([list([1, 2])]).selectionAvailable, true);
  assert.equal(selection([list([1, 2], 'res.partner', true)]).domainSelected, true);
});

test('selection ignores other models and refuses ambiguous same-model controller roots', () => {
  assert.deepEqual(selection([list([99], 'res.users'), list([1, 2])]).ids, [1, 2]);
  assert.equal(selection([list([1, 2]), list([3, 4])]).selectionAvailable, false);
  assert.deepEqual(selection([]).ids, []);
});

test('form identity follows currentState rather than stale props; no x2many selection', () => {
  const result = selection([list([1, 2])], { view: { type: 'form' }, props: { resModel: 'res.partner', resId: 8 }, currentState: { resId: 9 } });
  assert.equal(result.resId, 9);
  assert.equal(result.selectionAvailable, false);
  assert.deepEqual(result.ids, []);
});
