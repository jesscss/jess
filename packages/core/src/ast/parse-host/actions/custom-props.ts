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
// The parse-node `List` type is shadowed on the barrel by the value-domain `List`
// (index.ts re-exports value-eval's `List` explicitly), so import it DIRECTLY.
import type { List as ListNode } from '../../nodes.js';
import { type BuildAction, type BuildArgs, type Span, sliceSpan } from '../host-context.js';
import { isInterpRefNode, wholeValueNode } from './interp.js';

/* ------------------------------------------------ source-bytes value helpers */

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/** Drop a trailing `;` and any whitespace after it (non-regex mirror of `/;\s*$/`). */
function stripTrailingSemi(s: string): string {
  let i = s.length;
  while (i > 0 && isWs(s[i - 1]!)) i--;
  return i > 0 && s[i - 1] === ';' ? s.slice(0, i - 1) : s;
}

/**
 * Index where a trailing `!important` begins (consuming any surrounding /
 * interior whitespace, case-insensitive on the keyword), or -1 if `s` has none.
 * Non-regex mirror of `/\s*!\s*important\s*$/iu` — used both to DETECT (index >= 0)
 * and to STRIP (`s.slice(0, index)`) the marker recovered from a declaration's bytes.
 */
function importantStart(s: string): number {
  let i = s.length;
  while (i > 0 && isWs(s[i - 1]!)) i--;
  const kw = 'important';
  if (i < kw.length) return -1;
  for (let k = kw.length - 1; k >= 0; k--) {
    if (s[i - kw.length + k]!.toLowerCase() !== kw[k]) return -1;
  }
  i -= kw.length;
  while (i > 0 && isWs(s[i - 1]!)) i--;
  if (i === 0 || s[i - 1] !== '!') return -1;
  i--;
  while (i > 0 && isWs(s[i - 1]!)) i--;
  return i;
}

/** Strip a trailing `!important` (any spacing / case) from `s`, else return `s`. */
function stripImportant(s: string): string {
  const i = importantStart(s);
  return i < 0 ? s : s.slice(0, i);
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
  // A NAME position resolves BOTH `@{var}` (variable interpolation → `VarRef`) and
  // `${prop}` (property interpolation → `PropRef`, i.e. the VALUE of property `prop`
  // becomes part of the name — `${prop-name}: red` where `prop-name: color` yields
  // `color: red`). The sigil selects the ref kind; `evalInterp` resolves each.
  const re = /([@$])\{\s*([^}]+?)\s*\}/g;
  const parts: t2.InterpPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let sawRef = false;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
    const name = m[2]!;
    parts.push({ ref: m[1] === '$' ? t2.propRef(name) : t2.varRef(name), unquote });
    sawRef = true;
    last = m.index + m[0].length;
  }
  if (!sawRef) return t2.any(text);
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/** Strip a trailing `!important` from a value node's bytes (merged decls
 *  re-emit it once via the structured flag) — mirror of the bridge helper. */
function stripImportantBytes(v: t2.ValueNode): t2.ValueNode {
  if (t2.isLiteralNode(v)) {
    return t2.any(stripImportant(v.src));
  }
  return v;
}

/** A REGULAR declaration name (see the TODO above): bare string, or a `@{var}` /
 *  `${prop}` interpolation template. */
function declName(nameBytes: string): string | t2.Interp {
  if (!nameBytes.includes('@{') && !nameBytes.includes('${')) return nameBytes;
  const interp = interpFromString(nameBytes, false);
  return interp.type === 'Interp' ? (interp as t2.Interp) : nameBytes;
}

/** The declaration's source bytes with any trailing `;` dropped. */
function declBody(args: BuildArgs): string {
  return stripTrailingSemi(sliceSpan(args.ctx, args.span));
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
  // `wholeValueNode` is typed to the broad `Node` union; a value-position build only
  // yields value nodes, so narrow to `ValueNode` (as the return cast below already does).
  const vn = node as t2.ValueNode;
  const k = vn.type;
  return t2.isLiteralNode(vn) || k === 'VarRef' || k === 'Paren' || k === 'FunctionCall'
    || k === 'MapAccessor' || k === 'PropRef'
    ? vn
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
 * `Operation`, `FunctionCall`, `Paren`, or interpolation. A plain literal leaf /
 * `Dimension` leaf emits its bytes verbatim, so a value whose only built nodes are
 * those needs no assembly (the raw-bytes fallback is already byte-identical, and
 * cheaper). This is the gate that keeps every value that ALREADY worked untouched.
 */
function resolvesDifferently(node: t2.ValueNode): boolean {
  return !t2.isLiteralNode(node);
}

/** Every built value node the parser bounded within `[start, end)`, as source-ordered
 *  {@link Hole}s (each carrying its verbatim byte span). */
function collectHoles(args: BuildArgs, start: number, end: number): Hole[] {
  const holes: Hole[] = [];
  for (let i = 0; i < args.children.length; i++) {
    const node = asValueNode(args.children[i]);
    if (node === null) continue;
    const raw = args.rawChildren[i] as { span?: Span } | undefined;
    if (!raw?.span || raw.span.start < start || raw.span.end > end) continue;
    holes.push({ node, start: raw.span.start, end: raw.span.end });
  }
  holes.sort((a, b) => a.start - b.start);
  return holes;
}

/**
 * Assemble ONE contiguous value region `[start, end)` (already trimmed) from the
 * `holes` that fall in it. A region with no differently-resolving hole is a single
 * cheap verbatim `Any` (byte-identical + cheapest). Otherwise each built node is
 * interleaved with the verbatim source bytes between the nodes, so inert idents /
 * separators / exact spacing survive as literal `Any` gaps and refs / operations
 * resolve at serialize.
 */
function assembleRegion(src: string, holes: readonly Hole[], start: number, end: number): t2.ValueNode {
  const inRange = holes.filter((h) => h.start >= start && h.end <= end);
  if (!inRange.some((h) => resolvesDifferently(h.node))) return t2.any(src.slice(start, end));
  const parts: t2.ValueNode[] = [];
  let cursor = start;
  for (const h of inRange) {
    if (h.start > cursor) parts.push(t2.any(src.slice(cursor, h.start)));
    parts.push(h.node);
    cursor = h.end;
  }
  if (cursor < end) parts.push(t2.any(src.slice(cursor, end)));
  return parts.length === 1 ? parts[0]! : t2.sequence(parts);
}

/**
 * A multi-part / operated declaration value (`1px solid @a`, `@bg url(...) …`,
 * `1px solid (@bg * 0.66)`). The parser already isolated each operable component as
 * a built value node (`VarRef` / `Operation` / `FunctionCall` / `Paren`) among the
 * value children, and left the inert bytes (idents like `solid`, separators, the
 * exact whitespace) between them. This CONSUMES those built children (P0 — no
 * re-tokenizing of `ctx.src`): it interleaves each built node with the verbatim
 * source bytes that sit between the nodes, producing a `Sequence` (the shape
 * `nodes.ts` documents: `1px solid @c` → `Sequence[Any(...), VarRef]`).
 * At serialize time the `Sequence` resolves each ref / runs each operation and
 * emits the literal gaps verbatim, so un-operated components stay SOURCE-VERBATIM
 * (v5 rule) while operated / referenced ones canonicalize.
 *
 * Falls back to the verbatim-bytes `Any` (byte-identical to the prior behavior)
 * when nothing needs resolving, or when the reconstructed region does not match the
 * value bytes exactly (e.g. a trailing `!important` outside the built-node span).
 */
function assembleMultiPartValue(args: BuildArgs, valStart: number, valueBytes: string): t2.ValueNode {
  const src = args.ctx.src;
  const vEnd = valStart + valueBytes.length;
  // The value region must line up with the source bytes exactly (a re-derived
  // offset guards against any trailing-`!important` / trimming skew).
  if (src.slice(valStart, vEnd) !== valueBytes) return t2.any(valueBytes);
  return assembleRegion(src, collectHoles(args, valStart, vEnd), valStart, vEnd);
}

/**
 * Build a STRUCTURED comma-`List` from the value region `[valStart, valStart +
 * valueBytes.length)` when the parser bounded a top-level comma list there, else
 * `null`. The top-level `,` boundaries come from the grammar's `valueList`
 * separator LEAVES (P0 — the parser owns the structure; this consumes its comma
 * leaves, never a byte re-scan for a top-level comma). Each comma segment assembles
 * (via {@link assembleRegion}) to one lightweight lazy item — a cheap verbatim `Any`
 * for a static segment, or an interleaved ref/operation `Sequence` — so the list
 * stays STRUCTURED (indexable by `extract` / `length` / list-equality without a byte
 * re-parse) yet un-canonicalized. A dangling trailing `,` (Less tolerates `a, b,`)
 * yields an empty final segment that is dropped; a lone segment (`a,`) is not a list
 * (returns `null` so the single-value path builds it).
 */
export function buildValueList(args: BuildArgs, valStart: number, valueBytes: string): ListNode | null {
  const src = args.ctx.src;
  const vEnd = valStart + valueBytes.length;
  if (src.slice(valStart, vEnd) !== valueBytes) return null;
  // Top-level `,` separator leaves within the value region (comma leaves nested in a
  // paren/call are consumed inside that built child, never a top-level child here).
  const commas: Array<{ start: number; end: number }> = [];
  for (const c of args.children) {
    if (leafValue(c) !== ',') continue;
    const s = leafSpan(c);
    if (s && s.start >= valStart && s.end <= vEnd) commas.push(s);
  }
  if (commas.length === 0) return null;
  commas.sort((a, b) => a.start - b.start);
  const holes = collectHoles(args, valStart, vEnd);
  // Split the value into trimmed segments at the comma boundaries. Each kept
  // segment records its own [ts, te) so the verbatim source BETWEEN consecutive
  // segments (the comma + authored whitespace) becomes the emitted separator.
  const segs: Array<{ node: t2.ValueNode; ts: number; te: number }> = [];
  const pushSeg = (s: number, e: number): void => {
    let ts = s;
    let te = e;
    while (ts < te && isWs(src[ts]!)) ts++;
    while (te > ts && isWs(src[te - 1]!)) te--;
    if (ts < te) segs.push({ node: assembleRegion(src, holes, ts, te), ts, te });
  };
  let segStart = valStart;
  for (const comma of commas) {
    pushSeg(segStart, comma.start);
    segStart = comma.end;
  }
  pushSeg(segStart, vEnd);
  // A single non-empty segment (a dangling `a,`) is one value, not a list.
  if (segs.length < 2) return null;
  const separators: string[] = [];
  for (let i = 1; i < segs.length; i++) separators.push(src.slice(segs[i - 1]!.te, segs[i]!.ts));
  return t2.list(segs.map((s) => s.node), separators);
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
    if (colonIdx < 0) return t2.decl(stripTrailingSemi(sliceSpan(args.ctx, args.span)).trim(), t2.any(''), null, false);

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
    if (src.slice(vStart, ve).trim() === '') return t2.decl(name, t2.any(''), null, false);
    const vs = src[vStart] === ' ' || src[vStart] === '\t' ? vStart + 1 : vStart;
    // `@{…}` value tokens are now structured `LessInterp` nodes the grammar built into
    // ref value nodes (`VarRef` / `MapAccessor`) in `children`, index-aligned with the
    // span-carrying `rawChildren` placeholders. Splice each BUILT ref inside the value
    // region (`@{name}` resolves the variable, `@{map[key]}` the accessor) with the
    // gaps between them carried VERBATIM (bare `@var` / comments / spacing stay
    // literal). No `@{…}` ref → the whole value is one verbatim `Any` (byte-identical).
    const interpToks: Array<{ ref: t2.ValueNode; start: number; end: number }> = [];
    for (let i = 0; i < args.children.length; i++) {
      const b = args.children[i];
      const rc = args.rawChildren[i] as { span?: Span } | undefined;
      if (isInterpRefNode(b) && rc?.span && rc.span.start >= vs && rc.span.end <= ve) {
        interpToks.push({ ref: b, start: rc.span.start, end: rc.span.end });
      }
    }
    if (interpToks.length === 0) return t2.decl(name, t2.any(src.slice(vs, ve)), null, false);
    const parts: t2.InterpPart[] = [];
    let cursor = vs;
    for (const t of interpToks) {
      if (t.start > cursor) parts.push({ lit: src.slice(cursor, t.start) });
      parts.push({ ref: t.ref, unquote: true });
      cursor = t.end;
    }
    if (cursor < ve) parts.push({ lit: src.slice(cursor, ve) });
    return t2.decl(name, t2.interp(parts), null, false);
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
    if (colon < 0) return t2.decl(body.trim(), t2.any(''), null, false);

    const namePart = body.slice(0, colon).trimEnd();
    let merge: null | ',' | ' ' = null;
    if (namePart.endsWith('+_')) merge = ' ';
    else if (namePart.endsWith('+')) merge = ',';
    const important = importantStart(body) >= 0;

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
    // [whitespace] A NEWLINE in the authored gap after `:`, PLUS a value that
    // itself spans multiple lines, means the value was written on its own line
    // (multi-line `grid-template-areas`). v5 preserves that layout — the value
    // emits starting on the next line. A single-line value after a bare `:`
    // newline (`color:\n  white`) still collapses onto `: `, matching Less.
    const valueOnNewLine =
      rawValue.slice(0, leadingWs).indexOf('\n') !== -1 && valueBytes.indexOf('\n') !== -1;
    // A merged decl re-emits `!important` once via the structured flag, so strip it
    // from the value bytes FIRST — then the whole-value strategy can STRUCTURE the
    // remainder (e.g. `scale(2,4)` → a FunctionCall that canonicalizes to
    // `scale(2, 4)`) instead of freezing the whole run (incl. `!important`) as raw
    // bytes. Only the merge path strips (non-merge value handling is unchanged).
    const coreBytes = merge !== null && important
      ? stripImportant(valueBytes)
      : valueBytes;
    let value: t2.ValueNode =
      consumableWholeValue(args, coreBytes)
      ?? (merge === null
        ? (buildValueList(args, valStart, coreBytes) ?? assembleMultiPartValue(args, valStart, coreBytes))
        : t2.any(coreBytes));
    // Defensive: a raw-bytes merge value already had `!important` removed above; this
    // also covers any literal that still trails one.
    if (merge !== null && important) value = stripImportantBytes(value);
    return t2.decl(name, value, merge, important, valueOnNewLine);
  },
};

export const CUSTOM_PROPS_ACTIONS: readonly BuildAction[] = [customDeclaration, declaration];
