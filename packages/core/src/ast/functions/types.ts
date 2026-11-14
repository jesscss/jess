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
 * `@jesscss/core`); dialect implementations live in the existing
 * `@jesscss/fns` `shared/`, `less/`, and `sass/` folders.
 *
 * HARD MODULE BOUNDARY: value domain only — no `../tree`, no legacy nodes.
 */
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { EvalModes, Value, ValueGroup } from '../value-eval.js';

export type Kind = Value['type'];
export type ParamType = Kind | readonly Kind[] | 'any';

interface ParamSpecBase {
  /** Name used by Sass/Jess direct record-style invocation. */
  readonly name?: string;

  /** A missing arg is allowed (no more required params follow). */
  readonly optional?: boolean;

  /** Value-domain default; makes the slot optional. */
  readonly default?: ValueGroup;

  /** Collect all remaining positional arguments in this final slot. */
  readonly rest?: boolean;

  /** Hand the body a typed thunk; evaluation and validation happen on invocation. */
  readonly lazy?: boolean;

  /**
   * Whether a built-in's CSS form holds this value where an exposed variable reads
   * it, given the call's other arguments (docs/design/CSS-NATIVE-BUILTINS.md Q2, Q3).
   * Any other value keeps the call's runtime recipe, as does a slot without this
   * field, which has no form.
   */
  readonly fits?: (value: ValueGroup, vals: readonly ValueGroup[]) => boolean;
}

type ParamTypeSpec = ParamSpecBase & {
  /**
   * Accepted value node type(s) for this slot, or `'any'`. A function that says
   * `{ type: 'Color' }` receives a typed {@link Color} value node, not authored
   * source bytes.
   */
  readonly type: ParamType;
  readonly kinds?: never;
};

type LegacyParamKindSpec = ParamSpecBase & {
  readonly type?: never;

  /** @deprecated Public fn specs should use `type`. */
  readonly kinds: readonly Kind[] | 'any';
};

export type ParamSpec = ParamTypeSpec | LegacyParamKindSpec;

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
 *  - `parseSelector`: the OPTIONAL selector-list read a selector-valued fn
 *    (`selector.parse()`) needs. Injected by the dialect plugin from its own
 *    parser's selector-list production, so a fn body never imports a parser.
 */
export interface FnCtx {
  readonly modes: EvalModes;

  /** The call wrote CSS modern colour syntax (`rgb(0 128 255 / 50%)`), space and slash separated. */
  readonly modern?: boolean;
  readonly stringify: (v: ValueGroup) => string;
  readonly io?: FnIo;
  readonly parseSelector?: SelectorParse;
}

/**
 * Reads `text` as a selector list: per branch, in order, its compound selectors and
 * combinators. Throws an error whose message says why when `text` is not a
 * selector list.
 */
export type SelectorParse = (text: string) => readonly (readonly string[])[];

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
  /** A number only the browser knows leaves the call the CSS function of its name (`value-dispatch.ts` {@link declineOverUnknown}). */
  readonly cssFunction?: boolean;

  /** The name is also a CSS filter function (`filter-position.ts`). */
  readonly filter?: boolean;

  /** Dispatch name while this declarative spec is being assembled into a callable. */
  readonly name?: string;
  readonly params: readonly ParamSpec[];
}

/** A POSITIONAL fn: the dispatcher binds args by kind and spreads them. No ctx. */
export interface PositionalSpec extends BaseSpec {
  readonly variadic?: false;
  readonly body: (...args: never[]) => MaybePromise<ValueGroup>;
}

/**
 * A VARIADIC fn: the dispatcher skips the positional bind and hands the body the
 * call's arguments and the {@link FnCtx}, for a list or rest fn
 * (`length`/`extract`/`min`/`max`) or an overloaded or context-sensitive one
 * (`rgb`/`hsl`/`replace`/`%`). `params` is documentation-only.
 */
export interface VariadicSpec extends BaseSpec {
  readonly variadic: true;
  readonly body: (args: readonly ValueGroup[], ctx: FnCtx) => MaybePromise<ValueGroup>;
}

export type FnSpec = PositionalSpec | VariadicSpec;

/** A typed lazy argument. The thunk is deliberately the only deferral seam. */
export type LazyValue<T extends ValueGroup = ValueGroup> = () => MaybePromise<T>;

export type ValueForKinds<K> =
  K extends 'any' ? ValueGroup : K extends readonly Kind[] ? Extract<Value, { readonly type: K[number] }> : never;
export type ValueForType<T> =
  T extends 'any' ? ValueGroup : T extends Kind ? Extract<Value, { readonly type: T }> : T extends readonly Kind[] ? Extract<Value, { readonly type: T[number] }> : never;

export type ParamValue<P extends ParamSpec> = P extends { readonly type: infer T }
  ? ValueForType<T>
  : P extends { readonly kinds: infer K }
    ? ValueForKinds<K>
    : never;
export type ParamInput<P extends ParamSpec> = P['lazy'] extends true
  ? LazyValue<ParamValue<P>>
  : ParamValue<P>;
type RequiredBodyParam<P extends ParamSpec> = P['rest'] extends true
  ? readonly ParamInput<P>[]
  : ParamInput<P>;
type BodyParam<P extends ParamSpec> = P extends { readonly default: ValueGroup }
  ? RequiredBodyParam<P>
  : IsOptional<P> extends true
    ? RequiredBodyParam<P> | undefined
    : RequiredBodyParam<P>;
type IsOptional<P extends ParamSpec> = P extends { readonly optional: true } | { readonly default: ValueGroup } ? true : false;

/** Tuple passed to a direct function body, including lazy/rest semantics. */
export type FunctionBodyArgs<P extends readonly ParamSpec[]> =
  P extends readonly [infer Head extends ParamSpec, ...infer Tail extends readonly ParamSpec[]]
    ? [BodyParam<Head>, ...FunctionBodyArgs<Tail>]
    : [];

/** A named record (`callNamed`) may leave out an optional or defaulted slot, and a rest slot (it binds zero items). */
type IsRecordOptional<P extends ParamSpec> = P['rest'] extends true ? true : IsOptional<P>;
type RequiredRecord<P extends readonly ParamSpec[]> = {
  [Item in P[number] as IsRecordOptional<Item> extends true ? never : Item['name'] & string]: ParamValue<Item>;
};
type OptionalRecord<P extends readonly ParamSpec[]> = {
  [Item in P[number] as IsRecordOptional<Item> extends true ? Item['name'] & string : never]?: Item['rest'] extends true
    ? readonly ParamValue<Item>[]
    : ParamValue<Item>;
};

/** Named arguments for `callNamed`: each an evaluated value, which the function hands a `lazy` parameter as a thunk. */
export type FnRecord<P extends readonly ParamSpec[] = readonly ParamSpec[]> = Readonly<
  RequiredRecord<P> & OptionalRecord<P>
>;

/** A function {@link defineFunction} built, its parameters typed. */
export type DefinedFunction<P extends readonly ParamSpec[]> = Fn & {
  readonly params: P;
  readonly variadic?: false;
};

/**
 * The one calling convention: the call's arguments, evaluated, in the order the
 * call wrote them (keyword arguments already at their parameters' positions), and
 * the {@link FnCtx}. A JS caller holding named arguments uses `callNamed`
 * (`@jesscss/core/call-named`).
 */
export type Fn = ((args: readonly ValueGroup[], ctx: FnCtx) => MaybePromise<ValueGroup>) & {
  /** The name is also a CSS filter function (`filter-position.ts`). */
  readonly filter?: boolean;
  readonly name: string;
  readonly params: readonly ParamSpec[];
  readonly variadic?: boolean;

  /** By parameter, whether it is checked as a colour, so a colour name passed to it is read as one; fixed when the function is defined. */
  readonly colorSlots: readonly boolean[];

  /** Whether the parameter that takes every further argument (the `rest` one, or a variadic function's last) is checked as a colour. */
  readonly colorTail: boolean;

  /** The module export a function imported into a stylesheet binds (module-values.ts `bindModuleFunction`). */
  readonly origin?: FnOrigin;
};

/** Where an imported function comes from: the module as the stylesheet names it, and the export. */
export interface FnOrigin {
  readonly module: string;
  readonly name: string;
}
