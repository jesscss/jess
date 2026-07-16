/**
 * Real implementation of tree2's `ValueEvaluator` seam (R2).
 *
 * This file lives OUTSIDE `tree2/` on purpose. The hard module boundary forbids
 * any file under `tree2/` from importing `../tree`; the value EVALUATOR is the
 * boundary-crossing "context object" tree2 receives. It computes value math the
 * SHARED way — the same typed value nodes (`Color`/`Dimension`/…) the oracle
 * uses and the `@jesscss/fns` registry — but invoked DIRECTLY on already-typed
 * operands: NO reparse (`parseLessFn`), NO re-render through the legacy block
 * engine (`renderNodeToString`), and NO async-record → sync-replay pre-pass.
 * That deletes the roadmap Risk #2 circularity while staying byte-identical to
 * the oracle by reusing the exact math + value serialization.
 *
 * Design (spec §5 option B — boundary-clean sync value binding):
 *   - OPERATORS delegate to the legacy value nodes' own `.operate` (the exact
 *     arithmetic/color math the oracle's `Operation.eval` calls), with the
 *     unit-clash → `calc(...)` fallback reproduced.
 *   - FUNCTIONS delegate to `@jesscss/fns` via `callWithContext` on reconstructed
 *     typed arg nodes. Sync fns stay sync; genuinely async built-ins (rgb/rgba/
 *     hsl/hsla color-format fns, file-IO fns) return a thenable that tree2 lifts
 *     onto the async branch scoped to the forcing declaration (arch C1).
 *   - GUARD leaves compare typed values / call type-fns synchronously.
 *
 * tree2 stays boundary-clean: it holds only its own `ValueObj`s; this adapter is
 * the sole translator to/from the legacy value node shapes.
 */

import * as lessFunctions from '@jesscss/fns';
import { Context } from '../context.js';
import { Anonymous, Bool, Color, ColorFormat, Dimension, Nil, Quoted, List } from '../tree/index.js';
import { callWithContext } from '../define-function.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import type {
  EvalModes,
  List as ValueList,
  ValueEvaluator,
  ValueObj,
} from '../tree2/index.js';

/* --------------------------------------------------------- legacy glue */

/** A minimal legacy value node the adapter operates on / serializes. */
interface LegacyNode {
  render(context: Context): string;
  operate?(b: unknown, op: string, context: Context): LegacyNode;
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;
const QUOTE_RE = /^(['"])([\s\S]*)\1$/;

/**
 * A single `calc(...)` wrapper: the capture group is its inner expression.
 * Calc-keyword operands in this adapter are always singly wrapped (guard 1
 * below fires before guard 2 whenever both sides are calc, and the
 * unit-clash fallback wraps a single composed operation), so the greedy
 * capture never mis-splits a composed `calc(a) + calc(b)`.
 */
const CALC_WRAP_RE = /^calc\(([\s\S]*)\)$/;

/**
 * If `bytes` is a `calc(...)` wrapper, return its inner expression; otherwise
 * return `null`. Byte-level port of the legacy `Operation.unwrapCalcOperand`:
 * CSS flattens nested calc, so a `calc(...)` operand composing into an outer
 * operation has its inner expression spliced in directly, yielding one flat
 * `calc(...)` rather than `calc(calc(...) op Y)`. A Paren-wrapped inner
 * expression keeps its paren (`calc((a - b))` -> `(a - b)`).
 */
const calcInner = (bytes: string): string | null => {
  const m = CALC_WRAP_RE.exec(bytes.trim());
  return m ? m[1]! : null;
};

/* -------------------------------------------------------- fns registry */

/** The named-function table (mirrors the less plugin registration). */
function buildFnTable(): Map<string, { fn: (...a: unknown[]) => unknown; internal?: (...a: unknown[]) => unknown }> {
  const table = new Map<string, { fn: (...a: unknown[]) => unknown; internal?: (...a: unknown[]) => unknown }>();
  for (const [key, value] of Object.entries(lessFunctions)) {
    if (typeof value !== 'function') continue;
    const runtimeName = (value as { name?: string }).name || key;
    const internal = (value as { _internal?: (...a: unknown[]) => unknown })._internal;
    table.set(runtimeName.toLowerCase(), { fn: value as (...a: unknown[]) => unknown, internal });
  }
  return table;
}

/* ------------------------------------------------------- the evaluator */

export interface EvaluatorOptions {
  modes?: EvalModes;
}

/**
 * Build a synchronous typed `ValueEvaluator` (the R2 seam implementation). No
 * root/pre-pass argument: values are computed on demand during the single
 * serialize walk.
 */
export function buildEvaluator(_options?: EvaluatorOptions): ValueEvaluator {
  const ctx = new Context();
  const fnTable = buildFnTable();

  /* ---- ValueObj -> legacy node ---- */
  const toLegacy = (v: ValueObj): LegacyNode => {
    switch (v.kind) {
      case 'dimension':
        return new Dimension({ number: v.number, unit: v.unit || undefined }) as unknown as LegacyNode;
      case 'color': {
        const opts: { format?: number; modernSyntax?: boolean } = { format: v.format };
        if (v.modernSyntax) opts.modernSyntax = true;
        // Preserve the original literal `node` (e.g. `#ff0000`): fns like `fade`
        // key hex-format preservation off `color.node`.
        const data: { rgb: [number, number, number]; alpha: number; node?: string } = {
          rgb: [v.rgb[0], v.rgb[1], v.rgb[2]],
          alpha: v.alpha,
        };
        if (v.node !== undefined) data.node = v.node;
        return new Color(data, opts) as unknown as LegacyNode;
      }
      case 'quoted':
        return new Quoted(v.quote + v.value + v.quote, v.value, v.escaped) as unknown as LegacyNode;
      case 'keyword':
        return new Anonymous(v.text) as unknown as LegacyNode;
      case 'bool':
        return new Bool(v.value) as unknown as LegacyNode;
      case 'nil':
        return new Nil() as unknown as LegacyNode;
      case 'list':
        return new List(v.items.map(toLegacy)) as unknown as LegacyNode;
    }
  };

  /* ---- legacy node -> ValueObj ---- */
  const fromLegacy = (node: unknown): ValueObj => {
    const bytes = (node as LegacyNode).render(ctx);
    if (node instanceof Dimension) {
      return { kind: 'dimension', number: node.number, unit: node.unit ?? '', bytes };
    }
    if (node instanceof Color) {
      const [r, g, b] = node.rgb;
      return {
        kind: 'color',
        rgb: [r, g, b],
        alpha: node.alpha,
        format: (node.options?.format as number | undefined) ?? ColorFormat.HEX,
        modernSyntax: node.options?.modernSyntax === true,
        node: typeof node.node === 'string' ? node.node : undefined,
        bytes,
      };
    }
    if (node instanceof Quoted) {
      return { kind: 'quoted', value: node.value, quote: node.quote ?? '"', escaped: node.escaped === true, bytes };
    }
    if (node instanceof Bool) {
      return { kind: 'bool', value: Boolean(node.value), bytes };
    }
    if (node instanceof Nil) {
      return { kind: 'nil', bytes };
    }
    // Fallback: a keyword-shaped result carries its bytes.
    return { kind: 'keyword', text: bytes, bytes };
  };

  /* ---- materialize an un-materialized literal (its bytes) ---- */
  const materialize = (rawBytes: string): ValueObj => {
    const b = rawBytes.trim();
    // Hex color.
    if (HEX_RE.test(b)) {
      const c = new Color(b);
      return fromLegacyColorPreservingNode(c, b);
    }
    // Numeric (optionally united / %).
    if (NUM_RE.test(b)) {
      const m = NUM_RE.exec(b);
      if (m) {
        return { kind: 'dimension', number: Number(b.slice(0, b.length - m[1]!.length)), unit: m[1] ?? '', bytes: b };
      }
    }
    // Quoted string.
    const q = QUOTE_RE.exec(b);
    if (q) {
      return { kind: 'quoted', value: q[2]!, quote: q[1]!, escaped: false, bytes: b };
    }
    // Named color? (`blue`, `red`) — a keyword that names a color is a Color for
    // operations / color-typed params / `iscolor`; otherwise a plain keyword.
    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(b)) {
      const named = new Color({ node: b });
      if ((named as unknown as { _rgbChannels?: unknown })._rgbChannels !== undefined) {
        return fromLegacyColorPreservingNode(named, b);
      }
    }
    return { kind: 'keyword', text: b, bytes: b };
  };

  const fromLegacyColorPreservingNode = (c: Color, source: string): ValueObj => {
    const [r, g, b] = c.rgb;
    return {
      kind: 'color',
      rgb: [r, g, b],
      alpha: c.alpha,
      format: (c.options?.format as number | undefined) ?? ColorFormat.HEX,
      node: source,
      bytes: source,
    };
  };

  /* ---- operators ---- */
  const operate = (op: string, left: ValueObj, right: ValueObj, modes: EvalModes): ValueObj => {
    ctx.options.unitMode = modes.unitMode;
    // Guard 1: a `calc(...)` operand -> NESTED calc fallback (mirror the legacy
    // `Operation.unwrapCalcOperand` + `createCalcFallback`). Splice the inner
    // expression(s) directly so `calc(100% * 100%) * 2` composes to a flat
    // `calc(100% * 100% * 2)`, never `calc(calc(100% * 100%) * 2)`.
    const leftInner = left.kind === 'keyword' ? calcInner(left.bytes) : null;
    const rightInner = right.kind === 'keyword' ? calcInner(right.bytes) : null;
    if (leftInner !== null || rightInner !== null) {
      const bytes = `calc(${leftInner ?? left.bytes} ${op} ${rightInner ?? right.bytes})`;
      return { kind: 'keyword', text: bytes, bytes };
    }
    // Guard 2: an unoperable operand (a keyword / `Anonymous` whose `.operate`
    // throws a plain `Error`, mirror `Operation.isUnoperable`) -> preserve
    // source. The `typeof l.operate` check below can't catch this because
    // `Anonymous` inherits a throwing base `operate`, and the plain `Error` it
    // raises slips past the `TypeError`-only catch.
    if (left.kind === 'keyword' || right.kind === 'keyword') {
      const bytes = `${left.bytes} ${op} ${right.bytes}`;
      return { kind: 'keyword', text: bytes, bytes };
    }
    const l = toLegacy(left);
    const r = toLegacy(right);
    if (typeof l.operate !== 'function') {
      // Non-operable operand: preserve source.
      return { kind: 'keyword', text: `${left.bytes} ${op} ${right.bytes}`, bytes: `${left.bytes} ${op} ${right.bytes}` };
    }
    try {
      const out = l.operate(r as unknown, op, ctx);
      return fromLegacy(out);
    } catch (err) {
      if (err instanceof TypeError && modes.unitMode === 'preserve') {
        // Unit-clash → `calc(...)` fallback (mirror Operation.createCalcFallback).
        const bytes = `calc(${left.bytes} ${op} ${right.bytes})`;
        return { kind: 'keyword', text: bytes, bytes };
      }
      throw err;
    }
  };

  /* ---- functions ---- */
  const call = (name: string, args: ValueList, _modes: EvalModes): MaybePromise<ValueObj> => {
    const entry = fnTable.get(name.toLowerCase());
    if (!entry) {
      // Unknown function: emit verbatim (functionMode preserve).
      const inner = args.items.map((a) => a.bytes).join(args.sep === ',' ? ', ' : ` ${args.sep === '/' ? '/ ' : ''}`);
      const bytes = `${name}(${inner})`;
      return { kind: 'keyword', text: bytes, bytes };
    }
    const argNodes = args.items.map(toLegacy);
    const modern = args.sep === ' ' || args.sep === '/';
    ctx.caller = { options: { modernSyntax: modern } } as never;
    const result = callWithContext(ctx, entry.fn, new List(argNodes as unknown[]));
    if (isThenable(result)) return result.then((r) => fromLegacy(r));
    return fromLegacy(result);
  };

  /* ---- guards ---- */
  const guardCmp = (op: string, left: ValueObj, right: ValueObj, _modes: EvalModes): boolean => {
    // Numeric comparison when both are numbers; else byte/keyword comparison.
    if (left.kind === 'dimension' && right.kind === 'dimension') {
      const a = left.number;
      const b = right.number;
      switch (op) {
        case '>': return a > b;
        case '<': return a < b;
        case '>=': return a >= b;
        case '<=': return a <= b;
        case '=': return a === b;
      }
    }
    const a = left.bytes;
    const b = right.bytes;
    switch (op) {
      case '=': return a === b;
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
    return false;
  };

  const guardCall = (name: string, args: ValueList, _modes: EvalModes): boolean => {
    const entry = fnTable.get(name.toLowerCase());
    if (!entry) return false;
    // Type-fns (`iscolor`/`isnumber`/…) are sync bodies over typed nodes: invoke
    // the raw internal body directly (no async wrap, no convert plugins needed).
    const argNodes = args.items.map(toLegacy);
    const body = entry.internal ?? entry.fn;
    const out = body.call(undefined as never, ...argNodes);
    if (out instanceof Bool) return Boolean(out.value);
    if (isThenable(out)) throw new Error(`guard type-fn '${name}' is unexpectedly async`);
    return Boolean((out as { value?: unknown })?.value);
  };

  return { materialize, operate, call, guardCmp, guardCall };
}
