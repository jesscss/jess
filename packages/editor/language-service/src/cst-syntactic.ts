/**
 * CST-grounded SYNTACTIC features (Option B).
 *
 * Pure functions that drive purely-syntactic language features off the tolerant,
 * incremental CST rather than the eval AST: semantic-token classification,
 * variable-name completion, and the declared-symbol inventory behind "did you
 * mean" code actions. Historically these ran on the eval AST (`buildJessIndex` +
 * `node.type`), which dies on invalid input; the CST survives half-typed
 * documents, so these features keep working mid-edit.
 *
 * NODE SHAPES (raw `grammarType`, confirmed empirically across css/less/scss):
 *   - string literal      → `Quoted`
 *   - variable reference   → `Reference` / `VariableReference` (`@primary` / `$primary`)
 *   - variable declaration → `VarDeclaration` / `VariableDeclaration` (`@primary: red;`)
 *   - mixin definition     → `SelectorBranch` + `MixinDefinition` (`.button() { … }`) / `MixinDefinition` (`@mixin foo`)
 *   - mixin call           → `SelectorBranch` + `MixinCall` (`.button();`) / `MixinCall` (`@include foo`)
 *   - scss function def    → `FunctionRule`   (`@function bar`)
 *   - numbers              → `Num` / `Dimension` / `Color`
 *   - at-rules             → `AtRuleBlock` / `AtRuleStatement` / `QueryAtRuleBlock` / `ScssUse` …
 * Comments are trivia (not CST nodes), so comment tokens are recovered by a
 * source scan for `/* … *​/` blocks.
 *
 * SPAN MODEL: CST nodes and leaves carry absolute source spans. Node spans come
 * from `buildCstIndex(root).spanOf`; leaf spans can be read directly.
 */
import type { CssCstChild, CssCstNode } from '@jesscss/css-parser';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { Position } from 'vscode-languageserver-types';
import { buildCstIndex, cstChildrenOf } from './cst-analysis.js';

export type JessLangLike = 'css' | 'less' | 'scss' | 'jess';

// Keep in sync with the server semantic-token legend (and engine.ts).
export const SEMANTIC_TOKEN_TYPES = [
  'comment',
  'string',
  'keyword',
  'enumMember',
  'number',
  'operator',
  'function',
  'variable',
  'property',
  'type',
  'class',
  'namespace'
] as const;

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];

const SEMANTIC_TOKEN_TYPE_INDEX = new Map<SemanticTokenType, number>(SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]));

const NUMBER_TYPES = new Set(['Num', 'Dimension', 'Color']);
const VARIABLE_REFERENCE_TYPES = new Set(['Reference', 'VariableReference']);
const VARIABLE_DECLARATION_TYPES = new Set(['VarDeclaration', 'VariableDeclaration']);

/*
 * Genuine at-rule grammarTypes whose leading `@keyword` is a `namespace` token.
 * An ALLOW-list (not "any slice starting with `@`") so `@`-prefixed NON-at-rules
 * — a Less `@primary:` (`VarDeclaration`), a `@primary` `Reference`, and above all
 * a container like `Stylesheet` whose slice merely STARTS at a leading `@var` —
 * are never mis-tokenized as a `namespace` keyword.
 */
const NAMESPACE_KEYWORD_TYPES = new Set([
  'AtRuleBlock',
  'AtRuleStatement',
  'ImportAtRule',
  'UnknownAtRuleBlock',
  'QueryAtRuleBlock',
  'ScssUse',
  'ScssIf',
  'ScssReturn'
]);

/*
 * SCSS callable statements: `@mixin foo` / `@include foo` / `@function bar`. The
 * `@keyword` is a `namespace` token and the name that follows is a `function`.
 */
const SCSS_CALLABLE_TYPES = new Set(['MixinDefinition', 'MixinCall', 'FunctionRule']);
const LESS_SELECTOR_TYPES = new Set(['SelectorBranch', 'Compound']);
const LESS_MIXIN_STATEMENT_TYPE = 'MixinStatement';

function isCstNode(c: CssCstChild): c is CssCstNode {
  return c._tag === 'node';
}

/** Bare variable name from a `Reference`/`VarDeclaration` slice: head before any
 * `:`, sigil dropped. */
function varNameOf(slice: string): string {
  const head = slice.split(':')[0] ?? slice;
  return head.trim().replace(/^[$@]/, '').trim();
}

/** Bare mixin identifier from a `MixinCall`/`MixinDefinition` (Less/Jess)
 * or a SCSS callable slice: head before `(`/`{`, then the SCSS keyword or the
 * Less/Jess `.`/`#` combinator dropped. */
function mixinIdentOf(slice: string): string {
  const head = slice.split(/[({]/)[0]!.trim().replace(/^@(?:mixin|include|function)\s+/, '');
  return head.replace(/^[.#]/, '').trim();
}

function onlyTriviaBetween(source: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = source.charCodeAt(i);
    if (code !== 9 && code !== 10 && code !== 12 && code !== 13 && code !== 32) {
      return false;
    }
  }
  return true;
}

function previousLessSelectorName(
  entries: readonly { readonly node: CssCstNode; readonly start: number; readonly end: number }[],
  source: string,
  start: number
): string {
  let best: { readonly node: CssCstNode; readonly start: number; readonly end: number } | null = null;
  for (const entry of entries) {
    if (
      !LESS_SELECTOR_TYPES.has(entry.node.grammarType)
      || entry.end > start
      || !onlyTriviaBetween(source, entry.end, start)
    ) {
      continue;
    }
    if (
      best === null
      || entry.end > best.end
      || (entry.end === best.end && entry.start < best.start)
      || (entry.end === best.end && entry.start === best.start && entry.node.grammarType === 'SelectorBranch')
    ) {
      best = entry;
    }
  }
  return best === null ? '' : mixinIdentOf(source.slice(best.start, best.end));
}

function hasDescendantOfType(node: CssCstNode, grammarType: string): boolean {
  for (const child of cstChildrenOf(node)) {
    if (!isCstNode(child)) {
      continue;
    }
    if (child.grammarType === grammarType || hasDescendantOfType(child, grammarType)) {
      return true;
    }
  }
  return false;
}

/**
 * Every declared variable and mixin (bare identifiers) in one document's CST.
 * Powers the "did you mean" quick-fix candidate pools without reparsing to the
 * eval AST, so the suggestions survive an otherwise-invalid document.
 */
export function cstDeclaredSymbols(root: CssCstNode, doc: TextDocument): { vars: Set<string>; mixins: Set<string> } {
  const index = buildCstIndex(root);
  const src = doc.getText();
  const vars = new Set<string>();
  const mixins = new Set<string>();
  for (const { node, start, end } of index.nodes) {
    const gt = node.grammarType;
    if (VARIABLE_DECLARATION_TYPES.has(gt)) {
      const name = varNameOf(src.slice(start, end));
      if (name) {
        vars.add(name);
      }
    } else if (gt === LESS_MIXIN_STATEMENT_TYPE && hasDescendantOfType(node, 'MixinDefinition')) {
      const name = previousLessSelectorName(index.nodes, src, start);
      if (name) {
        mixins.add(name);
      }
    } else if (gt === 'MixinDefinition') {
      const slice = src.slice(start, end);
      const previousSelectorName = previousLessSelectorName(index.nodes, src, start);
      const name = slice.trim().startsWith('@') || previousSelectorName === ''
        ? mixinIdentOf(slice)
        : previousSelectorName;
      if (name) {
        mixins.add(name);
      }
    }
  }
  return { vars, mixins };
}

/**
 * Every declared variable's BARE name (no sigil) in one document's CST, in source
 * order and deduped. The engine wraps each in the dialect sigil (`@`/`$`/`--`)
 * and filters by the typed prefix.
 */
export function cstVariableNames(root: CssCstNode, doc: TextDocument): string[] {
  const index = buildCstIndex(root);
  const src = doc.getText();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { node, start, end } of index.nodes) {
    if (!VARIABLE_DECLARATION_TYPES.has(node.grammarType)) {
      continue;
    }
    const name = varNameOf(src.slice(start, end));
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

type Cand = { start: number; end: number; typeIdx: number };

function tailVariablePattern(lang: JessLangLike): RegExp {
  if (lang === 'less') {
    return /@[-_a-zA-Z0-9]+/g;
  }
  if (lang === 'scss' || lang === 'jess') {
    return /\$[-_a-zA-Z0-9]+/g;
  }
  return /--[-_a-zA-Z0-9]+/g;
}

/**
 * CST-grounded semantic-token classification. Walks the tolerant CST and emits
 * the LSP delta-encoded token array, mirroring the AST classifier: strings
 * (`Quoted`, split into quote / string / interpolation pieces), variables
 * (`Reference`/`VariableReference`), mixins (`MixinCall`), numbers (`Num`/`Dimension`/`Color`),
 * at-rule keywords (`@keyword` → namespace), and comments (source-scanned
 * `/* … *​/`). Sourced from the CST so tokens survive half-typed input where the
 * eval AST yields nothing.
 */
export function cstSemanticTokens(root: CssCstNode, doc: TextDocument, lang: JessLangLike): number[] {
  const index = buildCstIndex(root);
  const text = doc.getText();
  const typeIdxOf = (t: SemanticTokenType) => SEMANTIC_TOKEN_TYPE_INDEX.get(t) ?? 0;

  const cands: Cand[] = [];
  const push = (start: number, end: number, type: SemanticTokenType) => {
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cands.push({ start, end, typeIdx: typeIdxOf(type) });
    }
  };

  /*
   * Split an interpolated string region [s, e) into quote / string / variable
   * pieces. Quotes become their own `string` tokens; each `@{…}` / `#{…}`
   * interpolation becomes a `variable`.
   */
  const interpSource = lang === 'scss' ? '#\\{[^}]*\\}' : '@\\{[^}]*\\}';
  const emitStringRegion = (s: number, e: number) => {
    let contentStart = s;
    let contentEnd = e;
    const openCh = text.charAt(s);
    if (openCh === '"' || openCh === '\'') {
      push(s, s + 1, 'string');
      contentStart = s + 1;
    }
    const closeCh = text.charAt(e - 1);
    const hasClose = (closeCh === '"' || closeCh === '\'') && e - 1 >= contentStart;
    if (hasClose) {
      contentEnd = e - 1;
    }
    const content = text.slice(contentStart, contentEnd);
    const re = new RegExp(interpSource, 'g');
    let last = contentStart;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const ms = contentStart + m.index;
      const me = ms + m[0].length;
      if (ms > last) {
        push(last, ms, 'string');
      }
      push(ms, me, 'variable');
      last = me;
      if (me === ms) {
        re.lastIndex++;
      }
    }
    if (contentEnd > last) {
      push(last, contentEnd, 'string');
    }
    if (hasClose) {
      push(e - 1, e, 'string');
    }
  };

  const looksQuoted = (s: number, e: number) => {
    const c = text.charAt(s);
    return (c === '"' || c === '\'') && e > s + 1;
  };

  // Absolute span of a node's first leaf child (the name token of a call).
  const firstLeafSpan = (node: CssCstNode): { start: number; end: number } | null => {
    for (const c of cstChildrenOf(node)) {
      if (!isCstNode(c)) {
        return { start: Number(c.span.start), end: Number(c.span.end) };
      }
    }
    return null;
  };

  /*
   * Absolute span of a `Reference`'s leading `$` sigil. Prefer the CST child when
   * the grammar captured the sigil separately; fall back to the node source span
   * for current Jess value references, whose CST has one `$foo` leaf.
   */
  const sigilLeafSpan = (node: CssCstNode): { start: number; end: number } | null => {
    const first = cstChildrenOf(node)[0];
    if (first && !isCstNode(first)) {
      const s = Number(first.span.start);
      const e = Number(first.span.end);
      if (e === s + 1 && text.charAt(s) === '$') {
        return { start: s, end: e };
      }
    }
    const start = Number(node.span.start);
    const end = Number(node.span.end);
    if (!Number.isFinite(start) || end <= start + 1 || text.charAt(start) !== '$') {
      return null;
    }
    return { start, end: start + 1 };
  };

  for (const { node, start, end } of index.nodes) {
    const gt = node.grammarType;
    if (VARIABLE_REFERENCE_TYPES.has(gt)) {
      /*
       * .jess treats `$` as a distinct sigil/operator (it also heads control-flow
       * `$…{}`, scope `${}`, mutation `:=`), so the `$` and the variable name are
       * coloured as SEPARATE tokens rather than one blob. Prefer a separate `$`
       * leaf when present; current value references expose one `$foo` leaf, so the
       * editor fallback splits at the CST node's source start. css/less/scss keep
       * the conventional single-token variable.
       */
      const sigil = lang === 'jess' ? sigilLeafSpan(node) : null;
      if (sigil) {
        push(sigil.start, sigil.end, 'operator');
        push(sigil.end, end, 'variable');
      } else {
        push(start, end, 'variable');
      }
    } else if (SCSS_CALLABLE_TYPES.has(gt)) {
      /*
       * `@mixin foo` / `@include foo` / `@function bar`: the keyword is a
       * `namespace` token and the name after it is a `function` token.
       */
      const slice = text.slice(start, end);
      const kw = /^@[-\w]+/.exec(slice);
      if (kw) {
        push(start, start + kw[0].length, 'namespace');
        const nm = /^@[-\w]+\s+([\w-]+)/.exec(slice);
        if (nm?.[1]) {
          const nameStart = start + nm[0].length - nm[1].length;
          push(nameStart, nameStart + nm[1].length, 'function');
        }
      } else if (gt === 'MixinCall') {
        const leaf = firstLeafSpan(node);
        if (leaf) {
          push(leaf.start, leaf.end, 'function');
        }
      }
    } else if (NUMBER_TYPES.has(gt)) {
      push(start, end, 'number');
    } else if (gt === 'Quoted') {
      if (looksQuoted(start, end)) {
        emitStringRegion(start, end);
      }
    } else if (NAMESPACE_KEYWORD_TYPES.has(gt)) {
      /*
       * At-rule keyword `@keyword` → namespace. Gated to genuine at-rule types
       * (an allow-list), so `@`-prefixed non-at-rules / containers are skipped.
       */
      const slice = text.slice(start, end);
      const head = /^@[-\w]+/.exec(slice);
      if (head) {
        push(start, start + head[0].length, 'namespace');
      }
    }
  }

  /*
   * If the tolerant CST stops before an invalid tail, keep coloring references
   * to variables already declared in the parsed prefix. This is LS recovery, not
   * a parser claim: no synthetic CST node is invented.
   */
  const parsedEnd = Number(root.span.end);
  if (Number.isFinite(parsedEnd) && parsedEnd < text.length) {
    const declared = new Set(cstVariableNames(root, doc));
    const re = tailVariablePattern(lang);
    re.lastIndex = Math.max(0, parsedEnd);
    for (let m: RegExpExecArray | null; (m = re.exec(text));) {
      const raw = m[0];
      const name = varNameOf(raw);
      if (name && declared.has(name)) {
        push(m.index, m.index + raw.length, 'variable');
      }
    }
  }

  // Comments are CST trivia (no node), so recover `/* … *​/` blocks from source.
  const commentRe = /\/\*[\s\S]*?\*\//g;
  for (let m: RegExpExecArray | null; (m = commentRe.exec(text));) {
    push(m.index, m.index + m[0].length, 'comment');
  }

  return encodeTokens(cands, doc);
}

/**
 * Resolve overlaps (prefer the innermost/shortest token at any position), split
 * multi-line tokens, and delta-encode in document order — the LSP semantic-token
 * wire format. Shared with the AST path's encoding so output is identical.
 */
function encodeTokens(cands: Cand[], doc: TextDocument): number[] {
  cands.sort((a, b) => (a.start - b.start) || ((a.end - a.start) - (b.end - b.start)));

  type Pending = { line: number; char: number; length: number; typeIdx: number; modifiers: number };
  const pending: Pending[] = [];
  let acceptedEnd = -1;
  for (const c of cands) {
    if (c.start < acceptedEnd) {
      continue;
    }
    acceptedEnd = c.end;
    let segStart = c.start;
    while (segStart < c.end) {
      const startPos = doc.positionAt(segStart);
      const lineEndOffset = doc.offsetAt(Position.create(startPos.line + 1, 0));
      const segEnd = Math.min(c.end, lineEndOffset);
      let len = segEnd - segStart;
      const endPos = doc.positionAt(segEnd);
      if (endPos.line !== startPos.line && len > 0) {
        len -= 1;
      }
      if (len > 0) {
        pending.push({ line: startPos.line, char: startPos.character, length: len, typeIdx: c.typeIdx, modifiers: 0 });
      }
      segStart = segEnd;
    }
  }

  pending.sort((a, b) => (a.line - b.line) || (a.char - b.char));
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const t of pending) {
    const deltaLine = t.line - prevLine;
    const deltaStart = deltaLine === 0 ? (t.char - prevChar) : t.char;
    data.push(deltaLine, deltaStart, t.length, t.typeIdx, t.modifiers);
    prevLine = t.line;
    prevChar = t.char;
  }
  return data;
}
