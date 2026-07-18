/**
 * Shared interpolation + whole-value consumers.
 *
 * P0 (parser is the sole source of structure): these helpers CONSUME the leaves /
 * built children the grammar already produced — they never re-tokenize `ctx.src`
 * or regex-hunt for `@{…}` boundaries to REBUILD structure. Two consumers, reused
 * across the selector / declaration / variable families (P4 DRY):
 *
 *   • `interpFromChildren` — the grammar splits an interpolation-bearing position
 *     (selector / string) into ordered children: literal-chunk leaves interspersed
 *     with the built `LessInterp` ref nodes (`.a-@{n}` → leaf `.`, leaf `a-`, the
 *     built `@{n}` ref). Each ref node becomes an interpolation part, every leaf is a
 *     literal chunk. No scan of the surrounding source, no re-scan of the `@{…}` body.
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

/** A structured interpolation reference the `LessInterp` action built (`@{name}` →
 *  `VarRef`, `@{map[key]}` → `MapAccessor`). The grammar STRUCTURES the `@{…}` body
 *  into a `LessInterp` node whose action returns one of these value nodes, so this is
 *  the built ref child that sits among a selector / string's literal-chunk leaves. */
export function isInterpRefNode(x: unknown): x is t2.ValueNode {
  if (!t2.isNode(x)) return false;
  const t = x.type;
  return t === 'VarRef' || t === 'PropRef' || t === 'VarIndirect' || t === 'MapAccessor';
}

/**
 * Build an `Interp` from the ORDERED children the grammar produced for an
 * interpolation-bearing position — literal-chunk leaves interspersed with the built
 * `LessInterp` ref nodes (`.a-@{n}` → leaf `.`, leaf `a-`, `LessInterp(@{n})`; a
 * quoted string → quote/chunk leaves + `LessInterp` nodes). Returns `null` when no
 * `@{…}` ref is present (a plain string / selector with no interpolation), so the
 * caller keeps its byte-identical flat shape. Adjacent literal leaves coalesce into
 * one part. `unquote` rides on each spliced ref (selector context passes `false`).
 *
 * P0 (parser is the sole source of structure): the ref parts come from the grammar's
 * `LessInterp` children — this NEVER re-scans the `@{…}` body bytes to rebuild the
 * head/accessor split. A chunk leaf that merely STARTS with `@{` (a false-start the
 * `Quoted` grammar kept literal, e.g. `@{box-` in `"@{box-@{suffix}}"`) is a plain
 * leaf, never a `LessInterp` node, so it stays literal — matching strict §4.1.
 */
export function interpFromChildren(children: readonly unknown[], unquote: boolean): t2.Interp | null {
  const parts: t2.InterpPart[] = [];
  let lit = '';
  let sawRef = false;
  const flush = (): void => {
    if (lit) {
      parts.push({ lit });
      lit = '';
    }
  };
  for (const c of children) {
    if (isInterpRefNode(c)) {
      flush();
      parts.push({ ref: c, unquote });
      sawRef = true;
    } else if (isLeaf(c)) {
      lit += c.value;
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
 * Build a value from a prelude / name-position byte string, resolving ONLY `@{…}`
 * interpolation (`@charset "UTF-@{Eight}"`, `@namespace @{ns} "…"`): a bare `@var`
 * stays literal, matching Less's statement-prelude rule. With no `@{…}` the whole
 * string is one verbatim `Any`, so the common case round-trips byte-for-byte.
 *
 * TODO(tier-b/A4): this `@{…}` byte re-tokenizer is the SAME accepted interim shape
 * the query-prelude (`at-rules.ts`) / custom-prop-name (`custom-props.ts`) positions
 * use — a statement at-rule delivers its prelude as recovered bytes / one `atPrelude`
 * leaf, NOT split `@{…}` leaves. RETIREMENT TRIGGER — split the statement prelude
 * grammar into leaves + consume via `interpFromRegion` when the legacy BuilderHost is
 * retired (reorg Phase A4).
 */
export function interpFromBytes(text: string, unquote: boolean): t2.ValueNode {
  if (text.indexOf('@{') < 0) return t2.any(text);
  const re = /@\{\s*([^}]+?)\s*\}/g;
  const parts: t2.InterpPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let sawRef = false;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
    parts.push({ ref: t2.varRef(m[1]!), unquote });
    sawRef = true;
    last = m.index + m[0].length;
  }
  if (!sawRef) return t2.any(text);
  if (last < text.length) parts.push({ lit: text.slice(last) });
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
