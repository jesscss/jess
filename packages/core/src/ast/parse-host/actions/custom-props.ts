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
 *     multi-token / top-level-operation value keeps its verbatim source bytes, so
 *     plain declarations stay byte-identical to the seed while merge/important
 *     shapes fold at serialize time. `ACTION_LIST` is later-wins, so appending this
 *     family supersedes the seed's `Declaration` entry.
 *
 * TOTAL: parseman speculatively builds backtracked branches, so neither action
 * throws on a doomed shape — a colon-less span degrades to an inert declaration
 * that a discarded branch (or a parent re-deriving from source) drops.
 */
import * as t2 from '../../index.js';
import { type BuildAction, type BuildArgs, sliceSpan } from '../host-context.js';
import { wholeValueNode } from './interp.js';

/* ------------------------------------------------ source-bytes value helpers */

/**
 * TODO(tier-b): custom-property interpolation is a PARSER GAP. Unlike an
 * `InterpolatedSelector` (split into `.`/`a-`/`@{n}` leaves), the custom-prop name
 * and value arrive as an OPAQUE token run (`--n: @{base}px` splits as `--n`, `:`,
 * `@{base`… not a clean `@{base}` leaf), so there is no structured child to
 * consume — this helper must still tokenize the `@{…}` bytes itself. Split these in
 * `grammar.ts` (like `InterpolatedSelector`), then consume the leaves here.
 *
 * Build an `Interp` from raw bytes containing `@{name}` tokens (mirror of the
 * bridge's `interpFromString`). `unquote` controls whether spliced refs strip a
 * surrounding quote layer (true in value/string context, false in property-name
 * context). With no `@{…}` present the bytes stay a verbatim `Word`.
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

/** A declaration name: a bare string, or an `@{…}`-interpolated template.
 *  TODO(tier-b): see `interpFromString` — the interpolated NAME is an opaque token
 *  run too (`--@{k}` → `--@`, `{`, `k`, `}`), so it is tokenized here rather than
 *  consumed as split leaves. */
function declName(nameBytes: string): string | t2.Interp {
  if (!nameBytes.includes('@{')) return nameBytes;
  const interp = interpFromString(nameBytes, false);
  // `@{…}` was present, so `interpFromString` returned an `Interp`; a doomed span
  // without a real ref falls back to the raw string.
  return interp.type === 'Interp' ? (interp as t2.Interp) : nameBytes;
}

/** The declaration's source bytes with any trailing `;` dropped. */
function declBody(args: BuildArgs): string {
  return sliceSpan(args.ctx, args.span).replace(/;\s*$/u, '');
}

/**
 * The single whole-value built node the parser bounded, when it is a shape this
 * family structures at the declaration level (an F5 value leaf, an F1 `VarRef`, or
 * an F6/F7 `Paren` / `FunctionCall`). A top-level `Operation` / `SpacedValue` is
 * deliberately EXCLUDED — the bridge's declaration value for `1 + 2` / `12px/1.5`
 * is a raw `Word` (those `Operation` nodes are only the operands a paren / call
 * body consumes), so the source-bytes fallback stays byte-identical to the bridge.
 */
function consumableWholeValue(args: BuildArgs, valueBytes: string): t2.ValueNode | null {
  const node = wholeValueNode(args, valueBytes);
  if (node === null) return null;
  const k = node.type;
  return k === 'Word' || k === 'VarRef' || k === 'Paren' || k === 'FunctionCall'
    ? (node as t2.ValueNode)
    : null;
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
    const body = declBody(args);
    const colon = body.indexOf(':');
    if (colon < 0) return t2.decl(body.trim(), t2.word(''), null, false);
    const name = declName(body.slice(0, colon).trim());
    let raw = body.slice(colon + 1);
    if (raw.trim() === '') return t2.decl(name, t2.word(''), null, false);
    if (raw[0] === ' ' || raw[0] === '\t') raw = raw.slice(1);
    return t2.decl(name, interpFromString(raw, true), null, false);
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

    // Value strategy mirrors the F0/F5 static-decl seed: consume the single built
    // WHOLE-value node the parser bounded (leaf / ref / paren / call); otherwise
    // re-derive from the verbatim source bytes — no re-tokenizing of `@name` refs
    // the parser already isolated as `Reference` children.
    const valueBytes = body.slice(colon + 1).trim();
    let value: t2.ValueNode = consumableWholeValue(args, valueBytes) ?? t2.word(valueBytes);
    // A merged decl carrying `!important` in its bytes strips it (the structured
    // flag re-emits it once at the end of the combined line).
    if (merge !== null && important) value = stripImportantBytes(value);
    return t2.decl(name, value, merge, important);
  },
};

export const CUSTOM_PROPS_ACTIONS: readonly BuildAction[] = [customDeclaration, declaration];
