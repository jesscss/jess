/**
 * Lean typed KIND-DISPATCH + fn registry for the value domain — replaces
 * `define-function.ts`'s `instanceof` coercion. Each built-in fn declares its
 * accepted param `kind`(s) + optionality (its `Fn` spec, co-located with its
 * body in `functions/<fn>.ts`); the registry validates/binds positionally by kind
 * and calls the body. The fn set is CALLER-POPULATED (`registerAll(FN_LIST)`), not
 * hard-imported here, so a later stage can move the fns to `@jesscss/fns` and
 * register them from the consumer without touching this module. Deliberately
 * minimal (owner complexity guardrail): a spec table, NOT a rebuilt coercion monster.
 *
 * HARD MODULE BOUNDARY: value domain + built-in fns only.
 */
import type { List, ValueObj } from './value-eval.js';
import type { Fn, FnSpec, FnCtx } from './functions/types.js';

/** Positional bind by kind; throws on arity / kind mismatch (missing required, wrong kind). */
function bind(name: string, spec: FnSpec, args: readonly ValueObj[]): ValueObj[] {
  const out: ValueObj[] = [];
  for (let i = 0; i < spec.params.length; i++) {
    const p = spec.params[i]!;
    const a = args[i];
    if (a === undefined) {
      if (p.optional) continue;
      throw new TypeError(`${name}: missing required argument ${i}`);
    }
    if (p.kinds !== 'any' && !p.kinds.includes(a.type)) {
      throw new TypeError(`${name}: arg ${i} expected ${p.kinds.join('|')}, got ${a.type}`);
    }
    out.push(a);
  }
  return out;
}

/**
 * A caller-populated table of built-in fns plus the dispatch over it. Fn `name`s
 * are lower-case; lookups fold case.
 */
export interface FnRegistry {
  /** Register a single fn (overwrites any prior entry with the same name). */
  register(fn: Fn): void;
  /** Register every fn in a list (bulk `register`). */
  registerAll(fns: readonly Fn[]): void;
  /** Whether a built-in implementation exists for `name`. */
  has(name: string): boolean;
  /**
   * Dispatch a call by name over the typed arg `List`. A VARIADIC fn receives the
   * whole `List` (items + separator) plus the minimal {@link FnCtx} (modes + the
   * value→string host hook) so a list / rest fn can recover the real elements and a
   * context-sensitive Tier-B fn can serialize / read the separator; a positional fn
   * binds `list.items` by kind and needs no context.
   */
  dispatch(name: string, list: List, ctx: FnCtx): ValueObj;
}

/** Create an empty {@link FnRegistry}; the caller populates it via `registerAll`. */
export function createFnRegistry(): FnRegistry {
  const table = new Map<string, FnSpec>();
  return {
    register(fn) {
      table.set(fn.name, fn);
    },
    registerAll(fns) {
      for (const fn of fns) table.set(fn.name, fn);
    },
    has(name) {
      return table.has(name.toLowerCase());
    },
    dispatch(name, list, ctx) {
      const spec = table.get(name.toLowerCase());
      if (!spec) throw new Error(`no fn: ${name}`);
      if (spec.variadic) return spec.body(list, ctx);
      return spec.body(...bind(name, spec, list.items));
    },
  };
}
