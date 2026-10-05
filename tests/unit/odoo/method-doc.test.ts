import assert from 'node:assert/strict';
import { parseMethodDoc } from '../../../src/odoo/method-doc.ts';

// /doc/<model>.json, as api_doc/controllers/api_doc.py → _doc_method shapes it: parameters in signature order, `kind`
// absent for POSITIONAL_OR_KEYWORD, `api` listing 'model' for @api.model
const doc = {
  methods: {
    search_read: { parameters: { domain: {}, fields: {}, offset: {}, limit: {}, order: {}, read_kwargs: { kind: 'VAR_KEYWORD' } }, api: ['model', 'readonly'] },
    write: { parameters: { vals: {} } },
    web_read_group: { parameters: { domain: {}, groupby: {}, auto_unfold: { kind: 'KEYWORD_ONLY' } }, api: ['model'] },
  },
};
assert.deepEqual(parseMethodDoc(doc, 'search_read'), { params: ['domain', 'fields', 'offset', 'limit', 'order'], model: true });
assert.deepEqual(parseMethodDoc(doc, 'write'), { params: ['vals'], model: false });
assert.deepEqual(parseMethodDoc(doc, 'web_read_group'), { params: ['domain', 'groupby'], model: true }); // keyword-only: never positional
assert.equal(parseMethodDoc(doc, 'nope'), null);
assert.equal(parseMethodDoc(null, 'write'), null); // no api_doc / not allowed
