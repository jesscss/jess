/**
 * Clean-room tree2 at-rule nodes.
 *
 * Three shapes, matching the parser's split:
 *
 *   - `AtRuleBlock`  — a block-bearing at-rule (`@media`, `@font-face`,
 *     `@keyframes`, `@page`, `@supports`, `@counter-style`, unknown block
 *     at-rules). Carries a `name` (`@media`), an optional `prelude` value node
 *     (media query / keyframes name / selector), and `rules` statements.
 *     The rules form a fresh nesting/output context: direct declarations emit
 *     inside the block, nested rulesets compose among themselves (collapse-
 *     nesting within the block), nested at-rules stay nested. v5 does NOT merge
 *     sibling `@media` blocks — each stays its own block.
 *
 *   - `AtRuleStatement` — a statement-form at-rule with no block (`@charset
 *     "utf-8";`, `@namespace svg "…";`). Carries a `name` and optional raw
 *     `prelude` BYTES (never variable-resolved — Less emits statement preludes
 *     literally, e.g. `@namespace @ns "…"` stays `@ns`).
 *
 *   - `UnknownAtRuleBlock` — a block whose header and contents must remain
 *     verbatim. Its `rawBody` is bytes, not child statements: serialization is a
 *     terminal write and never evaluates or walks it.
 *
 * The prelude of a block at-rule is a value node so `@keyframes @name` resolves
 * `@name` through scope; a statement prelude is opaque bytes for byte-faithful
 * round-trip.
 *
 * This file lives inside the tree2 boundary and imports only sibling tree2
 * modules (`node`, `nodes`) — never the legacy tree.
 */

import { NO_SPAN, type BodySpanSlots, type SpanSlots } from './provenance.js';
import type { Interpolation, Quoted, Statement, Url, ValueNode } from './nodes.js';

const importStartKey = Symbol.for('jess.ast.import-source-start');
const importEndKey = Symbol.for('jess.ast.import-source-end');
const importTailStartKey = Symbol.for('jess.ast.import-tail-start');

interface ImportSourceSlots {
  [importStartKey]?: number;
  [importEndKey]?: number;
  [importTailStartKey]?: number;
}

/** A block-bearing at-rule: `@name prelude { …body }`. */
export interface AtRuleBlock extends SpanSlots, BodySpanSlots {
  readonly type: 'AtRuleBlock';
  readonly name: string;
  readonly prelude: ValueNode | null;
  readonly rules: Statement[];
}

/**
 * A statement-form at-rule: `@name prelude;`. The prelude is a value node so a
 * `@{…}` interpolation resolves through scope (`@charset "UTF-@{Eight}"` →
 * `@charset "UTF-8"`, `@namespace @{ns} "…"` → `@namespace less "…"`, matching Less
 * 4.x). A prelude with NO interpolation is a single verbatim `Any` — a bare `@var`
 * stays literal (Less resolves only `@{…}` in a statement prelude), so the common
 * case round-trips byte-for-byte.
 */
export interface AtRuleStatement extends SpanSlots, ImportSourceSlots {
  readonly type: 'AtRuleStatement';
  readonly name: string;
  readonly prelude: ValueNode | null;
}

/**
 * A terminal, byte-preserving block at-rule: `@name prelude {rawBody}`.
 *
 * This deliberately has no child-node body. It represents syntax that the
 * producing grammar keeps opaque; the core serializer must not try to evaluate,
 * inspect, or recursively render those bytes.
 */
export interface UnknownAtRuleBlock extends SpanSlots {
  readonly type: 'UnknownAtRuleBlock';
  readonly name: string;
  readonly prelude: string | null;
  readonly rawBody: string;
}

/**
 * A compile-time Plugin statement. Unlike a CSS at-rule statement it has no
 * CSS output: its grammar-owned target/options are handed to the Context
 * injected plugin capability when its lexical body is prepared.
 *
 * The node is deliberately dialect-neutral. A dialect may spell this as
 * `@plugin`, but core owns only the structural Plugin fact and its lexical
 * scope semantics; it owns neither module resolution nor a dialect runtime.
 */
export interface Plugin {
  readonly type: 'Plugin';

  /** Quoted/URL/template target, matching the typed import-target family. */
  readonly target: Quoted | Url | Interpolation;

  /** Inner text of the parenthesized option clause, retained as structured segments. */
  readonly options: Interpolation | null;
}

export const atRuleBlock = (
  name: string,
  prelude: ValueNode | null,
  rules: Statement[]
): AtRuleBlock => ({ type: 'AtRuleBlock', name, prelude, rules, _s: NO_SPAN, _e: NO_SPAN, _bs: NO_SPAN, _be: NO_SPAN });

export const atRuleStatement = (
  name: string,
  prelude: ValueNode | null
): AtRuleStatement => {
  const statement: AtRuleStatement = {
    type: 'AtRuleStatement',
    name,
    prelude,
    _s: NO_SPAN,
    _e: NO_SPAN,
    [importStartKey]: NO_SPAN,
    [importEndKey]: NO_SPAN,
    [importTailStartKey]: NO_SPAN
  };
  return statement;
};

/** Retain the parser-owned start of an import's typed tail in its fixed slot. */
export function withImportTailStart<T extends AtRuleStatement>(
  statement: T,
  start: number
): T {
  statement[importTailStartKey] = start;
  return statement;
}

/**
 * Retain parser-owned CSS import offsets without changing public source
 * provenance. Every AtRuleStatement factory result owns the same three Smi
 * symbol slots, so this is a same-map store rather than a shape transition.
 */
export function withImportSourceSpan<T extends AtRuleStatement>(
  statement: T,
  start: number,
  end: number
): T {
  statement[importStartKey] = start;
  statement[importEndKey] = end;
  return statement;
}

/** CSS import statement start, or NO_SPAN for every other at-rule statement. */
export function importSourceStartOf(statement: AtRuleStatement): number {
  return statement[importStartKey] ?? NO_SPAN;
}

/** CSS import statement end, or NO_SPAN for every other at-rule statement. */
export function importSourceEndOf(statement: AtRuleStatement): number {
  return statement[importEndKey] ?? NO_SPAN;
}

/** Typed import tail start, or NO_SPAN when the import has no tail. */
export function importTailStartOf(statement: AtRuleStatement): number {
  return statement[importTailStartKey] ?? NO_SPAN;
}

export const unknownAtRuleBlock = (
  name: string,
  prelude: string | null,
  rawBody: string
): UnknownAtRuleBlock => ({ type: 'UnknownAtRuleBlock', name, prelude, rawBody, _s: NO_SPAN, _e: NO_SPAN });

export const plugin = (
  target: Quoted | Url | Interpolation,
  options: Interpolation | null = null
): Plugin => ({ type: 'Plugin', target, options });
