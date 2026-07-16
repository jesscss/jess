/**
 * [tree2-native] Mixin-definition family (F8): `.m(@a; @b: 2; @rest...) when (…)
 * { … }` → tree2 `MixinDef` with its `Param[]` and body. Consumes F3's structured
 * selector-ish head bytes and F5's value leaves for param defaults/patterns.
 *
 * Grammar shape (verified): a definition is a `MixinOrQualifiedRule` in BLOCK
 * form — `head  MixinArgs?  Guard?  '{' body '}'`. The statement (no-`{`) form of
 * the same rule is a mixin CALL and is owned by the `MixinCall` family (F9), so
 * this action builds a `MixinDef` ONLY when a `{` body block is present; anything
 * else falls through inert (never throws — parseman also builds this on
 * backtracked branches).
 *
 * `MixinArgs` is SHARED with mixin calls, so its action stays interpretation-
 * neutral: it emits a `RawArg[]` (one branded slot per param, verbatim bytes +
 * built value). The def family classifies each slot into a `Param` (mirrors the
 * bridge's `mixinParams`); the call family (F9) will classify the SAME `RawArg[]`
 * into `CallArg`s.
 *
 * Params: `@a` positional binding; `@b: v` default; `@r...` / `...` variadic rest;
 * a bare literal (`dark`, `2px`) a pattern-match param. Names drop the leading `@`
 * (tree2 convention). Default / pattern values are leaves carrying the F5 literal
 * tag (serialize-identical to the bridge's `parseValue` / `toOperand` output for
 * the static / variable cases).
 *
 * Guard (`when …`): OWNED BY F10 (needs F6/F7 operands). This action carries a
 * guard through structurally — if a built `GuardNode` child is present (once F10
 * registers the `Guard` action) it is attached; until then the guard is left
 * undefined. A guard never affects a definition's emit (a `MixinDef` serializes to
 * nothing; output comes only from a call expanding it), so byte-identity is
 * unaffected — the guard governs call-time selection, F10's concern.
 */
import * as t2 from '../../tree2/index.js';
import { LiteralTag, tagForWord } from '../../tree2/index.js';
import {
  type BuildAction,
  type BuildArgs,
  type RawArg,
  type Span,
  isRawArgList,
  isStatement,
  placeholder,
} from '../host-context.js';

/** A GuardNode is a plain discriminated object (`{ g: … }`), not a tree2 Node. */
function isGuardNode(x: unknown): x is t2.GuardNode {
  return !!x && typeof x === 'object' && !(x instanceof t2.Node) && 'g' in (x as object);
}

/** Verbatim source bytes of a raw child leaf/node span. */
function rawText(args: BuildArgs, rc: unknown): string | undefined {
  const span = (rc as { span?: Span } | undefined)?.span;
  return span ? args.ctx.src.slice(span.start, span.end) : undefined;
}

/** A default / pattern leaf value: an F5-tagged leaf for a single token, else
 *  verbatim bytes (a multi-token list re-emits faithfully). */
function paramValue(text: string): t2.ValueNode {
  const tag: LiteralTag | undefined = /\s/.test(text) ? undefined : tagForWord(text);
  return t2.word(text, tag);
}

/** Classify one neutral arg slot into a tree2 `Param` (mirrors `mixinParams`). */
function classifyParam(arg: RawArg): t2.Param {
  const p = arg.text.trim();
  if (p.endsWith('...')) {
    const name = p.slice(0, -3).replace(/^@/, '');
    return name.length > 0 ? { rest: true, name } : { rest: true };
  }
  const colon = p.indexOf(':');
  if (colon >= 0) {
    const name = p.slice(0, colon).trim().replace(/^@/, '');
    const def = p.slice(colon + 1).trim();
    return { name, default: def.length > 0 ? paramValue(def) : undefined };
  }
  if (/^@[\w-]+$/.test(p)) return { name: p.slice(1) };
  return { pattern: paramValue(p) };
}

/**
 * `MixinArgs` → interpretation-neutral `RawArg[]`. Skips the wrapping parens and
 * `;`/`,` separators; each remaining slot is one arg (verbatim bytes + built
 * value node when the slot produced one).
 */
function buildMixinArgs(args: BuildArgs): RawArg[] {
  const out: RawArg[] = [];
  for (let i = 0; i < args.rawChildren.length; i++) {
    const text = rawText(args, args.rawChildren[i]);
    if (text === undefined) continue;
    if (text === '(' || text === ')' || text === ';' || text === ',') continue;
    const built = args.children[i];
    out.push({ __rawArg: true, text, value: built instanceof t2.Node ? built : undefined });
  }
  return out;
}

/** `MixinOrQualifiedRule` (block form) → `MixinDef`. */
function buildMixinDef(args: BuildArgs): unknown {
  // Only the block (definition) form — a `{` body brace must be present. The
  // statement (call) form is the MixinCall family's (F9); leave it to fall through.
  let hasBrace = false;
  for (const rc of args.rawChildren) {
    if (rawText(args, rc) === '{') {
      hasBrace = true;
      break;
    }
  }
  if (!hasBrace) return placeholder('MixinOrQualifiedRule');

  const name = typeof args.children[0] === 'string' ? args.children[0] : rawText(args, args.rawChildren[0]) ?? '';
  const rawArgs = args.children.find(isRawArgList) ?? [];
  const params = rawArgs.map(classifyParam);
  const guard = args.children.find(isGuardNode);
  const body = args.children.filter(isStatement) as t2.Statement[];
  return t2.mixinDef(name.trim(), params, body, guard);
}

export const MIXINS_DEF_ACTIONS: readonly BuildAction[] = [
  { type: 'MixinArgs', build: buildMixinArgs },
  { type: 'MixinOrQualifiedRule', build: buildMixinDef },
];
