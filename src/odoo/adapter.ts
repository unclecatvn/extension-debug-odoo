// Every difference between Odoo versions the panel depends on, in one contract. Features never test a version number
// or probe a field themselves: they ask the adapter of the Odoo they are on (odoo/detect.ts → odoo()). Adding a version
// = one new adapters/v<major>.ts implementing this, registered in detect.ts; the compiler lists what it must answer.

import type { SupportedMajor } from './version.ts';

/** A field the adapter relies on: checked against the database once per page load (detect.ts → selfCheck). */
export interface ExpectedField {
  model: string;
  field: string;
  /** what breaks without it, shown in the header when the check fails */
  usedBy: string;
}

/** A method's parameters, in order, and whether it is @api.model (called without ids). */
export interface MethodSignature {
  readonly params: readonly string[];
  readonly model: boolean;
}

/**
 * jsonrpc: /jsonrpc, object service, execute_kw(db, uid, API key, model, method, args, kwargs): the call_kw arguments
 *          fit as they are (positional + keyword).
 * json2:   /json/2/<model>/<method>, `Authorization: bearer <API key>`, a JSON object of NAMED arguments plus ids and
 *          context: positional arguments must be named, from /doc/<model>.json (api_doc) when the user may read it,
 *          else from `signatures` (the common ORM methods).
 */
export type ExternalApi =
  | { readonly kind: 'jsonrpc' }
  | { readonly kind: 'json2'; readonly signatures: Readonly<Record<string, MethodSignature>> };

export interface OdooAdapter {
  readonly major: SupportedMajor;

  readonly users: {
    /** res.users field: every group the user has, implied included (read) */
    readonly allGroupsField: string;
    /** res.users field: the groups set on the user, to add (4) / remove (3) one (write) */
    readonly writeGroupsField: string;
  };

  readonly groups: {
    /** res.groups field: every group it implies, transitively */
    readonly impliedField: string;
    /** whether impliedField lists the group itself too */
    readonly impliedIncludesSelf: boolean;
    /** res.groups many2one: the application a group belongs to, the prefix of its full_name ("Sales / User") */
    readonly appField: string;
    /** res.groups many2many: every user in the group, through an implying group too */
    readonly usersField: string;
  };

  /**
   * Where access rights live.
   * split:   ir.model.access (ACLs: a group, or none = every user, and four perm_* booleans) and ir.rule (record rules:
   *          global ones AND-ed, group ones OR-ed).
   * unified: ir.access (20): one row per group (a permission) or without one (a restriction), `operation` the letters of
   *          'crud', `domain` the records it covers. The permissions of the user's groups are OR-ed (no domain: every
   *          record), the restrictions AND-ed (models.py → _access_domain). Read as the split model: a permission is an ACL
   *          and a group rule, a restriction a global rule (odoo/access.ts).
   */
  readonly access: 'split' | 'unified';

  readonly rules: {
    /** the rules of an _inherits parent are skipped when its link field is not stored (19: ir.rule._compute_domain) */
    readonly inheritsStoredOnly: boolean;
    /** a model or a parent whose _inherits parents are not checked at all (`_check_inherits_access = False`, not readable
     * over RPC): models by name, and parents every model inheriting them skips */
    readonly inheritsUnchecked: { readonly models: readonly string[]; readonly parents: readonly string[] };
    /** no group rule of the user's (a permission, in 20) refuses the records, instead of not restricting them */
    readonly groupRulesRequired: boolean;
    /** the names the server gives a rule's domain (ir.rule / ir.access._eval_context; the webclient's py_js knows more:
     * `time` always) */
    readonly evalNames: readonly string[];
  };

  readonly i18n: {
    /** GET route of the webclient's code translations, per module: { modules: { <module>: { messages: [{ id, string }] } } }
     * (?lang=, every installed module); `{unique}` stands for any string */
    readonly webTranslationsPath: string;
  };

  readonly profiler: {
    /** ir.profile fields read for the list of profiled requests */
    readonly listFields: readonly string[];
    /** /web/speedscope/<…>: several profiles at once (ids joined by commas) */
    readonly speedscopeMany: boolean;
    /** /web/speedscope answers 404 once profiling is no longer enabled on the database */
    readonly speedscopeNeedsEnabled: boolean;
    /** the ir.config_parameter method reading a string parameter (base.profiling_enabled_until) */
    readonly paramGetter: 'get_param' | 'get_str';
  };

  readonly modules: {
    /** base.module.uninstall, the preview Odoo shows before an uninstall: the field taking the module (18: a many2one,
     * one module; 19+: a many2many), the ones listing together every module removed with it (itself included; 20 lists
     * the applications apart), and whether `show_all` must be set for applications to be listed (gone in 20) */
    readonly uninstallWizard: { readonly moduleField: string; readonly many: boolean; readonly impactedFields: readonly string[]; readonly showAll: boolean };
    /** Odoo refuses an install / upgrade / uninstall while modules wait for one (to install / upgrade / remove);
     * false: it runs the waiting ones along with it */
    readonly refusesWhilePending: boolean;
  };

  /** The external API a call of the page is replayed with (RPC tab → Copy as cURL). */
  readonly api: ExternalApi;

  readonly orm: {
    /** methods that only read: allowed by the Code tab in read-only mode */
    readonly readMethods: readonly string[];
    /** @api.model methods: called without ids */
    readonly modelMethods: readonly string[];
    /** how rows are grouped and counted: read_group(domain, fields, groupby, orderby=, lazy=) answering dicts, or
     * formatted_read_group(domain, groupby, aggregates, order=) (20: read_group answers tuples) */
    readonly groupMethod: 'read_group' | 'formatted_read_group';
    /** how read() gives a binary field without its content: context bin_size (its size as text), or load='web'
     * ({ size, filename?, checksum }; 20 has no bin_size) */
    readonly binaryRead: 'bin_size' | 'web';
  };

  /** the fields above, verified on the live database */
  readonly expects: readonly ExpectedField[];
}
