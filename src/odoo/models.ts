// Odoo records as read over RPC, shared by several features. A field that differs between versions is optional here;
// which one the database has is the adapter's answer (odoo/adapter.ts), never a test in the feature.

import type { Json } from '../contracts/json.ts';

export const MODES = ['read', 'write', 'create', 'unlink'] as const;
export type Mode = (typeof MODES)[number];

/** many2one value as read with load: '_classic_read' (the default): [id, display_name], or false. */
export type Many2one = [number, string] | false;

/** /web/session/get_session_info, the keys the panel uses. */
export interface SessionInfo {
  uid: number;
  name: string;
  username: string;
  db: string;
  server_version: string;
  /** e.g. [18, 0, 0, 'final', 0, ''] or ['saas~18', 2, 0, 'final', 0, ''] */
  server_version_info: (number | string)[];
  is_admin: boolean;
  is_system: boolean;
  user_context: Record<string, Json>;
  user_companies?: Json;
  profile_session?: string | null;
  test_mode?: boolean;
  'web.base.url'?: string;
}

/** fields_get with the attributes bridge.fieldsOf() asks for. */
export interface FieldInfo {
  string: string;
  type: string;
  relation?: string;
  store?: boolean;
  depends?: string[];
  related?: string | string[];
  readonly?: boolean;
  required?: boolean;
  groups?: string;
  /** selection fields: [value, label] pairs (in the user's language) */
  selection?: [string | number, string][];
}
export type FieldsGet = Record<string, FieldInfo>;

/** ir.model.fields, the columns fields_get doesn't give. */
export interface IrModelField {
  id: number;
  name: string;
  /** installed modules defining or extending the field, comma-separated */
  modules: string | false;
  index: boolean;
}

export interface IrModelAccess {
  id: number;
  name: string;
  group_id: Many2one;
  perm_read: boolean;
  perm_write: boolean;
  perm_create: boolean;
  perm_unlink: boolean;
}

export interface IrRule {
  id: number;
  name: string;
  groups: number[];
  domain_force: string | false;
  global: boolean;
  perm_read: boolean;
  perm_write: boolean;
  perm_create: boolean;
  perm_unlink: boolean;
}

export interface IrModule {
  id: number;
  name: string;
  shortdesc: string;
  latest_version: string | false;
  author: string | false;
}

/** ir.ui.view, the columns the View tab reads to rebuild an inheritance tree (same in 18.0 and 19.0). */
export interface IrUiView {
  id: number;
  name: string;
  xml_id: string | false;
  inherit_id: Many2one;
  mode: 'primary' | 'extension';
  priority: number;
  active: boolean;
  arch_fs: string | false;
}
