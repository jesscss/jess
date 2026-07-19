/**
 * LessGrammar — builder methods for the Less grammar.
 *
 * Builder-only class: no grammar rules, no Parséman Parser base.
 * Grammar rules live in grammar-fn.ts (macro-compiled functional grammar),
 * which uses LessGrammar via a thin BuilderHost subclass.
 * Extends CssParser to inherit the shared CSS builder methods.
 */

import type { FieldMap, Span, CSTLeaf, CSTError } from 'parseman';
import {
  CssParser,
  spannedComponents, setFieldSpan, fieldIndexOf, type Spanned, type Component,
  type BuilderFn
} from '@jesscss/css-parser/jess';
import { getInterpolatedOrString, getInterpolatedNode, createInterpolatedReference } from './utils.js';

import {
  type Node,
  type LocationInfo,
  Any, Keyword, Rules, Ruleset,
  type Selector,
  ComplexSelector, type ComplexSelectorValue,
  CompoundSelector,
  isSelectorListLike, selectorListItems,
  Declaration,
  VarDeclaration,
  NESTABLE_AT_RULES,
  Reference, type ReferenceValue,
  Ampersand, List, DefaultGuard, Extend, ExtendFlag, Call,
  For, type ForPattern,
  Interpolated, InterpolatedSelector, Sequence, CustomDeclaration,
  Color, Paren, Condition, type ConditionOperator,
  Num, Dimension,
  Mixin, Expression, Operation, Negative,
  shouldOperateWithMathFrames, type MathMode,
  StyleImport,
  JsImport,
  Nil,
  Rest,
  Quoted,
  Url,
  AtRuleStatement,
  AtRule,
  QueryCondition,
  INTERPOLATION_PLACEHOLDER,
  Block
} from '@jesscss/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JessNode = Node<any, any>;
type Child = JessNode | CSTLeaf | CSTError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mirrors grammar.ts's `knownAtVar` terminal (isVariableLike in the reference): a
// known at-rule name (incl. vendor-prefixed document/keyframes/viewport) used
// as a variable call (`@media()`) is only legal with empty parens, and is
// itself a deprecated form. Kept as a non-regex classifier (LAW: no regex outside
// Parseman `regex()`): the grammar's `nonKnownAtVar` choice-ordering routes
// `@-<vendor>-keyframes()` to the args branch, so this set is NOT redundant with
// the matched terminal — it preserves the `at-rule-variable` deprecation warning
// for vendor-prefixed keyframes.
const KNOWN_AT_RULE_VAR_NAMES = new Set([
  'document', '-moz-document', 'keyframes', 'viewport', '-ms-viewport',
  'import', 'media', 'supports', 'layer', 'container', 'scope', 'page',
  'font-face', 'starting-style', 'property', 'counter-style', 'color-profile',
  'font-palette-values', 'namespace'
]);
function isKnownAtRuleVarName(name: string): boolean {
  const n = name.toLowerCase();
  if (KNOWN_AT_RULE_VAR_NAMES.has(n)) {
    return true;
  }
  // `-<vendor>-keyframes` — vendor prefix of the form `-[a-z]+-`.
  if (n.startsWith('-') && n.endsWith('-keyframes')) {
    const vendor = n.slice(1, -'-keyframes'.length);
    return vendor.length > 0 && [...vendor].every(c => c >= 'a' && c <= 'z');
  }
  return false;
}

function spanToLocation(span: Span): LocationInfo {
  return { start: span.start, end: span.end };
}

/** ASCII letter (`[a-zA-Z]`). */
function isAsciiLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/** A `[\w-]` character: ASCII word char (`[A-Za-z0-9_]`) or hyphen. */
function isWordOrDash(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
    || (c >= '0' && c <= '9') || c === '_' || c === '-';
}

/** The first `<sigil><letter><[\w-]*>` run in `value` (e.g. `@foo`, `$bar`), or null.
 * Non-regex equivalent of the first (non-global) match of sigil + letter + word/dash. */
function firstSigilIdent(value: string, sigil: string): string | null {
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== sigil) {
      continue;
    }
    const lead = value[i + 1];
    if (lead === undefined || !isAsciiLetter(lead)) {
      continue;
    }
    let j = i + 2;
    while (j < value.length && isWordOrDash(value[j]!)) {
      j++;
    }
    return value.slice(i, j);
  }
  return null;
}

/** Lead char of an ns-name after `#`/`.`: `_`, an ASCII letter, or U+0080-U+FFFF
 * (the `[_a-zA-Z\x80-\uffff]` class). */
function isNsNameLead(ch: string): boolean {
  const cc = ch.charCodeAt(0);
  return ch === '_' || isAsciiLetter(ch) || (cc >= 0x80 && cc <= 0xffff);
}

/** `/^[#.]-?<lead>/`: `#`/`.`, then an optional `-`, then a lead char accepted by
 * `isLead`. Non-regex core shared by the ns-name classifiers. */
function startsWithHashDotLead(s: string, isLead: (c: string) => boolean): boolean {
  const c0 = s[0];
  if (c0 !== '#' && c0 !== '.') {
    return false;
  }
  let p = 1;
  if (s[p] === '-') {
    p++;
  }
  const lead = s[p];
  return lead !== undefined && isLead(lead);
}

/** Global match of the `[#.][^#.]*` pattern: segments each starting with `#`/`.` and
 * running until the next `#`/`.`. Empty when none match. Non-regex. */
function splitHashDotSegments(s: string): string[] {
  const segs: string[] = [];
  let k = 0;
  while (k < s.length) {
    if (s[k] === '#' || s[k] === '.') {
      let e = k + 1;
      while (e < s.length && s[e] !== '#' && s[e] !== '.') {
        e++;
      }
      segs.push(s.slice(k, e));
      k = e;
    } else {
      k++;
    }
  }
  return segs;
}

/** Global match of the `[#.][^#.>+~\s]*` pattern: like {@link splitHashDotSegments} but a
 * segment also ends at a combinator (`>`,`+`,`~`) or whitespace. Non-regex. */
function splitSelectorHeadSegments(s: string): string[] {
  const segs: string[] = [];
  let k = 0;
  while (k < s.length) {
    if (s[k] === '#' || s[k] === '.') {
      let e = k + 1;
      while (e < s.length) {
        const c = s[e]!;
        if (c === '#' || c === '.' || c === '>' || c === '+' || c === '~' || c.trim() === '') {
          break;
        }
        e++;
      }
      segs.push(s.slice(k, e));
      k = e;
    } else {
      k++;
    }
  }
  return segs;
}

/** `/(?:^|[\s,])\.-?[_a-zA-Z]/`: a `.` at string start or after whitespace/comma, then
 * an optional `-`, then `[_a-zA-Z]` — an unquoted class-selector capture. Non-regex. */
function hasUnquotedClassSelector(text: string): boolean {
  for (let k = 0; k < text.length; k++) {
    if (text[k] !== '.') {
      continue;
    }
    if (k > 0) {
      const prev = text[k - 1]!;
      if (prev.trim() !== '' && prev !== ',') {
        continue;
      }
    }
    let p = k + 1;
    if (text[p] === '-') {
      p++;
    }
    const ch = text[p];
    if (ch !== undefined && (ch === '_' || isAsciiLetter(ch))) {
      return true;
    }
  }
  return false;
}

/** `/^\[([^\]]*)\]/`: leading `[`, zero+ non-`]` chars, `]`. Returns the inner text and the
 * full match length, or null. Non-regex. */
function leadingBracket(s: string): { inner: string; length: number } | null {
  if (s[0] !== '[') {
    return null;
  }
  let e = 1;
  while (e < s.length && s[e] !== ']') {
    e++;
  }
  if (e >= s.length || s[e] !== ']') {
    return null;
  }
  return { inner: s.slice(1, e), length: e + 1 };
}

/** `/^([.#][^\[\]()\s]+)(\[([^\]]*)\])?$/`: a `.`/`#` selector token (no brackets, parens,
 * or whitespace), optionally followed by a `[...]` accessor, spanning the whole string.
 * Returns the selector and the bracket inner (undefined when no bracket), or null. */
function parseSelBracketRef(s: string): { sel: string; bracket: string | undefined } | null {
  const c0 = s[0];
  if (c0 !== '.' && c0 !== '#') {
    return null;
  }
  let i = 1;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '[' || c === ']' || c === '(' || c === ')' || c.trim() === '') {
      break;
    }
    i++;
  }
  if (i === 1) {
    return null;
  }
  const sel = s.slice(0, i);
  if (i === s.length) {
    return { sel, bracket: undefined };
  }
  if (s[i] !== '[') {
    return null;
  }
  let e = i + 1;
  while (e < s.length && s[e] !== ']') {
    e++;
  }
  if (e === s.length || s[e] !== ']' || e + 1 !== s.length) {
    return null;
  }
  return { sel, bracket: s.slice(i + 1, e) };
}

/** `/^\s*\[([^\]]+)\]/`: leading optional-ws `[`, ≥1 non-`]` chars, `]`. Returns the inner
 * text and the full match length (incl. leading ws), or null. Non-regex. */
function leadingBracketGroup(s: string): { inner: string; length: number } | null {
  let i = 0;
  while (i < s.length && s[i]!.trim() === '') {
    i++;
  }
  if (s[i] !== '[') {
    return null;
  }
  let e = i + 1;
  while (e < s.length && s[e] !== ']') {
    e++;
  }
  if (e === i + 1 || s[e] !== ']') {
    return null;
  }
  return { inner: s.slice(i + 1, e), length: e + 1 };
}

/** `/^\(\s*\)/`: `(`, optional-ws, `)` at the very start. Non-regex. */
function startsWithEmptyParens(s: string): boolean {
  if (s[0] !== '(') {
    return false;
  }
  let i = 1;
  while (i < s.length && s[i]!.trim() === '') {
    i++;
  }
  return s[i] === ')';
}

/** `/^\s*\(\s*\)/`: leading optional-ws `(`, optional-ws, `)`. Non-regex. */
function startsWithWsEmptyParens(s: string): boolean {
  let i = 0;
  while (i < s.length && s[i]!.trim() === '') {
    i++;
  }
  return startsWithEmptyParens(s.slice(i));
}

/** `/^\S+\s+\(/`: a leading non-whitespace run, then whitespace, then `(` (a mixin
 * name separated from its parens by whitespace). Non-regex; `.trim()` on a single char
 * matches JS `\s` exactly. */
function hasWhitespaceBeforeParen(src: string): boolean {
  let i = 0;
  while (i < src.length && src[i]!.trim() !== '') {
    i++;
  }
  if (i === 0) {
    return false;
  }
  let j = i;
  while (j < src.length && src[j]!.trim() === '') {
    j++;
  }
  return j > i && src[j] === '(';
}

/** Non-empty and made up entirely of CSS trivia whitespace (` \t\n\r\f`).
 * Non-regex equivalent of `/^[ \t\n\r\f]+$/u`. */
function isTriviaWhitespace(s: string): boolean {
  if (s.length === 0) {
    return false;
  }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r' && c !== '\f') {
      return false;
    }
  }
  return true;
}

function nodeChildren(children: ReadonlyArray<Child>): JessNode[] {
  return children.filter((c): c is JessNode => c._tag === 'node') as JessNode[];
}

// ---------------------------------------------------------------------------
// LessGrammar
// ---------------------------------------------------------------------------

export class LessGrammar extends CssParser {
  /** Math mode governing when arithmetic operates / when `/` divides. Less default. */
  mathMode: MathMode = 'parens-division';

  /** Bare ident/keyword token in value or guard position. */
  private _lessKeyword(text: string, loc: LocationInfo): Keyword {
    return this._valueKeyword(text, loc);
  }

  private _isKeywordLike(node: unknown): node is Keyword | Any {
    return !!node && typeof node === 'object'
      && ((node as { type?: string }).type === 'Keyword' || (node as { type?: string }).type === 'Any');
  }

  private _isEmptyKeywordLike(node: unknown): boolean {
    return !node
      || (this._isKeywordLike(node) && !String((node as { value?: string }).value ?? '').trim());
  }

  // -- buildNode -------------------------------------------------------------
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/naming-convention */

  protected override _builderEntries(): Record<string, BuilderFn> {
    return { ...super._builderEntries(), ...this._lessBuilderEntries() };
  }

  private _lessBuilderEntries(): Record<string, BuilderFn> {
    return {
      VarDeclaration: a => this._buildVarDeclaration(a.children, a.rawChildren, a.loc),
      Reference: a => this._buildReference(a.children, a.loc),
      LessAmpersand: a => this._buildAmpersand(a.children, a.loc),
      ComplexSelector: a => this._buildComplexSelector(a.rawChildren, a.loc),
      SelectorList: a => this._buildSelectorList(a.rawChildren, a.loc),
      Ruleset: a => this._buildRuleset(a.children, a.rawChildren, a.loc) as unknown as JessNode,
      Declaration: (a) => {
        this._warnDeprecatedValue(a.span);
        return this._buildLessDeclaration(a.rawChildren, a.loc);
      },
      CustomDeclaration: (a) => {
        this._warnCustomPropVars(a.span);
        return this._buildLessCustomDecl(a.children, a.loc);
      },
      Block: a => this._buildLessCustomBlock(a.children, a.loc),
      AtRuleBlock: (a) => {
        this._warnAtRulePreludeVars(a.span);
        return this._buildAtRuleBlock(a.children, a.loc) as unknown as JessNode;
      },
      QueryAtRuleBlock: (a) => {
        this._warnAtRulePreludeVars(a.span);
        return this._buildLessQueryAtRuleBlock(a.children, a.rawChildren, a.loc);
      },
      NamedColor: a => this._buildNamedColor(a.children, a.loc),
      Comparison: a => this._buildComparison(a.rawChildren, a.loc),
      GuardDefault: a => new DefaultGuard('default()', undefined, a.loc) as unknown as JessNode,
      GuardInParens: a => this._buildGuardInParens(a.children, a.loc),
      GuardTerm: a => this._buildGuardTerm(a.rawChildren, a.loc),
      GuardAnd: a => this._buildGuardJoin(a.children, a.loc, 'and'),
      GuardOr: a => this._buildGuardJoin(a.children, a.loc, 'or'),
      Guard: a => this._buildGuard(a.children, a.loc),
      CondArgTerm: a => this._buildCondArgTerm(a.rawChildren, a.loc),
      CondArgAnd: a => this._buildCondArgJoin(a.children, a.loc, 'and'),
      CondArgOr: a => this._buildCondArgJoin(a.children, a.loc, 'or'),
      UnicodeRange: a => this._lessKeyword(this._source.slice(a.span.start, a.span.end), a.loc) as unknown as JessNode,
      PseudoSelector: a => this._buildLessPseudo(a.type, a.span, a.children, a.state, a.rawChildren, a.fields, a.triviaLog, a.loc),
      InterpolatedSelector: a => this._buildInterpolatedSelector(a.children, a.loc),
      LessInterp: a => this._buildLessInterpLeaf(a.span) as unknown as JessNode,
      VarCall: a => this._buildVarCall(a.children, a.rawChildren, a.loc),
      MixinCall: a => this._buildMixinCall(a.children, a.rawChildren, a.loc),
      Rest: a => this._buildRest(a.children, a.loc),
      NamedArg: a => this._buildNamedArg(a.rawChildren, a.loc),
      MixinArgs: a => this._buildMixinArgs(a.rawChildren, a.loc),
      AnonymousMixinDefinition: a => this._buildAnonMixin(a.children, a.loc) as unknown as JessNode,
      DetachedRuleset: a => this._buildDetachedRuleset(a.children, a.loc) as unknown as JessNode,
      For: a => this._buildEachFor(a.children, a.loc) as unknown as JessNode,
      FormatCall: a => this._buildFormatCall(a.rawChildren, a.loc),
      MixinOrQualifiedRule: a => this._buildMixinOrQualified(a.children, a.loc),
      Negative: a => new Negative(this._negativeOperand(a.children), undefined, a.loc) as unknown as JessNode,
      OperationTop: a => this._buildOperation(a.children, a.loc, this.mathMode === 'always') as unknown as JessNode,
      EscapedValue: a => this._buildEscapedValue(a.children, a.loc),
      InterpValue: a => this._buildInterpValue(a.rawChildren, a.loc),
      NsAccessor: a => this._buildNsAccessor(a.children, a.loc),
      AtRuleStatement: a => this._buildAtRuleStatement(a.children, a.loc),
      ExtendTarget: a => this._buildExtendTarget(a.children, a.rawChildren, a.loc),
      ExtendPseudo: a => this._buildExtendPseudo(a.children, a.loc),
      ExtendStatement: a => this._buildExtendStatement(a.children, a.rawChildren, a.loc)
    };
  }

  // -- Private Less AST builders ---------------------------------------------

  /**
   * The operand of a `Negative` (`-value`). The grammar emits the leading `-`
   * as a leaf followed by the operand, which may itself be a node or a bare
   * string terminal (e.g. `-@color` → `var(--color)`'s inner `-color-accent`).
   * Prefer a node child; otherwise take the operand leaf's text so `Negative`
   * coerces it to the canonical node form rather than receiving `undefined`.
   */
  private _negativeOperand(children: ReadonlyArray<Child>): JessNode | string {
    const node = nodeChildren(children)[0];
    if (node) {
      return node;
    }
    const operand = children.find((c): c is CSTLeaf => c._tag === 'leaf' && c.value !== '-');
    return operand?.value ?? '';
  }

  private _buildVarDeclaration(children: ReadonlyArray<JessNode | CSTLeaf | CSTError>, rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
    // Less.js still accepts a digit-leading variable name (`@3`) — its name regex
    // is `[\w-]+` — but it's a footgun (collides with numeric tokens), so flag it.
    // `/^-?\d/`: the first char after an optional leading `-` is a digit.
    const firstDigitCh = name[0] === '-' ? name[1] : name[0];
    if (firstDigitCh !== undefined && firstDigitCh >= '0' && firstDigitCh <= '9') {
      this._warn(
        `Variable name "@${name}" starts with a digit; digit-leading variable names are deprecated.`,
        'digit-leading-variable'
      );
    }
    const colonIdx = items.findIndex(i => i.comp === ':');
    const afterColon = items[colonIdx + 1];
    if (afterColon?.comp === '{') {
      // Detached ruleset: @var: { ... }
      const ruleNodes = nodeChildren(children);
      const openBrace = items[colonIdx + 1]!;
      const closeBrace = items[items.length - 1]!.comp === '}'
        ? items[items.length - 1]!
        : undefined;
      // Raw-string detached ruleset (grammar's rawDetachedBlock fallback): the body
      // had no structurable declarations but is non-empty (special-char keys like
      // bootstrap's `@escaped-characters: { <: %3c; … }`). Historical Less keeps such
      // a block as a raw `Quoted` string (braces included); @plugin functions such as
      // escape-svg read it via `.value`.
      if (ruleNodes.length === 0 && closeBrace) {
        const bodyText = this._source.slice(openBrace.span.end, closeBrace.span.start);
        if (bodyText.trim() !== '') {
          const rawBlock = this._source.slice(openBrace.span.start, closeBrace.span.end);
          const nameNode = name || undefined;
          return new VarDeclaration(
            { name: (nameNode ?? name) as any, value: new Quoted(rawBlock, undefined, loc) as any } as any,
            undefined,
            loc
          );
        }
      }
      const mixin = new Mixin({ rules: ruleNodes }, undefined, loc);
      const nameNode = name || undefined;
      return new VarDeclaration(
        { name: (nameNode ?? name) as any, value: mixin as any } as any,
        undefined,
        loc
      );
    }
    let end = items.length;
    let bangIdx = -1;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!') {
        end = i;
        bangIdx = i;
        break;
      }
      if (c === 'important' || c === ';') {
        end = i;
        break;
      }
    }
    const valItems = items.slice(colonIdx + 1, end);
    // A tolerated trailing comma (`@x: a, b, c,;`) is not a value item — Less 4.x
    // drops it, so a comma-list value keeps N items, not N + 1 empty. (Plain
    // declarations go through the CSS builder, which already filters empty
    // segments; the Less var path assembles valItems directly, so strip it here.)
    if (valItems.length > 0 && valItems[valItems.length - 1]!.comp === ',') {
      valItems.pop();
    }
    if (valItems.length) {
      const vText = this._source.slice(valItems[0]!.span.start, valItems[valItems.length - 1]!.span.end);
      if (hasUnquotedClassSelector(vText)) {
        this._warn(
          `Unquoted selector capture in variable "@${name}" is deprecated; wrap the value in quotes or ~"...".`,
          'unquoted-selector-capture'
        );
      }
    }
    const nsRef = this._tryParseNamespaceRef(valItems, loc);
    let { value: rawValue } = nsRef ? { value: nsRef } : this._assembleLessValue(valItems, loc);
    // Check for trailing [accessor] and/or () in source that the grammar couldn't consume.
    // (nsRef already handles this via internal lookahead; only do it when nsRef is null)
    if (!nsRef && valItems.length > 0) {
      const lastSpan = valItems[valItems.length - 1]!.span;
      const afterVal = this._source.slice(lastSpan.end);
      // The grammar may partially consume '[' into the Reference CST due to parseman
      // not rolling back CST leaves on optional-sequence failure. Detect this case:
      // rawValue is Reference with target set but key='' (empty from grammar bug).
      const rv = rawValue as any;
      // Grammar bug: parseman leaks '[' into CST but accessor fails → Reference(target, key=''|Quoted(''))
      const rvKey = rv?.key;
      const isEmptyKey = rvKey === '' || rvKey === undefined
        || (rvKey && typeof rvKey === 'object' && rvKey.type === 'Quoted' && (rvKey.value === '' || rvKey.valueOf?.() === ''));
      const grammarPartialAccessor =
        rv?.type === 'Reference' && rv.target !== undefined && isEmptyKey;
      const accMatch = leadingBracketGroup(afterVal);
      if (accMatch) {
        const accText = accMatch.inner.trim();
        const accessorKey = this._decodeAccessorKey(accText, loc);
        // A numeric accessor key (`foo[2]` / `foo[]` → last, key -1) is an INDEX
        // lookup; a variable dispatch would fail with `'-1' is not defined`.
        const accessorRefOptions = typeof accessorKey === 'number'
          ? { type: 'index' as const }
          : {};
        if (grammarPartialAccessor) {
          // Fix in-place: replace the wrong key on the existing Reference wrapper
          rawValue = new Reference(
            { target: rv.target as any, key: accessorKey as any } as unknown as ReferenceValue,
            accessorRefOptions,
            loc
          ) as unknown as JessNode;
        } else {
          // No partial grammar accessor: wrap with new Reference
          rawValue = new Reference(
            { target: rawValue as any, key: accessorKey as any } as unknown as ReferenceValue,
            accessorRefOptions,
            loc
          ) as unknown as JessNode;
        }
        const afterAcc = afterVal.slice(accMatch.length);
        if (startsWithWsEmptyParens(afterAcc)) {
          rawValue = new Call({ name: rawValue as any } as any, undefined, loc) as unknown as JessNode;
        }
      }
    }
    const value = rawValue;
    // `important` is the verbatim source text (`!important`, `! important`, …),
    // not a boolean — the declaration stores the string it will re-emit.
    let important: string | undefined;
    if (bangIdx >= 0) {
      const bang = items[bangIdx]!;
      const kw = items[bangIdx + 1];
      const impEnd = kw && typeof kw.comp === 'string' && kw.comp.toLowerCase() === 'important'
        ? kw.span.end
        : bang.span.end;
      important = this._source.slice(bang.span.start, impEnd);
    }
    const nameNode = name || undefined;
    return new VarDeclaration(
      { name: (nameNode ?? name) as any, value, important } as any,
      undefined,
      loc
    );
  }

  /**
   * Build a Less variable reference and its accessor/call chain. Faithful 1:1
   * port of the Chevrotain `varReference` + `lookupOrCall` productions
   * (productions/values.ts, productions/guards.ts): a `@var` base glued to a
   * left-folded chain of `[index]` accessors and `(call)`s. The grammar's
   * noTrivia() guarantees the chain is adjacent (no whitespace between segments).
   */
  private _buildReference(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const varName = ls[0]?.value ?? '';
    // Head sigil types the base reference. `@a` → variable. `$color` → a bare
    // property accessor: an `index` reference with a Quoted key and no target,
    // resolved against the current scope (port of varReference's PropertyReference
    // branch). Anything else → bare index base.
    const isVar = varName.startsWith('@');
    const isProp = varName.startsWith('$');
    let base: JessNode = isProp
      ? new Reference(
        { key: new Quoted(varName.slice(1), { quote: '\'' }, loc) as any } as unknown as ReferenceValue,
        { type: 'index' },
        loc
      ) as unknown as JessNode
      : new Reference(
        isVar ? varName.slice(1) : varName,
        isVar ? { type: 'variable' as const } : {},
        loc
      ) as unknown as JessNode;
    let i = 1;
    while (i < ls.length) {
      const tok = ls[i]!.value;
      if (tok === '[') {
        if (ls[i + 1]?.value === ']') {
          // Empty `[]` → key = -1, type index (lookupOrCall else-branch).
          base = new Reference(
            { target: base as any, key: -1 } as unknown as ReferenceValue,
            { type: 'index' }, loc
          ) as unknown as JessNode;
          i += 2;
        } else {
          base = this._applyReferenceAccessor(base, ls[i + 1]!.value, loc);
          i += 3; // '[', key, ']'
        }
      } else if (tok === '(') {
        const payload: Record<string, unknown> = { name: base };
        if (ls[i + 1]?.value === ')') {
          i += 2;
        } else {
          const args = this._buildRefCallArgs(ls[i + 1]!.value, loc);
          if (args) {
            payload.args = args;
          }
          i += 3; // '(', content, ')'
        }
        base = new Call(payload as any, undefined, loc) as unknown as JessNode;
      } else {
        break;
      }
    }
    return base;
  }

  /**
   * Build a namespace INDEXED-accessor value: a `.`/`#` selector-path head glued to
   * a `[accessor]` (and any further `[accessor]`/`(call)` chain), e.g.
   * `#ns.options[val1]`. The grammar (NsAccessor) captures this as ONE value operand
   * so it survives arithmetic folding; here we reassemble it into the mixin-ruleset
   * name Reference + accessor chain — the SAME shape the declaration-value
   * _assembleSegment path produces for a lone `#ns.options[val1]`. Call-headed forms
   * (`.mixin()`, `.mixin()[k]`) do NOT reach here (they keep the GluedParen path).
   * Leaves: [ headText, '[', key?, ']', '(', content?, ')' … ].
   */
  private _buildNsAccessor(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const headText = (ls[0]?.value ?? '').trim();
    // Split the selector path into segments: `#ns.options` → ['#ns', '.options'];
    // combinators (`#ns > .a`) are dropped, each `.`/`#` name is one segment.
    const headSegs = splitSelectorHeadSegments(headText);
    const pathSegs = headSegs.length > 0 ? headSegs : [headText];
    const nameKey: string | string[] = pathSegs.length === 1 ? pathSegs[0]! : pathSegs;
    const rawKey = pathSegs.length > 1 ? pathSegs.join('') : undefined;
    let base: JessNode = new Reference(
      { key: nameKey, ...(rawKey ? { rawKey } : {}) } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any, loc
    ) as unknown as JessNode;
    let i = 1;
    while (i < ls.length) {
      const tok = ls[i]!.value;
      if (tok === '[') {
        if (ls[i + 1]?.value === ']') {
          base = new Reference(
            { target: base as any, key: -1 } as unknown as ReferenceValue,
            { type: 'index' }, loc
          ) as unknown as JessNode;
          i += 2;
        } else {
          base = this._applyReferenceAccessor(base, ls[i + 1]!.value, loc);
          i += 3;
        }
      } else if (tok === '(') {
        const payload: Record<string, unknown> = { name: base };
        if (ls[i + 1]?.value === ')') {
          i += 2;
        } else {
          const args = this._buildRefCallArgs(ls[i + 1]!.value, loc);
          if (args) {
            payload.args = args;
          }
          i += 3;
        }
        base = new Call(payload as any, undefined, loc) as unknown as JessNode;
      } else {
        break;
      }
    }
    return base;
  }

  /**
   * Apply one `[key]` accessor to `base`, reproducing lookupOrCall's key logic:
   * type is `variable` when the key token starts with `@`, else `index`; the key
   * text runs through getInterpolatedOrString (handling `$@x`/`@{x}` interpolation),
   * and index keys are wrapped in a Quoted.
   */
  private _applyReferenceAccessor(base: JessNode, keyStr: string, loc: LocationInfo): JessNode {
    const type: 'variable' | 'index' = keyStr.startsWith('@') ? 'variable' : 'index';
    let result: string | JessNode = getInterpolatedOrString(keyStr, loc) as string | JessNode;
    if (type === 'index') {
      result = new Quoted(result as any, { quote: '\'' }, loc) as unknown as JessNode;
    }
    return new Reference(
      { target: base as any, key: result as any } as unknown as ReferenceValue,
      { type }, loc
    ) as unknown as JessNode;
  }

  /**
   * Build mixin-call args for a `(…)` segment in a reference chain from the raw
   * captured content. Comma-separated values become a List; an empty segment
   * yields null (no args). Sub-structure here is intentionally shallow — the
   * accessor-chain call form is rare and no consumer inspects nested arg shape.
   */
  private _buildRefCallArgs(content: string, loc: LocationInfo): JessNode | null {
    const trimmed = content.trim();
    if (!trimmed) {
      return null;
    }
    const parts = trimmed.split(',').map(p => p.trim()).filter(Boolean);
    const items = parts.map(p => p.startsWith('@')
      ? new Reference(p.slice(1), { type: 'variable' as const }, loc) as unknown as Node
      : this._lessKeyword(p, loc) as unknown as Node);
    return new List(items as any, undefined, loc) as unknown as JessNode;
  }

  private _buildNamedColor(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    return new Color({ node: name }, undefined, loc) as unknown as JessNode;
  }

  private _normalizeCompareOp(op: string): ConditionOperator {
    switch (op) {
      case '=>':
      case '>=':
        return '>=';
      case '=<':
      case '<=':
        return '<=';
      case '>':
        return '>';
      case '<':
        return '<';
      default:
        return '=';
    }
  }

  /** A guard comparison operator leaf (`=`, `<`, `>=`, `=<`, `=~`, …). Mirrors the
   * grammar's `compareOp` terminal without a regex: every operator token contains a
   * `<`, `>`, or `=` (and a lone `~` is not an operator), so a char-membership test is
   * exactly equivalent to `/>=|<=|=>|=<|=~|[<>=]/`. */
  private _isCompareOpLeaf(text: string): boolean {
    return text.includes('<') || text.includes('>') || text.includes('=');
  }

  /**
   * Split a guard term's ordered components into `left [op right]`. A bare-keyword
   * operand (`foo`, `true`) is a leaf string — not a node — so `nodeChildren`
   * alone drops it; walk the ordered stream so string operands become real
   * keyword nodes (their guard truthiness is decided at eval by `Condition`).
   */
  private _guardComparison(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo):
  { left: Node; op?: ConditionOperator; right?: Node } {
    const items = spannedComponents(raw);
    let op: ConditionOperator | undefined;
    const operands: Node[] = [];
    for (const it of items) {
      if (typeof it.comp === 'string') {
        if (this._isCompareOpLeaf(it.comp)) {
          op = this._normalizeCompareOp(it.comp);
          continue;
        }
        operands.push(this._lessKeyword(it.comp, loc) as unknown as Node);
      } else {
        operands.push(it.comp as unknown as Node);
      }
    }
    const left = this._maybeDefaultGuard(operands[0] ?? this._lessKeyword('', loc), loc);
    const right = operands[1] !== undefined ? this._maybeDefaultGuard(operands[1], loc) : undefined;
    return { left, op, right };
  }

  private _buildComparison(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const { left, op, right } = this._guardComparison(raw, loc);
    if (op && right) {
      return new Condition([left, op, right], undefined, loc) as unknown as JessNode;
    }
    return new Condition([left], undefined, loc) as unknown as JessNode;
  }

  /**
   * Coerce a `_assembleValue` result — a single Component or a raw space-group
   * array — into ONE Node, so it can be a Condition operand. A single string
   * becomes a keyword; a space-group array becomes a `Sequence` (the same coercion
   * the List serializer applies to a raw group).
   */
  private _condOperandNode(comps: Spanned[], loc: LocationInfo): Node {
    const { value } = this._assembleValue(comps, loc);
    if (Array.isArray(value)) {
      const nodes = (value as Component[]).map(c =>
        typeof c === 'string' ? this._lessKeyword(c, loc) as unknown as Node : c as unknown as Node);
      return new Sequence(nodes as any, undefined, loc) as unknown as Node;
    }
    if (typeof value === 'string') {
      return this._lessKeyword(value, loc) as unknown as Node;
    }
    return value as unknown as Node;
  }

  /**
   * `CondArgTerm` — a name-independent condition-argument term: optional leading
   * `not`, a bounded value operand, and an optional `<op> right` comparison. Builds
   * a `Condition` (comparison → `[left, op, right]`; bare `not` → `{negate:true}`)
   * or, when neither a `not` nor a `compareOp` is present, the plain operand value
   * (byte-identical to an ordinary value arg). Multi-token operands (`1px solid`)
   * survive as a `Sequence`, unlike the single-operand guard path.
   */
  private _buildCondArgTerm(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const items = spannedComponents(raw);
    const hasNot = items.length > 0 && items[0]!.comp === 'not';
    const rest = hasNot ? items.slice(1) : items;
    const opIdx = rest.findIndex(it => typeof it.comp === 'string' && this._isCompareOpLeaf(it.comp));
    let term: Node;
    if (opIdx >= 0) {
      const left = this._condOperandNode(rest.slice(0, opIdx), loc);
      const op = this._normalizeCompareOp(rest[opIdx]!.comp as string);
      const right = this._condOperandNode(rest.slice(opIdx + 1), loc);
      term = new Condition([left, op, right], undefined, loc) as unknown as Node;
    } else {
      term = this._condOperandNode(rest, loc);
    }
    if (hasNot) {
      return new Condition([term as any], { negate: true }, loc) as unknown as JessNode;
    }
    return term as unknown as JessNode;
  }

  /**
   * Fold a left-associative `and`/`or` chain of condition-arg terms into Conditions.
   *
   * Less accepts a bare `and`/`or` join in value-position condition args (`if(@a > 5
   * and @b < 2, …)`) — verified against less@4.6.7 (`if`/`boolean` route their arg
   * through `condition()` with no `needsParens`, so bare comparisons split on `and`/
   * `or`). We keep accepting the bare form for Less parity, but NORMALIZE the AST so
   * each join operand is `Paren`-wrapped: `@a > 5 and @b < 2` builds the SAME tree as
   * the explicitly-parenthesised `(@a > 5) and (@b < 2)`. This is a structural
   * normalisation only — `Paren(Condition)` evaluates to the same boolean as the bare
   * `Condition`, so rendered CSS is byte-identical. A single unjoined operand (one
   * node) is untouched (no synthetic Paren).
   */
  private _buildCondArgJoin(children: ReadonlyArray<Child>, loc: LocationInfo, op: ConditionOperator): JessNode {
    const nodes = nodeChildren(children);
    if (nodes.length === 0) {
      return this._lessKeyword('', loc) as unknown as JessNode;
    }
    if (nodes.length === 1) {
      return nodes[0]! as unknown as JessNode;
    }
    const wrap = (n: Node): Node =>
      (n as { type?: string }).type === 'Paren'
        ? n
        : (new Paren(n as any, undefined, loc) as unknown as Node);
    let left = wrap(nodes[0]!);
    for (let i = 1; i < nodes.length; i++) {
      left = new Condition([left, op, wrap(nodes[i]!)], undefined, loc) as unknown as Node;
    }
    return left as unknown as JessNode;
  }

  /** Coerce a default() call/reference into a DefaultGuard, mirroring isDefaultGuardCall. */
  private _maybeDefaultGuard(node: Node, loc: LocationInfo): Node {
    const n = node as any;
    if (n?.type === 'Call') {
      const name = n.name;
      const nameStr = String(
        typeof name === 'object' && name !== null && 'valueOf' in name ? name.valueOf() : name ?? ''
      );
      if (nameStr === 'default' || nameStr === '??') {
        return new DefaultGuard('default()', undefined, loc) as unknown as Node;
      }
    }
    return node;
  }

  /** guardInParens: `(` guardOr `)` → Paren, or a bare default() → Paren(DefaultGuard). */
  private _buildGuardInParens(children: ReadonlyArray<Child>, loc: LocationInfo) {
    let inner = nodeChildren(children)[0] ?? this._lessKeyword('', loc);
    inner = this._maybeDefaultGuard(inner, loc) as Node;
    // `(default())` nests guardInParens(GuardDefault) inside another guardInParens;
    // collapse the redundant Paren-around-Paren(DefaultGuard) to a single Paren.
    const innerAny = inner as any;
    if (innerAny?.type === 'Paren' && (innerAny.value as any)?.type === 'DefaultGuard') {
      return inner as unknown as JessNode;
    }
    return new Paren(inner as any, undefined, loc) as unknown as JessNode;
  }

  /** A single guard term: optional `not`, then a paren-guard or a comparison/value. */
  private _buildGuardTerm(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(raw);
    const hasNot = items.some(i => typeof i.comp === 'string' && i.comp === 'not');
    // Everything after an optional leading `not` is the operand run.
    const rest = raw.filter(rc => !(rc._tag === 'leaf' && (rc as { value?: string }).value === 'not'));
    const nodes = nodeChildren(rest as ReadonlyArray<Child>);
    let term: Node;
    if (nodes.length >= 1 && (nodes[0] as any).type === 'Paren') {
      // guardInParens branch (already a Paren node)
      term = nodes[0]!;
    } else {
      const { left, op, right } = this._guardComparison(rest, loc);
      term = op && right
        ? new Condition([left, op, right], undefined, loc) as unknown as Node
        : left;
    }
    if (hasNot) {
      return new Condition([term as any], { negate: true }, loc) as unknown as JessNode;
    }
    return term as unknown as JessNode;
  }

  /** Fold a left-associative chain of terms joined by `and` / `or`. */
  private _buildGuardJoin(children: ReadonlyArray<Child>, loc: LocationInfo, op: ConditionOperator) {
    const nodes = nodeChildren(children);
    if (nodes.length === 0) {
      return this._lessKeyword('', loc) as unknown as JessNode;
    }
    let left = nodes[0]!;
    for (let i = 1; i < nodes.length; i++) {
      left = new Condition([left, op, nodes[i]!], undefined, loc) as unknown as Node;
    }
    return left as unknown as JessNode;
  }

  /** guard: `when` guardOr — returns the single guardOr child. */
  private _buildGuard(children: ReadonlyArray<Child>, loc: LocationInfo) {
    return (nodeChildren(children)[0] ?? this._lessKeyword('', loc)) as unknown as JessNode;
  }

  /**
   * Deprecated Less `%(format, args…)` string formatting, LOWERED at build time.
   *
   * Jess already has full string interpolation, so `%()` is redundant Less-4 legacy —
   * we emit a `percent-format` deprecation warning and, when the format is a string
   * literal, splice its `%[sda]` directives into the canonical `Interpolated` node
   * (the same one `@{var}` string interpolation builds), wrapped in a `Quoted` that
   * preserves the literal's quote char / escaped flag:
   *   - `%s`  → bare interpolation slot (a Quoted arg inserts with its quotes stripped);
   *   - `%d`/`%a` → identical bare slot (d/a are the same in Less);
   *   - `%S`/`%D`/`%A` → the arg WRAPPED in `escape(…)` (URL-encode);
   *   - `%%` → a literal `%`.
   * A dynamic (non-literal) format (`%(hello)`, `%(e("…"), …)`) can't be lowered at
   * parse time, so it falls back to a best-effort runtime `%` Call with the same warning.
   */
  private _buildFormatCall(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    this._warn('%() string formatting is deprecated — use string interpolation', 'percent-format');

    // Assemble the args exactly like a normal Call so bare keywords (`%(hello)`) are
    // keyword-ified and comma runs fold uniformly.
    const argList = this._assembleArgs(this._betweenParens(spannedComponents(raw)), loc) as unknown as List<Node>;
    const args = (argList.value ?? []) as Node[];
    const format = args[0];
    const rest = args.slice(1);

    // The format must be a Quoted literal (plain `"…"`, `'…'`, or escaped `~"…"`)
    // wrapping a bare string to lower; anything else stays a runtime call.
    if (format instanceof Quoted && typeof format.value === 'string') {
      const { source, replacements } = this._lowerFormatString(format.value, rest, loc);
      const interp = new Interpolated({ source, replacements: replacements as any }, { role: 'ident' }, loc);
      return new Quoted(interp as any, { quote: format.quote, escaped: format.escaped }, loc) as unknown as JessNode;
    }

    // Dynamic / non-literal format (`%(hello)`, `%(e("…"), …)`): best-effort runtime `%` Call.
    const nameRef = new Reference('%', { type: 'function', fallbackValue: true } as any, loc);
    return new Call({ name: nameRef as any, args: argList as any }, { silentFail: true } as any, loc) as unknown as JessNode;
  }

  /**
   * Turn a printf-style format string into an `Interpolated` source + replacements.
   * `%[sda]` → one `INTERPOLATION_PLACEHOLDER` slot consuming the next positional arg
   * (uppercase → wrapped in `escape(…)` to URL-encode); `%%` → a literal `%`.
   */
  private _lowerFormatString(
    formatText: string, restArgs: ReadonlyArray<Node>, loc: LocationInfo
  ): { source: string; replacements: Node[] } {
    let source = '';
    const replacements: Node[] = [];
    let argIndex = 0;
    for (let i = 0; i < formatText.length; i++) {
      const ch = formatText[i]!;
      if (ch !== '%') {
        source += ch;
        continue;
      }
      const next = formatText[i + 1];
      if (next === '%') {
        source += '%';
        i++;
        continue;
      }
      if (next && /[sda]/i.test(next)) {
        const arg = restArgs[argIndex++];
        if (arg) {
          source += INTERPOLATION_PLACEHOLDER;
          // Uppercase directive (`%S`/`%D`/`%A`) → URL-encode the inserted value.
          if (/[A-Z]/.test(next)) {
            const escapeRef = new Reference('escape', { type: 'function', fallbackValue: true } as any, loc);
            const escapeArgs = new List([arg] as any, undefined, loc);
            replacements.push(new Call({ name: escapeRef as any, args: escapeArgs as any }, { silentFail: true } as any, loc) as unknown as Node);
          } else {
            replacements.push(arg);
          }
        } else {
          // No matching arg — Less leaves the directive in place as literal text.
          source += ch + next;
        }
        i++;
        continue;
      }
      source += ch;
    }
    return { source, replacements };
  }

  /**
   * `LessInterp` (`@{name}` / `@{map[key]}`) — the grammar now STRUCTURES the
   * interpolation body into a `LessInterp` node (head + `[key]` accessor leaves) so
   * the ast/ host can resolve `@{map[key]}`. The legacy BuilderHost has no accessor
   * resolution (that closes on the front-end flip), so it re-collapses the node into
   * the single flat `@{…}` leaf every existing interp consumer here already expects
   * (`_buildInterpolatedSelector`, `getInterpolatedOrString`/`getInterpolatedNode`
   * over the value/name bytes). Emitting the verbatim token keeps this path
   * byte-identical for `@{name}`; `@{map[key]}` stays a flat (unresolved) interp,
   * exactly as before.
   */
  private _buildLessInterpLeaf(span: Span): CSTLeaf {
    return { _tag: 'leaf', value: this._source.slice(span.start, span.end), span };
  }

  private _buildInterpolatedSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const replacements: Node[] = [];
    let source = '';
    for (const l of ls) {
      if (l.value.startsWith('@{')) {
        const varName = l.value.slice(2, -1);
        replacements.push(new Reference(varName, { role: 'ident' }, loc) as unknown as Node);
        source += INTERPOLATION_PLACEHOLDER;
      } else {
        source += l.value;
      }
    }
    const interp = new Interpolated({ source, replacements }, { role: 'ident' }, loc);
    return new InterpolatedSelector(interp as any, undefined, loc) as unknown as JessNode;
  }

  private _buildLessPseudo(
    type: string, span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown, raw: ReadonlyArray<{ _tag: string }>, fields: FieldMap | undefined, triviaLog: readonly number[], loc: LocationInfo
  ): JessNode {
    // `:extend(...)` is parsed by the dedicated ExtendPseudo grammar rule, never
    // here — generic PseudoSelector is guarded against it (extendAhead). So this
    // builder only ever sees real CSS pseudo-classes/elements. Call the CSS
    // PseudoSelector builder directly (name-keyed dispatch would re-enter this
    // Less override); Less does not override `_buildPseudoSelector`.
    const pseudo = this._buildPseudoSelector(children, loc) as JessNode;
    // `readPseudoArg` (css builder) only recognizes node/array args. Under the Less
    // grammar an `nth` arg (`4n+1`) arrives as a leaf string and a single-member
    // selector list collapses to a bare string — both of which it skips, leaving
    // `arg` undefined (`:not(.one)` → `:not`). Recover the arg as the child that
    // sits between the `(` and `)` leaves.
    let pseudoArg = (pseudo as unknown as { arg?: unknown }).arg;
    if (pseudoArg === undefined) {
      const open = children.findIndex(c => (c as CSTLeaf)._tag === 'leaf' && (c as CSTLeaf).value === '(');
      if (open >= 0) {
        const inner = children[open + 1];
        const isClose = (inner as CSTLeaf)?._tag === 'leaf' && (inner as CSTLeaf).value === ')';
        if (inner !== undefined && !isClose) {
          // A collapsed single-member selector list arrives as a bare string, an
          // `nth` value as a leaf token; both wrap to a Keyword so the pseudo arg
          // is an eval-able Node. A real node (multi-member list, etc.) passes through.
          const recovered = typeof inner === 'string'
            ? this._lessKeyword(inner, loc)
            : (inner as CSTLeaf)._tag === 'leaf'
                ? this._lessKeyword((inner as CSTLeaf).value, loc)
                : (inner as unknown as JessNode);
          (pseudo as unknown as { arg: unknown }).arg = recovered;
          pseudoArg = recovered;
        }
      }
    }
    if (Array.isArray(pseudoArg)) {
      // Unknown-pseudo: raw string array → Keyword[] for structured serialization.
      const keywordNodes = (pseudoArg as unknown[]).map(item =>
        typeof item === 'string' && item !== ' '
          ? this._lessKeyword(item, loc)
          : item as JessNode
      );
      (pseudo as unknown as { arg: unknown }).arg = keywordNodes;
    }
    return pseudo;
  }

  private _buildLessDeclaration(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(raw);
    const deferred = this._buildDeferredScalarDeclaration(items, loc);
    if (deferred) {
      return deferred;
    }
    const decl = this._buildDeclaration(raw, loc);
    const colonIdx = items.findIndex(i => i.comp === ':');
    const merge = colonIdx > 0 ? items[colonIdx - 1]?.comp : undefined;
    const assign = merge === '+_' ? '+_:' : merge === '+' ? '+,:' : ':';
    const d = decl as unknown as { _options?: Record<string, unknown>; name?: unknown };
    if (assign !== ':') {
      d._options = d._options ? { ...d._options, assign } : { assign };
    }
    // Wrap the string name. An interpolated property name (`@{prop}`, `pre-@{x}`)
    // becomes an Interpolated (port of `declaration`'s getInterpolatedNode branch);
    // a plain name becomes a bare string (or Interpolated when templated).
    if (typeof d.name === 'string' && d.name) {
      const nameStr = d.name;
      (decl as unknown as { name: unknown }).name =
        (nameStr.includes('@{') || nameStr.includes('${'))
          ? getInterpolatedNode(nameStr, loc)
          : nameStr;
    }
    // Arithmetic precedence is now folded in the grammar (topSum → Operation node),
    // so a top-level `10px + 5px` arrives as a single Operation. Wrap it in an
    // explicit parenthesized Expression (the Jess `$( … )` form) when math mode would
    // actually perform the operation. Port of wrapOuterExpressionIfNeeded.
    const dvRaw = (decl as unknown as { value?: unknown }).value;
    if (dvRaw && typeof dvRaw === 'object' && (dvRaw as { type?: string }).type === 'Operation') {
      const f = dvRaw as unknown as { operator?: any; left?: any; right?: any };
      if (shouldOperateWithMathFrames({ mathMode: this.mathMode, parenFrames: [], calcFrames: 0 }, f.operator, f.left, f.right)) {
        (decl as unknown as { value: unknown }).value = new Expression(dvRaw as any, { parens: true } as any, loc);
      }
      return decl;
    }
    // A top-level `/`-list that math mode WOULD divide (e.g. `math:always`) promotes to
    // a division Operation. Default `parens-division` keeps a top-level slash a list.
    const dvList = (decl as unknown as { value?: unknown }).value;
    if (dvList && (dvList as any).type === 'List' && (dvList as any).options?.sep === '/' && this.mathMode === 'always') {
      const items = (dvList as any).value as JessNode[];
      if (items.length >= 2 && items.every(it => this._isDivisionLike(it))) {
        let op: JessNode = items[0]!;
        for (let i = 1; i < items.length; i++) {
          op = new Operation([op, '/', items[i]] as any, undefined, loc) as unknown as JessNode;
        }
        const f = op as unknown as { operator: any; left: any; right: any };
        (decl as unknown as { value: unknown }).value =
          shouldOperateWithMathFrames({ mathMode: this.mathMode, parenFrames: [], calcFrames: 0 }, f.operator, f.left, f.right)
            ? new Expression(op as any, { parens: true } as any, loc)
            : op;
        return decl;
      }
    }
    // Legacy IE `filter: progid:…(…)` values. Chevrotain lexes the whole run as one
    // `LegacyMSFilter` token and `processLegacyMSFilterToken` collapses it to a single
    // Interpolated (role=any): the raw source with every `@var` replaced by a
    // placeholder (colorstr assignments keep the surrounding quotes) and the `@var`
    // references as replacements. We have no such token — the value parsed into a
    // Sequence/List/Paren tree — but for a `progid:` filter run we reconstruct the
    // identical node from the raw value source.
    const dv = (decl as unknown as { value?: unknown }).value;
    const dvIsArray = Array.isArray(dv);
    const dvHasNode = dvIsArray && (dv as unknown[]).some(p => !!p && typeof p === 'object' && 'type' in (p as object));
    if (dvIsArray && dvHasNode) {
      const src = this._source.slice(loc.start, loc.end);
      const colonPos = src.indexOf(':');
      const rawVal = colonPos >= 0 ? src.slice(colonPos + 1).trim().replace(/;\s*$/, '').trim() : src;
      if (/^progid:/i.test(rawVal)) {
        const legacy = this._buildLegacyMSFilter(rawVal, loc);
        (decl as unknown as { value: unknown }).value = legacy;
      }
    }
    return decl;
  }

  /**
   * Build the deliberately tiny deferred-value family emitted by
   * `DeferredScalarDeclaration`: a plain property and one unsigned numeric
   * terminal. The string is the exact authored source slice; no value node is
   * made until a node-only declaration consumer calls `valueNode()`.
   */
  private _buildDeferredScalarDeclaration(items: Spanned[], loc: LocationInfo): Declaration | undefined {
    // `noTrivia()` exposes the admitted whitespace as leaf children; discard
    // only those whitespace leaves before recognizing the intentionally exact
    // `name : scalar [;]` shape.
    const significant = items.filter(item => (
      typeof item.comp !== 'string' || !isTriviaWhitespace(item.comp)
    ));
    if (
      (significant.length !== 3 && significant.length !== 4)
      || typeof significant[0]?.comp !== 'string'
      || significant[1]?.comp !== ':'
      || typeof significant[2]?.comp !== 'string'
      || (significant.length === 4 && significant[3]?.comp !== ';')
    ) {
      return undefined;
    }
    const name = significant[0]!;
    const value = significant[2]!;
    const authoredValue = this._source.slice(value.span.start, value.span.end);
    const numeric = /^(\d+)([a-zA-Z]+|%)?$/u.exec(authoredValue);
    if (!numeric) {
      return undefined;
    }
    // Source-map parse mode retains the pre-POC scalar node shape so its value
    // span remains a distinct mapping origin. Normal render mode keeps the exact
    // authored spelling as the deferred scalar string.
    const declarationValue = this.context?.opts.sourceMap === true
      ? new Dimension({ number: Number(numeric[1]!), unit: numeric[2] }, undefined, spanToLocation(value.span))
      : authoredValue;
    const decl = new Declaration({ name: name.comp, value: declarationValue }, undefined, loc);
    const jn = decl as unknown as JessNode;
    const { index: nameIdx, count } = fieldIndexOf(jn, 'name');
    if (nameIdx >= 0) {
      setFieldSpan(jn, nameIdx, count, name.span, this._source);
    }
    const { index: valueIdx } = fieldIndexOf(jn, 'value');
    if (valueIdx >= 0) {
      setFieldSpan(jn, valueIdx, count, value.span, this._source);
    }
    return decl;
  }

  /**
   * Port of `processLegacyMSFilterToken` (lessRecursiveParser.ts): a `progid:…`
   * filter value string → Interpolated(role=any) with `@var` runs templated out,
   * or a plain Keyword when the run has no variables.
   */
  private _buildLegacyMSFilter(source: string, loc: LocationInfo): JessNode {
    source = source.replace(/\s*=\s*/g, '=');
    const varRe = /@([_a-zA-Z\xA0-￿][-_a-zA-Z0-9\xA0-￿]*)/g;
    const matches = [...source.matchAll(varRe)];
    if (matches.length === 0) {
      return this._lessKeyword(source, loc) as unknown as JessNode;
    }
    const templatedSource = source.replace(
      varRe,
      (_full, _name, offset: number, fullSource: string) => {
        const prefix = fullSource.slice(0, offset);
        const key = prefix.match(/([A-Za-z]+)=$/)?.[1];
        if (key && /colorstr$/i.test(key)) {
          return `"${INTERPOLATION_PLACEHOLDER}"`;
        }
        return INTERPOLATION_PLACEHOLDER;
      }
    );
    const replacements = matches.map(match =>
      createInterpolatedReference('@', match[1]!, loc) as unknown as JessNode);
    return new Interpolated(
      { source: templatedSource, replacements: replacements as any },
      { role: 'any' },
      loc
    ) as unknown as JessNode;
  }

  // Precedence is folded in the grammar (mathSum/topSum → Operation); the base
  // _buildOperation / _isDivisionLike (inherited from CssParser) handle the slash-
  // vs-list decision. `OperationTop` dispatches here with slashEnabled = math:always.

  private _buildAmpersand(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const hasParen = ls.some(l => l.value === '(');
    if (!hasParen) {
      // The ampersand token is always `&`-led (`&`, `&-bar`, `&1`) — a `.`/`#` prefix
      // like `.foo-&` parses as a separate BasicSelector + a bare `&`, not one token.
      // The suffix after `&` is the append value; a bare `&` has none.
      const image = ls[0]?.value ?? '&';
      const appendValue = this._ampersandTemplateValue(image);
      return new Ampersand(appendValue, undefined, loc) as unknown as JessNode;
    }
    const content = ls.find(l => l.value !== '&' && l.value !== '(' && l.value !== ')')?.value ?? '';
    const trimmed = content.trim();
    // Strip a matched outer quote pair (`'x'`/`"x"`) without a regex: same open/close
    // quote char and length ≥ 2. Non-regex form of `.replace(/^(['"])([\s\S]*)\1$/, '$2')`.
    const q0 = trimmed[0];
    const appendValue = trimmed === 'nil'
      ? ''
      : (trimmed.length >= 2 && (q0 === '"' || q0 === '\'') && trimmed[trimmed.length - 1] === q0
          ? trimmed.slice(1, -1)
          : trimmed);
    return new Ampersand(appendValue, undefined, loc) as unknown as JessNode;
  }

  /** The append value of a `&`-led ampersand token: the suffix after `&` (`&-bar` →
   * `-bar`, `&1` → `1`), or undefined for a bare `&`. */
  private _ampersandTemplateValue(image: string): string | undefined {
    return image === '&' ? undefined : image.slice(1) || undefined;
  }

  /**
   * A single extend target inside `extend( … )`: a complex selector plus its
   * optional `all` / `!all` flag (selectors.ts `complexSelector`'s OPTION2 flag).
   * Produced as an `Extend` carrier the surrounding pseudo/statement groups.
   */
  private _buildExtendTarget(
    _children: ReadonlyArray<Child>, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    // Components: the target selector (string or selector node) + an optional
    // trailing `all` / `!all` flag leaf. The complexSelector builder collapses a
    // lone `.x` to a bare string, so accept either form here.
    const comps = spannedComponents(raw);
    const isFlag = (c: unknown): c is string => c === 'all' || c === '!all';
    const hasFlag = comps.some(c => isFlag(c.comp));
    const flag = hasFlag ? ExtendFlag.All : ExtendFlag.Exact;
    const targetComp = comps.find(c => !isFlag(c.comp))?.comp;
    const target = (typeof targetComp === 'string'
      ? targetComp
      : (targetComp ?? '&')) as Selector;
    return new Extend({ target, flag }, undefined, loc) as unknown as JessNode;
  }

  /**
   * `:extend( … )` pseudo form (selectors.ts `extend`): groups its ExtendTarget
   * children. Targets sharing one flag collapse to a single Extend whose target is
   * a SelectorList (or the lone selector); mixed flags stay as one Extend each,
   * returned in a List. Mirrors mergeExtends' target-and-flag grouping.
   */
  private _buildExtendPseudo(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    // Grammar guarantees ≥1 target: `extendBody = sepBy(ExtendTarget, ',')`.
    const targets = nodeChildren(children).filter(n => n.type === 'Extend') as unknown as Array<{
      target: Selector; flag: number;
    }>;
    const firstFlag = targets[0]!.flag;
    const allSameFlag = targets.every(t => t.flag === firstFlag);
    if (allSameFlag) {
      const target = targets.length === 1
        ? targets[0]!.target
        : this._makeSelectorList(targets.map(t => t.target) as any, loc) as unknown as Selector;
      return new Extend({ target, flag: firstFlag }, undefined, loc) as unknown as JessNode;
    }
    const extendNodes: JessNode[] = targets.map(t =>
      new Extend({ target: t.target, flag: t.flag }, undefined, loc) as unknown as JessNode
    );
    return new List(extendNodes as any, undefined, loc) as unknown as JessNode;
  }

  /**
   * `&:extend( … );` (or bare `:extend( … );`) statement form (selectors.ts
   * `ampersandExtend`). The ExtendPseudo child already carries the grouped
   * Extend(s); the leading `&` is just the statement marker.
   */
  private _buildExtendStatement(
    children: ReadonlyArray<Child>, _raw: ReadonlyArray<{ _tag: string }>, _loc: LocationInfo
  ): JessNode {
    // ExtendPseudo always yields the grouped Extend (or List of Extends).
    const built = nodeChildren(children).find(n => n.type === 'Extend' || n.type === 'List')!;
    return built as unknown as JessNode;
  }

  /**
   * Decode a single `[key]` accessor into its Less lookup-key AST — the ONE shared
   * decoder for every accessor-chain builder path (var-decl value, declaration value,
   * at-rule prelude, namespace ref). Accepts either a raw authored key STRING (the
   * text inside the brackets, e.g. `@@foo`, `$@x`, `bar`, ``), or a SquareParen `Paren`
   * node whose inner content the grammar already parsed (a raw string or a `@var`
   * Reference). Returns the key exactly as the reference lookupOrCall production would:
   *
   *   `[]`        → -1        (index, empty)
   *   `[@@name]`  → Reference{type:variable,key:name}   (dynamic variable lookup)
   *   `[$@name]` / `[@$name]` → Quoted(Interpolated(@name))  (dynamic property lookup)
   *   `[@name]`   → 'name'    (static variable lookup; bare string key)
   *   `[$name]`   → Quoted('name')   (property lookup; `$` marker dropped)
   *   `[name]`    → Quoted('name')   (index)
   *
   * Exactly one `@`/`$` marker is the lookup marker and is never kept.
   */
  private _decodeAccessorKey(
    rawTextOrNode: JessNode | string,
    loc: LocationInfo
  ): JessNode | string | number {
    // Recover the authored key text: a bare string, a SquareParen node's inner
    // content (string or parsed `@foo` Reference), or an already-extracted string.
    let rawText: string | undefined;
    let innerVal: unknown;
    if (typeof rawTextOrNode === 'string') {
      rawText = rawTextOrNode.trim();
    } else {
      innerVal = (rawTextOrNode as any).node ?? (rawTextOrNode as any).value;
      // Empty `[]` — no inner content, or an empty Keyword placeholder → index key -1.
      if (!innerVal
        || this._isEmptyKeywordLike(innerVal)) {
        return -1;
      }
      if (typeof innerVal === 'string') {
        rawText = innerVal.trim();
      } else if (typeof innerVal === 'object'
        && (innerVal as any).type === 'Reference' && typeof (innerVal as any).key === 'string') {
        rawText = '@' + (innerVal as any).key;
      } else if (this._isKeywordLike(innerVal)
        && typeof (innerVal as any).value === 'string') {
        // A bare/ident/`$prop` accessor key parsed as a Keyword leaf (e.g.
        // `#ns[foo]`, `#ns.vars[$sub]`) — recover its text so the `$`/`@`/bare
        // key logic below applies uniformly with the string path.
        rawText = (innerVal as any).value.trim();
      }
    }
    if (rawText === undefined || rawText === '') {
      // Empty `[]` (bare string) → index key -1. A non-string/non-@var node (e.g. an
      // interpolated key) falls back to its `.key` or the node itself.
      if (rawText === '') {
        return -1;
      }
      return (innerVal as any)?.key ?? (innerVal as JessNode);
    }
    // `@@name` → dynamic variable lookup; key is a variable Reference.
    if (rawText.startsWith('@@')) {
      return new Reference(rawText.slice(2), { type: 'variable' as const }, loc) as unknown as JessNode;
    }
    // `$@name` / `@$name` → property lookup with a dynamic (variable) name:
    // Quoted(Interpolated(@name)). The `$`/`@` markers are never kept.
    if (rawText.startsWith('$@') || rawText.startsWith('@$')) {
      const varRef = new Reference(rawText.slice(2), { role: 'ident' as const }, loc) as unknown as Node;
      const interp = new Interpolated(
        { source: INTERPOLATION_PLACEHOLDER, replacements: [varRef] as any },
        { role: 'ident' as const }, loc
      ) as unknown as string;
      return new Quoted(interp, undefined, loc) as unknown as JessNode;
    }
    // `@name` → variable lookup; key is the bare name (a string).
    if (rawText.startsWith('@')) {
      return rawText.slice(1);
    }
    // `$name` (property reference) or bare `name` (index) → Quoted(name); the `$`
    // property marker is dropped.
    return new Quoted(rawText.startsWith('$') ? rawText.slice(1) : rawText, undefined, loc) as unknown as JessNode;
  }

  protected override _assembleSegment(seg: Spanned[], loc: LocationInfo): Component {
    const result = super._assembleSegment(seg, loc);
    const isNsNameEarly = (c: unknown): c is string =>
      typeof c === 'string' && startsWithHashDotLead(c.trim(), ch => ch === '_' || isAsciiLetter(ch));
    if (!Array.isArray(result)) {
      // A lone `#ns.mixin` / `.mixin` string in declaration-value position is a
      // mixin-ruleset name Reference — not a raw string. Faithful to the reference
      // `mixinReference`→`mixinName` (asReference:true). (The var-decl namespace path
      // does this too via _tryParseNamespaceRef.)
      if (isNsNameEarly(result)) {
        const segTrimmed = (result as string).trim();
        const segArr = splitHashDotSegments(segTrimmed);
        const segs = segArr.length > 0 ? segArr : [segTrimmed];
        const nameKey: string | string[] = segs.length === 1 ? segs[0]! : segs;
        const rawKey = segs.length > 1 ? segs.join('') : undefined;
        return new Reference(
          { key: nameKey, ...(rawKey ? { rawKey } : {}) } as unknown as ReferenceValue,
          { type: 'mixin-ruleset', role: 'name' } as any, loc
        ) as unknown as Component;
      }
      return result as Component;
    }
    if (result.length < 2) {
      return result as Component;
    }
    const comps = result as Component[];
    const isNsName = (c: unknown): c is string =>
      typeof c === 'string' && startsWithHashDotLead(c.trim(), isNsNameLead);
    const isSquareParen = (c: unknown): c is JessNode =>
      !!c && typeof c === 'object' && (c as any).type === 'Paren'
      && (c as any)._options?.delimiter === 'square';
    const isRoundParen = (c: unknown): c is JessNode =>
      !!c && typeof c === 'object' && (c as any).type === 'Paren'
      && (c as any)._options?.delimiter !== 'square';
    if (!isNsName(comps[0])) {
      return comps as unknown as Component;
    }
    // Consume all leading #/.-prefixed strings as namespace path segments.
    // A single token like '#ns.breakpoint' also gets split into sub-segments.
    const splitNsToken = (s: string): string[] => {
      const arr = splitHashDotSegments(s);
      return arr.length > 0 ? arr : [s];
    };
    let i = 0;
    const pathSegs: string[] = [];
    while (i < comps.length && isNsName(comps[i])) {
      pathSegs.push(...splitNsToken((comps[i] as string).trim()));
      i++;
    }
    const rawPathText = pathSegs.join('');
    const nameKey: string | string[] = pathSegs.length === 1 ? pathSegs[0]! : pathSegs;
    const rawKey = pathSegs.length > 1 ? rawPathText : undefined;
    let base: JessNode = new Reference(
      { key: nameKey, ...(rawKey ? { rawKey } : {}) } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any, loc
    ) as unknown as JessNode;
    // A bare `#ns.mixin` / `.mixin` / `#ns > .a` run in declaration-value position,
    // with NO following `[`/`(`, is still a mixin-ruleset name Reference — not a raw
    // string/array. Faithful to the reference `mixinReference`→`mixinName`
    // (asReference:true) `flushPendingAsRef` shape. (The var-decl path does this too.)
    if (i >= comps.length || (!isSquareParen(comps[i]) && !isRoundParen(comps[i]))) {
      // Only rewrite when the namespace run is the WHOLE value; a trailing non-paren
      // component means this wasn't a lone namespace target (leave it as-is).
      return (i === comps.length ? base : comps as unknown) as Component;
    }
    while (i < comps.length) {
      const item = comps[i];
      if (isSquareParen(item)) {
        const innerKey = this._decodeAccessorKey(item as JessNode, loc);
        // A bare-string key (`@var`) or an `@@name` indirection Reference is a
        // variable lookup; a Quoted/number key is a property (`index`) lookup —
        // mirror _applyReferenceAccessor's key→type logic (the var-decl accessor
        // path does the same).
        const keyIsVar = typeof innerKey === 'string'
          || (innerKey != null && typeof innerKey === 'object'
            && (innerKey as any).type === 'Reference');
        const accType: 'variable' | 'index' = keyIsVar ? 'variable' : 'index';
        base = new Reference(
          { target: base as any, key: innerKey as any } as unknown as ReferenceValue,
          { type: accType }, loc
        ) as unknown as JessNode;
        i++;
      } else if (isRoundParen(item)) {
        const innerContent = (item as any).value ?? (item as any).node;
        const isEmpty = this._isEmptyKeywordLike(innerContent);
        const argsNode = isEmpty ? null : this._parenToArgs(item, loc);
        const callPayload: Record<string, unknown> = { name: base };
        if (argsNode) {
          callPayload.args = argsNode;
        }
        base = new Call(callPayload as any, undefined, loc) as unknown as JessNode;
        i++;
      } else {
        break;
      }
    }
    return (i === comps.length ? base : comps as unknown) as Component;
  }

  private _buildEscapedValue(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const inner = nodeChildren(children)[0];
    if (!inner) {
      return this._lessKeyword('', loc) as unknown as JessNode;
    }
    // Quoted keeps `escaped` as its own readonly instance field (render reads the
    // field, not `_options`), so mutating `_options` alone would leave the field
    // `false` and the string would print quoted. Rebuild the Quoted through its
    // constructor so both the field and `_options` carry `escaped: true`. Paren
    // (`~(…)`) reads `_options.escaped` directly, so the option merge suffices.
    if (inner instanceof Quoted) {
      return new Quoted(
        inner.value,
        { quote: inner.quote, escaped: true },
        loc
      ) as unknown as JessNode;
    }
    const n = inner as unknown as { _options?: Record<string, unknown> };
    n._options = { ...(n._options ?? {}), escaped: true };
    return inner;
  }

  // `@{colorVar}` / `pre-@{x}` in value position. Port of `processValueToken`'s
  // InterpolatedIdent branch: getInterpolatedOrString → Interpolated (role=ident),
  // or a plain Keyword when the run resolves to a bare string.
  private _buildInterpValue(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const items = spannedComponents(raw);
    const image = items.map(i => (typeof i.comp === 'string' ? i.comp : '')).join('');
    const result = getInterpolatedOrString(image, loc);
    if (typeof result === 'string') {
      return this._lessKeyword(result, loc) as unknown as JessNode;
    }
    return result as unknown as JessNode;
  }

  /**
   * A quoted string value. Unlike plain CSS, Less interpolates `@{var}` / `${prop}`
   * inside quoted (and escaped `~"…"`) strings and inside `@import` paths. When the
   * raw content holds an interpolation, split it into an `Interpolated` value the same
   * way the reference parser's `processStringInterpolation` does (source with
   * INTERPOLATION_PLACEHOLDER, `@var`/`$prop` references in `replacements`); otherwise
   * fall through to the plain CSS builder (bare-string value).
   */
  /**
   * The Less `Url` grammar tokenizes the inner string as bare leaves (no child
   * node), so the css base builder wraps a quoted url body in a raw-string
   * `Quoted` — which never interpolates `@{var}`/`${prop}`. Less 4.x DOES resolve
   * interpolation inside a QUOTED url body (`url("@{base}/@{i}.svg")`), the same as
   * any other quoted string, so route the quoted inner through the same
   * interpolation-aware construction `_buildQuoted` uses. Unquoted url bodies stay
   * verbatim (Less 4.x leaves `url(@{x})` literal), as does a quoted body with no
   * interpolation.
   */
  protected override _buildUrl(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const innerNode = nodeChildren(children)[0];
    if (innerNode) {
      return super._buildUrl(children, loc);
    }
    const inner = children
      .filter((c): c is CSTLeaf => c._tag === 'leaf')
      .filter(l => !/^url\($/i.test(l.value) && l.value !== ')')
      .map(l => l.value).join('').trim();
    const quote = inner[0];
    if ((quote === '"' || quote === '\'') && inner.at(-1) === quote) {
      const body = inner.slice(1, -1);
      if (body.includes('@{') || body.includes('${')) {
        const value = this._buildStringInterpolation(body, loc);
        return new Url(
          new Quoted(value as any, { quote }, loc) as any,
          undefined, loc
        ) as unknown as JessNode;
      }
    }
    return super._buildUrl(children, loc);
  }

  protected override _buildQuoted(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const text = children
      .filter((c): c is CSTLeaf => c._tag === 'leaf')
      .map(l => l.value)
      .join('');
    const inner = text.slice(1, -1);
    if (inner.includes('@{') || inner.includes('${')) {
      const value = this._buildStringInterpolation(inner, loc);
      return new Quoted(value as any, { quote: text[0] as '"' | '\'' }, loc) as unknown as JessNode;
    }
    return super._buildQuoted(children, loc);
  }

  /**
   * Build an escaped `~'…'` Quoted (at-rule prelude position), interpolating any
   * `@{var}` / `${prop}` in its body the same way `_buildQuoted` does — so
   * `~'@{a} / @{b}'` renders its substituted values instead of literal text.
   */
  private _buildEscapedQuoted(inner: string, quote: '"' | '\'', loc: LocationInfo): JessNode {
    const value = (inner.includes('@{') || inner.includes('${'))
      ? this._buildStringInterpolation(inner, loc)
      : inner;
    return new Quoted(value as any, { quote, escaped: true }, loc) as unknown as JessNode;
  }

  /**
   * Split a quoted-string body on `@{…}` / `${…}` interpolations into an
   * `Interpolated` (source + reference replacements). Port of the reference parser's
   * `processStringInterpolation`/`findInterpolations` (productions/values.ts): brace
   * matching is nesting-aware, and a nested-interpolated name resolves through a
   * variable Reference wrapped in an Expression.
   */
  private _buildStringInterpolation(value: string, loc: LocationInfo): Interpolated {
    const matches = this._findInterpolations(value);
    const replacements: Node[] = [];
    let source = value;
    let offset = 0;
    for (const match of matches) {
      const adjustedStart = match.start - offset;
      const adjustedEnd = match.end - offset;
      source = source.slice(0, adjustedStart) + INTERPOLATION_PLACEHOLDER + source.slice(adjustedEnd);
      offset += (match.end - match.start) - INTERPOLATION_PLACEHOLDER.length;
      if (match.content.includes('@{') || match.content.includes('${')) {
        // Nested interpolation resolves through a variable Reference, kept
        // expression-wrapped so it re-renders as a single interpolated slot.
        const nestedRef = new Reference(
          { key: this._buildStringInterpolation(match.content, loc) as any } as unknown as ReferenceValue,
          { type: 'variable', role: 'ident' } as any, loc
        );
        replacements.push(new Expression(nestedRef as any, undefined, loc) as unknown as Node);
      } else {
        replacements.push(createInterpolatedReference(match.prefix, match.content, loc) as unknown as Node);
      }
    }
    return new Interpolated({ source, replacements: replacements as any }, { role: 'ident' }, loc);
  }

  /**
   * Locate `@{…}` / `${…}` interpolation runs in a string, counting nested braces so
   * `@{@{x}}` and `@{fn(a, b)}` are matched whole. Returns start/end/prefix/content.
   */
  private _findInterpolations(value: string): Array<{ start: number; end: number; prefix: string; content: string }> {
    const matches: Array<{ start: number; end: number; prefix: string; content: string }> = [];
    let i = 0;
    while (i < value.length) {
      if ((value[i] === '@' || value[i] === '$') && value[i + 1] === '{') {
        const prefix = value[i]!;
        const start = i;
        i += 2;
        let braceCount = 1;
        const contentStart = i;
        while (i < value.length && braceCount > 0) {
          if (value[i] === '{') {
            braceCount++;
          } else if (value[i] === '}') {
            braceCount--;
          }
          i++;
        }
        if (braceCount === 0) {
          matches.push({ start, end: i, prefix, content: value.slice(contentStart, i - 1) });
        }
      } else {
        i++;
      }
    }
    return matches;
  }

  protected override _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const call = super._buildCall(rawChildren, loc) as unknown as {
      name: unknown; args: unknown; _options?: Record<string, unknown>;
    };
    const key = typeof call.name === 'string' ? call.name : '';
    // Function calls share the mixin args grammar, so they get the same `,`/`;`
    // mix rejection (e.g. `foo(@a: 1; @b: 2, @c: 3)`).
    this._checkMixedArgDelimiters(call.args as unknown as JessNode, 'function', loc);
    // Lower `;`-args to comma + `~(…)` (after the mixed-delimiter check), matching
    // the mixin path so function calls converge on the same unified AST.
    const loweredArgs = this._lowerSemiArgs(call.args as unknown as JessNode, loc);
    const nameRef = new Reference(key, { type: 'function', fallbackValue: true } as any, loc);
    const next = new Call({ name: nameRef as any, args: loweredArgs as any }, { silentFail: true } as any, loc);
    return next as unknown as JessNode;
  }

  private _buildLessCustomDecl(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const propNameText = ls[0]?.value ?? '';
    // `--@{key}: …` (port of the reference's InterpolatedCustomProperty branch):
    // an interpolated name becomes an Interpolated node, same as a regular
    // declaration's `getInterpolatedNode` branch.
    const name = (propNameText.includes('@') || propNameText.includes('$'))
      ? getInterpolatedNode(propNameText, loc)
      : propNameText;
    const valueNodes = nodeChildren(children);
    if (valueNodes.length > 0) {
      const value = valueNodes.length === 1 ? valueNodes[0]! : valueNodes;
      return new CustomDeclaration({ name: name as any, value: value as any }, undefined, loc);
    }
    // Verbatim custom-property value (grammar's cpValue). Owner rule: Less `--*`
    // is interpolation-ONLY — resolve ONLY `@{…}` interpolation, leaving bare
    // `@var` references and function calls LITERAL. `getInterpolatedNode` builds an
    // Interpolated whose `@{…}` runs become evaluated replacements and whose
    // remaining text is verbatim; with no `@{…}` present the value stays a plain
    // literal Keyword.
    // The whitespace after the `:` is consumed as ambient trivia before cpValue
    // starts, so re-introduce the canonical single space the golden renders
    // (`--this: () => …`). Right-trim trailing whitespace before the terminating
    // `;`/`}` so semicolon insertion stays inline.
    const rawText = ls.slice(2).filter(l => l.value !== ';').map(l => l.value).join('').trimEnd();
    const valueText = rawText === '' ? '' : ' ' + rawText;
    const value = valueText.includes('@{')
      ? getInterpolatedNode(valueText, loc)
      : this._lessKeyword(valueText, loc);
    return new CustomDeclaration({ name: name as any, value: value as any }, undefined, loc);
  }

  /**
   * `--foo: { color: @a; }` — a curly-brace custom-property value whose body
   * opportunistically structured as a declaration list (customCurlyBlock in the
   * grammar), so nested `@var`/calls evaluate normally instead of staying opaque
   * text. Wrapped in a Block(type: 'curly') so `{`/`}` re-render around it.
   */
  private _buildLessCustomBlock(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const bodyNodes = nodeChildren(children);
    // Block.value must remain a single Node; Sequence is the interim container until
    // Block can hold a bare declaration array.
    const seq = new Sequence(bodyNodes as any, undefined, loc);
    return new Block(seq as any, { type: 'curly' }, loc) as unknown as JessNode;
  }

  private _warnDeprecatedValue(span: Span) {
    const text = this._source.slice(span.start, span.end);
    if (/\d\s*\.\//.test(text)) {
      this._warn('The ./ operator is deprecated and will be removed.', 'dot-slash-operator');
    }
  }

  private _warnCustomPropVars(span: Span) {
    const text = this._source.slice(span.start, span.end);
    const colon = text.indexOf(':');
    const value = colon >= 0 ? text.slice(colon + 1) : text;
    const at = firstSigilIdent(value, '@');
    if (at !== null && !value.includes('@{')) {
      this._warn(
        `"${at}" in custom property values is treated as literal text. Use @{${at.slice(1)}} for interpolation.`,
        'variable-in-unknown-value'
      );
    }
    const dollar = firstSigilIdent(value, '$');
    if (dollar !== null && !value.includes('${')) {
      this._warn(
        `"${dollar}" in custom property values is treated as literal text. Use \${${dollar.slice(1)}} for interpolation.`,
        'property-in-unknown-value'
      );
    }
  }

  private _warnAtRulePreludeVars(span: Span) {
    const text = this._source.slice(span.start, span.end);
    const varName = this._firstTopLevelBareAtVar(text);
    if (varName !== null) {
      this._warn(
        `A bare "@${varName}" in an at-rule prelude is deprecated. Use @{${varName}} interpolation instead.`,
        'variable-in-at-rule-prelude'
      );
    }
  }

  /**
   * The first bare `@ident` reference in an at-rule prelude that is deprecated
   * under Less 4.x PR #4462 (`variable-in-at-rule-prelude`), or null when there
   * is none. A bare `@var` in a *structural* (top-level) prelude position still
   * resolves but is deprecated in favour of `@{var}` interpolation; the scan
   * therefore ignores, mirroring `hasTopLevelBareVariable` / `warnBareAtRuleVariable`:
   *   - the leading at-rule name itself (`@media`, `@-moz-document`, …);
   *   - `@{ident}` interpolation — the supported migration target;
   *   - a `@var` inside `(...)` — a declaration/feature value (e.g. the `@size`
   *     in `@media (min-width: @size)`), which stays valid;
   *   - `@`/`(` characters inside string literals, which are not structural.
   */
  private _firstTopLevelBareAtVar(text: string): string | null {
    let depth = 0;
    // Skip the leading at-rule name (`@media`, `@-moz-document`, …). Non-regex form of
    // `/^\s*@-?[\w-]+/` (the `-?` is redundant: a dash is already in `[\w-]`).
    let i = 0;
    let ws = 0;
    while (ws < text.length && text[ws]!.trim() === '') {
      ws++;
    }
    if (text[ws] === '@') {
      let end = ws + 1;
      while (end < text.length && isWordOrDash(text[end]!)) {
        end++;
      }
      if (end > ws + 1) {
        i = end;
      }
    }
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (c === '"' || c === '\'') {
        // A string literal: skip its contents so inner `(`/`@` are not counted.
        i++;
        while (i < text.length && text[i] !== c) {
          i++;
        }
        continue;
      }
      if (c === '@') {
        if (text[i + 1] === '{') {
          // `@{ident}` interpolation — skip the whole group (its `}` is not the
          // block opener, and a later bare `@var` must still be reported).
          i += 2;
          while (i < text.length && text[i] !== '}') {
            i++;
          }
          continue;
        }
        if (depth === 0) {
          // `@(-?[a-zA-Z\x80-\uffff][\w-]*)` - capture the bare-var name (sans `@`).
          let p = i + 1;
          if (text[p] === '-') {
            p++;
          }
          const lead = text[p];
          const leadCode = lead === undefined ? -1 : lead.charCodeAt(0);
          if (lead !== undefined && (isAsciiLetter(lead) || (leadCode >= 0x80 && leadCode <= 0xffff))) {
            let q = p + 1;
            while (q < text.length && isWordOrDash(text[q]!)) {
              q++;
            }
            return text.slice(i + 1, q);
          }
        }
        continue;
      }
      if (c === '{') {
        // The block's opening brace ends the prelude.
        break;
      }
      if (c === '(') {
        depth++;
      } else if (c === ')' && depth > 0) {
        depth--;
      }
    }
    return null;
  }

  private _buildMixinCall(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    // `!important` (the `!`/`important` leaves) must end the name path and set
    // markImportant — never leak into the Reference key.
    const markImportant = ls.some(l => l.value === '!');
    const nameParts: string[] = [];
    for (const l of ls) {
      if (l.value === '(' || l.value === ';' || l.value === '!') {
        break;
      }
      nameParts.push(l.value);
    }
    const name = nameParts.join('');
    const nodes = nodeChildren(children);
    const argsList = nodes.find(n => n.type === 'List');
    const hasArgs = argsList && (argsList as unknown as { value?: unknown[] }).value?.length;
    if (argsList === undefined) {
      this._warn('Calling a mixin without parentheses is deprecated', 'mixin-call-no-parens');
    } else {
      const src = this._source.slice(loc.start, loc.end);
      if (hasWhitespaceBeforeParen(src)) {
        this._warn('Whitespace between a mixin name and parentheses is deprecated', 'mixin-call-whitespace');
      }
    }
    const ref = new Reference(
      { key: name } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any,
      loc
    );
    const callArgs = hasArgs ? this._convertArgsForCall(argsList as unknown as JessNode, loc) : undefined;
    return new Call(
      { name: ref as any, args: callArgs as any },
      { markImportant } as any, loc
    ) as unknown as JessNode;
  }

  /**
   * `@name(...)` (no `:`) → a detached-ruleset variable CALL. Faithful port of
   * `varDeclarationOrCall`'s LParen branch (selectors.ts): build a `Reference`
   * over the var name (`type: 'variable', role: 'name'`), wrap in a `Call` with
   * the (optional) args, and wrap THAT in an `Expression` (a top-level variable
   * call is an expression, not a parenthesized one). `!important` sets
   * `markImportant` on the Call, mirroring the production.
   */
  private _buildVarCall(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const markImportant = ls.some(l => l.value === '!');
    // First leaf is the `@name` token (the MixinArgs parens live in the sub-node).
    const nameLeaf = ls.find(l => l.value.startsWith('@'));
    const rawName = nameLeaf?.value ?? '';
    const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
    const nameNode = this._lessKeyword(name, loc);
    const nameRef = new Reference(
      { key: nameNode } as unknown as ReferenceValue,
      { type: 'variable', role: 'name' } as any,
      loc
    );
    const nodes = nodeChildren(children);
    const argsList = nodes.find(n => n.type === 'List');
    const hasArgs = argsList && (argsList as unknown as { value?: unknown[] }).value?.length;
    // `@media()` etc — a known at-rule name used as a variable call, allowed only
    // with empty parens (port of isVariableLike's 'at-rule-variable' warning).
    if (!hasArgs && isKnownAtRuleVarName(name)) {
      this._warn('Using known at-rule names as variables is deprecated', 'at-rule-variable');
    }
    const callArgs = hasArgs ? this._convertArgsForCall(argsList as unknown as JessNode, loc) : undefined;
    const call = new Call(
      { name: nameRef as any, args: callArgs as any },
      (markImportant ? { markImportant: true } : undefined) as any,
      loc
    );
    return new Expression(call as unknown as Node, undefined, loc) as unknown as JessNode;
  }

  /** `...` or `@name...` variadic arg → `Rest`. Definition-shape (string name); a
   * CALL turns it into `Rest(Reference)` via `_convertArgsForCall`. */
  private _buildRest(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const items = spannedComponents(raw);
    const nameItem = items.find(i => typeof i.comp === 'string' && i.comp.startsWith('@'));
    const name = nameItem ? String(nameItem.comp).slice(1) : '';
    return new Rest(name, undefined, loc) as unknown as JessNode;
  }

  /** `@name: value` named arg/param → `VarDeclaration`. The value is assembled by the
   * shared value builder (`_assembleValue`) — the same machinery as a declaration
   * value, so trivia and Keyword-ification are handled and no manual trimming is
   * needed. Named args flow through function calls too; the runtime decides whether
   * the target accepts them. */
  private _buildNamedArg(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const items = spannedComponents(raw);
    const colonIdx = items.findIndex(i => i.comp === ':');
    const nameItem = items.find(i => typeof i.comp === 'string' && i.comp.startsWith('@'));
    const name = String(nameItem?.comp ?? '').slice(1);
    const valueItems = colonIdx >= 0 ? items.slice(colonIdx + 1) : [];
    const { value } = this._assembleValue(valueItems, loc);
    // A param/arg VarDeclaration value is always a single Node in the callable-
    // binding path (it calls `value.hasFlag(...)`). `_assembleValue` leaves a lone
    // bare keyword (`@a: inherit`) as a raw string, and a space-separated segment
    // (`@padding: 40px 10px`) as a bare Component array — wrap each into a Node.
    let paramValue: Component;
    if (typeof value === 'string') {
      paramValue = this._valueKeyword(value, loc) as unknown as Component;
    } else if (Array.isArray(value)) {
      const seq = value.map(c => this._argComponent(c, loc));
      paramValue = new Sequence(seq as unknown as Node[], undefined, loc) as unknown as Component;
    } else {
      paramValue = value;
    }
    return new VarDeclaration(
      { name: name as any, value: paramValue as any } as any,
      undefined,
      loc
    ) as unknown as JessNode;
  }

  /** Mixin-call args are assembled by the SAME builder as function-call args
   * (`_assembleArgs` via `_betweenParens`) — identical comma/semicolon and value
   * handling. Named args are `VarDeclaration`s and variadic args `Rest`, which pass
   * through as single components. A bare `@name` is a `Reference` (the call shape);
   * the mixin-DEFINITION builder reinterprets a lone `@name` as a param. */
  private _buildMixinArgs(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const inner = this._betweenParens(spannedComponents(raw));
    const args = this._assembleArgs(inner, loc);
    this._checkMixedArgDelimiters(args as unknown as JessNode, 'mixin', loc);
    // Lower `;`-args to comma + `~(…)` (after the mixed-delimiter check, which
    // needs the `;`-List) so Less `;` and Jess `~(…)` produce the same AST.
    return this._lowerSemiArgs(args as unknown as JessNode, loc) as unknown as typeof args;
  }

  /** Less forbids mixing the COMMA and SEMICOLON argument separators: once a
   * semicolon separates args, a comma is a value-list separator, so a semicolon-group
   * may not hold 2+ named params (`@a: 1, @b: 2`). `_assembleArgs` renders such a group
   * as a List of ≥2 VarDeclarations. (This is purely about the `,` vs `;` argument
   * separators — a `/` inside a value is unrelated and never checked.) Applies to BOTH
   * mixin and function calls (args are unified). */
  private _checkMixedArgDelimiters(args: JessNode | undefined, kind: 'mixin' | 'function', loc: LocationInfo): void {
    const list = args as unknown as { type?: string; options?: { sep?: string }; value?: JessNode[] };
    if (list?.type !== 'List' || list.options?.sep !== ';' || !Array.isArray(list.value)) {
      return;
    }
    for (const el of list.value) {
      const group = el as unknown as { type?: string; value?: JessNode[] };
      if (group?.type === 'List' && Array.isArray(group.value)
        && group.value.filter(n => (n as { type?: string })?.type === 'VarDeclaration').length >= 2) {
        this._error(`Cannot mix ; and , as delimiter types in ${kind} arguments`, loc.start);
        break;
      }
    }
  }

  /**
   * Lower Less `;`-separated call args to the unified Jess representation: the outer
   * args `List{ sep: ';' }` becomes comma-separated, and each element that is itself
   * a comma-`List` (a `;`-group that held a comma-list) is wrapped in an escaped
   * `Paren` — the same shape Jess authors write as `~(1, 2)`. So
   * `.mixin(1, 2; 3, 4)` and Jess `mixin(~(1, 2), ~(3, 4))` converge on one AST.
   *
   * The escaped `Paren` evaluates to its inner value STRIPPED (paren.ts §escaped),
   * so `~(1, 2)` binds/renders identically to the bare list `1, 2` — representation
   * only, semantics unchanged. Scalar (non-List) elements pass through untouched.
   *
   * MUST run AFTER `_checkMixedArgDelimiters` (which inspects the `;`-List).
   */
  private _lowerSemiArgs(args: JessNode | undefined, loc: LocationInfo): JessNode | undefined {
    const list = args as unknown as { type?: string; options?: { sep?: string }; value?: JessNode[] } | undefined;
    if (list?.type !== 'List' || list.options?.sep !== ';' || !Array.isArray(list.value)) {
      return args;
    }
    const lowered = list.value.map((el) => {
      // A comma-list arg (an inner `List`) becomes `~(…)`; scalars stay as-is.
      if ((el as { type?: string })?.type === 'List') {
        return new Paren(el as unknown as Node, { escaped: true }, loc) as unknown as JessNode;
      }
      return el;
    });
    return new List(lowered as unknown as Node[], undefined, loc) as unknown as JessNode;
  }

  /**
   * Mixin-DEFINITION param conversion. With combinator-composed args a bare `@name`
   * value parses as a `Reference{variable}` (the CALL shape); in a DEFINITION it is a
   * param, so convert it to `VarDeclaration(name, Nil)`. Named params (`@a: 1`),
   * variadic (`Rest`) and pattern-match values stay as-is. Returns a NEW List (the
   * def/call split must not mutate a shared node).
   */
  private _convertArgsForDefinition(argsList: JessNode | undefined, loc: LocationInfo): JessNode | undefined {
    if (argsList?.type !== 'List') {
      return argsList;
    }
    const list = argsList as unknown as List<Node>;
    const value = (list as unknown as { value?: JessNode[] }).value;
    if (!value || value.length === 0) {
      return argsList;
    }
    let changed = false;
    const converted = value.map((node): JessNode => {
      if (node.type === 'Reference'
        && (node as unknown as { options?: { type?: string } }).options?.type === 'variable') {
        const key = (node as unknown as { key?: unknown }).key;
        const name = typeof key === 'string'
          ? key
          : String((key as { valueOf?(): unknown } | undefined)?.valueOf?.() ?? '');
        changed = true;
        return new VarDeclaration(
          { name: name as any, value: new Nil('', undefined, loc) as unknown as JessNode as any } as any,
          undefined,
          loc
        ) as unknown as JessNode;
      }
      return node;
    });
    if (!changed) {
      return argsList;
    }
    return new List(converted as any, list.options as any, loc) as unknown as JessNode;
  }

  /**
   * Mixin-CALL argument conversion (reference `convertArgsForCall`, root.ts).
   * `_buildMixinArgs` builds bare `@name` args as definition-style VarDeclarations
   * (Nil value) — correct for a DEFINITION param, but in a CALL a bare `@name` is a
   * variable being PASSED, i.e. a `Reference{type:variable}`. Named args (`@a: 1`)
   * and value args stay as-is; a `Rest('name')` becomes `Rest(Reference{variable})`.
   * Returns a NEW List (the def/call split must not mutate a shared node).
   */
  private _convertArgsForCall(argsList: JessNode | undefined, loc: LocationInfo): JessNode | undefined {
    if (argsList?.type !== 'List') {
      return argsList;
    }
    const list = argsList as unknown as List<Node>;
    const value = (list as unknown as { value?: JessNode[] }).value;
    if (!value || value.length === 0) {
      return argsList;
    }
    let changed = false;
    const converted = value.map((node): JessNode => {
      if (node.type === 'VarDeclaration') {
        const decl = node as unknown as { name: JessNode; value?: JessNode };
        const val = decl.value;
        if (!val || val.type === 'Nil') {
          // Bare `@name` → a variable reference being passed to the call.
          const key = (decl.name as unknown as { valueOf(): string }).valueOf();
          changed = true;
          return new Reference(
            { key } as unknown as ReferenceValue,
            { type: 'variable' } as any,
            loc
          ) as unknown as JessNode;
        }
        return node;
      }
      if (node.type === 'Rest') {
        const restVal = (node as unknown as { value: unknown }).value;
        if (typeof restVal === 'string') {
          changed = true;
          return new Rest(
            new Reference({ key: restVal } as unknown as ReferenceValue, { type: 'variable' } as any, loc) as any,
            {} as any,
            loc
          ) as unknown as JessNode;
        }
        return node;
      }
      return node;
    });
    if (!changed) {
      return argsList;
    }
    return new List(
      converted as any,
      list.options as any,
      loc
    ) as unknown as JessNode;
  }

  private _buildAnonMixin(children: ReadonlyArray<Child>, loc: LocationInfo) {
    // `.(@p) { … }` → a nameless Mixin (reference `anonymousMixinDefinition`,
    // selectors.ts: `new Mixin({ params, rules })`), NOT a `.`-selector Ruleset.
    // The MixinArgs sub-node is the param List; everything else is the body.
    const nodes = nodeChildren(children);
    const argsList = nodes.find(n => n.type === 'List');
    const rules = nodes.filter(n => n !== argsList);
    // Definition params: a bare `@name` value is a param, so reinterpret it.
    const defParams = this._convertArgsForDefinition(argsList as unknown as JessNode, loc);
    const params = (defParams as unknown as { value?: unknown[] })?.value?.length
      ? defParams as unknown as List<Node>
      : undefined;
    return new Mixin(
      { params, rules } as any,
      undefined,
      loc
    ) as unknown as JessNode;
  }

  /**
   * `each(<iterable>, { … })` → a `For` control node (the $for shape), not a Call.
   * The value(s) before the comma are the iterable; the callback block's body becomes
   * the loop rules. A literal block callback carries no captured params here, so the
   * pattern defaults to the Less `[value, key, index]` triple.
   */
  /** A bare detached ruleset `{ … }` in value / argument position → a Mixin holding
   * its rules (same shape `@var: { … }` produces in `_buildVarDeclaration`). */
  private _buildDetachedRuleset(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ruleNodes = nodeChildren(children);
    return new Mixin({ rules: ruleNodes } as any, undefined, loc);
  }

  private _buildEachFor(children: ReadonlyArray<Child>, loc: LocationInfo) {
    // Args come from the shared functionCallArgs: the callback (detached ruleset /
    // `.(…){…}`) is a Mixin sub-node; everything else is the iterable.
    const nodes = nodeChildren(children);
    const callback = nodes.find(n => n.type === 'Mixin') as unknown as { rules?: JessNode[]; params?: JessNode } | undefined;
    const iterableNodes = nodes.filter(n => (n as unknown) !== (callback as unknown));
    const paramsList = ((callback?.params as unknown as { type?: string } | undefined)?.type === 'List')
      ? callback!.params as JessNode
      : undefined;
    const ruleNodes = callback?.rules ?? [];
    const iterable: JessNode = iterableNodes.length === 1
      ? iterableNodes[0]!
      : (new List(iterableNodes as any, undefined, loc) as unknown as JessNode);
    return new For(
      { pattern: this._eachPattern(paramsList, loc), iterable: { kind: 'node', value: iterable as unknown as Node }, rules: ruleNodes as unknown as Node[] },
      undefined,
      loc
    );
  }

  private _eachPattern(paramsList: JessNode | undefined, loc: LocationInfo): ForPattern {
    // Explicit `.(@v; @i)` callback params parse straight into VarDeclaration nodes
    // (name 'v'/'i'); reuse them as the loop's binding pattern.
    const params = ((paramsList as unknown as { value?: JessNode[] } | undefined)?.value ?? [])
      .filter((p): p is JessNode => p?.type === 'VarDeclaration');
    if (params.length === 1) {
      return { kind: 'single', value: params[0] as any };
    }
    if (params.length >= 2) {
      return { kind: 'tuple', values: [params[0], ...params.slice(1)] as any };
    }
    // A param-less block callback iterates with the Less default triple.
    const paramVar = (name: string) => new VarDeclaration(
      { name, value: this._lessKeyword('', loc) } as any,
      { paramVar: true } as any,
      loc
    );
    return { kind: 'tuple', values: [paramVar('value'), paramVar('key'), paramVar('index')] };
  }

  private _buildMixinOrQualified(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const hasBlock = ls.some(l => l.value === '{');
    // `!important` on a mixin call: the `!`/`important` leaves are direct children
    // (MixinArgs's own parens live in the sub-node, not in `ls`). The `!` ends the
    // name path and flips markImportant — it must NOT leak into the Reference key.
    const markImportant = ls.some(l => l.value === '!');
    const nameParts: string[] = [];
    for (const l of ls) {
      if (l.value === '(' || l.value === '{' || l.value === '}' || l.value === ';' || l.value === ')' || l.value === '!') {
        break;
      }
      nameParts.push(l.value);
    }
    const name = nameParts.join('');
    const argsList = nodes.find(n => n.type === 'List');
    const guard = nodes.find(n => n.type === 'Paren' || n.type === 'Condition' || n.type === 'DefaultGuard');
    // argsList presence (from MixinArgs sub-node) signals explicit parens
    const hasExplicitParens = argsList !== undefined;
    if (hasBlock) {
      const rawRuleNodes = nodes.filter(n => n !== argsList && n !== guard);
      // Lift standalone comments in the body (the Mixin/qualified-rule body is built
      // inline here, bypassing _buildRuleset's own comment lift).
      const braceIdx = this._source.indexOf('{', loc.start);
      const bodyStart = braceIdx >= 0 ? braceIdx + 1 : loc.start;
      const closeIdx = this._source.lastIndexOf('}', loc.end - 1);
      const bodyEnd = closeIdx >= bodyStart ? closeIdx : loc.end;
      const ruleNodes = this._liftStandaloneComments(rawRuleNodes as any, bodyStart, bodyEnd, loc);
      if (hasExplicitParens) {
        // Has explicit parens -- it's a Mixin definition
        const guardText = guard !== undefined ? (guard as any).toTrimmedString?.() ?? '' : '';
        const hasDefault = guardText.includes('default');
        // Definition params: reinterpret a bare `@name` value as a param.
        const defParams = this._convertArgsForDefinition(argsList as unknown as JessNode, loc);
        const nonEmptyParams = (defParams as unknown as { value?: unknown[] })?.value?.length
          ? defParams as unknown as List<Node>
          : undefined;
        return new Mixin(
          { name, params: nonEmptyParams, rules: ruleNodes, guard: guard as any },
          { hasDefault: !!hasDefault },
          loc
        ) as unknown as JessNode;
      }
      // No parens -- qualified rule (Ruleset)
      // Extract any Extend nodes from the selector and prepend them to rules
      const { cleanedSelector, extractedExtends } = this._extractExtendsFromSelectorText(name || '&', loc);
      const finalRules = extractedExtends.length > 0
        ? [...extractedExtends, ...ruleNodes]
        : ruleNodes;
      return new Ruleset(
        { selector: cleanedSelector || '&', rules: finalRules, guard: guard as any },
        undefined, loc
      ) as unknown as JessNode;
    }
    // Build the rawKey ComplexSelector from the name parts (for complex paths)
    const combinatorValues = new Set(['>', '+', '~']);
    const selectorTokens = nameParts.filter(p => !combinatorValues.has(p.trim()) && p.trim() !== '');
    const hasComplexPath = selectorTokens.length > 1;
    const refKey: string | string[] = hasComplexPath ? selectorTokens : name;
    const rawKey = hasComplexPath ? new ComplexSelector(nameParts as unknown as ComplexSelectorValue, undefined, loc) : undefined;
    const isMixinName = name.startsWith('.') || name.startsWith('#');
    const ref = isMixinName
      ? new Reference(
        { key: refKey, ...(rawKey ? { rawKey } : {}) } as unknown as ReferenceValue,
        { type: 'mixin-ruleset', role: 'name' } as any,
        loc
      )
      : new Reference(
        { key: refKey } as unknown as ReferenceValue,
        { type: 'function', silentFail: true, fallbackValue: true } as any,
        loc
      );
    const hasArgs2 = argsList && (argsList as unknown as { value?: unknown[] }).value?.length;
    const hasSemi = ls.some(l => l.value === ';');
    if (hasSemi && !hasExplicitParens) {
      this._warn('Calling a mixin without parentheses is deprecated', 'mixin-call-no-parens');
    } else if (hasSemi && hasExplicitParens) {
      const src = this._source.slice(loc.start, loc.end);
      if (hasWhitespaceBeforeParen(src)) {
        this._warn('Whitespace between a mixin name and parentheses is deprecated', 'mixin-call-whitespace');
      }
    }
    const callArgs = hasArgs2 ? this._convertArgsForCall(argsList, loc) : undefined;
    return new Call(
      { name: ref as any, args: callArgs as any },
      { markImportant } as any, loc
    ) as unknown as JessNode;
  }

  private _extractExtendsFromSelectorText(selectorText: string, _loc: LocationInfo) {
    // Simple passthrough - extend extraction from selector text is handled elsewhere
    return { cleanedSelector: selectorText, extractedExtends: [] as JessNode[] };
  }

  private _selectorHasNestedExtend(sel: JessNode | string | undefined): boolean {
    if (!sel || typeof sel === 'string') {
      return false;
    }
    if (sel.type === 'PseudoSelector') {
      const arg = (sel as unknown as { arg?: JessNode }).arg;
      return arg ? this._treeHasExtend(arg) : false;
    }
    if (sel instanceof CompoundSelector || sel instanceof ComplexSelector) {
      return sel.value.some(p => this._selectorHasNestedExtend(p as JessNode));
    }
    if (isSelectorListLike(sel)) {
      return selectorListItems(sel).some(p => this._selectorHasNestedExtend(p as JessNode));
    }
    return false;
  }

  private _treeHasExtend(node: JessNode): boolean {
    if (node instanceof Extend) {
      return true;
    }
    if (node instanceof CompoundSelector || node instanceof ComplexSelector) {
      return node.value.some(p => this._treeHasExtend(p as JessNode));
    }
    if (isSelectorListLike(node)) {
      return selectorListItems(node).some(p => this._treeHasExtend(p as JessNode));
    }
    return false;
  }

  /**
   * A guarded ruleset (`sel when …`) is parsed by the shared CSS builder, which
   * has no `when` concept, so the Guard CST child folds into the body as the
   * first rule — always a Paren/Condition/DefaultGuard. Lift it into the
   * ruleset's `guard` field (rebuilt through the canonical Ruleset ctor so the
   * guard is adopted) so it gates output instead of rendering as a `{ true }`
   * body. Non-guarded rulesets never begin their body with one of these node
   * types, so the leading-node check is unambiguous.
   */
  private _liftRulesetGuard(base: Ruleset, loc: LocationInfo): Ruleset {
    const rules = (base as unknown as { rules?: unknown }).rules;
    if (!Array.isArray(rules) || rules.length === 0) {
      return base;
    }
    const first = rules[0] as { type?: string } | undefined;
    if (first?.type !== 'Paren' && first?.type !== 'Condition' && first?.type !== 'DefaultGuard') {
      return base;
    }
    return new Ruleset(
      {
        selector: (base as unknown as { selector: any }).selector,
        rules: rules.slice(1) as any,
        guard: first as any
      },
      undefined, loc
    ) as unknown as Ruleset;
  }

  protected override _buildRuleset(
    children: ReadonlyArray<Child>,
    rawChildren: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    let base = super._buildRuleset(children, rawChildren, loc);
    const selector = base.selector;
    if (!selector) {
      return base;
    }
    // The shared CSS builder has no notion of `when` guards, so the Guard CST
    // child lands as the first body rule. A guarded ruleset (`sel when …`)
    // always emits its guard as a leading Paren/Condition/DefaultGuard; lift it
    // into the ruleset's `guard` field so it gates output instead of rendering.
    base = this._liftRulesetGuard(base, loc);
    if (typeof selector === 'string') {
      return base;
    }
    if (this._selectorHasNestedExtend(selector as unknown as JessNode)) {
      this._error(':extend() is not allowed inside a pseudo-class selector', loc.start);
    }
    const baseRules = Array.isArray(base.rules) ? base.rules as JessNode[] : [];
    const baseGuard = (base as unknown as { guard?: unknown }).guard;
    const withGuard = (rs: Ruleset): Ruleset => {
      if (baseGuard !== undefined) {
        (rs as unknown as { guard?: unknown }).guard = baseGuard;
      }
      return rs;
    };

    const extendKey = (e: JessNode): string => {
      const ext = e as unknown as { target?: { valueOf?(): unknown }; flag?: unknown };
      return `${String(ext.target?.valueOf?.() ?? ext.target)}:${ext.flag}`;
    };

    // Non-list: simple single-selector extraction.
    if (!isSelectorListLike(selector)) {
      const { cleanedSelector, extractedExtends } = this._extractExtendsFromSelector(
        selector as unknown as JessNode, loc
      );
      if (extractedExtends.length === 0) {
        return base;
      }
      return withGuard(new Ruleset(
        { selector: cleanedSelector as any, rules: [...extractedExtends, ...baseRules] },
        undefined, loc
      )) as unknown as Ruleset;
    }

    // Selector list: extract extends per selector, then decide structure.
    const perSelector: Array<{ clean: JessNode | string | undefined; extends: JessNode[] }> = [];
    let anyExtends = false;
    for (const item of selectorListItems(selector)) {
      const { cleanedSelector: cs, extractedExtends: ee } = this._extractExtendsFromSelector(
        item as unknown as JessNode, loc
      );
      perSelector.push({ clean: cs, extends: ee });
      if (ee.length > 0) {
        anyExtends = true;
      }
    }

    if (!anyExtends) {
      return base;
    }

    // If all selectors share identical extend sets → flat Ruleset, deduplicated extends.
    const allExtendKeys = perSelector.map(s => s.extends.map(extendKey).sort().join('|'));
    const allSame = allExtendKeys.every(k => k === allExtendKeys[0]!);

    if (allSame) {
      const uniqueExtends = perSelector[0]!.extends;
      const cleanedItems = perSelector.map(s => s.clean).filter((c): c is JessNode | string => c !== undefined);
      const combinedSel = cleanedItems.length === 1
        ? cleanedItems[0]!
        : this._makeSelectorList(cleanedItems as any, loc);
      return withGuard(new Ruleset(
        { selector: combinedSel as any, rules: [...uniqueExtends, ...baseRules] },
        undefined, loc
      )) as unknown as Ruleset;
    }

    // Different extends per selector → Rules wrapper with per-selector Extend nodes.
    const wrapperRules: JessNode[] = [];
    const cleanedItems: (JessNode | string)[] = [];
    for (const { clean, extends: exts } of perSelector) {
      for (const ext of exts) {
        const extNode = ext as unknown as { target?: unknown; flag?: unknown };
        wrapperRules.push(new Extend(
          {
            target: extNode.target as any,
            flag: extNode.flag as any,
            selector: clean as unknown as Selector
          },
          undefined, loc
        ) as unknown as JessNode);
      }
      if (clean !== undefined) {
        cleanedItems.push(clean);
      }
    }

    const combinedSel = cleanedItems.length === 1
      ? cleanedItems[0]!
      : this._makeSelectorList(cleanedItems as any, loc);

    wrapperRules.push(withGuard(new Ruleset(
      { selector: combinedSel as any, rules: baseRules },
      undefined, loc
    )) as unknown as JessNode);

    return new Rules(wrapperRules as any, undefined, loc) as unknown as Ruleset;
  }

  private _extractExtendsFromSelector(
    selector: JessNode | string | undefined,
    loc: LocationInfo
  ): { cleanedSelector: JessNode | string | undefined; extractedExtends: JessNode[] } {
    if (!selector || typeof selector === 'string') {
      return { cleanedSelector: selector, extractedExtends: [] };
    }

    // CompoundSelector: extract Extend nodes from .value[]
    if (selector instanceof CompoundSelector) {
      const extractedExtends: JessNode[] = [];
      const newParts: any[] = [];
      for (const part of selector.value) {
        if (part instanceof Extend) {
          extractedExtends.push(part as unknown as JessNode);
        } else if (part instanceof List) {
          // List of Extend nodes from multi-target :extend()
          for (const item of (part as any).value ?? []) {
            if (item instanceof Extend) {
              extractedExtends.push(item as unknown as JessNode);
            } else {
              newParts.push(item);
            }
          }
        } else {
          newParts.push(part);
        }
      }
      if (extractedExtends.length === 0) {
        return { cleanedSelector: selector, extractedExtends: [] };
      }
      const cleanedSelector = newParts.length === 0
        ? '&'
        : newParts.length === 1
          ? newParts[0] as JessNode | string
          : new CompoundSelector(newParts, undefined, loc) as unknown as JessNode;
      return { cleanedSelector, extractedExtends };
    }

    // ComplexSelector: recurse into its CompoundSelector components and pull out
    // any trailing Extend / List<Extend> (the `:extend(...)` pseudo lives at the
    // end of the complex selector — see grammar's ComplexSelector).
    if (selector instanceof ComplexSelector) {
      const allExtends: JessNode[] = [];
      const newParts: any[] = [];
      for (const part of selector.value) {
        if (part instanceof Extend) {
          allExtends.push(part as unknown as JessNode);
        } else if (part instanceof List) {
          for (const item of (part as any).value ?? []) {
            if (item instanceof Extend) {
              allExtends.push(item as unknown as JessNode);
            } else {
              newParts.push(item);
            }
          }
        } else if (part instanceof CompoundSelector) {
          const { cleanedSelector: cs, extractedExtends: ee } = this._extractExtendsFromSelector(part as unknown as JessNode, loc);
          allExtends.push(...ee);
          if (cs !== undefined) {
            newParts.push(cs);
          }
        } else {
          newParts.push(part);
        }
      }
      if (allExtends.length === 0) {
        return { cleanedSelector: selector, extractedExtends: [] };
      }
      const newComplex = newParts.length === 1
        ? newParts[0] as JessNode | string
        : new ComplexSelector(newParts as any, undefined, loc) as unknown as JessNode;
      return { cleanedSelector: newComplex, extractedExtends: allExtends };
    }

    // Selector list node or parser-delivered array.
    if (isSelectorListLike(selector)) {
      const allExtends: JessNode[] = [];
      const cleanedItems: (JessNode | string)[] = [];
      let changed = false;
      for (const item of selectorListItems(selector)) {
        const { cleanedSelector: cs, extractedExtends: ee } = this._extractExtendsFromSelector(
          item as unknown as JessNode, loc
        );
        allExtends.push(...ee);
        if (ee.length > 0) {
          changed = true;
        }
        if (cs !== undefined) {
          cleanedItems.push(cs);
        }
      }
      if (!changed) {
        return { cleanedSelector: selector, extractedExtends: [] };
      }
      const newSel = cleanedItems.length === 1
        ? cleanedItems[0]!
        : this._makeSelectorList(cleanedItems as any, loc);
      return { cleanedSelector: newSel as JessNode, extractedExtends: allExtends };
    }

    return { cleanedSelector: selector, extractedExtends: [] };
  }

  // -- Import helpers --------------------------------------------------------

  private static _isCssUrl(url: string, opts: string[]): boolean {
    if (opts.includes('inline') || opts.includes('less')) {
      return false;
    }
    return url.endsWith('.css') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
  }

  private _buildImportAtRuleFromPrelude(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo,
    name: string
  ): JessNode {
    const preludeText = this._source.slice(loc.start, loc.end);
    const optMatch = /^\s*\(([^)]+)\)/.exec(preludeText.replace(/^@import\s*/, ''));
    const opts: string[] = optMatch ? optMatch[1]!.split(',').map(s => s.trim()) : [];
    const builtNodes = nodeChildren(children);
    // `@import url("x.css")` parses the path as a Url node, `@import "x.css"` as a
    // Quoted. The url() wrapper is part of the serialized path — keep it as the
    // prelude for CSS imports (and strip the whole `url(...)`, not just its inner
    // quotes, when extracting a trailing media query).
    const urlNode = builtNodes.find(n => n.type === 'Url') as unknown as Url | undefined;
    const quotedNode = builtNodes.find(n => n.type === 'Quoted') as unknown as Quoted | undefined;
    let pathNode: Quoted | undefined;
    if (quotedNode) {
      // Reuse the built Quoted so an interpolated path (`@import "@{theme}.less"`)
      // keeps its Interpolated value and resolves before import resolution — flattening
      // it to `.valueOf()` would strip the `@{…}` references.
      pathNode = new Quoted(quotedNode.value, { quote: quotedNode.quote ?? '"' }, loc);
    } else {
      // Fallback: extract path from preludeText (AtRuleStatement uses scanTo leaves)
      const _qm = preludeText.match(/(['"])([^'"]+)\1/);
      if (_qm) {
        const quote: '"' | '\'' = _qm[1] === '\'' ? '\'' : '"';
        const inner = _qm[2]!;
        const innerNode = inner;
        pathNode = new Quoted(innerNode, { quote }, loc);
      }
    }
    let mediaNode: Node | undefined;
    {
      // Remove @name, (options), the path (url(...) or quoted), and 'as namespace'
      // to find a trailing media query.
      let rest = preludeText.replace(/^@-?[_a-zA-Z][-_a-zA-Z0-9]*\s*/, '');
      rest = rest.replace(/^\([^)]*\)\s*/, '');
      rest = urlNode
        ? rest.replace(/url\(\s*(['"])[^'"]*\1\s*\)\s*/i, '')
        : rest.replace(/(['"])[^'"]*\1\s*/, '');
      rest = rest.replace(/\bas\s+[^\s;(]+\s*/g, '');
      rest = rest.replace(/;\s*$/, '').trim();
      if (rest) {
        // Parse the trailing media query as a real media prelude (feature
        // conditions become Paren(Declaration) etc.) so it re-serializes with
        // normalized spacing (`(min-width:600px)` → `(min-width: 600px)`),
        // matching Less. A bare keyword tail (`screen`) round-trips unchanged.
        mediaNode = this._buildAtRulePrelude(rest, loc) as unknown as Node;
      }
    }
    const pathMatch2 = /['"]([^'"]+)['"]/.exec(preludeText);
    const pathStr = pathMatch2 ? pathMatch2[1] : '';
    const isCssImport = pathStr ? LessGrammar._isCssUrl(pathStr, opts) : false;
    // `(inline)` wins over `(css)`: even `@import (inline, css) "x"` must inject
    // the target's raw text verbatim (StyleImport inline path), never emit a
    // passthrough CSS `@import`.
    if (!opts.includes('inline') && (isCssImport || opts.includes('css'))) {
      const preludeItems: JessNode[] = [];
      const pathPrelude = (urlNode ?? pathNode) as unknown as JessNode | undefined;
      if (pathPrelude) {
        preludeItems.push(pathPrelude);
      }
      // A plain (non-Less) import can carry a trailing media-query tail, same as
      // the StyleImport `postlude` option below — don't drop it here.
      if (mediaNode) {
        preludeItems.push(mediaNode as unknown as JessNode);
      }
      let prelude: JessNode | string;
      if (preludeItems.length === 1) {
        prelude = preludeItems[0]!;
      } else {
        const joined = preludeItems.map(item => item.toTrimmedString()).join(' ');
        // A multi-item prelude (path + trailing media/supports/layer tail) whose
        // parts are ALL static (no `@{…}`/`$…` interpolation) is itself a static
        // token: wrap it in an `Any` so it carries `F_STATIC` and the spine can
        // fold the bodyless CSS `@import` statement inline (byte-identical — `Any`
        // re-serializes its value, its `evalNode` is a no-op). A non-static part
        // (interpolated path/media) keeps the raw string, deferring to eval where
        // the interpolation resolves.
        const allStatic = preludeItems.every(item => item.structuralStaticFlag());
        prelude = allStatic ? (new Any(joined, undefined, loc) as unknown as JessNode) : joined;
      }
      return new AtRuleStatement({ name, prelude }, undefined, loc) as unknown as JessNode;
    }
    const isForward = name === '@-export';
    const importType: 'import' | 'compose' = isForward ? 'compose' : 'import';
    const importOpts: Record<string, unknown> = {
      once: !opts.includes('multiple')
    };
    if (opts.includes('reference')) {
      importOpts.reference = true;
    }
    if (opts.includes('multiple')) {
      importOpts.multiple = true;
    }
    if (opts.includes('optional')) {
      importOpts.optional = true;
    }
    if (opts.includes('inline')) {
      importOpts.inline = true;
    }
    if (opts.includes('less')) {
      importOpts.type = 'less';
    }
    if (mediaNode) {
      importOpts.postlude = mediaNode;
    }
    if (isForward) {
      importOpts.forward = true;
    }
    const nsMatch2 = /\bas\s+([^\s;(]+)/.exec(preludeText);
    const namespace = nsMatch2?.[1];
    const styleImportOptions: Record<string, unknown> = { type: importType, importOptions: importOpts };
    if (namespace) {
      styleImportOptions.namespace = namespace;
    }
    // A Less `@import (reference) url(https://…)` with an UNQUOTED url() has no
    // Quoted path; StyleImport accepts a Url path directly, so fall back to the
    // parsed Url node rather than leaving `path` undefined (it later derefs
    // `this.path.eval`).
    const path = pathNode ?? (urlNode as unknown as JessNode | undefined);
    return new StyleImport(
      { path: path as any },
      styleImportOptions as any,
      loc
    ) as unknown as JessNode;
  }

  protected override _buildAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nameLf = ls[0];
    const name = nameLf?.value ?? '';
    const IMPORT_NAMES = ['@import', '@-import', '@-export'];
    if (IMPORT_NAMES.includes(name)) {
      return this._buildImportAtRuleFromPrelude(children, ls as any, loc, name);
    }
    const USE_NAMES = ['@use', '@-use'];
    if (USE_NAMES.includes(name)) {
      return this._buildUseAtRuleFromPrelude(children, loc, name);
    }
    // Reconstruct the prelude from source between the name keyword and the `{`,
    // so a comment authored right after the name (`@keyframes /* c */ hover`) is
    // kept — the prelude leaf itself starts at the first non-trivia token, past
    // that comment. A trailing comment already sits inside the leaf. Falls back
    // to the leaf value when spans are unavailable.
    const nameSpan = (nameLf as unknown as { span?: Span })?.span;
    const braceLf = ls.find(l => l.value === '{');
    const braceStart = (braceLf as unknown as { span?: Span })?.span?.start;
    let rawPreludeText: string | undefined;
    if (nameSpan && typeof braceStart === 'number') {
      const sliced = this._source.slice(nameSpan.end, braceStart).trim();
      rawPreludeText = sliced.length > 0 ? sliced : undefined;
    } else {
      rawPreludeText = ls.slice(1).find(l => l.value !== '{' && l.value !== '}')?.value.trim();
    }
    return this._buildAtRuleFromParts(name, rawPreludeText, nodeChildren(children), loc);
  }

  /**
   * Shared AtRule assembly used by both the flat `AtRuleBlock` builder and the
   * structured, committed `QueryAtRuleBlock` builder. `preludeText` is the raw
   * prelude source (already `{`/`}` stripped); routing it through
   * `_buildAtRulePrelude` keeps the emitted AST identical regardless of which
   * grammar rule matched.
   */
  private _buildAtRuleFromParts(
    name: string,
    preludeText: string | undefined,
    ruleNodes: JessNode[],
    loc: LocationInfo
  ): JessNode {
    const isNestable = (NESTABLE_AT_RULES as readonly string[]).includes(name);
    const nestableOpts = isNestable ? { nestable: true } : undefined;
    const nameNode = name;
    const prelude = preludeText ? this._buildAtRulePrelude(preludeText, loc) : undefined;
    return new AtRule(
      { name: nameNode as any, prelude: prelude as any, rules: ruleNodes },
      nestableOpts, loc
    ) as unknown as JessNode;
  }

  /**
   * Builder for the structured, committed `@media`/`@container`/`@supports`
   * query block. The grammar rule parses the prelude with real query structure
   * (so a stray/unbalanced bracket is rejected instead of swallowed) and commits
   * on `expect('{')`, but the AST is reconstructed from the prelude source text
   * via the shared `_buildAtRuleFromParts` path — so well-formed queries emit the
   * exact same AtRule the flat `AtRuleBlock` builder would.
   */
  private _buildLessQueryAtRuleBlock(children: ReadonlyArray<Child>, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const comps = spannedComponents(raw);
    const keywordEnd = comps[0]?.span.end ?? loc.start;
    const braceComp = comps.find(c => c.comp === '{');
    const braceStart = braceComp?.span.start ?? loc.end;
    const preludeText = this._source.slice(keywordEnd, braceStart).trim();
    // `g.queryPrelude` parses the prelude into real node children (e.g. the
    // `(max-width: 600px)` Paren), so `children` holds BOTH prelude nodes and
    // body nodes. The prelude is reconstructed from source text above; the body
    // is only the nodes that begin after the opening brace.
    const bodyNodes = comps
      .filter((c): c is Spanned & { comp: JessNode } => typeof c.comp !== 'string' && c.span.start >= braceStart)
      .map(c => c.comp);
    return this._buildAtRuleFromParts(name, preludeText || undefined, bodyNodes, loc);
  }

  private _buildAtRulePrelude(text: string, loc: LocationInfo): JessNode {
    const singleVarRe = /^@(-?[_a-zA-Z\x80-￿][-_a-zA-Z0-9\x80-￿]*)$/;
    const MEDIA_KEYWORDS = new Set(['and', 'or', 'not', 'only', 'all', 'print', 'screen', 'speech']);
    const COMPARISON_OPS = new Set(['>', '<', '>=', '<=', '=', '!=']);

    // `~"screen"` / `~'screen'` — an escaped string standing in for the whole
    // query (lessMediaQueryFromString in the reference). Mirrors
    // `_buildEscapedValue`: a Quoted with `escaped: true` so eval unwraps it to
    // the literal content instead of quoted CSS.
    const escapedStrRe = /^~(['"])([\s\S]*)\1$/;
    const buildWord = (w: string): JessNode => {
      const es = escapedStrRe.exec(w);
      if (es) {
        return this._buildEscapedQuoted(es[2]!, es[1] as '\'' | '"', loc);
      }
      // A plain quoted string whose body carries `@{…}` / `${…}` interpolation
      // (e.g. an at-rule prelude arg `regexp("(\d{0,@{d-value}})")`): build an
      // interpolating Quoted so the substitution renders, instead of a literal
      // Keyword. Non-interpolated strings stay a plain keyword (unchanged).
      const plainStr = /^(['"])([\s\S]*)\1$/.exec(w);
      if (plainStr && (plainStr[2]!.includes('@{') || plainStr[2]!.includes('${'))) {
        const value = this._buildStringInterpolation(plainStr[2]!, loc);
        return new Quoted(value as any, { quote: plainStr[1] as '"' | '\'' }, loc) as unknown as JessNode;
      }
      const mv = singleVarRe.exec(w);
      if (mv) {
        return new Reference(mv[1]!, { type: 'index' as const, role: 'ident' as const }, loc) as unknown as JessNode;
      }
      if (MEDIA_KEYWORDS.has(w.toLowerCase())) {
        return this._lessKeyword(w, loc) as unknown as JessNode;
      }
      if (COMPARISON_OPS.has(w)) {
        return w as unknown as JessNode;
      }
      return this._lessKeyword(w, loc) as unknown as JessNode;
    };

    // `@var[key]` accessor in value position → Reference(target=Reference(var), key).
    // (Authoritative accessor shape: lookupOrCall in productions/guards.ts; mirrors
    // the top-level `varAccRe` branch in buildItem below.)
    const varAccRe = /^@(-?[_a-zA-Z\x80-￿][-_a-zA-Z0-9\x80-￿]*)\[([^\]]*)\]$/;
    const buildAccessor = (varName: string, accInner: string): JessNode => {
      const varBase = new Reference(
        { key: varName } as unknown as ReferenceValue, undefined, loc
      ) as unknown as JessNode;
      const inner = accInner.trim();
      let accKey: JessNode | string | number;
      let accType: 'variable' | 'index';
      if (inner === '') {
        accKey = -1;
        accType = 'index';
      } else if (inner.startsWith('@')) {
        accKey = inner.slice(1);
        accType = 'variable';
      } else {
        accKey = new Quoted(inner, undefined, loc) as unknown as JessNode;
        accType = 'index';
      }
      return new Reference(
        { target: varBase as any, key: accKey as any } as unknown as ReferenceValue,
        { type: accType }, loc
      ) as unknown as JessNode;
    };

    // Operator token in a prelude math expression (`(@some-var + 1)`). Kept simple:
    // a `+ - * /` surrounded by whitespace (bare `-`/`+` glued to a following number
    // is a signed operand, not a binary op — matches the value grammar's sumOp gate).
    const prodOps = new Set(['*', '/']);
    const buildFeatureValue = (raw: string): JessNode => {
      const propVal = raw.trim();
      // `~"…"` escaped string, bare `@var`, or `@var[key]` accessor.
      if (escapedStrRe.test(propVal) || singleVarRe.test(propVal)) {
        return buildWord(propVal);
      }
      const vam = varAccRe.exec(propVal);
      if (vam) {
        return buildAccessor(vam[1]!, vam[2] ?? '');
      }
      // A parenthesized math expression `(<expr>)` — fold `left op right …` into a
      // left-associative Operation over References/Dimensions/Nums so eval computes
      // it (`(@some-var + 1)` → `61px`). `* /` bind tighter than `+ -`.
      const paren = /^\(([\s\S]*)\)$/.exec(propVal);
      if (paren) {
        const op = buildMathExpr(paren[1]!.trim());
        if (op) {
          return new Expression(op as unknown as Node, { parens: true } as any, loc) as unknown as JessNode;
        }
      }
      // A `<ratio>` feature value (`aspect-ratio: 3/2`) serializes with spaces
      // around the slash (`3 / 2`) — the slash is a ratio separator, not a
      // division to evaluate. @see https://drafts.csswg.org/css-values-4/#ratios
      const ratio = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(propVal);
      if (ratio) {
        return this._lessKeyword(`${ratio[1]} / ${ratio[2]}`, loc) as unknown as JessNode;
      }
      // A multi-token feature value carrying a variable (e.g. an unknown-at-rule
      // prelude `(foo: "(" @boom-boom ")")`): tokenize into a space-separated run so
      // the bare `@var` evaluates. Strings still interpolate `@{…}` via buildWord.
      if (/\s/.test(propVal) && propVal.includes('@')) {
        const toks = tokenize(propVal);
        if (toks.length > 1) {
          return new QueryCondition(toks as any, undefined, loc) as unknown as JessNode;
        }
      }
      return this._lessKeyword(propVal, loc) as unknown as JessNode;
    };

    // Build a left-associative Operation tree from a flat `operand op operand …`
    // math run, honoring `* /` over `+ -` precedence. Returns undefined if the run
    // isn't a recognizable binary expression (caller falls back to a keyword).
    const buildMathExpr = (expr: string): JessNode | undefined => {
      // Split on whitespace; operators must be space-separated (`@some-var + 1`).
      const parts = expr.split(/\s+/).filter(Boolean);
      if (parts.length < 3 || parts.length % 2 === 0) {
        return undefined;
      }
      const buildOperand = (t: string): JessNode | undefined => {
        const es = escapedStrRe.exec(t);
        if (es) {
          return this._buildEscapedQuoted(es[2]!, es[1] as '\'' | '"', loc);
        }
        const mv = singleVarRe.exec(t);
        if (mv) {
          return new Reference(mv[1]!, { type: 'index' as const, role: 'ident' as const }, loc) as unknown as JessNode;
        }
        const va = varAccRe.exec(t);
        if (va) {
          return buildAccessor(va[1]!, va[2] ?? '');
        }
        const dim = /^([+-]?(?:\d*\.\d+|\d+))([_a-zA-Z%][-_a-zA-Z0-9%]*)?$/.exec(t);
        if (dim) {
          return dim[2]
            ? new Dimension({ number: parseFloat(dim[1]!), unit: dim[2]! }, undefined, loc) as unknown as JessNode
            : new Num(parseFloat(dim[1]!), undefined, loc) as unknown as JessNode;
        }
        return undefined;
      };
      // First fold `* /`, then `+ -`, over a flat operand/operator list.
      const nodes: Array<JessNode | string | undefined> = parts.map((p, i) =>
        i % 2 === 0 ? buildOperand(p) : (/^[-+*/]$/.test(p) ? p : undefined));
      if (nodes.some(n => n === undefined)) {
        return undefined;
      }
      const foldPass = (matchOp: (op: string) => boolean): boolean => {
        for (let i = 1; i < nodes.length - 1; i += 2) {
          const op = nodes[i] as string;
          if (matchOp(op)) {
            const left = nodes[i - 1] as JessNode;
            const right = nodes[i + 1] as JessNode;
            const combined = new Operation([left, op, right] as any, undefined, loc) as unknown as JessNode;
            nodes.splice(i - 1, 3, combined);
            return true;
          }
        }
        return false;
      };
      while (foldPass(op => prodOps.has(op))) { /* fold products */ }
      while (foldPass(op => op === '+' || op === '-')) { /* fold sums */ }
      return nodes.length === 1 ? (nodes[0] as JessNode) : undefined;
    };

    const buildParen = (inner: string): JessNode => {
      const trimmed = inner.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0 && !/[><=!]/.test(trimmed.slice(0, colonIdx))) {
        const propName = trimmed.slice(0, colonIdx).trim();
        const propVal = trimmed.slice(colonIdx + 1).trim();
        // The value may be a bare `@var` (→ indexed Reference, matching
        // atRulePreludeBareVariableAs:'index'), a `@var[key]` accessor, a `~"…"`
        // escaped string, or a parenthesized math expression — all evaluated so
        // the prelude renders computed values (Less 4.x parity).
        const valueNode = buildFeatureValue(propVal);
        // A custom-property style query — `@container style(--responsive: true)`.
        // Less normalizes the feature to `name: value` (single space after the
        // colon), NOT the verbatim custom-property spacing a `Declaration` would
        // preserve, so model it as a query condition (`--name:` keyword + value).
        // @see https://drafts.csswg.org/css-conditional-5/#style-container
        if (propName.startsWith('--')) {
          const qc = new QueryCondition(
            [this._lessKeyword(`${propName}:`, loc), valueNode] as any, undefined, loc);
          return new Paren(qc as any, undefined, loc) as unknown as JessNode;
        }
        const decl = new Declaration({ name: propName as any, value: valueNode as any }, undefined, loc);
        return new Paren(decl as any, undefined, loc) as unknown as JessNode;
      }
      // Normalize interior whitespace of a range/comparison query so it renders
      // canonically regardless of author spacing: no space after `(` or before
      // `)`, and a single space around a comparison operator even when it is
      // glued to an operand (`( width< 500px)` → `(width < 500px)`).
      // @see https://drafts.csswg.org/mediaqueries-5/#mq-range-context
      const normalized = trimmed
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .replace(/\s*(<=|>=|!=|[<>=])\s*/g, ' $1 ')
        .trim();
      const words = normalized.split(/\s+/).filter(Boolean).map(w => buildWord(w));
      const qc = new QueryCondition(words as any, undefined, loc);
      return new Paren(qc as any, undefined, loc) as unknown as JessNode;
    };

    const tokenize = (t: string): JessNode[] => {
      const tokens: JessNode[] = [];
      let i = 0;
      while (i < t.length) {
        if (t[i] === '(') {
          let depth = 1;
          let j = i + 1;
          while (j < t.length && depth > 0) {
            if (t[j] === '(') {
              depth++;
            } else if (t[j] === ')') {
              depth--;
            }
            j++;
          }
          tokens.push(buildParen(t.slice(i + 1, j - 1)));
          i = j;
        } else if (t[i] === '"' || t[i] === '\'' || (t[i] === '~' && (t[i + 1] === '"' || t[i + 1] === '\''))) {
          // A quoted (optionally `~`-escaped) run is one token, even with spaces
          // inside — matches the outer atPrelude scan, which already treats
          // strings as atomic.
          const start = i;
          if (t[i] === '~') {
            i++;
          }
          const quote = t[i]!;
          i++;
          while (i < t.length && t[i] !== quote) {
            i++;
          }
          i = Math.min(i + 1, t.length);
          tokens.push(buildWord(t.slice(start, i)));
        } else if (/\s/.test(t[i]!)) {
          i++;
        } else {
          let j = i;
          while (j < t.length && !/\s/.test(t[j]!) && t[j] !== '(') {
            j++;
          }
          tokens.push(buildWord(t.slice(i, j)));
          i = j;
        }
      }
      return tokens;
    };

    const splitCommas = (t: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '(') {
          depth++;
        } else if (t[i] === ')') {
          depth--;
        } else if (t[i] === ',' && depth === 0) {
          parts.push(t.slice(start, i).trim());
          start = i + 1;
        }
      }
      parts.push(t.slice(start).trim());
      return parts.filter(Boolean);
    };

    // Regex: namespace path (#ns.sub or #ns > .sub), optional (args), optional [accessor]
    const nsMediaRe = /^([#.][^(\[,\s]*)(\([^)]*\))?(\[[^\]]*\])?$/;
    const buildItem = (t: string): JessNode => {
      const trimmed = t.trim();
      const mv = singleVarRe.exec(trimmed);
      if (mv) {
        const ref = new Reference(mv[1]!, { type: 'index' as const, role: 'ident' as const }, loc) as unknown as JessNode;
        return new QueryCondition([ref] as any, undefined, loc) as unknown as JessNode;
      }
      // `@var[accessor]` prelude → Expression(Reference(target=Reference(var), key))
      // (Authoritative accessor shape: lookupOrCall in productions/guards.ts.)
      const varAccRe = /^@(-?[_a-zA-Z\x80-￿][-_a-zA-Z0-9\x80-￿]*)(\[([^\]]*)\])$/;
      const vam = varAccRe.exec(trimmed);
      if (vam) {
        const varBase = new Reference(
          { key: vam[1]! } as unknown as ReferenceValue, undefined, loc
        ) as unknown as JessNode;
        const accInner = (vam[3] ?? '').trim();
        let accKey: JessNode | string | number;
        let accType: 'variable' | 'index';
        if (accInner === '') {
          accKey = -1;
          accType = 'index';
        } else if (accInner.startsWith('@')) {
          accKey = accInner.slice(1);
          accType = 'variable';
        } else {
          accKey = new Quoted(accInner, undefined, loc) as unknown as JessNode;
          accType = 'index';
        }
        const acc = new Reference(
          { target: varBase as any, key: accKey as any } as unknown as ReferenceValue,
          { type: accType }, loc
        ) as unknown as JessNode;
        return new Expression(acc as unknown as Node, undefined, loc) as unknown as JessNode;
      }
      const nsm = nsMediaRe.exec(trimmed);
      if (nsm) {
        const nsPath = nsm[1]!;
        const argsText = nsm[2];
        const accText = nsm[3];
        // Build namespace reference: split compound selector path into segments
        const segments = nsPath.match(/[#.][^#.]*/g) ?? [nsPath];
        const nameKey: string | string[] = segments.length === 1 ? segments[0]! : segments;
        const rawKey = segments.length > 1 ? nsPath : undefined;
        let base: JessNode = new Reference(
          { key: nameKey, ...(rawKey ? { rawKey } : {}) } as unknown as ReferenceValue,
          { type: 'mixin-ruleset', role: 'name' } as any, loc
        ) as unknown as JessNode;
        if (argsText) {
          const argsInner = argsText.slice(1, -1).trim();
          let argsNode: JessNode | null = null;
          if (argsInner) {
            // Build accessor-style arg ref if it looks like .sel[]
            const argRefMatch = /^([.#][^\[\]()\s]+)(\[([^\]]*)\])?$/.exec(argsInner);
            if (argRefMatch) {
              let argBase: JessNode = new Reference(
                { key: argRefMatch[1]! } as unknown as ReferenceValue,
                { role: 'name' } as any, loc
              ) as unknown as JessNode;
              if (argRefMatch[2] !== undefined) {
                const argAcc = argRefMatch[3] ?? '';
                const argKey: string | number = argAcc === '' ? -1 : argAcc;
                argBase = new Reference(
                  { target: argBase as any, key: argKey as any } as unknown as ReferenceValue,
                  undefined, loc
                ) as unknown as JessNode;
              }
              argsNode = new List([argBase as unknown as Node] as any, undefined, loc) as unknown as JessNode;
            }
          }
          const callPayload: Record<string, unknown> = { name: base };
          if (argsNode) {
            callPayload.args = argsNode;
          }
          base = new Call(callPayload as any, undefined, loc) as unknown as JessNode;
        }
        if (accText) {
          const inner = accText.slice(1, -1).trim();
          const key: string | number = inner.startsWith('@') ? inner.slice(1) : (inner === '' ? -1 : inner);
          base = new Reference(
            { target: base as any, key: key as any } as unknown as ReferenceValue,
            { type: 'variable' as const }, loc
          ) as unknown as JessNode;
        }
        return new Expression(base as unknown as Node, undefined, loc) as unknown as JessNode;
      }
      const tokens = tokenize(t);
      // A leading `<container-name>` — an identifier (or `@var`) separated from
      // the following `<container-query>` by whitespace (`@container sidebar
      // (min-width: 700px)`) — is NOT a query function token (`size(…)`), so the
      // serializer keeps a space before the query group instead of gluing it.
      // @see https://drafts.csswg.org/css-conditional-5/#container-condition
      const nameMatch = /^(@?-?[_a-zA-Z\x80-\uffff][-_a-zA-Z0-9\x80-\uffff]*)\s+(?:\(|not(?![-\w]))/i.exec(trimmed);
      const leadingContainerName = !!nameMatch
        && tokens.length > 1
        && !['not', 'and', 'or', 'only'].includes(nameMatch[1]!.replace(/^@/, '').toLowerCase());
      return new QueryCondition(
        tokens as any,
        leadingContainerName ? { leadingContainerName: true } : undefined,
        loc
      ) as unknown as JessNode;
    };

    const commaItems = splitCommas(text);
    if (commaItems.length === 1) {
      return buildItem(commaItems[0]!);
    }
    return new List(commaItems.map(buildItem) as any, undefined, loc) as unknown as JessNode;
  }

  protected _buildAtRuleStatement(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const IMPORT_NAMES = ['@import', '@-import', '@-export'];
    if (IMPORT_NAMES.includes(name)) {
      return this._buildImportAtRuleFromPrelude(children, ls as any, loc, name);
    }
    const USE_NAMES = ['@use', '@-use'];
    if (USE_NAMES.includes(name)) {
      return this._buildUseAtRuleFromPrelude(children, loc, name);
    }
    return super._buildAtRuleStatement(children, loc) as unknown as JessNode;
  }

  private _buildUseAtRuleFromPrelude(
    children: ReadonlyArray<Child>,
    loc: LocationInfo,
    name: string
  ): JessNode {
    const preludeText = this._source.slice(loc.start, loc.end);
    const builtNodes = nodeChildren(children);
    const quotedNode = builtNodes.find(n => n.type === 'Quoted') as unknown as { quote?: '"' | '\''; value?: unknown } | undefined;
    let rawPath = '';
    let pathNode: Quoted | undefined;
    if (quotedNode) {
      const quote = quotedNode.quote ?? '"';
      const innerVal = quotedNode.value;
      const inner = typeof innerVal === 'string'
        ? innerVal
        : (innerVal as any)?.value ?? String((innerVal as any)?.valueOf?.() ?? '');
      rawPath = inner;
      const innerNode = inner;
      pathNode = new Quoted(innerNode, { quote }, loc);
    } else {
      // Fallback: extract from preludeText (AtRuleStatement uses scanTo, not Quoted node)
      const qm = /(['"])((?:[^'"\\]|\\.)*)\1/.exec(preludeText);
      if (qm) {
        const quote: '"' | '\'' = qm[1] === '\'' ? '\'' : '"';
        const inner = qm[2]!;
        rawPath = inner;
        const innerNode = inner;
        pathNode = new Quoted(innerNode, { quote }, loc);
      }
    }
    const nsMatch = /\bas\s+([^\s;]+)/.exec(preludeText);
    const explicitNs = nsMatch?.[1];
    const isJsFile = /\.[cm]?[jt]sx?$/.test(rawPath) || rawPath.startsWith('#');
    if (isJsFile) {
      let ns = explicitNs;
      if (!ns) {
        const base = rawPath.split('/').pop() ?? '';
        ns = base.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_$]/g, '_');
      }
      return new JsImport(
        { path: pathNode as any },
        { namespace: ns },
        loc
      ) as unknown as JessNode;
    }
    // Not a JS import - build plain AtRule/AtRuleStatement
    const nameAny = name;
    const preludeNode: JessNode | undefined = pathNode as unknown as JessNode | undefined;
    return new AtRule(
      { name: nameAny as any, prelude: preludeNode as any, rules: [] },
      undefined, loc
    ) as unknown as JessNode;
  }

  private _parenToArgs(paren: JessNode, loc: LocationInfo): JessNode | null {
    // Convert Paren content to List of mixin args.
    // Handles patterns like @foo: bar (keyword args) and bare values.
    const inner = (paren as any).value ?? (paren as any).node;
    if (!inner) {
      return null;
    }
    const items: JessNode[] = [];
    // Inner may be a component array (e.g. [Reference, ':', 'bar']) or legacy Sequence node.
    const isSeq = inner && typeof inner === 'object' && inner.type === 'Sequence';
    const isRawArray = Array.isArray(inner);
    if (isSeq || isRawArray) {
      const rawSeq: unknown[] = isSeq ? ((inner as any).value ?? []) : (inner as unknown[]);
      // Normalize bare strings to Keyword nodes so both the ':' / @var
      // detection and the value-node construction below operate on real nodes.
      const seqItems: JessNode[] = rawSeq.map(it =>
        typeof it === 'string'
          ? (this._lessKeyword(it.trim(), loc) as unknown as JessNode)
          : it as JessNode);
      // Look for @var : value patterns
      let j = 0;
      while (j < seqItems.length) {
        const item = seqItems[j]!;
        // Check for Reference (potential @foo) followed by ':' and value
        if (
          item.type === 'Reference'
          && j + 2 < seqItems.length
          && (seqItems[j + 1] as any)?.value === ':'
        ) {
          const varName = (item as any).key ?? '';
          const nameAny = varName;
          const valNode = seqItems[j + 2]!;
          const valueNode = this._isKeywordLike(valNode)
            ? this._lessKeyword(String((valNode as any).value ?? '').trim(), loc) as unknown as JessNode
            : this._lessKeyword(String((valNode as any).value ?? ''), loc) as unknown as JessNode;
          const vd = new VarDeclaration(
            { name: nameAny as any, value: valueNode } as any,
            undefined,
            loc
          );
          items.push(vd as unknown as JessNode);
          j += 3;
        } else {
          items.push(item);
          j++;
        }
      }
    } else if (inner && (inner as any).type === 'List') {
      // A comma/semicolon List as the direct paren content is the ARG SEPARATOR,
      // not a single list-valued arg: `.mixin(10px, 10px)` is two args, so spread
      // the list's items. (The `@var(...)` path splits on comma in
      // `_buildRefCallArgs`; this mirrors it for the namespace/mixin call path
      // where the grammar hands us a real List node.) Space-separated content
      // arrives as a Sequence/single node and stays one arg.
      for (const it of ((inner as any).value ?? []) as JessNode[]) {
        items.push(it);
      }
    } else if (inner) {
      const isEmptyInner = this._isEmptyKeywordLike(inner);
      if (!isEmptyInner) {
        items.push(inner as JessNode);
      }
    }
    if (items.length === 0) {
      return null;
    }
    return new List(items as any, undefined, loc) as unknown as JessNode;
  }

  private _tryParseNamespaceRef(
    valItems: Spanned[],
    loc: LocationInfo
  ): JessNode | null {
    // Check if this looks like a namespace selector reference/call
    // Pattern: #id or .class, optionally followed by > .mixin, [accessor], ()
    const isSel = (s: unknown): s is string =>
      typeof s === 'string' && startsWithHashDotLead(s.trim(), isNsNameLead);
    const isCombinator = (s: unknown): s is string => {
      if (typeof s !== 'string') {
        return false;
      }
      // `/^[>+~|]$|^\|\|$/`: exactly one of `>` `+` `~` `|`, or `||`.
      const t = s.trim();
      return t === '>' || t === '+' || t === '~' || t === '|' || t === '||';
    };
    const isJessNodeVal = (x: unknown): x is JessNode =>
      !!x && typeof x === 'object' && 'type' in x;

    // Quick check: does first item look like a selector segment?
    const first = valItems[0]?.comp;
    const isVarRef = (x: unknown): x is JessNode =>
      !!x && typeof x === 'object' && (x as any).type === 'Reference';
    if (!isSel(first) && !isVarRef(first)) {
      return null;
    }
    // Must have at least one SquareParen accessor when starting with a variable ref
    if (isVarRef(first) && valItems.length < 2) {
      return null;
    }
    const hasSquareAfterVar = isVarRef(first) && valItems.slice(1).some(vi =>
      isJessNodeVal(vi.comp) && (vi.comp as any).type === 'Paren' && (vi.comp as any)._options?.delimiter === 'square'
    );
    if (isVarRef(first) && !hasSquareAfterVar) {
      return null;
    }

    // Parse selector chain with interleaved calls.
    // Each "segment ()" pair becomes a Call; subsequent "> segment" chains further.
    // e.g.: .a() > .b() => Call(name=Ref(target=Call(name=Ref(key=.a)) key=.b))
    // e.g.: #ns > .mixin => Ref[role=name](key=['#ns', '.mixin'])
    let i = 0;
    let base: JessNode | null = null;
    // Pending segments since the last call (or since start)
    let pendingSegments: string[] = [];
    let hasMidCall = false; // any () seen mid-chain

    const flushPendingAsRef = (): JessNode => {
      const k: string | string[] = pendingSegments.length === 1 ? pendingSegments[0]! : pendingSegments;
      pendingSegments = [];
      if (base === null) {
        return new Reference(
          { key: k } as unknown as ReferenceValue,
          { type: 'mixin-ruleset', role: 'name' } as any, loc
        ) as unknown as JessNode;
      }
      return new Reference(
        { target: base as any, key: k } as unknown as ReferenceValue,
        { type: 'mixin-ruleset', role: 'name' } as any, loc
      ) as unknown as JessNode;
    };

    while (i < valItems.length) {
      const c = valItems[i]!.comp;
      if (isVarRef(c) && base === null && pendingSegments.length === 0) {
        // Variable reference node (e.g. Reference('config')) as the base.
        // Observed: for `@config[$@prop]` the grammar emits TWO items —
        //   1. Reference(target=Reference('config'), key=Quoted('')) — a leaked
        //      empty-accessor wrapper, and
        //   2. a separate `[$@prop]` SquareParen that carries the real key.
        // Strip the empty-key wrapper so the trailing SquareParen accessor applies
        // to Reference('config'). (Authoritative shape: lookupOrCall in productions/guards.ts.)
        const rv = c as any;
        const isLeakedEmptyKey = rv.target !== undefined
          && (rv.key === '' || rv.key === undefined
            || (rv.key && typeof rv.key === 'object'
              && rv.key.type === 'Quoted' && !String(rv.key.value ?? '').trim()));
        base = isLeakedEmptyKey ? rv.target as JessNode : c as JessNode;
        i++;
      } else if (isSel(c)) {
        // Split compound selectors like '#ns.breakpoint' → ['#ns', '.breakpoint']
        const seg = (c as string).trim();
        const splitSegArr = splitHashDotSegments(seg);
        const splitSeg = splitSegArr.length > 0 ? splitSegArr : [seg];
        for (const s of splitSeg) {
          pendingSegments.push(s);
        }
        i++;
      } else if (isCombinator(c) && i + 1 < valItems.length && isSel(valItems[i + 1]?.comp)) {
        // Combinator between segments — skip
        i++;
      } else if (isJessNodeVal(c) && (c as any).type === 'Paren' && (c as any)._options?.delimiter === 'square') {
        // Square paren: accessor on current base
        if (pendingSegments.length > 0) {
          base = flushPendingAsRef();
        }
        if (base === null) {
          break;
        }
        const innerKey = this._decodeAccessorKey(c as JessNode, loc);
        // A numeric accessor key (`foo[2]`, or `foo[]` → last, key -1) is an
        // INDEX lookup, not a variable lookup. Dispatching it as `variable`
        // sends `-1` through the variable resolver and fails with `'-1' is not
        // defined`; `index` resolves it via `rules.at(-1)` (the last value).
        base = new Reference(
          { target: base as any, key: innerKey as any } as unknown as ReferenceValue,
          { type: typeof innerKey === 'number' ? 'index' as const : 'variable' as const }, loc
        ) as unknown as JessNode;
        i++;
      } else if (isJessNodeVal(c) && (c as any).type === 'Paren') {
        // Round paren: flush pending segments as Reference (if any), then wrap in Call
        if (pendingSegments.length === 0 && base === null) {
          break;
        } // unexpected ()
        if (pendingSegments.length > 0) {
          base = flushPendingAsRef();
        }
        // Extract args from the Paren's inner node (may be null for empty parens)
        const argsNode = this._parenToArgs(c as JessNode, loc);
        const callPayload: Record<string, unknown> = { name: base as any };
        if (argsNode) {
          callPayload.args = argsNode;
        }
        base = new Call(callPayload as any, undefined, loc) as unknown as JessNode;
        hasMidCall = true;
        i++;
      } else {
        break;
      }
    }

    // Must have consumed all valItems
    if (i !== valItems.length) {
      return null;
    }
    if (pendingSegments.length === 0 && base === null) {
      return null;
    }

    // If we still have pending segments (no trailing call), flush them
    if (pendingSegments.length > 0) {
      base = flushPendingAsRef();
    }

    // Check source text for (args)[accessor] AFTER the last parsed item
    // Process in order: (args) call → [accessor] → trailing ()
    if (valItems.length > 0) {
      const lastSpan = valItems[valItems.length - 1]!.span;
      let afterVal = this._source.slice(lastSpan.end).trimStart();

      // Step 1: Check for a trailing call (...) when grammar didn't catch it
      if (!hasMidCall && afterVal.startsWith('(')) {
        const closeIdx = afterVal.indexOf(')', 1);
        if (closeIdx > 0) {
          const callInner = afterVal.slice(1, closeIdx).trim();
          afterVal = afterVal.slice(closeIdx + 1).trimStart();
          // Build args from call content if non-empty
          let argsNode: JessNode | null = null;
          if (callInner) {
            // Check for .selector[accessor] pattern in call args
            const argRefMatch = parseSelBracketRef(callInner);
            if (argRefMatch) {
              const argSel = argRefMatch.sel;
              const argAccContent = argRefMatch.bracket; // may be undefined or empty string
              let argBase: JessNode = new Reference(
                { key: argSel } as unknown as ReferenceValue,
                { role: 'name' } as any, loc
              ) as unknown as JessNode;
              if (argRefMatch.bracket !== undefined) {
                const argAccKey: string | number = argAccContent === undefined || argAccContent === ''
                  ? -1
                  : (argAccContent.startsWith('@') ? argAccContent.slice(1) : argAccContent);
                argBase = new Reference(
                  { target: argBase as any, key: argAccKey as any } as unknown as ReferenceValue,
                  undefined, loc
                ) as unknown as JessNode;
              }
              argsNode = new List([argBase as unknown as Node] as any, undefined, loc) as unknown as JessNode;
            }
          }
          const callPayload: Record<string, unknown> = { name: base as any };
          if (argsNode) {
            callPayload.args = argsNode;
          }
          base = new Call(callPayload as any, undefined, loc) as unknown as JessNode;
        }
      }

      // Step 2: Check for [accessor] suffix
      const accMatch = leadingBracket(afterVal);
      if (accMatch) {
        const accText = accMatch.inner.trim();
        let accessorKey: JessNode | string | number;
        if (accText === '') {
          accessorKey = -1;
        } else if (accText.startsWith('@')) {
          accessorKey = accText.slice(1);
        } else {
          accessorKey = new Quoted(accText, undefined, loc) as unknown as JessNode;
        }
        base = new Reference(
          { target: base as any, key: accessorKey as any } as unknown as ReferenceValue,
          undefined, loc
        ) as unknown as JessNode;
        const afterAcc = afterVal.slice(accMatch.length).trimStart();
        if (startsWithEmptyParens(afterAcc)) {
          base = new Call({ name: base as any } as any, undefined, loc) as unknown as JessNode;
        }
      } else if (!hasMidCall) {
        // Step 3: Check for trailing () (simple empty call)
        if (startsWithEmptyParens(afterVal)) {
          base = new Call({ name: base as any } as any, undefined, loc) as unknown as JessNode;
        }
      }
    }

    return base;
  }

  private _assembleLessValue(
    valItems: Spanned[],
    loc: LocationInfo
  ): { value: JessNode | string } {
    // A lone Less identifier is an inert scalar value. Keep it as the raw
    // DeclarationValue string; nodes below represent colors, calculations,
    // references, calls, and grouped values with semantics of their own.
    const scalar = valItems[0]?.comp;
    if (valItems.length === 1 && typeof scalar === 'string') {
      return { value: scalar.trim() };
    }
    const parts: JessNode[] = [];
    for (const item of valItems) {
      const c = item.comp;
      if (typeof c === 'string') {
        if (c.trim()) {
          parts.push(this._lessKeyword(c.trim(), loc) as unknown as JessNode);
        }
      } else {
        parts.push(c as JessNode);
      }
    }
    if (parts.length === 0) {
      return { value: '' };
    }
    if (parts.length === 1) {
      return { value: parts[0]! };
    }
    return { value: parts as unknown as JessNode };
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
