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

/** A Less interpolation-name byte (`lessInterp` class: `-_A-Za-z0-9` + non-ASCII). */
function isInterpNameByte(c: number): boolean {
  return c === 0x2d /* - */ || c === 0x5f /* _ */
    || (c >= 0x30 && c <= 0x39) /* 0-9 */
    || (c >= 0x41 && c <= 0x5a) /* A-Z */
    || (c >= 0x61 && c <= 0x7a) /* a-z */
    || c >= 0x80;
}

/**
 * The variable name of a `@{name}` interpolation leaf (the parser's `lessInterp`
 * token), or `null` for any other leaf. This CLASSIFIES a leaf the grammar already
 * bounded (it does not re-scan source): it FULLY validates the strict `@{name}`
 * shape (`@{` + optional `-` + a non-empty name run + `}`) because a quoted-string
 * chunk leaf may legitimately START with `@{` — a NON-interpolation false-start the
 * `Quoted` grammar absorbs into a literal chunk (`@{box-` in `"@{box-@{suffix}}"`,
 * or `@{ x }` / `@{a.b}` / `@{}`). Such a chunk fails the full shape (no closing `}`
 * before the run ends, or an invalid interior), so it stays literal — matching the
 * strict §4.1 (owner-LOCKED) rule and real Less 4.x. A selector / custom-prop chunk
 * never starts with `@{`, so this is a no-op tightening for those callers.
 */
function interpName(value: string): string | null {
  const n = value.length;
  if (n < 4 || value.charCodeAt(0) !== 0x40 /* @ */ || value.charCodeAt(1) !== 0x7b /* { */
    || value.charCodeAt(n - 1) !== 0x7d /* } */) return null;
  let i = 2;
  if (value.charCodeAt(i) === 0x2d /* - */) i++;
  const nameStart = i;
  while (i < n - 1 && isInterpNameByte(value.charCodeAt(i))) i++;
  return i === n - 1 && i > nameStart ? value.slice(2, n - 1).trim() : null;
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

/** A `@{name}` interpolation leaf's source range + resolved variable name. */
export interface InterpSpan {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

/**
 * Build a value from a SOURCE region `[start, end)` and the `@{…}` interpolation
 * leaves the grammar isolated within it (Tier-B). The token boundaries come from
 * the parser's leaf spans (never a re-scan); the gaps between them are carried
 * VERBATIM from source, so bare `@var` bytes, comments, and exact spacing survive
 * as literal parts (owner rule: a custom-prop / prelude value resolves ONLY `@{…}`).
 * With no interpolation leaf the whole region is one verbatim `Any`.
 */
export function interpFromRegion(
  src: string,
  start: number,
  end: number,
  spans: readonly InterpSpan[],
  unquote: boolean,
): t2.ValueNode {
  if (spans.length === 0) return t2.any(src.slice(start, end));
  const parts: t2.InterpPart[] = [];
  let cursor = start;
  for (const s of spans) {
    if (s.start > cursor) parts.push({ lit: src.slice(cursor, s.start) });
    parts.push({ ref: t2.varRef(s.name), unquote });
    cursor = s.end;
  }
  if (cursor < end) parts.push({ lit: src.slice(cursor, end) });
  return t2.interp(parts);
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
    if (t2.isNode(c)) {
      if (node !== null) return null; // more than one value node → not whole-value
      node = c;
      idx = i;
    }
  }
  if (node === null) return null;
  const raw = args.rawChildren[idx] as { span?: Span } | undefined;
  return raw?.span && sliceSpan(args.ctx, raw.span) === valueBytes ? node : null;
}
