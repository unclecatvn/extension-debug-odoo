// Reads that only change on a page load (session, fields, installed modules): kept until the next one, or ⟳, and
// shared by every tab. Pure: tested by page-cache.test.ts.

const cache = new Map<string, Promise<unknown>>();

export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    const p = fn();
    p.catch(() => { if (cache.get(key) === p) cache.delete(key); }); // a failure is retried on the next render
    cache.set(key, p);
  }
  return cache.get(key) as Promise<T>;
}
export const uncache = (key: string) => cache.delete(key);
export const clearCache = () => cache.clear();
