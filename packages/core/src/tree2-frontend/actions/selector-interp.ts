/**
 * [tree2-native] Selector interpolation family (F4): structured `@{…}` in a
 * selector position (`.@{n}`, `#@{id}`, `@{parent}`, `foo-@{x}-bar`, `&.@{mod}`).
 *
 * Why this family exists: F3 (`selector.ts`) slices every simple-selector token
 * VERBATIM from its source span, so a token carrying `@{name}` rode as literal
 * `Simple` bytes — byte-identical to the bridge ONLY while the interpolation is
 * left UNRESOLVED. This family reads the same bytes but builds a real tree2
 * `Interp` (`Simple.interp`), so the serializer RESOLVES the variable at
 * ruleset-enter (`.@{n}` with `@n: a` → `.a`) exactly as the bridge does.
 *
 * Oracle: `bridge.ts` `toSimpleFromString` / `interpFromString(text, false)` (the
 * selector-context, refs-as-is string path) and `interpFromInterpolated` (which,
 * for a single-level `@{name}`, yields the SAME `{ lit } / { ref, unquote:false }`
 * part sequence the byte-regex below produces).
 *
 * Two integration points, both routed through the ONE `simpleFromText` builder:
 *   1. This module registers `InterpolatedSelector` — the grammar node for a
 *      selector that IS interpolation (`.@{n}`, `@{parent}`, `foo-@{x}-bar`). It
 *      builds a single-simple `Compound` so `ruleset.ts`'s `ruleSelector` and
 *      F3's segment helpers (which already accept `Compound`) carry it unchanged.
 *   2. F3's `buildCompound` slices each part of a multi-simple compound
 *      (`.a.@{n}`, `&.@{mod}`) verbatim; it now creates those parts via
 *      `simpleFromText`, so an interp-bearing part becomes an interp `Simple`.
 *
 * TOTAL, like every action: a doomed/backtracked shape never throws — a token
 * with no valid `@{…}` falls back to a plain `Simple`.
 */
import * as t2 from '../../tree2/index.js';
import { type BuildAction, type BuildArgs, type Span } from '../host-context.js';

/** `@{ name }` interpolation token — mirrors the bridge's `interpFromString` regex. */
const INTERP_RE = /@\{\s*([^}]+?)\s*\}/g;

/**
 * Build an `Interp` from raw selector bytes containing `@{name}` tokens, or
 * `null` when the text carries no interpolation. Selector context: spliced refs
 * are kept as-is (`unquote:false`), and bare `@name` inside a literal chunk stays
 * literal — only `@{…}` is an interpolation (matches the bridge's string path).
 */
function interpFromSelectorText(text: string): t2.Interp | null {
  const parts: t2.InterpPart[] = [];
  let last = 0;
  let sawRef = false;
  let m: RegExpExecArray | null;
  INTERP_RE.lastIndex = 0;
  while ((m = INTERP_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
    parts.push({ ref: t2.varRef(m[1]!), unquote: false });
    sawRef = true;
    last = m.index + m[0].length;
  }
  if (!sawRef) return null;
  if (last < text.length) parts.push({ lit: text.slice(last) });
  return t2.interp(parts);
}

/**
 * The interp-aware simple-token builder shared with F3's `buildCompound`: an
 * `@{…}`-bearing token becomes an interpolation `Simple`; any other token is a
 * plain verbatim-bytes `Simple` (byte-identical to F3's prior `t2.simple`).
 */
export function simpleFromText(text: string): t2.Simple {
  if (text.includes('@{')) {
    const interp = interpFromSelectorText(text);
    if (interp) return t2.simpleInterp(interp);
  }
  return t2.simple(text);
}

/** The full source span of a parseman node, if it carries one. */
function nodeSpan(x: unknown): Span | undefined {
  const span = (x as { span?: Span } | undefined)?.span;
  return span && typeof span.start === 'number' && typeof span.end === 'number' ? span : undefined;
}

/**
 * `InterpolatedSelector`: a whole simple selector that is interpolation. Sliced
 * verbatim from its span and routed through `simpleFromText`, wrapped in a
 * single-simple `Compound` so every consuming position (ruleset head, complex
 * segment, list member) accepts it with no further edits.
 */
function buildInterpolatedSelector(args: BuildArgs): t2.Compound {
  const span = nodeSpan(args) ?? args.span;
  const text = args.ctx.src.slice(span.start, span.end);
  return new t2.Compound([simpleFromText(text)]);
}

export const SELECTOR_INTERP_ACTIONS: readonly BuildAction[] = [
  { type: 'InterpolatedSelector', build: buildInterpolatedSelector },
];
