/**
 * Lean typed KIND-DISPATCH table — replaces `define-function.ts`'s `instanceof`
 * coercion for the tree2 value domain. A spec table declares each param's
 * accepted `kind`(s) + optionality; the dispatcher validates/binds positionally
 * by kind and calls the native body. Registering a fn = ONE spec entry + one
 * native body. Deliberately minimal (owner complexity guardrail): a spec table,
 * NOT a rebuilt coercion monster.
 *
 * HARD MODULE BOUNDARY: value domain + native fns only.
 */
import type { Color, Dimension, Keyword, Quoted, ValueObj } from './value-eval.js';
import { lightenNative, percentageNative, eNative } from './fns-native.js';

type Kind = ValueObj['kind'];

interface ParamSpec {
  readonly kinds: readonly Kind[] | 'any';
  readonly optional?: boolean;
}
interface FnSpec {
  readonly params: readonly ParamSpec[];
  readonly body: (...args: ValueObj[]) => ValueObj;
}

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

const TABLE: Record<string, FnSpec> = {
  lighten: {
    params: [{ kinds: ['color'] }, { kinds: ['dimension'] }, { kinds: ['keyword', 'quoted'], optional: true }],
    body: (c, amt, m) => lightenNative(c as Color, amt as Dimension, m as Keyword | Quoted | undefined),
  },
  percentage: {
    params: [{ kinds: ['dimension'] }],
    body: (v) => percentageNative(v as Dimension),
  },
  e: {
    params: [{ kinds: 'any' }],
    body: (v) => eNative(v),
  },
};

/** Whether a native Tier-A implementation exists for `name`. */
export const hasNativeFn = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(TABLE, name.toLowerCase());

/** Dispatch a native Tier-A call by name over typed value args. */
export function dispatchNative(name: string, args: readonly ValueObj[]): ValueObj {
  const spec = TABLE[name.toLowerCase()];
  if (!spec) throw new Error(`no native fn: ${name}`);
  return spec.body(...bind(name, spec, args));
}

/** The set of natively-converted fn names (proof set for the foundation). */
export const NATIVE_FNS: ReadonlySet<string> = new Set(Object.keys(TABLE));
