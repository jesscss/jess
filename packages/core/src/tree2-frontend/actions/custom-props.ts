/**
 * [tree2-native] Custom-property + merge declaration family (F2).
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
 *     exactly like the bridge's `detectMergeImportant`. The value reuses the same
 *     source-bytes strategy as the seed (a single built value leaf when the value
 *     family produced one, else the verbatim value bytes), so plain declarations
 *     stay byte-identical while merge/important shapes fold at serialize time.
 *     `ACTION_LIST` is later-wins, so appending this family supersedes the seed's
 *     `Declaration` entry.
 *
 * TOTAL: parseman speculatively builds backtracked branches, so neither action
 * throws on a doomed shape — a colon-less span degrades to an inert declaration
 * that a discarded branch (or a parent re-deriving from source) drops.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, type BuildArgs, type Span, sliceSpan } from '../host-context.js';

/* ------------------------------------------------ source-bytes value helpers */

/**
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

/**
 * Tokenize static value bytes into a tree2 value (mirror of the bridge's
 * `parseValue`): bare `@name` → `VarRef`, `@@name` → `VarIndirect`, `@{…}` →
 * `Interp`, everything else literal. A value with no `@` is a bare `Word`.
 */
function parseValue(text: string): t2.ValueNode {
  if (text.indexOf('@') < 0) return t2.word(text);
  const indirect = /^@@([A-Za-z_][\w-]*)$/u.exec(text.trim());
  if (indirect) return t2.varIndirect(t2.varRef(indirect[1]!));
  if (text.includes('@{')) return interpFromString(text, true);
  const re = /@([A-Za-z_][\w-]*)/gu;
  const parts: t2.ValueNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(t2.word(text.slice(last, m.index)));
    parts.push(t2.varRef(m[1]!));
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return t2.word(text);
  if (last < text.length) parts.push(t2.word(text.slice(last)));
  return parts.length === 1 ? parts[0]! : t2.concat(parts);
}

/** Strip a trailing `!important` from a value node's bytes (merged decls
 *  re-emit it once via the structured flag) — mirror of the bridge helper. */
function stripImportantBytes(v: t2.ValueNode): t2.ValueNode {
  if (v.kind === t2.Kind.Word) {
    return t2.word((v as t2.Word).text.replace(/\s*!\s*important\s*$/iu, ''));
  }
  return v;
}

/** A declaration name: a bare string, or an `@{…}`-interpolated template. */
function declName(nameBytes: string): string | t2.Interp {
  if (!nameBytes.includes('@{')) return nameBytes;
  const interp = interpFromString(nameBytes, false);
  // `@{…}` was present, so `interpFromString` returned an `Interp`; a doomed span
  // without a real ref falls back to the raw string.
  return interp.kind === t2.Kind.Interp ? (interp as t2.Interp) : nameBytes;
}

/** The declaration's source bytes with any trailing `;` dropped. */
function declBody(args: BuildArgs): string {
  return sliceSpan(args.ctx, args.span).replace(/;\s*$/u, '');
}

/** The value's source span `[start,end)` within a `name: value` declaration span. */
function valueSpan(src: string, start: number, end: number): { start: number; end: number } | null {
  const body = src.slice(start, end).replace(/;\s*$/u, '');
  const colon = body.indexOf(':');
  if (colon < 0) return null;
  let i = colon + 1;
  while (i < body.length && /\s/u.test(body[i]!)) i++;
  let j = body.length;
  while (j > i && /\s/u.test(body[j - 1]!)) j--;
  return { start: start + i, end: start + j };
}

/**
 * [F6/F7] A whole-value computed node (`Paren` / `FunctionCall`) whose source span
 * equals the declaration's value span, else `null`. These are the shapes the
 * bridge structures at the declaration level; a top-level `Operation` /
 * `SpacedValue` is deliberately NOT consumed here (the bridge's declaration value
 * for `1 + 2` / `12px/1.5` is a raw Word — those `Operation` nodes are only the
 * operands paren / call bodies consume), so the source-bytes fallback stays
 * byte-identical to the bridge. Span coverage rejects a trailing `!important`.
 */
function wholeValueComputed(args: BuildArgs): t2.ValueNode | null {
  let node: t2.ValueNode | null = null;
  let idx = -1;
  for (let k = 0; k < args.children.length; k++) {
    if (args.children[k] instanceof t2.Node) {
      if (node !== null) return null; // more than one value node → not whole-value
      node = args.children[k] as t2.ValueNode;
      idx = k;
    }
  }
  if (node === null) return null;
  if (node.kind !== t2.Kind.Paren && node.kind !== t2.Kind.FunctionCall) return null;
  const vSpan = valueSpan(args.ctx.src, args.span.start, args.span.end);
  const raw = args.rawChildren[idx] as { span?: Span } | undefined;
  if (!vSpan || !raw?.span) return null;
  return raw.span.start === vSpan.start && raw.span.end === vSpan.end ? node : null;
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
    if (colon < 0) return new t2.Declaration(body.trim(), t2.word(''), null, false);
    const name = declName(body.slice(0, colon).trim());
    let raw = body.slice(colon + 1);
    if (raw.trim() === '') return new t2.Declaration(name, t2.word(''), null, false);
    if (raw[0] === ' ' || raw[0] === '\t') raw = raw.slice(1);
    return new t2.Declaration(name, interpFromString(raw, true), null, false);
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
    if (colon < 0) return new t2.Declaration(body.trim(), t2.word(''), null, false);

    const namePart = body.slice(0, colon).replace(/\s+$/u, '');
    let merge: null | ',' | ' ' = null;
    if (namePart.endsWith('+_')) merge = ' ';
    else if (namePart.endsWith('+')) merge = ',';
    const important = /!\s*important\s*$/iu.test(body);

    let nameBytes = namePart;
    if (merge === ' ') nameBytes = nameBytes.slice(0, -2);
    else if (merge === ',') nameBytes = nameBytes.slice(0, -1);
    const name = declName(nameBytes.trim());

    // Value strategy mirrors the F0/F5 static-decl seed: consume a built value
    // node ONLY when it is a single leaf `Word` spanning the WHOLE value (the
    // whole-value guard — a fragment leaf like `1px solid red` → only `red` must
    // NOT collapse the value); otherwise re-derive from the verbatim source bytes.
    const valueBytes = body.slice(colon + 1).trim();
    const built = args.children.filter((c): c is t2.ValueNode => c instanceof t2.Node);
    let value: t2.ValueNode = parseValue(valueBytes);
    if (built.length === 1 && built[0]!.kind === t2.Kind.Word && (built[0]! as t2.Word).text === valueBytes) {
      value = built[0]!; // F5 leaf (`red`, `10px`, …)
    } else {
      // [F6/F7] a whole-value Paren / FunctionCall (`rgb(1,2,3)`, `(1 + 2)`, calc()).
      const computed = wholeValueComputed(args);
      if (computed !== null) value = computed;
    }
    // A merged decl carrying `!important` in its bytes strips it (the structured
    // flag re-emits it once at the end of the combined line).
    if (merge !== null && important) value = stripImportantBytes(value);
    return new t2.Declaration(name, value, merge, important);
  },
};

export const CUSTOM_PROPS_ACTIONS: readonly BuildAction[] = [customDeclaration, declaration];
