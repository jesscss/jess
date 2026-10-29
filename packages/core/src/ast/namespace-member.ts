/**
 * Module namespaces at a member read: how a read tells a namespace binding from
 * a variable or property of the same name (ledger R17, R18), and the coded
 * diagnostics it raises when it cannot (R7). The reader is the serializer's
 * reference resolution; this module holds the decisions so the resolver only
 * calls them.
 *
 * HARD MODULE BOUNDARY: types from the serializer, values from the AST and the
 * error layer only.
 */
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import type { CallValue, Reference } from './nodes.js';
import { NO_SPAN, sourceStartOf } from './provenance.js';
import type { Frame } from './serialize.js';
import { isCollection } from './value-collection.js';
import type { ValueGroup } from './value-eval.js';

/** What these decisions read from the render session. */
export interface NamespaceSession {
  /** Each module namespace binding (`@use … as ns`, `@-compose … as ns`) → the import that bound it. */
  namespaceImports: WeakMap<object, object> | undefined;
  readonly snapshotValues: WeakMap<CallValue, ValueGroup> | undefined;
  readonly context: Context | undefined;
}

/** The serializer's variable read (`resolveVarRef`). */
export type VarLookup<L> = (frame: Frame | null, name: string, lookup: 'live' | 'scoped', e: L) => { value: CallValue; frame: Frame } | undefined;

/** A lane, as far as these decisions use one. */
export interface NamespaceLane {
  readonly s: NamespaceSession;
}

/** A reference read that failed: the reference, the frame it was read in, the variable read, and whether it was optional. */
export interface MemberRead<L> {
  readonly node: Reference;
  readonly frame: Frame | null;
  readonly lookup: VarLookup<L>;
  readonly optional: boolean;
}

/** Record `binding` as the namespace `site` (the import) bound. */
export function recordNamespace(s: NamespaceSession, binding: object, site: object): void {
  (s.namespaceImports ??= new WeakMap()).set(binding, site);
}

/**
 * [R17] Whether a `$` head's first member read beside a same-named property
 * reads the namespace: a namespace is bound only at the root, where no property
 * can be declared, so the two are never candidates for one name (owner
 * 2026-10-28). A bare `$.color` reads no member of a module and stays R7's
 * ambiguity.
 */
export function readsNamespaceMember(node: Reference, binding: CallValue, s: NamespaceSession): boolean {
  return node.steps.length >= 2 && s.namespaceImports?.has(binding) === true;
}

/** [R7] Two candidates for one member name in one surface: a coded diagnostic at the read. */
export function ambiguousMember(node: object, symbol: string, s: NamespaceSession): never {
  throw ERR.ambiguousMember({ node, ...callSiteLocation(node, s), meta: { symbol } });
}

/**
 * A head's value as a member read takes it. An argument bound by eager snapshot
 * (a `@function` or `@mixin` parameter) is opaque bytes with its typed value
 * carried beside it; when that value is a map, the read takes the map, as a
 * read of the variable it came from would.
 */
export function carriedMap(s: NamespaceSession, value: CallValue, evaluated: ValueGroup | null): ValueGroup | null {
  if (evaluated !== null || isValueSlotArray(value) || value.type !== 'Any') {
    return evaluated;
  }
  const carried = s.snapshotValues?.get(value);
  return carried !== undefined && isCollection(carried) ? carried : null;
}

/**
 * [R18] The member read at `stepIndex` failed. When it is a dot member read
 * (`math.$pi`, `$ns.name`, `@ns.name`) right after a head that is a variable,
 * not a namespace, and that variable hides a namespace of the same name in an
 * outer scope, report that, naming both, at the read (owner 2026-10-29). A call
 * through the head (`$ns.fn()`) and a bracket key (`$m[k]`, which
 * `map.get($m, k)` lowers to) are not member reads. Resolution is unchanged:
 * the variable is what was read. Returns `null`, the failed read, otherwise.
 */
export function hiddenNamespace<L extends NamespaceLane>(read: MemberRead<L>, stepIndex: number, e: L): null {
  const { node } = read;
  const base = node.base;
  const imports = e.s.namespaceImports;
  if (read.optional || imports === undefined || isValueSlotArray(base) || base.type !== 'Lookup') {
    return null;
  }
  const head = base.kind === 'var' && stepIndex === 0 ? base : base.kind === 'entry' && stepIndex === 1 ? node.steps[0] : undefined;
  const member = node.steps[stepIndex];
  if (head?.type === 'Call' || typeof head?.name !== 'string' || member?.type !== 'LookupStep' || typeof member.name !== 'string'
    || node.steps[stepIndex + 1]?.type === 'Call') {
    return null;
  }
  const local = read.lookup(read.frame, head.name, head.type === 'Lookup' ? head.scope : 'scoped', e);
  const outer = local === undefined || imports.has(local.value) || !local.frame.parent
    ? undefined
    : read.lookup(local.frame.parent, head.name, 'scoped', e);
  const site = outer === undefined ? undefined : imports.get(outer.value);
  if (site === undefined) {
    return null;
  }
  const bound = callSiteLocation(site, e.s);
  const at = sourceStartOf(node) === NO_SPAN ? base : node;
  throw ERR.namespaceShadowed({
    node: at,
    ...callSiteLocation(at, e.s),
    meta: {
      local: head.type === 'Lookup' ? head.raw : `$${head.name}`,
      name: head.name,
      at: bound.line === undefined ? 'the root' : `${bound.line}:${bound.column}`
    }
  });
}

/** A member read that found nothing: {@link hiddenNamespace} when it applies, else `resolve/name-not-found` at the read. */
export function memberNotFound<L extends NamespaceLane>(read: MemberRead<L>, stepIndex: number, symbol: string, e: L): never {
  hiddenNamespace(read, stepIndex, e);
  throw ERR.nameNotFound({ node: read.node, ...callSiteLocation(read.node, e.s), meta: { symbol } });
}

/* A usable module namespace identifier (the same ident shape the grammars use). */
const MODULE_NAMESPACE_IDENT = /^-?[_a-zA-Z\u0080-\uFFFF][-_a-zA-Z0-9\u0080-\uFFFF]*$/;

/**
 * The auto-derived `@compose`/`@use` namespace: Sass's default-namespace rule
 * applied to the SPECIFIER STRING the author wrote (never the plugin-resolved
 * path). Take the last `/`-segment, strip a trailing file extension, strip a
 * leading `_` partial marker or `#` package-import marker. `./foo.less` → `foo`,
 * `#sass/map` → `map`, `#less` → `less`, `@co/design-tokens` → `design-tokens`,
 * `./_theme.scss` → `theme`. Returns
 * `null` when the result is not a usable identifier — the author must then
 * spell an explicit `as <name>`.
 */
export function deriveModuleNamespace(specifier: string): string | null {
  /* Last `/`-segment, then strip a trailing `.ext` (only when a name precedes the
     dot) and a leading `_` or `#` marker. Regex-based, as it was in `serialize.ts`, whose
     diagnostic cold-path guard bans `lastIndexOf`. */
  const segment = /[^/]*$/.exec(specifier)?.[0] ?? specifier;
  const withoutExt = segment.replace(/^(.+)\.[^.]+$/, '$1');
  const base = withoutExt.startsWith('_') || withoutExt.startsWith('#') ? withoutExt.slice(1) : withoutExt;
  return MODULE_NAMESPACE_IDENT.test(base) ? base : null;
}
