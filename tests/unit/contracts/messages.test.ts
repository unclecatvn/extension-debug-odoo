import assert from 'node:assert/strict';
import { isExtMessage } from '../../../src/contracts/messages.ts';

assert.equal(isExtMessage({ type: 'odoo-rpc', raw: '{}' }), true);
assert.equal(isExtMessage({ type: 'odoo-toggle' }), true);
assert.equal(isExtMessage({ type: 'something-else' }), false); // another extension's message
assert.equal(isExtMessage(null), false);
assert.equal(isExtMessage('odoo-rpc'), false);
