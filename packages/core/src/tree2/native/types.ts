/**
 * The NATIVE-FN module contract. A native Tier-A function is a self-describing
 * value: its dispatch `name`, a `params` spec (accepted `kind`(s) + optionality/
 * rest, positional), and a `body` over already-materialized typed value objects.
 *
 * Co-locating the spec WITH the body in one per-fn module is what makes the
 * registry tree-shakeable (a stylesheet that never calls `pow` must not ship
 * `pow`) and additive (a new fn = a new module + one line in `native/index.ts`).
 *
 * HARD MODULE BOUNDARY: value domain only — no `../tree`, no legacy nodes.
 */
import type { ValueObj } from '../value-eval.js';

export type Kind = ValueObj['kind'];

export interface ParamSpec {
  /** Accepted kinds for this positional slot, or `'any'`. */
  readonly kinds: readonly Kind[] | 'any';
  /** A missing arg is allowed (no more required params follow). */
  readonly optional?: boolean;
}

export interface FnSpec {
  readonly params: readonly ParamSpec[];
  readonly body: (...args: ValueObj[]) => ValueObj;
}

/** A native fn module's export: a `FnSpec` plus the lower-case dispatch name. */
export interface NativeFn extends FnSpec {
  readonly name: string;
}
