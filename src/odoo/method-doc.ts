// A method's parameter names, for the JSON-2 API that only takes named arguments (odoo/adapter.ts → ExternalApi).
// Odoo 19's api_doc module describes every public method at /doc/<model>.json (auth user, api_doc.group_allow_doc,
// implied by Settings): read once per model and page load; without it, the adapter's table of common ORM methods.
import { cached } from '../extension/page-cache.ts';
import { exec, isExecError } from '../extension/run-in-tab.ts';
import { pageFetch } from '../injected/json-rpc.ts';
import type { MethodSignature, OdooAdapter } from './adapter.ts';

/** /doc/<model>.json → methods[name] (api_doc/controllers/api_doc.py → _doc_method), the keys this reads. */
interface DocMethod {
  parameters?: Record<string, { kind?: string }>;
  api?: string[];
}

/** The parameters that can be given by position, in order (parameters keep the signature's order; kind absent means
 * POSITIONAL_OR_KEYWORD). Pure: tested by tests/unit/odoo/method-doc.test.ts. */
export function parseMethodDoc(doc: unknown, method: string): MethodSignature | null {
  const m = (doc as { methods?: Record<string, DocMethod> } | null)?.methods?.[method];
  if (!m?.parameters) return null;
  const params = Object.entries(m.parameters)
    .filter(([, p]) => !p.kind || p.kind === 'POSITIONAL_OR_KEYWORD' || p.kind === 'POSITIONAL_ONLY')
    .map(([name]) => name);
  return { params, model: !!m.api?.includes('model') };
}

/** model.method's signature: from the database's own documentation, else the adapter's table, else unknown (null). */
export async function methodSignature(adapter: OdooAdapter, model: string, method: string): Promise<MethodSignature | null> {
  if (adapter.api.kind !== 'json2') return null;
  const doc = await cached(`doc ${model}`, async () => {
    const r = await exec(pageFetch, `/doc/${encodeURIComponent(model)}.json`);
    if (!r || isExecError(r) || !('status' in r) || r.status !== 200) return null; // no api_doc, or not allowed
    try { return JSON.parse(r.text) as unknown; } catch { return null; }
  });
  return parseMethodDoc(doc, method) ?? adapter.api.signatures[method] ?? null;
}
