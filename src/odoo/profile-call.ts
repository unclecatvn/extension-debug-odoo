// The RPC tab hands a call it recorded to the Perf tab ("Profile"), which takes it when it renders: sent again with the
// profiler on, its profile opened.

/** A call to send again: the route and the JSON body as the page sent them, its label (method · model). */
export interface CallToProfile { route: string; body: string; label: string }

let pending: CallToProfile | null = null;
export const reportCallToProfile = (c: CallToProfile) => { pending = c; };
export const takeCallToProfile = (): CallToProfile | null => { const c = pending; pending = null; return c; };
