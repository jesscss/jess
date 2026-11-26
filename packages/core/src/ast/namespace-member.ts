/**
 * Module namespaces at a member read: how a read tells a namespace binding from
 * a variable or property of the same name (ledger R17, R18), and the coded
 * diagnostics it raises when it cannot (R7), and the diagnostic for a reference
 * that reads nothing. The reader is the serializer's
 * reference resolution; this module holds the decisions so the resolver only
 * calls them.
 *
 * HARD MODULE BOUNDARY: types from the serializer, values from the AST and the
 * error layer only.
 */
import type { Context } from '../context.js';
import { ERR } from '../error/diagnostics.js';
import { callSiteLocation } from './call-site-location.js';
import { isQuote, stringEnd } from './css-syntax.js';
import { isValueSlotArray } from './css-grammar-helpers.js';
import { declarationReference, funcCall, lookupStep, reference, referenceCall } from './nodes.js';
import type { CallArg, CallValue, FunctionCall, Reference, ValueSlot } from './nodes.js';
import { NO_SPAN, sourceEndOf, sourceStartOf, withSourceSpan } from './provenance.js';
import type { Frame } from './serialize.js';

/** What these decisions read from the render session. */
export interface NamespaceSession {
  /** Each module namespace binding (`@use … as ns`, `@-compose … as ns`) → the import that bound it. */
  namespaceImports: WeakMap<object, object> | undefined;
  readonly context: Context | undefined;

  /** The last lookup step that read nothing, noted where the resolver returns no value (see {@link stepMissed}). */
  missedStep: StepMiss | undefined;
}

/** A reference's lookup step that read nothing; `key` is the key it evaluated to (`[@k]`), when it was not written literally. */
export interface StepMiss {
  readonly node: Reference;
  readonly step: number;
  readonly key: string | undefined;
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

/**
 * A member read that found nothing: {@link hiddenNamespace} when it applies,
 * else {@link keyNotFound} at the read, or `symbol` when its key cannot be
 * read from the written chain.
 */
export function memberNotFound<L extends NamespaceLane>(read: MemberRead<L>, stepIndex: number, key: string | undefined, symbol: string, e: L): never {
  hiddenNamespace(read, stepIndex, e);
  keyNotFound(read.node, { node: read.node, step: stepIndex, key }, symbol, e);
}

/**
 * Notes that `node`'s lookup `step` read nothing, so its error can name the key.
 * The resolver returns this `null` wherever such a read ends; a later read that
 * misses overwrites it, and {@link chainNotFound} reads it only for its own node.
 */
export function stepMissed(s: NamespaceSession, node: Reference, step: number, key?: string): null {
  s.missedStep = { node, step, key };
  return null;
}

/** A member read on a value with no members to read: {@link hiddenNamespace} when it applies, else the noted miss. */
export function receiverMissed<L extends NamespaceLane>(read: MemberRead<L>, stepIndex: number, e: L): null {
  hiddenNamespace(read, stepIndex, e);
  return stepMissed(e.s, read.node, stepIndex);
}

/**
 * A reference that read nothing, as `resolve/name-not-found`: an unbound
 * variable or property `head` is named as written (`@nope`, `$^nope`); a
 * lookup step that missed names its key and what it was read in
 * ({@link keyNotFound}); any other reference is named whole.
 */
export function chainNotFound(at: object, node: Reference, head: string | undefined, bound: boolean, e: NamespaceLane): never {
  if (head !== undefined && !bound) {
    throw ERR.nameNotFound({ node: at, ...callSiteLocation(at, e.s), meta: { symbol: node.raw.slice(0, node.raw.indexOf(head) + head.length) } });
  }
  const missed = e.s.missedStep;
  if (missed?.node === node) {
    keyNotFound(at, missed, node.raw, e);
  }
  throw ERR.nameNotFound({ node: at, ...callSiteLocation(at, e.s), meta: { symbol: node.raw } });
}

/**
 * A lookup step read nothing: `"b" is undefined in "@map[a]"`. The brackets or
 * dot are the lookup, so the key is what they hold as written, or the key it
 * evaluated to (`[@k]` with `@k: b` → `b`). A chain whose steps its written
 * text does not show is named by `fallback`.
 */
function keyNotFound(at: object, { node, step, key }: StepMiss, fallback: string, e: NamespaceLane): never {
  const starts = segmentStarts(node.raw);
  let shown = node.steps.length;
  while (shown > step + 1 && node.steps[shown - 1]?.type === 'Call' && !node.raw.endsWith(')')) {
    shown--;
  }
  const first = starts.length - shown;
  const start = starts[first + step];
  if (first < 0 || !start) {
    throw ERR.nameNotFound({ node: at, ...callSiteLocation(at, e.s), meta: { symbol: key ?? fallback } });
  }
  const written = node.raw.slice(start, starts[first + step + 1] ?? node.raw.length);
  throw ERR.nameNotFound({
    node: at,
    ...callSiteLocation(at, e.s),
    meta: { symbol: key ?? (written.charCodeAt(0) === 91 ? written.slice(1, -1).trim() : written.slice(1)), in: node.raw.slice(0, start) }
  });
}

/**
 * Where each segment of an authored chain starts: the head at 0, then each `[`,
 * `(` or `.` outside brackets, quotes and escapes. Its last segments are the
 * reference's steps.
 * ponytail: steps carry no source text, so the message splits `raw`; when the
 * parser records a span per step, read that instead.
 */
function segmentStarts(raw: string): number[] {
  const starts = [0];
  let depth = 0;
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\') {
      i++;
    } else if (isQuote(c)) {
      i = stringEnd(raw, i);
    } else if (c === '[' || c === '(') {
      if (depth++ === 0) {
        starts.push(i);
      }
    } else if (c === ']' || c === ')') {
      depth--;
    } else if (c === '.' && depth === 0) {
      starts.push(i);
    }
  }
  return starts;
}

/** Whether a call is spelled `ns.fn(…)`, which only `.scss` parses as one name. An escaped dot is part of an identifier. */
export function isNamespaceCall(name: string): boolean {
  const dot = name.indexOf('.');
  return dot > 0 && name.charCodeAt(dot - 1) !== 92;
}

/**
 * The call a module member reference makes. It carries the reference's span (its
 * head's, where only the head has one), so a failure is named where the call was
 * written.
 */
export function moduleReferenceCallNode(node: Reference, name: string, args: CallArg<ValueSlot>[]): FunctionCall {
  const call = funcCall(name, args);
  const written = sourceStartOf(node) === NO_SPAN && !isValueSlotArray(node.base) ? node.base : node;
  call._s = sourceStartOf(written);
  call._e = sourceEndOf(written);
  return call;
}

/**
 * A `.scss` call `ns.fn(…)` that no imported function answers, as a read of the
 * member `fn` of the module `ns`: the chain `ns.$var` is built as. So a
 * stylesheet's `@function` is invoked, and a member or a namespace that does not
 * exist is `resolve/name-not-found`.
 */
export function namespaceMemberCall(node: FunctionCall): Reference {
  const { name } = node;
  const dot = name.indexOf('.');
  const span = { start: sourceStartOf(node), end: sourceEndOf(node) };
  return withSourceSpan(reference(
    withSourceSpan(declarationReference('$'), span),
    [lookupStep('member', name.slice(0, dot)), lookupStep('member', name.slice(dot + 1)), referenceCall(node.args)],
    name
  ), span);
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
