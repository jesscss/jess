/**
 * Lean typed KIND-DISPATCH for the tree2 value domain — replaces
 * `define-function.ts`'s `instanceof` coercion. Each native fn declares its
 * accepted param `kind`(s) + optionality (its `NativeFn` spec, co-located with its
 * body in `native/<fn>.ts`); this dispatcher validates/binds positionally by kind
 * and calls the body. The TABLE is ASSEMBLED from `native/index.ts` — adding a fn
 * touches only that module + list, never this file. Deliberately minimal (owner
 * complexity guardrail): a spec table, NOT a rebuilt coercion monster.
 *
 * HARD MODULE BOUNDARY: value domain + native fns only.
 */
import type { List, ValueObj } from './value-eval.js';
import type { FnSpec, NativeCtx } from './native/types.js';
import { NATIVE_FN_LIST } from './native/index.js';

/** name → spec, assembled from the per-fn modules (names are lower-case). */
const TABLE: ReadonlyMap<string, FnSpec> = new Map(NATIVE_FN_LIST.map((f) => [f.name, f]));

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
    if (p.kinds !== 'any' && !p.kinds.includes(a.kind)) {
      throw new TypeError(`${name}: arg ${i} expected ${p.kinds.join('|')}, got ${a.kind}`);
    }
    out.push(a);
  }
  return out;
}

/** Whether a native Tier-A implementation exists for `name`. */
export const hasNativeFn = (name: string): boolean => TABLE.has(name.toLowerCase());

/**
 * Dispatch a native call by name over the typed arg `List`. A VARIADIC fn
 * receives the whole `List` (items + separator) plus the minimal {@link NativeCtx}
 * (modes + the value→string host hook) so a list / rest fn can recover the real
 * elements and a context-sensitive Tier-B fn can serialize / read the separator;
 * a positional fn binds `list.items` by kind and needs no context.
 */
export function dispatchNative(name: string, list: List, ctx: NativeCtx): ValueObj {
  const spec = TABLE.get(name.toLowerCase());
  if (!spec) throw new Error(`no native fn: ${name}`);
  if (spec.variadic) return spec.body(list, ctx);
  return spec.body(...bind(name, spec, list.items));
}
