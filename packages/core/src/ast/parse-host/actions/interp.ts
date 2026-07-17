/**
 * Shared interpolation + whole-value consumers.
 *
 * P0 (parser is the sole source of structure): these helpers CONSUME the leaves /
 * built children the grammar already produced — they never re-tokenize `ctx.src`
 * or regex-hunt for `@{…}` boundaries to REBUILD structure. Two consumers, reused
 * across the selector / declaration / variable families (P4 DRY):
 *
 *   • `interpFromLeaves` — the grammar splits an interpolated SELECTOR into
 *     index-aligned leaves (`.a-@{n}` → `.`, `a-`, `@{n}`); a leaf whose bytes are
 *     the `@{name}` token the parser isolated becomes an interpolation ref, every
 *     other leaf is a literal chunk. No scan of the surrounding source.
 *   • `wholeValueNode` — a declaration / variable value that is EXACTLY one built
 *     node (the parser bounded it: a single `Reference`, value leaf, paren, or
 *     call spanning the whole value) is consumed directly; a multi-token value has
 *     no single node and the caller keeps the verbatim bytes.
 */
import * as t2 from '../../index.js';
import { type BuildArgs, type Span, sliceSpan } from '../host-context.js';

/** A raw parseman leaf token: `{ _tag:'leaf', value, span }`. */
export interface Leaf {
  readonly _tag: 'leaf';
  readonly value: string;
  readonly span: Span;
}

export function isLeaf(x: unknown): x is Leaf {
  return !!x && typeof x === 'object' && (x as { _tag?: unknown })._tag === 'leaf'
    && typeof (x as { value?: unknown }).value === 'string';
}

/** An isolated `@{name}` interpolation leaf (the parser's `lessInterp` token). A
 *  literal-run leaf can never start with `@{`, so the first two bytes classify it. */
function interpName(value: string): string | null {
  return value.length >= 3 && value.charCodeAt(0) === 0x40 /* @ */ && value.charCodeAt(1) === 0x7b /* { */
    ? value.slice(2, -1).trim()
    : null;
}

/**
 * Build an `Interp` from a selector's already-split leaves, or `null` when no
 * `@{…}` leaf is present. Adjacent literal leaves coalesce into one part (so the
 * part sequence matches the bridge's `interpFromString`). `unquote` rides on each
 * spliced ref (selector context passes `false`).
 */
export function interpFromLeaves(leaves: readonly { value: string }[], unquote: boolean): t2.Interp | null {
  const parts: t2.InterpPart[] = [];
  let lit = '';
  let sawRef = false;
  const flush = (): void => {
    if (lit) {
      parts.push({ lit });
      lit = '';
    }
  };
  for (const { value } of leaves) {
    const name = interpName(value);
    if (name !== null) {
      flush();
      parts.push({ ref: t2.varRef(name), unquote });
      sawRef = true;
    } else {
      lit += value;
    }
  }
  flush();
  return sawRef ? t2.interp(parts) : null;
}

/**
 * The single built value node that spans the WHOLE value, or `null` when the value
 * is multi-token (more than one built node, or a built node that does not cover the
 * value bytes). The span-equality check is a whole-value GUARD (not structure
 * derivation): it rejects a fragment leaf (`1px solid red` → only `red` builds) so
 * the caller keeps the verbatim bytes. The caller narrows by `kind` as needed.
 */
export function wholeValueNode(args: BuildArgs, valueBytes: string): t2.Node | null {
  let node: t2.Node | null = null;
  let idx = -1;
  for (let i = 0; i < args.children.length; i++) {
    const c = args.children[i];
    if (c instanceof t2.Node) {
      if (node !== null) return null; // more than one value node → not whole-value
      node = c;
      idx = i;
    }
  }
  if (node === null) return null;
  const raw = args.rawChildren[idx] as { span?: Span } | undefined;
  return raw?.span && sliceSpan(args.ctx, raw.span) === valueBytes ? node : null;
}
