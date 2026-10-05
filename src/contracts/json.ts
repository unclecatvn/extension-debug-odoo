// Contract shared by every context: what crosses a boundary as JSON (page function arguments and results through
// chrome.scripting, JSON-RPC params). Pure: no DOM, no chrome.* (tsconfig.contracts.json).

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined };
