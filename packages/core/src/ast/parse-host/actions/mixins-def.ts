/**
 * Mixin-definition family: `.m(@a; @b: 2; @rest...) when (…)
 * { … }` → tree2 `MixinDef` with its `Param[]` and body. Consumes F3's structured
 * selector-ish head bytes and F5's value leaves for param defaults/patterns.
 *
 * Grammar shape (verified): a definition is a `MixinOrQualifiedRule` in BLOCK
 * form — `head  MixinArgs?  Guard?  '{' body '}'`. The statement (no-`{`) form of
 * the same rule is a mixin CALL and is owned by the `MixinCall` family, so
 * this action builds a `MixinDef` ONLY when a `{` body block is present; anything
 * else falls through inert (never throws — parseman also builds this on
 * backtracked branches).
 *
 * `MixinArgs` is SHARED with mixin calls, so its action stays interpretation-
 * neutral: it emits one slot per param carrying (a) the verbatim slot bytes and
 * (b) the slot's BUILT child — which the grammar already structures as a `Rest` /
 * `NamedArg` marker, a `VarRef` (bare `@a` binding), or a literal value node/leaf
 * (a pattern). The def family reads that structure into a `Param`; the call family
 * reads the SAME slots into `CallArg`s. No slot is re-tokenized from bytes
 * (P0) — the `Rest` / `NamedArg` grammar nodes register their own build actions
 * below so their structure reaches this family instead of collapsing to a
 * placeholder.
 *
 * Params: `@a` positional binding; `@b: v` default; `@r...` / `...` variadic rest;
 * a bare literal (`dark`, `2px`) a pattern-match param. Names drop the leading `@`
 * (tree2 convention). Default / pattern values are the grammar's built value nodes
 * (serialize-identical to the bridge's `parseValue` / `toOperand` output).
 *
 * Guard (`when …`): OWNED BY F10 (needs F6/F7 operands). This action carries a
 * guard through structurally — if a built `GuardNode` child is present (once F10
 * registers the `Guard` action) it is attached; until then the guard is left
 * undefined. A guard never affects a definition's emit (a `MixinDef` serializes to
 * nothing; output comes only from a call expanding it), so byte-identity is
 * unaffected — the guard governs call-time selection, F10's concern.
 */
import * as t2 from '../../index.js';
import {
  type BuildAction,
  type BuildArgs,
  type RawArg,
  type Span,
} from '../host-context.js';
import { buildMixinCall } from './mixin-call.js';
import { bodyStatementsWithComments } from './comments.js';

/** A GuardNode is a plain discriminated object (`{ g: … }`), not a tree2 Node. */
function isGuardNode(x: unknown): x is t2.GuardNode {
  return !!x && typeof x === 'object' && !t2.isNode(x) && 'g' in (x as object);
}

/** The string value of a parseman leaf child, or `undefined` for a non-leaf. */
function leafValue(x: unknown): string | undefined {
  const leaf = x as { _tag?: string; value?: unknown; span?: Span } | undefined;
  return leaf?._tag === 'leaf' && typeof leaf.value === 'string' ? leaf.value : undefined;
}

/** Verbatim source bytes of a raw child leaf/node span. */
function rawText(args: BuildArgs, rc: unknown): string | undefined {
  const span = (rc as { span?: Span } | undefined)?.span;
  return span ? args.ctx.src.slice(span.start, span.end) : undefined;
}

/** Drop the leading `@` sigil the grammar keeps on a `lessVar` leaf. */
function paramName(sigiled: string): string {
  return sigiled[0] === '@' ? sigiled.slice(1) : sigiled;
}

/* ------------------------------------------------------ neutral param markers */

/**
 * Interpretation-neutral markers a `Rest` / `NamedArg` grammar node builds — the
 * shared `MixinArgs` action carries them per slot; the def family reads them as a
 * variadic / named `Param`, a call family as a spread / named call-arg.
 */
export interface RestMarker {
  readonly __rest: true;
  readonly name?: string;
}
export interface NamedMarker {
  readonly __named: true;
  readonly name: string;
  readonly value: t2.ValueNode;
}
export function isRestMarker(x: unknown): x is RestMarker {
  return !!x && typeof x === 'object' && (x as RestMarker).__rest === true;
}
export function isNamedMarker(x: unknown): x is NamedMarker {
  return !!x && typeof x === 'object' && (x as NamedMarker).__named === true;
}

/** `Rest` grammar node (`@name...` / `...`) → neutral rest marker. Children are
 *  `[lessVar leaf, '...' leaf]` (named) or `['...' leaf]` (anonymous). */
function buildRest(args: BuildArgs): RestMarker {
  const head = leafValue(args.children[0]);
  const name = head !== undefined && head[0] === '@' ? paramName(head) : undefined;
  return name !== undefined ? { __rest: true, name } : { __rest: true };
}

/**
 * `NamedArg` grammar node (`@name: value`) → neutral named marker. Children are
 * `[lessVar leaf, ':' leaf, …value]`. A single-token default arrives as ONE built
 * value node (used directly, carrying the grammar's literal tag); a multi-token
 * space-list default is the one shape the grammar does not yet assemble.
 */
function buildNamedArg(args: BuildArgs): NamedMarker {
  const name = paramName(leafValue(args.children[0]) ?? '');
  return { __named: true, name, value: namedArgValue(args) };
}

function namedArgValue(args: BuildArgs): t2.ValueNode {
  const vals = args.children.slice(2);
  if (vals.length === 1 && t2.isNode(vals[0])) return vals[0] as t2.ValueNode;
  // TODO(tier-b): PARSER GAP — a multi-token space-list default (`thin dotted`)
  // is not assembled into a value node (single-token defaults DO arrive built),
  // so the verbatim bytes after the `:` are consumed here until the grammar emits
  // a List. Not a re-tokenization of structure the parser produced (P0): it is the
  // documented fallback for a shape the parser leaves unstructured.
  const colon = args.children[1] as { span?: Span } | undefined;
  const from = colon?.span ? colon.span.end : args.span.start;
  return t2.any(args.ctx.src.slice(from, args.span.end).trim());
}

/* ---------------------------------------------------------------- mixin args */

/**
 * One interpretation-neutral `MixinArgs` slot: the verbatim slot bytes (`text`),
 * the built value node when the slot IS a plain value (`value`, for F9), and the
 * slot's raw built child (`built`) so the def family can classify on structure
 * (`Rest` / `NamedArg` marker, `VarRef`, or a literal) rather than re-parsing text.
 */
export interface ArgSlot extends RawArg {
  readonly built: unknown;
}

export function isArgSlotList(x: unknown): x is ArgSlot[] {
  return Array.isArray(x) && (x.length === 0 || (!!x[0] && (x[0] as RawArg).__rawArg === true));
}

/**
 * `MixinArgs` → interpretation-neutral `ArgSlot[]`. Skips the wrapping parens and
 * `;`/`,` separators; each remaining slot is one arg (verbatim bytes + built child).
 */
/** One value token in an arg group: its built child + verbatim bytes/span, plus
 *  whether an explicit `,` preceded it (vs a bare space) INSIDE the group. */
interface GroupTok {
  readonly built: unknown;
  readonly text: string;
  readonly span: Span;
  readonly comma: boolean;
}

/** A raw value token as a `ValueNode` — its built node, else opaque bytes. */
function tokenToNode(t: GroupTok): t2.ValueNode {
  return t2.isNode(t.built) ? (t.built as t2.ValueNode) : t2.any(t.text);
}

/**
 * Assemble a MULTI-token arg group into ONE value node so a space/comma list arg
 * binds as a SINGLE parameter (Less: only `,`/`;` separate args; adjacent tokens
 * form a space-list, and `,` inside a `;`-separated group forms a comma-list).
 * A pure space run → `SpacedValue`; a run carrying inner commas → a `Sequence`
 * interleaving the literal separators so it emits verbatim and its parts still
 * resolve (variables inside the group are evaluated, not frozen as bytes).
 */
function buildGroupNode(g: readonly GroupTok[]): t2.ValueNode {
  const spaceOnly = g.every((t, i) => i === 0 || !t.comma);
  if (spaceOnly) return t2.spaced(g.map(tokenToNode));
  const parts: t2.ValueNode[] = [];
  for (let i = 0; i < g.length; i++) {
    if (i > 0) parts.push(t2.any(g[i]!.comma ? ', ' : ' '));
    parts.push(tokenToNode(g[i]!));
  }
  return t2.sequence(parts);
}

/**
 * `MixinArgs` → interpretation-neutral `ArgSlot[]`, ONE slot per real argument.
 * Args are split on the top-level separator — `;` when any is present, else `,`
 * (Less' semicolon-promotes-to-arg-separator rule); a multi-token run between
 * separators is grouped into a single space/comma list value ({@link buildGroupNode})
 * so `.m(1 2, 3)` binds two args (`1 2`, `3`), not three. A single-token group keeps
 * its built child verbatim (preserving `Rest`/`NamedArg`/`VarRef`/typed-literal shape
 * the def family classifies on). No slot is re-tokenized from bytes (P0).
 */
function buildMixinArgs(args: BuildArgs): ArgSlot[] {
  // 1. Linearize: value tokens (with their built child + span) and `,`/`;` seps.
  type Item = GroupTok | { readonly sep: ',' | ';' };
  const seq: Item[] = [];
  for (let i = 0; i < args.rawChildren.length; i++) {
    const rc = args.rawChildren[i];
    const text = rawText(args, rc);
    if (text === undefined || text === '(' || text === ')') continue;
    if (text === ',' || text === ';') {
      seq.push({ sep: text });
      continue;
    }
    const span = (rc as { span?: Span } | undefined)?.span;
    if (span === undefined) continue;
    seq.push({ built: args.children[i], text, span, comma: false });
  }

  // 2. Top-level arg separator: `;` promotes to the separator when present.
  const argSep: ',' | ';' = seq.some((s) => 'sep' in s && s.sep === ';') ? ';' : ',';

  // 3. Split into groups on the arg separator; a non-arg-sep `,` marks the next
  //    token as comma-preceded (inner comma-list) rather than a bare space run.
  const groups: GroupTok[][] = [];
  let cur: GroupTok[] = [];
  let pendingComma = false;
  for (const s of seq) {
    if ('sep' in s) {
      if (s.sep === argSep) {
        groups.push(cur);
        cur = [];
        pendingComma = false;
      } else {
        pendingComma = true;
      }
      continue;
    }
    cur.push({ ...s, comma: pendingComma });
    pendingComma = false;
  }
  groups.push(cur);

  // 4. One slot per non-empty group.
  const out: ArgSlot[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    if (g.length === 1) {
      const t = g[0]!;
      out.push({ __rawArg: true, text: t.text, value: t2.isNode(t.built) ? t.built : undefined, built: t.built });
      continue;
    }
    const node = buildGroupNode(g);
    const text = args.ctx.src.slice(g[0]!.span.start, g[g.length - 1]!.span.end);
    out.push({ __rawArg: true, text, value: node, built: node });
  }
  return out;
}

/**
 * Classify one neutral slot into a tree2 `Param` by its BUILT structure:
 *   - `Rest` marker    → variadic `{ rest, name? }`
 *   - `NamedArg` marker→ default binding `{ name, default }`
 *   - `VarRef`         → positional binding `{ name }`
 *   - anything else    → literal PATTERN `{ pattern }` (the built value node, or a
 *                        `Any` of the verbatim slot bytes for an unbuilt literal).
 */
function classifyParam(arg: ArgSlot): t2.Param {
  const built = arg.built;
  if (isRestMarker(built)) return built.name !== undefined ? { rest: true, name: built.name } : { rest: true };
  if (isNamedMarker(built)) return { name: built.name, default: built.value };
  if (t2.isNode(built) && built.type === 'VarRef') return { name: built.name };
  return { pattern: t2.isNode(built) ? (built as t2.ValueNode) : t2.any(arg.text) };
}

/** `MixinOrQualifiedRule` → `MixinDef` (block form) or `MixinCall` (statement
 *  form). The block form (a `{` body) is a definition; the no-brace form is a
 *  document-level mixin CALL (`.loop(3);`) — the same call a ruleset body parses
 *  directly as `MixinCall`, so it delegates to that family's builder rather than
 *  dropping to a placeholder (which would silently discard top-level calls). */
function buildMixinDef(args: BuildArgs): unknown {
  let hasBrace = false;
  for (const rc of args.rawChildren) {
    if (rawText(args, rc) === '{') {
      hasBrace = true;
      break;
    }
  }
  if (!hasBrace) return buildMixinCall(args);

  const name = typeof args.children[0] === 'string' ? args.children[0] : rawText(args, args.rawChildren[0]) ?? '';
  const slots = args.children.find(isArgSlotList) ?? [];
  const params = slots.map(classifyParam);
  const guard = args.children.find(isGuardNode);
  const body = bodyStatementsWithComments(args);
  return t2.mixinDef(name.trim(), params, body, guard);
}

export const MIXINS_DEF_ACTIONS: readonly BuildAction[] = [
  { type: 'MixinArgs', build: buildMixinArgs },
  { type: 'Rest', build: buildRest },
  { type: 'NamedArg', build: buildNamedArg },
  { type: 'MixinOrQualifiedRule', build: buildMixinDef },
];
