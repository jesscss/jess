/**
 * Clean-room tree2 at-rule nodes.
 *
 * Two shapes, matching the parser's split:
 *
 *   - `AtRuleBlock`  — a block-bearing at-rule (`@media`, `@font-face`,
 *     `@keyframes`, `@page`, `@supports`, `@counter-style`, unknown block
 *     at-rules). Carries a `name` (`@media`), an optional `prelude` value node
 *     (media query / keyframes name / selector), and a `body` of statements.
 *     The body is a fresh nesting/output context: its direct declarations emit
 *     inside the block, nested rulesets compose among themselves (collapse-
 *     nesting within the block), nested at-rules stay nested. v5 does NOT merge
 *     sibling `@media` blocks — each stays its own block.
 *
 *   - `AtRuleStatement` — a statement-form at-rule with no block (`@charset
 *     "utf-8";`, `@namespace svg "…";`). Carries a `name` and optional raw
 *     `prelude` BYTES (never variable-resolved — Less emits statement preludes
 *     literally, e.g. `@namespace @ns "…"` stays `@ns`).
 *
 * The prelude of a block at-rule is a value node so `@keyframes @name` resolves
 * `@name` through scope; a statement prelude is opaque bytes for byte-faithful
 * round-trip.
 *
 * This file lives inside the tree2 boundary and imports only sibling tree2
 * modules (`node`, `nodes`) — never the legacy tree.
 */

import type { Statement, ValueNode } from './nodes.js';

/** A block-bearing at-rule: `@name prelude { …body }`. */
export interface AtRuleBlock {
  readonly type: 'AtRuleBlock';
  readonly name: string;
  readonly prelude: ValueNode | null;
  readonly body: Statement[];
}

/** A statement-form at-rule: `@name prelude;` (prelude bytes kept literal). */
export interface AtRuleStatement {
  readonly type: 'AtRuleStatement';
  readonly name: string;
  readonly prelude: string | null;
}

export const atRuleBlock = (
  name: string,
  prelude: ValueNode | null,
  body: Statement[],
): AtRuleBlock => ({ type: 'AtRuleBlock', name, prelude, body });

export const atRuleStatement = (name: string, prelude: string | null): AtRuleStatement =>
  ({ type: 'AtRuleStatement', name, prelude });
