/**
 * Custom-property + merge declaration family.
 *
 * Two grammar types, both emitted DIRECTLY from the declaration's source span
 * (mirroring the bridge's `case 'CustomDeclaration'` / `case 'Declaration'`
 * derivations — the oracle — without walking the legacy tree):
 *
 *   • `CustomDeclaration` — a `--x: <value>` custom property. v5 keeps the value
 *     VERBATIM (custom properties carry any token stream; bare `@var`/functions/
 *     inline `!important` stay literal); ONLY `@{…}` interpolation is resolved.
 *     Never structured/evaluated as a Less value (mirror of `customDeclValue`).
 *
 *   • `Declaration` — OVERRIDES the F0 static-declaration seed to add the `+`/`+_`
 *     MERGE marker + structured `!important`, both recovered from the source bytes
 *     exactly like the bridge's `detectMergeImportant`. The value consumes the
 *     single WHOLE-value built node the parser bounded (an F5 value leaf, an F1
 *     `VarRef`, or an F6/F7 paren / call — via the shared `wholeValueNode`); a
 *     MULTI-PART value (`1px solid @a`, `@bg url(…) …`, `1px solid (@bg * .5)`) is
 *     ASSEMBLED — each operable component the parser isolated (var ref / operation /
 *     call) is interleaved with the verbatim source bytes between components into a
 *     `Sequence`, so at serialize time refs resolve and operations run while inert
 *     idents / separators / spacing stay source-VERBATIM (v5). A value with no
 *     operable component keeps its raw bytes (byte-identical to the seed). A merged
 *     (`+`/`+_`) value stays raw-bytes (its `!important` is re-emitted by the flag,
 *     which the `Sequence` shape would double). `ACTION_LIST` is later-wins, so
 *     appending this family supersedes the seed's `Declaration` entry.
 *
 * TOTAL: parseman speculatively builds backtracked branches, so neither action
 * throws on a doomed shape — a colon-less span degrades to an inert declaration
 * that a discarded branch (or a parent re-deriving from source) drops.
 */
import * as t2 from '../../index.js';
import { type BuildAction, type BuildArgs, type Span, sliceSpan } from '../host-context.js';
import { type InterpSpan, interpFromRegion, wholeValueNode } from './interp.js';

/* ------------------------------------------------ source-bytes value helpers */

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/** The string value of a parseman leaf child, or `undefined` for a non-leaf. */
function leafValue(x: unknown): string | undefined {
  const leaf = x as { _tag?: string; value?: unknown } | undefined;
  return leaf?._tag === 'leaf' && typeof leaf.value === 'string' ? leaf.value : undefined;
}
/** The source span of a leaf child, if it carries one. */
function leafSpan(x: unknown): Span | undefined {
  return (x as { span?: Span } | undefined)?.span;
}
/** A leaf's `@{name}` interpolation span, or `null` for any other leaf. */
function interpSpanOf(x: unknown): InterpSpan | null {
  const v = leafValue(x);
  const s = leafSpan(x);
  if (v === undefined || s === undefined) return null;
  if (v.charCodeAt(0) !== 0x40 /* @ */ || v.charCodeAt(1) !== 0x7b /* { */) return null;
  return { start: s.start, end: s.end, name: v.slice(2, -1).trim() };
}

/**
 * TODO(tier-b/A4): WHAT — `interpFromString` + `declName` (this file's only remaining
 * `@{…}` regex re-tokenizers) tokenize the CUSTOM-prop interpolated NAME (`--@{k}`)
 * and the REGULAR declaration's interpolated PROPERTY name (`@{prop}: v`). WHY —
 * (a) cp-NAME: the grammar's `customPropInterp` is kept as ONE leaf because the legacy
 * BuilderHost that drives the less-compat bridge consumes that single-leaf shape;
 * splitting it into `@{…}` leaves regressed the bridge's name emission (`--@{k}` →
 * `--`), an external-contract break. (b) regular-decl name: its `declPropName` is one
 * opaque leaf (a separate, un-structured shape). RETIREMENT TRIGGER — split
 * `customPropInterp` (and `declPropName`) into leaves + consume via `interpFromRegion`
 * when the legacy BuilderHost is retired (reorg Phase A4). The custom-prop VALUE is
 * already leaf-consumed (grammar-structured, legacy-tolerant).
 */
function interpFromString(text: string, unquote: boolean): t2.ValueNode {
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
  if (!sawRef) return t2.word(text);
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/** Strip a trailing `!important` from a value node's bytes (merged decls
 *  re-emit it once via the structured flag) — mirror of the bridge helper. */
function stripImportantBytes(v: t2.ValueNode): t2.ValueNode {
  if (v.type === 'Word') {
    return t2.word((v as t2.Word).text.replace(/\s*!\s*important\s*$/iu, ''));
  }
  return v;
}

/** A REGULAR declaration name (see the TODO above): bare string, or `@{…}` template. */
function declName(nameBytes: string): string | t2.Interp {
  if (!nameBytes.includes('@{')) return nameBytes;
  const interp = interpFromString(nameBytes, false);
  return interp.type === 'Interp' ? (interp as t2.Interp) : nameBytes;
}

/** The declaration's source bytes with any trailing `;` dropped. */
function declBody(args: BuildArgs): string {
  return sliceSpan(args.ctx, args.span).replace(/;\s*$/u, '');
}

/**
 * The single whole-value built node the parser bounded, when it is a shape this
 * family structures at the declaration level (an F5 value leaf, an F1 `VarRef`, or
 * an F6/F7 `Paren` / `FunctionCall`). A whole-value top-level `Operation` /
 * `SpacedValue` is not returned here — it flows to `assembleMultiPartValue`, which
 * consumes it (the direct path has no separate eval pass, so a top-level operation
 * must be STRUCTURED to evaluate at serialize; `12px/1.5` serializes as a slash
 * list, `@a * .5 + @b * .5` computes).
 */
function consumableWholeValue(args: BuildArgs, valueBytes: string): t2.ValueNode | null {
  const node = wholeValueNode(args, valueBytes);
  if (node === null) return null;
  const k = node.type;
  return k === 'Word' || k === 'VarRef' || k === 'Paren' || k === 'FunctionCall'
    ? (node as t2.ValueNode)
    : null;
}

/* ---------------------------------------------- multi-part value assembly */

/** A built value node the parser bounded, plus its verbatim source span. */
interface Hole {
  readonly node: t2.ValueNode;
  readonly start: number;
  readonly end: number;
}

/** A value node built by the grammar (declines a raw parseman leaf token). */
function asValueNode(x: unknown): t2.ValueNode | null {
  return t2.isNode(x) ? (x as t2.ValueNode) : null;
}

/**
 * A hole that emits DIFFERENTLY from its verbatim source bytes — a `VarRef`,
 * `Operation`, `FunctionCall`, `Paren`, or interpolation. A plain `Word` /
 * `Dimension` leaf emits its bytes verbatim, so a value whose only built nodes are
 * those needs no assembly (the raw-bytes fallback is already byte-identical, and
 * cheaper). This is the gate that keeps every value that ALREADY worked untouched.
 */
function resolvesDifferently(node: t2.ValueNode): boolean {
  return node.type !== 'Word' && node.type !== 'Dimension';
}

/**
 * A multi-part / operated declaration value (`1px solid @a`, `@bg url(...) …`,
 * `1px solid (@bg * 0.66)`). The parser already isolated each operable component as
 * a built value node (`VarRef` / `Operation` / `FunctionCall` / `Paren`) among the
 * value children, and left the inert bytes (idents like `solid`, separators, the
 * exact whitespace) between them. This CONSUMES those built children (P0 — no
 * re-tokenizing of `ctx.src`): it interleaves each built node with the verbatim
 * source bytes that sit between the nodes, producing a `Sequence` (the shape
 * `nodes.ts` documents: `1px solid @c` → `Sequence[Word('1px solid '), VarRef]`).
 * At serialize time the `Sequence` resolves each ref / runs each operation and
 * emits the literal gaps verbatim, so un-operated components stay SOURCE-VERBATIM
 * (v5 rule) while operated / referenced ones canonicalize.
 *
 * Falls back to the verbatim-bytes `Word` (byte-identical to the prior behavior)
 * when nothing needs resolving, or when the reconstructed region does not match the
 * value bytes exactly (e.g. a trailing `!important` outside the built-node span).
 */
function assembleMultiPartValue(args: BuildArgs, valStart: number, valueBytes: string): t2.ValueNode {
  const src = args.ctx.src;
  const vEnd = valStart + valueBytes.length;
  // The value region must line up with the source bytes exactly (a re-derived
  // offset guards against any trailing-`!important` / trimming skew).
  if (src.slice(valStart, vEnd) !== valueBytes) return t2.word(valueBytes);

  const holes: Hole[] = [];
  let anyResolves = false;
  for (let i = 0; i < args.children.length; i++) {
    const node = asValueNode(args.children[i]);
    if (node === null) continue;
    const raw = args.rawChildren[i] as { span?: Span } | undefined;
    if (!raw?.span || raw.span.start < valStart || raw.span.end > vEnd) continue;
    holes.push({ node, start: raw.span.start, end: raw.span.end });
    if (resolvesDifferently(node)) anyResolves = true;
  }
  // No operable component → the raw bytes are already byte-identical (and cheaper).
  if (!anyResolves) return t2.word(valueBytes);
  holes.sort((a, b) => a.start - b.start);

  // Interleave each built node with the verbatim source bytes between the nodes,
  // so inert idents / separators / exact spacing survive as literal `Word` gaps.
  const parts: t2.ValueNode[] = [];
  let cursor = valStart;
  for (const h of holes) {
    if (h.start > cursor) parts.push(t2.word(src.slice(cursor, h.start)));
    parts.push(h.node);
    cursor = h.end;
  }
  if (cursor < vEnd) parts.push(t2.word(src.slice(cursor, vEnd)));
  return parts.length === 1 ? parts[0]! : t2.sequence(parts);
}

/* --------------------------------------------------------------- actions */

/**
 * `--x: <value>` — value kept VERBATIM (only `@{…}` interpolation resolved). The
 * serializer emits `name: value`, so one leading whitespace char after the colon
 * is dropped to keep the authored inner spacing byte-faithful (identical to the
 * bridge's `customDeclValue`); a whitespace-only value collapses to empty.
 */
const customDeclaration: BuildAction = {
  type: 'CustomDeclaration',
  build: (args) => {
    const { children } = args;
    const src = args.ctx.src;
    // The grammar splits the head into leaves: the name token run (`--` + ident
    // chunks + isolated `@{…}` leaves), the `:` leaf, the value token run (`@{…}`
    // leaves isolated among opaque content), and an optional `;`. This CONSUMES
    // those leaves — the `@{…}` boundaries come from the parser's leaf spans, the
    // gaps are verbatim source (bare `@var` / comments / spacing stay literal).
    let colonIdx = -1;
    for (let i = 0; i < children.length; i++) {
      if (leafValue(children[i]) === ':') {
        colonIdx = i;
        break;
      }
    }
    // TOTAL: a colon-less doomed branch degrades to an inert declaration.
    if (colonIdx < 0) return t2.decl(sliceSpan(args.ctx, args.span).replace(/;\s*$/u, '').trim(), t2.word(''), null, false);

    const colonSpan = leafSpan(children[colonIdx])!;
    // NAME: from the first child leaf to the colon, outer-trimmed. The interpolated
    // NAME stays ONE grammar leaf (the legacy bridge consumes that shape — see the
    // grammar comment), so it is tokenized by `declName` for now; the name-leaf split
    // is DEFERRED to the legacy-builder retirement (the VALUE below IS leaf-consumed).
    let ns = leafSpan(children[0])?.start ?? args.span.start;
    let ne = colonSpan.start;
    while (ns < ne && isWs(src[ns]!)) ns++;
    while (ne > ns && isWs(src[ne - 1]!)) ne--;
    const name = declName(src.slice(ns, ne));

    // VALUE: from after the colon to the terminating `;` (or the declaration end).
    // A whitespace-only value collapses to empty; otherwise drop ONE leading
    // whitespace char (the serializer re-adds `name: value`) and keep the rest —
    // including trailing spacing before the `;` — verbatim, matching the old slice.
    let ve = args.span.end;
    const lastLeaf = children[children.length - 1];
    if (leafValue(lastLeaf) === ';') ve = leafSpan(lastLeaf)?.start ?? ve;
    const vStart = colonSpan.end;
    if (src.slice(vStart, ve).trim() === '') return t2.decl(name, t2.word(''), null, false);
    const vs = src[vStart] === ' ' || src[vStart] === '\t' ? vStart + 1 : vStart;
    const valueSpans: InterpSpan[] = [];
    for (let i = colonIdx + 1; i < children.length; i++) {
      const s = interpSpanOf(children[i]);
      if (s !== null && s.start >= vs && s.end <= ve) valueSpans.push(s);
    }
    return t2.decl(name, interpFromRegion(src, vs, ve, valueSpans, true), null, false);
  },
};

/**
 * `name[+|+_]: value [!important]` — a regular declaration with the merge marker
 * + structured `!important` recovered from source. Supersedes the F0 static-decl
 * seed (later-wins); plain declarations stay byte-identical to the seed.
 */
const declaration: BuildAction = {
  type: 'Declaration',
  build: (args) => {
    const body = declBody(args);
    const colon = body.indexOf(':');
    // TOTAL: a colon-less span is a doomed/backtracked branch — inert node.
    if (colon < 0) return t2.decl(body.trim(), t2.word(''), null, false);

    const namePart = body.slice(0, colon).replace(/\s+$/u, '');
    let merge: null | ',' | ' ' = null;
    if (namePart.endsWith('+_')) merge = ' ';
    else if (namePart.endsWith('+')) merge = ',';
    const important = /!\s*important\s*$/iu.test(body);

    let nameBytes = namePart;
    if (merge === ' ') nameBytes = nameBytes.slice(0, -2);
    else if (merge === ',') nameBytes = nameBytes.slice(0, -1);
    const name = declName(nameBytes.trim());

    // Value strategy: consume the single built WHOLE-value node the parser bounded
    // (leaf / ref / paren / call); else ASSEMBLE a multi-part value — interleaving
    // each built component (var ref / operation / call) with the verbatim source
    // bytes between them (P0 — no re-tokenizing of the `@name` refs the parser
    // already isolated). A merged (`+`/`+_`) value keeps the raw-bytes fallback: its
    // `!important` is re-emitted by the structured flag, which the `Sequence` shape
    // would double — an uncommon merged-multipart-var case left byte-safe.
    const rawValue = body.slice(colon + 1);
    const leadingWs = rawValue.length - rawValue.trimStart().length;
    const valStart = args.span.start + colon + 1 + leadingWs;
    const valueBytes = rawValue.trim();
    // A merged decl re-emits `!important` once via the structured flag, so strip it
    // from the value bytes FIRST — then the whole-value strategy can STRUCTURE the
    // remainder (e.g. `scale(2,4)` → a FunctionCall that canonicalizes to
    // `scale(2, 4)`) instead of freezing the whole run (incl. `!important`) as raw
    // bytes. Only the merge path strips (non-merge value handling is unchanged).
    const coreBytes = merge !== null && important
      ? valueBytes.replace(/\s*!\s*important\s*$/iu, '')
      : valueBytes;
    let value: t2.ValueNode =
      consumableWholeValue(args, coreBytes)
      ?? (merge === null ? assembleMultiPartValue(args, valStart, coreBytes) : t2.word(coreBytes));
    // Defensive: a raw-bytes merge value already had `!important` removed above; this
    // also covers any Word that still trails one.
    if (merge !== null && important) value = stripImportantBytes(value);
    return t2.decl(name, value, merge, important);
  },
};

export const CUSTOM_PROPS_ACTIONS: readonly BuildAction[] = [customDeclaration, declaration];
