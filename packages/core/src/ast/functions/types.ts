/**
 * The built-in-fn module contract. A Tier-A/B function is a self-describing
 * value: a callable with its dispatch `name` and `params` metadata. `FnSpec` is
 * only factory input while a callable is being authored; it is never the
 * registry/runtime function representation.
 *
 * Co-locating a factory declaration with its implementation in one per-fn module is what makes the
 * registry tree-shakeable (a stylesheet that never calls `pow` must not ship
 * `pow`) and additive (a new fn = a new module + one line in the assembly list).
 *
 * This contract stays in core (it is the fn-authoring surface, re-exported via
 * `@jesscss/core/value`); dialect implementations live in the existing
 * `@jesscss/fns` `shared/`, `less/`, and `sass/` folders.
 *
 * HARD MODULE BOUNDARY: value domain only — no `../tree`, no legacy nodes.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { EvalModes, List, ValueObj } from '../value-eval.js';

export type Kind = ValueObj['type'];

export interface ParamSpec {
  /** Name used by Sass/Jess direct record-style invocation. */
  readonly name?: string;
  /** Accepted kinds for this positional slot, or `'any'`. */
  readonly kinds: readonly Kind[] | 'any';
  /** A missing arg is allowed (no more required params follow). */
  readonly optional?: boolean;
  /** Value-domain default; makes the slot optional. */
  readonly default?: ValueObj;
  /** Collect all remaining positional arguments in this final slot. */
  readonly rest?: boolean;
  /** Hand the body a typed thunk; evaluation and validation happen on invocation. */
  readonly lazy?: boolean;
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
  /** Dispatch name while this declarative spec is being assembled into a callable. */
  readonly name?: string;
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
 * `List` (value + separator) — the shape a list / rest fn (`length`/`extract`/
 * `min`/`max`) or an overloaded / context-sensitive Tier-B fn (`rgb`/`hsl`/
 * `replace`/`%`) needs to see the real elements, the call's separator (the
 * modern-syntax signal), and the {@link FnCtx}. `params` is documentation-only.
 */
export interface VariadicSpec extends BaseSpec {
  readonly variadic: true;
  readonly body: (list: List, ctx: FnCtx) => MaybePromise<ValueObj>;
}

export type FnSpec = PositionalSpec | VariadicSpec;

/** A typed lazy argument. The thunk is deliberately the only deferral seam. */
export type LazyValue<T extends ValueObj = ValueObj> = () => MaybePromise<T>;

export type ValueForKinds<K extends ParamSpec['kinds']> =
  K extends 'any' ? ValueObj : Extract<ValueObj, { readonly type: K[number] }>;

export type ParamValue<P extends ParamSpec> = ValueForKinds<P['kinds']>;
export type ParamInput<P extends ParamSpec> = P['lazy'] extends true
  ? LazyValue<ParamValue<P>>
  : ParamValue<P>;
type BodyParam<P extends ParamSpec> = P['rest'] extends true
  ? readonly ParamInput<P>[]
  : ParamInput<P>;
type IsOptional<P extends ParamSpec> = P extends { readonly optional: true } | { readonly default: ValueObj } ? true : false;

/** Tuple passed to a direct function body, including lazy/rest semantics. */
export type FunctionBodyArgs<P extends readonly ParamSpec[]> =
  P extends readonly [infer Head extends ParamSpec, ...infer Tail extends readonly ParamSpec[]]
    ? [BodyParam<Head>, ...FunctionBodyArgs<Tail>]
    : [];

/** Tuple accepted by direct positional invocation. */
export type FunctionArgs<P extends readonly ParamSpec[]> =
  P extends readonly [infer Head extends ParamSpec, ...infer Tail extends readonly ParamSpec[]]
    ? Head['rest'] extends true
      ? [...ParamInput<Head>[]]
      : IsOptional<Head> extends true
        ? [ParamInput<Head>?, ...FunctionArgs<Tail>]
        : [ParamInput<Head>, ...FunctionArgs<Tail>]
    : [];

type RequiredRecord<P extends readonly ParamSpec[]> = {
  [Item in P[number] as IsOptional<Item> extends true ? never : Item['name'] & string]: Item['rest'] extends true
    ? readonly ParamInput<Item>[]
    : ParamInput<Item>;
};
type OptionalRecord<P extends readonly ParamSpec[]> = {
  [Item in P[number] as IsOptional<Item> extends true ? Item['name'] & string : never]?: Item['rest'] extends true
    ? readonly ParamInput<Item>[]
    : ParamInput<Item>;
};
export type FnRecord<P extends readonly ParamSpec[] = readonly ParamSpec[]> = Readonly<
  RequiredRecord<P> & OptionalRecord<P>
>;
/** Named fields that may supplement positional arguments in a mixed direct call. */
export type PartialFnRecord<P extends readonly ParamSpec[] = readonly ParamSpec[]> = Readonly<
  Partial<FnRecord<P>>
>;

/**
 * Canonical direct value function. It is a plain callable with its authoritative
 * metadata (`name`, `params`) attached—no legacy record/body/options aliases.
 *
 * The record and mixed overloads are a Sass/Jess embedding capability. Parser
 * evaluators always use the `(List, FnCtx)` overload; in particular, a Less
 * evaluator remains positional-only until its syntax explicitly gains records.
 */
export type DefinedFunction<P extends readonly ParamSpec[]> = {
  (...args: FunctionArgs<P>): MaybePromise<ValueObj>;
  (record: FnRecord<P>): MaybePromise<ValueObj>;
  (...args: [...FunctionArgs<P>, PartialFnRecord<P>]): MaybePromise<ValueObj>;
  (list: List, ctx: FnCtx): MaybePromise<ValueObj>;
  readonly name: string;
  readonly params: P;
  readonly variadic?: false;
};

/**
 * The only runtime function contract. A function is its implementation; the
 * registry always calls it with the evaluator's typed argument list and context.
 */
export type Fn = ((list: List, ctx: FnCtx) => MaybePromise<ValueObj>) & {
  readonly name: string;
  readonly params: readonly ParamSpec[];
  readonly variadic?: boolean;
};
