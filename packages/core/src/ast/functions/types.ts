/**
 * The built-in-fn module contract. A Tier-A/B function is a self-describing
 * value: its dispatch `name`, a `params` spec (accepted `kind`(s) + optionality/
 * rest, positional), and a `body` over already-materialized typed value objects.
 *
 * Co-locating the spec WITH the body in one per-fn module is what makes the
 * registry tree-shakeable (a stylesheet that never calls `pow` must not ship
 * `pow`) and additive (a new fn = a new module + one line in the assembly list).
 *
 * This contract stays in core (it is the fn-authoring surface, re-exported via
 * `@jesscss/core/value`); the fn BODIES live in `@jesscss/fns` (`builtins/`).
 *
 * HARD MODULE BOUNDARY: value domain only — no `../tree`, no legacy nodes.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { EvalModes, List, ValueObj } from '../value-eval.js';

export type Kind = ValueObj['type'];

export interface ParamSpec {
  /** Accepted kinds for this positional slot, or `'any'`. */
  readonly kinds: readonly Kind[] | 'any';
  /** A missing arg is allowed (no more required params follow). */
  readonly optional?: boolean;
}

/**
 * The MINIMAL eval-context a VARIADIC (Tier-B) fn body receives — deliberately NOT
 * the whole legacy `Context` (owner complexity guardrail). It carries the two
 * things a context-sensitive fn genuinely needs:
 *
 *  - `modes`: the already-threaded {@link EvalModes} (math / unit / function mode).
 *  - `stringify`: the opaque host hook that renders a value to a string the way
 *    legacy `serializeNodeValue` does — a Quoted's INNER text (unquoted), any
 *    other value its canonical emitted bytes. Supplied by the host so a fn body
 *    never imports the serializer directly (keeps the seam injected + lean).
 *  - `io`: the OPTIONAL file-read capability the IO Tier-C fns (`data-uri`/
 *    `image-size`/`image-width`/`image-height`) need. Injected per-render by the
 *    host (bound to the source file's directory + search paths) — NOT a global,
 *    NOT the whole legacy `Context`. Absent on the idle path (a render with no IO
 *    host wired); an IO fn that finds it absent degrades gracefully (verbatim /
 *    `url()` fallback) rather than throwing.
 */
export interface FnCtx {
  readonly modes: EvalModes;
  readonly stringify: (v: ValueObj) => string;
  readonly io?: FnIo;
}

/**
 * The per-render file-read capability handed to the IO built-ins. The host owns
 * path-resolution POLICY (base directory of the current file, configured search
 * paths); a fn body only supplies a specifier and gets back the raw bytes, or
 * `null` when nothing resolves/reads. Deliberately minimal — the mime/charset
 * decision, encoding, size handling and image-header parsing all live in the fn
 * bodies (pure), so this capability stays a single narrow read seam.
 */
export interface FnIo {
  /**
   * Resolve `specifier` against the render's base directory (+ search paths) and
   * return the referenced file's raw bytes, or `null` if it cannot be read. The
   * specifier is already stripped of any `#fragment` by the caller.
   */
  readFile(specifier: string): MaybePromise<Uint8Array | null>;
}

interface BaseSpec {
  readonly params: readonly ParamSpec[];
}

/** A POSITIONAL fn: the dispatcher binds args by kind and spreads them. No ctx. */
export interface PositionalSpec extends BaseSpec {
  readonly variadic?: false;
  readonly body: (...args: ValueObj[]) => MaybePromise<ValueObj>;
}

/**
 * A VARIADIC fn (owner complexity guardrail: a flag, not a rebuilt coercion
 * layer). The dispatcher SKIPS positional bind and hands the body the whole arg
 * `List` (items + separator) — the shape a list / rest fn (`length`/`extract`/
 * `min`/`max`) or an overloaded / context-sensitive Tier-B fn (`rgb`/`hsl`/
 * `replace`/`%`) needs to see the real elements, the call's separator (the
 * modern-syntax signal), and the {@link FnCtx}. `params` is documentation-only.
 */
export interface VariadicSpec extends BaseSpec {
  readonly variadic: true;
  readonly body: (list: List, ctx: FnCtx) => MaybePromise<ValueObj>;
}

export type FnSpec = PositionalSpec | VariadicSpec;

/** A fn module's export: a `FnSpec` plus the lower-case dispatch name. */
export type Fn = FnSpec & { readonly name: string };
