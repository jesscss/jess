/**
 * [tree2-native] Variables family (F1): Less variable declarations + references.
 *
 * `VarDeclaration` (`@x: value`) → tree2 `VarDeclaration` (emits nothing; binds a
 * name in the scope frame). A bare variable `Reference` (`@name` / `@@name`) that
 * appears as a value → tree2 `VarRef` / `VarIndirect`, so the value resolves
 * against the scope frame at serialize time.
 *
 * ORACLE — `bridge.ts`:
 *   - `case 'VarDeclaration'` : name is the bare identifier (the leading `@` is
 *     dropped), value is `parseValue(rawDeclValue(...))` — the SAME source-bytes
 *     tokenizer used here (`parseVarValue`), so a computed value (function call /
 *     operation) is out of F1's scope and left to the value families.
 *   - the `Reference` / `parseValue` handling : a bare `@name` → `VarRef`, a
 *     `@@name` indirect → `VarIndirect` over a `VarRef`, `@{name}` interpolation →
 *     `Interp`, and a value that mixes literal chunks with `@name` refs → `Concat`.
 * This module emits those tree2 nodes DIRECTLY from the grammar's `build` span
 * (mirroring the bridge's derivations — the ponytail) with no legacy-tree walk.
 *
 * A map / namespace accessor (`@map[key]`), a `$property` reference, or a
 * detached-ruleset call (`@rs(...)`) is NOT a plain variable value — those are the
 * value / mixin families' shapes, so this family declines them (an inert
 * placeholder) rather than mis-modelling them. Every action is TOTAL (never
 * throws) so parseman's speculative / backtracked branches are safe.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, declParts, placeholder, sliceSpan } from '../host-context.js';

/**
 * [oracle: bridge `interpFromString`] Build an `Interp` from a raw string that
 * contains `@{name}` interpolation tokens. Value context, so a spliced ref strips
 * one surrounding quote layer (`unquote: true`); a bare `@name` inside a literal
 * chunk is left literal (matches Less: only `@{…}` interpolates).
 */
function interpFromString(text: string): t2.ValueNode {
  const re = /@\{\s*([^}]+?)\s*\}/g;
  const parts: t2.InterpPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let sawRef = false;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
    parts.push({ ref: t2.varRef(m[1]!), unquote: true });
    sawRef = true;
    last = m.index + m[0].length;
  }
  if (!sawRef) return t2.word(text);
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/**
 * [oracle: bridge `parseValue`] Tokenize a variable declaration's value bytes into
 * a tree2 value: bare `@name` refs become `VarRef`, everything else stays literal.
 * `@@name` (standalone) → `VarIndirect`; `@{name}` interpolation → `Interp`; a
 * value with no `@` → a plain `Word`. Byte-identical to the bridge because it runs
 * the identical derivation over the identical source bytes.
 */
function parseVarValue(text: string): t2.ValueNode {
  if (text.indexOf('@') < 0) return t2.word(text);
  const indirect = /^@@([A-Za-z_][\w-]*)$/.exec(text.trim());
  if (indirect) return t2.varIndirect(t2.varRef(indirect[1]!));
  if (text.includes('@{')) return interpFromString(text);
  const re = /@([A-Za-z_][\w-]*)/g;
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

/**
 * A bare variable reference token → `VarRef` (`@name`) or `VarIndirect` (`@@name`).
 * Returns `null` for anything else (a `@map[key]` accessor, a `$property` ref, a
 * `@rs(...)` call — all carry brackets / parens / `$`) so the caller declines it.
 */
function varLeaf(text: string): t2.VarRef | t2.VarIndirect | null {
  const t = text.trim();
  const indirect = /^@@([A-Za-z_][\w-]*)$/.exec(t);
  if (indirect) return t2.varIndirect(t2.varRef(indirect[1]!));
  const bare = /^@([A-Za-z_][\w-]*)$/.exec(t);
  if (bare) return t2.varRef(bare[1]!);
  return null;
}

/**
 * `@x: value;` — split the span into name + value bytes (drop a trailing `;`,
 * split on the first `:`), strip the name's leading `@` (the bridge / scope key is
 * the bare identifier), and tokenize the value bytes. A computed value (function
 * call / operation) falls out as literal here — that is the value families' shape,
 * not F1's — but a VarDeclaration emits nothing, so it is only observable once such
 * a variable is referenced, which is out of this family's byte-identity scope.
 */
const varDeclaration: BuildAction = {
  type: 'VarDeclaration',
  build: (args) => {
    const { name, value } = declParts(args.ctx.src, args.span.start, args.span.end);
    const bare = name.charCodeAt(0) === 0x40 /* @ */ ? name.slice(1) : name;
    return t2.varDecl(bare, parseVarValue(value));
  },
};

/**
 * A value-position `@name` / `@@name` reference → `VarRef` / `VarIndirect`. The
 * declaration family consumes it as a whole-value node (see `declaration-static`);
 * a non-variable `Reference` shape (accessor / `$property` / call) is declined with
 * an inert placeholder so a family that models it can, and a speculative branch is
 * never broken.
 */
const reference: BuildAction = {
  type: 'Reference',
  build: (args) => varLeaf(sliceSpan(args.ctx, args.span)) ?? placeholder(args.type),
};

export const VARIABLES_ACTIONS: readonly BuildAction[] = [varDeclaration, reference];
