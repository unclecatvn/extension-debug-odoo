import assert from 'node:assert/strict';
import { RpcError, isAccessError } from '../../../src/odoo/rpc.ts';

// AccessError detection: on the exception class the server reports, not on the message
assert.equal(isAccessError(new RpcError('no', 'TB', 'odoo.exceptions.AccessError')), true);
assert.equal(isAccessError(new RpcError('AccessError in the text', 'TB', 'odoo.exceptions.UserError')), false);
assert.equal(isAccessError(new Error('odoo.exceptions.AccessError')), false);
