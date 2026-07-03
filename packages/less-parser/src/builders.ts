/**
 * LessGrammar — builder methods for the Less grammar.
 *
 * Builder-only class: no grammar rules, no Parséman Parser base.
 * Grammar rules live in grammar-fn.ts (macro-compiled functional grammar),
 * which uses LessGrammar via a thin BuilderHost subclass.
 * Extends CssParser to inherit the shared CSS builder methods.
 */

import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import {
  CssParser, CSS_COLOR_NAMES,
  spannedComponents, type Spanned, type Component
} from '@jesscss/css-parser';
import { getInterpolatedOrString, getInterpolatedNode, createInterpolatedReference } from './utils.js';

import {
  type Node,
  type LocationInfo,
  Any, BasicSelector, Rules, Ruleset,
  type Selector,
  ComplexSelector, type ComplexSelectorValue,
  CompoundSelector,
  SelectorList,
  Declaration, type DeclarationOptions,
  VarDeclaration, type VarDeclarationOptions,
  NESTABLE_AT_RULES,
  Reference, type ReferenceValue,
  Ampersand, List, DefaultGuard, Extend, ExtendFlag, Call,
  For, type ForPattern,
  Interpolated, InterpolatedSelector, Sequence, CustomDeclaration,
  Color, Paren, Condition, type ConditionOperator,
  Mixin, Expression, Operation, Negative,
  shouldOperateWithMathFrames, type MathMode,
  StyleImport, type StyleImportOptions,
  JsImport,
  Nil,
  Rest,
  Quoted,
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

// Mirrors grammar.ts's `knownAtVar` regex (isVariableLike in the reference): a
// known at-rule name (incl. vendor-prefixed document/keyframes/viewport) used
// as a variable call (`@media()`) is only legal with empty parens, and is
// itself a deprecated form.
const KNOWN_AT_RULE_VAR_NAME_RE = /^(?:(?:-moz-)?document|(?:-[a-z]+-)?keyframes|(?:-ms-)?viewport|import|media|supports|layer|container|scope|page|font-face|starting-style|property|counter-style|color-profile|font-palette-values|namespace)$/i;

function spanToLocation(span: Span): LocationInfo {
  return [span.start, 0, 0, span.end, 0, 0];
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

  // -- buildNode -------------------------------------------------------------
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/naming-convention */

  protected override buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    _state: unknown,
    _rawChildren: ReadonlyArray<{ _tag: string }>
  ): JessNode {
    const loc = spanToLocation(span);
    const raw = _rawChildren;
    switch (type) {
      case 'VarDeclaration':      return this._buildVarDeclaration(children, raw, loc);
      case 'Reference':           return this._buildReference(children, loc);
      case 'LessAmpersand':       return this._buildAmpersand(children, loc);
      case 'LessComplexSelector': return this._buildComplexSelector(raw, loc);
      case 'LessSelectorList':    return this._buildSelectorList(raw, loc);
      case 'Ruleset':             return this._buildRuleset(children, raw, loc) as unknown as JessNode;
      case 'Declaration':
        this._warnDeprecatedValue(span);
        return this._buildLessDeclaration(raw, loc);
      case 'CustomDeclaration':
        this._warnCustomPropVars(span);
        return this._buildLessCustomDecl(children, loc);
      case 'Block':               return this._buildLessCustomBlock(children, loc);
      case 'AtRuleBlock':
        this._warnAtRulePreludeVars(span);
        return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'QueryAtRuleBlock':
        this._warnAtRulePreludeVars(span);
        return this._buildLessQueryAtRuleBlock(children, raw, loc);
      case 'NamedColor':          return this._buildNamedColor(children, loc);
      case 'Comparison':          return this._buildComparison(children, loc);
      case 'GuardDefault':        return new DefaultGuard('default()', {}, loc) as unknown as JessNode;
      case 'GuardInParens':       return this._buildGuardInParens(children, loc);
      case 'GuardTerm':           return this._buildGuardTerm(children, loc);
      case 'GuardAnd':            return this._buildGuardJoin(children, loc, 'and');
      case 'GuardOr':             return this._buildGuardJoin(children, loc, 'or');
      case 'Guard':               return this._buildGuard(children, loc);
      case 'PseudoSelector':      return this._buildLessPseudo(type, span, children, _state, raw, loc);
      case 'InterpolatedSelector': return this._buildInterpolatedSelector(children, loc);
      case 'VarCall':             return this._buildVarCall(children, raw, loc);
      case 'MixinCall':           return this._buildMixinCall(children, raw, loc);
      case 'MixinArgs':           return this._buildMixinArgs(children, loc);
      case 'AnonymousMixinDefinition': return this._buildAnonMixin(children, loc) as unknown as JessNode;
      case 'DetachedRuleset':     return this._buildDetachedRuleset(children, loc) as unknown as JessNode;
      case 'For':                 return this._buildEachFor(children, loc) as unknown as JessNode;
      case 'MixinOrQualifiedRule': return this._buildMixinOrQualified(children, loc);
      case 'Negative':            return new Negative(nodeChildren(children)[0]!, undefined, loc) as unknown as JessNode;
      case 'OperationTop':        return this._buildOperation(children, loc, this.mathMode === 'always') as unknown as JessNode;
      case 'EscapedValue':        return this._buildEscapedValue(children, loc);
      case 'InterpValue':         return this._buildInterpValue(raw, loc);
      case 'AtRuleStatement':     return this._buildAtRuleStatement(children, loc);
      case 'ExtendTarget':        return this._buildExtendTarget(children, raw, loc);
      case 'ExtendPseudo':        return this._buildExtendPseudo(children, loc);
      case 'ExtendStatement':     return this._buildExtendStatement(children, raw, loc);
      default:                    return super.buildNode(type, span, children, _state, raw) as unknown as JessNode;
    }
  }

  // -- Private Less AST builders ---------------------------------------------

  private _buildVarDeclaration(children: ReadonlyArray<JessNode | CSTLeaf | CSTError>, rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
    // Less.js still accepts a digit-leading variable name (`@3`) — its name regex
    // is `[\w-]+` — but it's a footgun (collides with numeric tokens), so flag it.
    if (/^-?\d/.test(name)) {
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
      const mixin = new Mixin({ rules: ruleNodes }, {}, loc);
      const nameNode = name ? new Any(name, { role: 'ident' }, loc) : undefined;
      return new VarDeclaration(
        { name: (nameNode ?? name) as any, value: mixin as any } as any,
        {} as VarDeclarationOptions,
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
    if (valItems.length) {
      const vText = this._source.slice(valItems[0]!.span.start, valItems[valItems.length - 1]!.span.end);
      if (/(?:^|[\s,])\.-?[_a-zA-Z]/.test(vText)) {
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
        rv && rv.type === 'Reference' && rv.target !== undefined && isEmptyKey;
      const accMatch = /^\s*\[([^\]]+)\]/.exec(afterVal);
      if (accMatch) {
        const accText = accMatch[1]!.trim();
        const accessorKey = this._decodeAccessorKey(accText, loc);
        if (grammarPartialAccessor) {
          // Fix in-place: replace the wrong key on the existing Reference wrapper
          rawValue = new Reference(
            { target: rv.target as any, key: accessorKey as any } as unknown as ReferenceValue,
            {},
            loc
          ) as unknown as JessNode;
        } else {
          // No partial grammar accessor: wrap with new Reference
          rawValue = new Reference(
            { target: rawValue as any, key: accessorKey as any } as unknown as ReferenceValue,
            {},
            loc
          ) as unknown as JessNode;
        }
        const afterAcc = afterVal.slice(accMatch[0].length);
        if (/^\s*\(\s*\)/.test(afterAcc)) {
          rawValue = new Call({ name: rawValue as any } as any, {}, loc) as unknown as JessNode;
        }
      }
    }
    const value = typeof rawValue === 'string' && rawValue
      ? new Any(rawValue, { role: 'ident' }, loc)
      : rawValue;
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
    const nameNode = name ? new Any(name, { role: 'ident' }, loc) : undefined;
    return new VarDeclaration(
      { name: (nameNode ?? name) as any, value, important } as any,
      {} as VarDeclarationOptions,
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
    let base: JessNode = new Reference(
      varName.startsWith('@') ? varName.slice(1) : varName,
      varName.startsWith('@') ? { type: 'variable' as const } : {},
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
        base = new Call(payload as any, {}, loc) as unknown as JessNode;
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
      : new Any(p, { role: 'ident' }, loc) as unknown as Node);
    return new List(items as any, undefined, loc) as unknown as JessNode;
  }

  private _buildNamedColor(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    return new Color({ node: name }, {}, loc) as unknown as JessNode;
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

  private _buildComparison(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const left = nodes[0] ?? new Any('', {}, loc);
    const op = ls.find(l => />=|<=|=>|=<|=~|[<>=]/.test(l.value));
    const right = nodes[1] ?? new Any('', {}, loc);
    if (op) {
      return new Condition(
        [left, this._normalizeCompareOp(op.value), right],
        {},
        loc
      ) as unknown as JessNode;
    }
    return new Condition([left], {}, loc) as unknown as JessNode;
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
        return new DefaultGuard('default()', {}, loc) as unknown as Node;
      }
    }
    return node;
  }

  /** guardInParens: `(` guardOr `)` → Paren, or a bare default() → Paren(DefaultGuard). */
  private _buildGuardInParens(children: ReadonlyArray<Child>, loc: LocationInfo) {
    let inner = nodeChildren(children)[0] ?? new Any('', {}, loc);
    inner = this._maybeDefaultGuard(inner, loc) as Node;
    // `(default())` nests guardInParens(GuardDefault) inside another guardInParens;
    // collapse the redundant Paren-around-Paren(DefaultGuard) to a single Paren.
    const innerAny = inner as any;
    if (innerAny?.type === 'Paren' && (innerAny.value as any)?.type === 'DefaultGuard') {
      return inner as unknown as JessNode;
    }
    return new Paren(inner as any, {}, loc) as unknown as JessNode;
  }

  /** A single guard term: optional `not`, then a paren-guard or a comparison/value. */
  private _buildGuardTerm(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const hasNot = ls.some(l => l.value === 'not');
    let term: Node;
    if (nodes.length >= 1 && (nodes[0] as any).type === 'Paren') {
      // guardInParens branch (already a Paren node)
      term = nodes[0]!;
    } else {
      const left = this._maybeDefaultGuard(nodes[0] ?? new Any('', {}, loc), loc);
      const op = ls.find(l => />=|<=|=>|=<|=~|[<>=]/.test(l.value));
      if (op && nodes[1]) {
        const right = this._maybeDefaultGuard(nodes[1], loc);
        term = new Condition([left, this._normalizeCompareOp(op.value), right], {}, loc) as unknown as Node;
      } else {
        term = left;
      }
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
      return new Any('', {}, loc) as unknown as JessNode;
    }
    let left = nodes[0]!;
    for (let i = 1; i < nodes.length; i++) {
      left = new Condition([left, op, nodes[i]!], {}, loc) as unknown as Node;
    }
    return left as unknown as JessNode;
  }

  /** guard: `when` guardOr — returns the single guardOr child. */
  private _buildGuard(children: ReadonlyArray<Child>, loc: LocationInfo) {
    return (nodeChildren(children)[0] ?? new Any('', {}, loc)) as unknown as JessNode;
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
    return new InterpolatedSelector(interp as any, {}, loc) as unknown as JessNode;
  }

  private _buildLessPseudo(
    type: string, span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    // `:extend(...)` is parsed by the dedicated ExtendPseudo grammar rule, never
    // here — generic PseudoSelector is guarded against it (extendAhead). So this
    // builder only ever sees real CSS pseudo-classes/elements.
    const pseudo = super.buildNode(type, span, children, state, raw) as JessNode;
    const pseudoArg = (pseudo as unknown as { arg?: unknown }).arg;
    if (Array.isArray(pseudoArg)) {
      // Unknown-pseudo: raw string array → Sequence([Any...]) for structured serialization.
      const anyNodes = (pseudoArg as unknown[]).map(item =>
        typeof item === 'string' ? new Any(item, undefined, loc) : item as JessNode
      );
      (pseudo as unknown as { arg: unknown }).arg = new Sequence(anyNodes, undefined, loc);
    }
    return pseudo;
  }

  private _buildLessDeclaration(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(raw);
    const decl = this._buildDeclaration(raw, loc);
    const colonIdx = items.findIndex(i => i.comp === ':');
    const merge = colonIdx > 0 ? items[colonIdx - 1]?.comp : undefined;
    const assign = merge === '+_' ? '+_:' : merge === '+' ? '+,:' : ':';
    const d = decl as unknown as { _options?: Record<string, unknown>; options?: Record<string, unknown>; name?: unknown };
    d._options = { ...(d._options ?? {}), assign };
    // Wrap the string name. An interpolated property name (`@{prop}`, `pre-@{x}`)
    // becomes an Interpolated (port of `declaration`'s getInterpolatedNode branch);
    // a plain name becomes Any(role='property').
    if (typeof d.name === 'string' && d.name) {
      const nameStr = d.name;
      (decl as unknown as { name: unknown }).name =
        (nameStr.includes('@{') || nameStr.includes('${'))
          ? getInterpolatedNode(nameStr, loc)
          : new Any(nameStr, { role: 'property' }, loc);
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
      const src = this._source.slice(loc[0], loc[3]);
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
   * Port of `processLegacyMSFilterToken` (lessRecursiveParser.ts): a `progid:…`
   * filter value string → Interpolated(role=any) with `@var` runs templated out,
   * or a plain Any when the run has no variables.
   */
  private _buildLegacyMSFilter(source: string, loc: LocationInfo): JessNode {
    source = source.replace(/\s*=\s*/g, '=');
    const varRe = /@([_a-zA-Z\xA0-￿][-_a-zA-Z0-9\xA0-￿]*)/g;
    const matches = [...source.matchAll(varRe)];
    if (matches.length === 0) {
      return new Any(source, { role: 'any' }, loc) as unknown as JessNode;
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
      // Glued-suffix (`&-bar`, `&1`) or prefix (`.foo-&`) template: the first leaf
      // is the whole ampersand-token image. Mirror the reference's
      // getAmpersandTemplateValue (selectors.ts): bare `&` → undefined; a `&`-led
      // image keeps everything after the `&` (`&-bar` → '-bar'); a non-`&`-led image
      // that still contains `&` keeps the full image (`.foo-&` → '.foo-&').
      const image = ls[0]?.value ?? '&';
      const appendValue = this._ampersandTemplateValue(image);
      return new Ampersand(appendValue, {}, loc) as unknown as JessNode;
    }
    const content = ls.find(l => l.value !== '&' && l.value !== '(' && l.value !== ')')?.value ?? '';
    const trimmed = content.trim();
    const appendValue = trimmed === 'nil'
      ? ''
      : trimmed.replace(/^(['"])([\s\S]*)\1$/, '$2');
    return new Ampersand(appendValue, {}, loc) as unknown as JessNode;
  }

  /** Port of selectors.ts getAmpersandTemplateValue (reference parser). */
  private _ampersandTemplateValue(image: string): string | undefined {
    if (image === '&') {
      return undefined;
    }
    if (image.startsWith('&')) {
      return image.slice(1) || undefined;
    }
    if (image.includes('&')) {
      return image;
    }
    return undefined;
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
    const isFlag = (c: unknown): c is string => typeof c === 'string' && /^!?all$/.test(c);
    const hasFlag = comps.some(c => isFlag(c.comp));
    const flag = hasFlag ? ExtendFlag.All : ExtendFlag.Exact;
    const targetComp = comps.find(c => !isFlag(c.comp))?.comp;
    const target = (typeof targetComp === 'string'
      ? this._makeBasicSelector(targetComp, loc) as unknown as Selector
      : (targetComp ?? this._makeBasicSelector('&', loc)) as unknown as Selector);
    return new Extend({ target, flag }, {}, loc) as unknown as JessNode;
  }

  /**
   * `:extend( … )` pseudo form (selectors.ts `extend`): groups its ExtendTarget
   * children. Targets sharing one flag collapse to a single Extend whose target is
   * a SelectorList (or the lone selector); mixed flags stay as one Extend each,
   * returned in a List. Mirrors mergeExtends' target-and-flag grouping.
   */
  private _buildExtendPseudo(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const targets = nodeChildren(children).filter(n => n.type === 'Extend') as unknown as Array<{
      target: Selector; flag: number;
    }>;
    if (targets.length === 0) {
      return new Extend({ target: this._makeBasicSelector('&', loc), flag: ExtendFlag.Exact }, {}, loc) as unknown as JessNode;
    }
    const firstFlag = targets[0]!.flag;
    const allSameFlag = targets.every(t => t.flag === firstFlag);
    if (allSameFlag) {
      const target = targets.length === 1
        ? targets[0]!.target
        : this._makeSelectorList(targets.map(t => t.target) as any, loc) as unknown as Selector;
      return new Extend({ target, flag: firstFlag }, {}, loc) as unknown as JessNode;
    }
    const extendNodes: JessNode[] = targets.map(t =>
      new Extend({ target: t.target, flag: t.flag }, {}, loc) as unknown as JessNode
    );
    return new List(extendNodes as any, {}, loc) as unknown as JessNode;
  }

  /**
   * `&:extend( … );` (or bare `:extend( … );`) statement form (selectors.ts
   * `ampersandExtend`). The ExtendPseudo child already carries the grouped
   * Extend(s); the leading `&` is just the statement marker.
   */
  private _buildExtendStatement(
    children: ReadonlyArray<Child>, _raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    const built = nodeChildren(children).find(n => n.type === 'Extend' || n.type === 'List');
    return (built ?? new Extend({ target: this._makeBasicSelector('&', loc), flag: ExtendFlag.Exact }, {}, loc)) as unknown as JessNode;
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
      // Empty `[]` — no inner content, or an empty `Any` placeholder → index key -1.
      if (!innerVal
        || (typeof innerVal === 'object' && (innerVal as any).type === 'Any'
          && !String((innerVal as any).value ?? '').trim())) {
        return -1;
      }
      if (typeof innerVal === 'string') {
        rawText = innerVal.trim();
      } else if (typeof innerVal === 'object'
        && (innerVal as any).type === 'Reference' && typeof (innerVal as any).key === 'string') {
        rawText = '@' + (innerVal as any).key;
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
      return new Quoted(interp, {}, loc) as unknown as JessNode;
    }
    // `@name` → variable lookup; key is the bare name (a string).
    if (rawText.startsWith('@')) {
      return rawText.slice(1);
    }
    // `$name` (property reference) or bare `name` (index) → Quoted(name); the `$`
    // property marker is dropped.
    return new Quoted(rawText.replace(/^\$/, ''), {}, loc) as unknown as JessNode;
  }

  protected override _assembleSegment(seg: Spanned[], loc: LocationInfo): Component {
    const result = super._assembleSegment(seg, loc);
    const isNsNameEarly = (c: unknown): c is string =>
      typeof c === 'string' && /^[#.]-?[_a-zA-Z]/.test(c.trim());
    if (!Array.isArray(result)) {
      // A lone `#ns.mixin` / `.mixin` string in declaration-value position is a
      // mixin-ruleset name Reference — not a raw string. Faithful to the reference
      // `mixinReference`→`mixinName` (asReference:true). (The var-decl namespace path
      // does this too via _tryParseNamespaceRef.)
      if (isNsNameEarly(result)) {
        const segs = (result as string).trim().match(/[#.][^#.]*/g) ?? [(result as string).trim()];
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
      typeof c === 'string' && /^[#.]-?[_a-zA-Z-￿]/.test(c.trim());
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
    const splitNsToken = (s: string): string[] => s.match(/[#.][^#.]*/g) ?? [s];
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
        base = new Reference(
          { target: base as any, key: innerKey as any } as unknown as ReferenceValue,
          { type: 'variable' as const }, loc
        ) as unknown as JessNode;
        i++;
      } else if (isRoundParen(item)) {
        const innerContent = (item as any).value ?? (item as any).node;
        const isEmpty = !innerContent || (innerContent.type === 'Any' && !String(innerContent.value ?? '').trim());
        const argsNode = isEmpty ? null : this._parenToArgs(item, loc);
        const callPayload: Record<string, unknown> = { name: base };
        if (argsNode) {
          callPayload.args = argsNode;
        }
        base = new Call(callPayload as any, {}, loc) as unknown as JessNode;
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
      return new Any('', { role: 'ident' }, loc) as unknown as JessNode;
    }
    const n = inner as unknown as { _options?: Record<string, unknown> };
    n._options = { ...(n._options ?? {}), escaped: true };
    return inner;
  }

  // `@{colorVar}` / `pre-@{x}` in value position. Port of `processValueToken`'s
  // InterpolatedIdent branch: getInterpolatedOrString → Interpolated (role=ident),
  // or a plain Any(role=ident) when the run resolves to a bare string.
  private _buildInterpValue(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo): JessNode {
    const items = spannedComponents(raw);
    const image = items.map(i => (typeof i.comp === 'string' ? i.comp : '')).join('');
    const result = getInterpolatedOrString(image, loc);
    if (typeof result === 'string') {
      return new Any(result, { role: 'ident' }, loc) as unknown as JessNode;
    }
    return result as unknown as JessNode;
  }

  protected override _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const call = super._buildCall(rawChildren, loc) as unknown as {
      name: unknown; args: unknown; _options?: Record<string, unknown>;
    };
    const key = typeof call.name === 'string' ? call.name : '';
    const nameRef = new Reference(key, { type: 'function', fallbackValue: true } as any, loc);
    const next = new Call({ name: nameRef as any, args: call.args as any }, { silentFail: true } as any, loc);
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
      const value = valueNodes.length === 1 && valueNodes[0]!.type === 'Sequence'
        ? valueNodes[0]!
        : new Sequence(valueNodes as any, undefined, loc);
      return new CustomDeclaration({ name: name as any, value: value as any }, undefined, loc);
    }
    const valueText = ls.slice(2).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new CustomDeclaration({ name: name as any, value: new Any(valueText, {}, loc) as any }, undefined, loc);
  }

  /**
   * `--foo: { color: @a; }` — a curly-brace custom-property value whose body
   * opportunistically structured as a declaration list (customCurlyBlock in the
   * grammar), so nested `@var`/calls evaluate normally instead of staying opaque
   * text. Wrapped in a Block(type: 'curly') so `{`/`}` re-render around it.
   */
  private _buildLessCustomBlock(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const bodyNodes = nodeChildren(children);
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
    const at = value.match(/@[a-zA-Z][\w-]*/);
    if (at && !value.includes('@{')) {
      this._warn(
        `"${at[0]}" in custom property values is treated as literal text. Use @{${at[0].slice(1)}} for interpolation.`,
        'variable-in-unknown-value'
      );
    }
    const dollar = value.match(/\$[a-zA-Z][\w-]*/);
    if (dollar && !value.includes('${')) {
      this._warn(
        `"${dollar[0]}" in custom property values is treated as literal text. Use \${${dollar[0].slice(1)}} for interpolation.`,
        'property-in-unknown-value'
      );
    }
  }

  private _warnAtRulePreludeVars(span: Span) {
    const text = this._source.slice(span.start, span.end);
    const brace = text.indexOf('{');
    const prelude = (brace >= 0 ? text.slice(0, brace) : text).replace(/^\s*@-?[\w-]+/, '');
    const at = prelude.match(/@[a-zA-Z][\w-]*/);
    if (at && !prelude.includes('@{')) {
      this._warn(
        `"${at[0]}" in at-rule preludes is deprecated. Use @{${at[0].slice(1)}} for interpolation.`,
        'at-rule-prelude-variable'
      );
    }
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
      const src = this._source.slice(loc[0], loc[3]);
      if (/^\S+\s+\(/.test(src)) {
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
    const nameNode = new Any(name, { role: 'ident' }, loc);
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
    if (!hasArgs && KNOWN_AT_RULE_VAR_NAME_RE.test(name)) {
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

  private _buildMixinArgs(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    // The grammar (sepBy + scanTo) has already split the args at top-level `,`/`;`
    // (respecting nested ()/[]/{}/strings) — walk the chunks/separators into
    // `;`-groups of `,`-separated chunks. No string _splitTopLevel.
    const groups: string[][] = [[]];
    let semicolonMode = false;
    for (const l of ls) {
      const v = l.value;
      if (v === '(' || v === ')') {
        continue;
      }
      if (v === ';') {
        semicolonMode = true;
        groups.push([]);
        continue;
      }
      if (v === ',') {
        continue;
      }            // chunk separator within the current group
      const t = v.trim();
      if (t) {
        groups[groups.length - 1]!.push(t);
      }
    }
    if (groups.every(g => g.length === 0)) {
      return new List([] as any, {} as any, loc);
    }
    if (!semicolonMode) {
      // comma mode → each chunk is its own arg.
      const items = groups[0]!.map(p => p.trim()).filter(Boolean)
        .map(p => this._mixinParamPart(p, loc));
      return new List(items as any, { sep: ',' } as any, loc);
    }
    // Semicolon mode → each `;`-group is ONE arg. Its comma-chunks are NOT separate
    // args: they are a value-list belonging to that one arg. Mirrors the reference
    // `mixinArgList` collapse (guards.ts): a leading named param (`@x: v`) folds its
    // trailing comma-chunks into a value List; a group of bare values becomes a List.
    // The only illegal `,`-in-`;` mix is two or more PARAM chunks in one group —
    // a bare `@name` or a named `@name: v`. (Reference `hasDeclarations`: a group
    // with 2+ VarDeclarations raises "Cannot mix ; and , as delimiter types".)
    // A trailing bare value (`@a: d, e` → the `e`) is not a param, so it is fine.
    const isParam = (c: string) => /^@[\w-]+\s*(?::|$)/.test(c);
    const items: JessNode[] = [];
    for (const group of groups) {
      const chunks = group.map(c => c.trim()).filter(Boolean);
      if (chunks.length === 0) {
        continue;
      }
      if (chunks.filter(isParam).length >= 2) {
        this._error('Cannot mix ; and , as delimiter types in mixin arguments', loc[0]);
      }
      if (chunks.length === 1) {
        items.push(this._mixinParamPart(chunks[0]!, loc));
        continue;
      }
      const head = this._mixinParamPart(chunks[0]!, loc);
      const tail = chunks.slice(1).map(c => this._mixinParamPart(c, loc));
      if (head.type === 'VarDeclaration') {
        // Named param: fold its trailing comma-chunks into the param's value List.
        const decl = head as unknown as VarDeclaration;
        const headVal = decl.value as unknown as JessNode | undefined;
        const valueNodes = headVal && headVal.type !== 'Nil' ? [headVal, ...tail] : tail;
        const valueList = new List(valueNodes as any, undefined as any, loc);
        items.push(new VarDeclaration(
          { name: decl.name as any, value: valueList as any } as any,
          decl.options as VarDeclarationOptions,
          loc
        ) as unknown as JessNode);
      } else {
        // Unnamed value-list arg.
        items.push(new List([head, ...tail] as any, undefined as any, loc) as unknown as JessNode);
      }
    }
    return new List(items as any, { sep: ';' } as any, loc);
  }

  private _mixinParamPart(part: string, loc: LocationInfo): JessNode {
    if (part.startsWith('...')) {
      const restName = part.slice(3).replace(/^\$/, '');
      return new Rest(restName, {}, loc) as unknown as JessNode;
    }
    // @varname... → Rest parameter
    if (/^@.+\.\.\.$/.test(part)) {
      const restName = part.slice(1, -3).trim();
      return new Rest(restName, {}, loc) as unknown as JessNode;
    }
    // @varname or @varname: default → VarDeclaration
    if (part.startsWith('@')) {
      const colonIdx = part.indexOf(':');
      if (colonIdx >= 0) {
        const nameStr = part.slice(1, colonIdx).trim();
        const defaultText = part.slice(colonIdx + 1).trim();
        const nameNode = new Any(nameStr, { role: 'property' }, loc) as unknown as JessNode;
        const valueNode = defaultText
          ? new Any(defaultText, { role: 'ident' }, loc) as unknown as JessNode
          : new Nil('', {}, loc) as unknown as JessNode;
        return new VarDeclaration(
          { name: nameNode as any, value: valueNode as any } as any,
          {} as VarDeclarationOptions,
          loc
        ) as unknown as JessNode;
      }
      const nameStr = part.slice(1).trim();
      const nameNode = new Any(nameStr, { role: 'property' }, loc) as unknown as JessNode;
      return new VarDeclaration(
        { name: nameNode as any, value: new Nil('', {}, loc) as unknown as JessNode as any } as any,
        {} as VarDeclarationOptions,
        loc
      ) as unknown as JessNode;
    }
    const esc = /^~\(([\s\S]*)\)$/.exec(part);
    if (esc) {
      const innerItems = this._splitTopLevel(esc[1]!, ',')
        .map(s => new Any(s.trim(), { role: 'ident' }, loc));
      const innerList = new List(innerItems as any, undefined as any, loc);
      return new Paren(innerList as any, { escaped: true } as any, loc) as unknown as JessNode;
    }
    if (this._splitTopLevel(part, ',').length > 1) {
      const innerItems = this._splitTopLevel(part, ',')
        .map(s => new Any(s.trim(), { role: 'ident' }, loc));
      return new List(innerItems as any, undefined as any, loc) as unknown as JessNode;
    }
    if (/^[a-zA-Z]/.test(part) && CSS_COLOR_NAMES.has(part.toLowerCase())) {
      return new Color({ node: part } as any, {} as any, loc) as unknown as JessNode;
    }
    const spaceParts = part.split(/\s+/).filter(Boolean);
    if (spaceParts.length > 1) {
      const items = spaceParts.map(s => new Any(s, { role: 'ident' }, loc) as unknown as JessNode);
      return new Sequence(items as any, undefined, loc) as unknown as JessNode;
    }
    return new Any(part, { role: 'ident' }, loc) as unknown as JessNode;
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
    if (!argsList || argsList.type !== 'List') {
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

  private _splitTopLevel(text: string, sep: string): string[] {
    const out: string[] = [];
    let depth = 0, quote = '', start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (quote) {
        if (ch === quote) {
          quote = '';
        }
        continue;
      }
      if (ch === '"' || ch === '\'') {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === sep && depth === 0) {
        out.push(text.slice(start, i));
        start = i + 1;
      }
    }
    out.push(text.slice(start));
    return out;
  }

  private _buildAnonMixin(children: ReadonlyArray<Child>, loc: LocationInfo) {
    // `.(@p) { … }` → a nameless Mixin (reference `anonymousMixinDefinition`,
    // selectors.ts: `new Mixin({ params, rules })`), NOT a `.`-selector Ruleset.
    // The MixinArgs sub-node is the param List; everything else is the body.
    const nodes = nodeChildren(children);
    const argsList = nodes.find(n => n.type === 'List');
    const rules = nodes.filter(n => n !== argsList);
    const params = (argsList as unknown as { value?: unknown[] })?.value?.length
      ? argsList as unknown as List<Node>
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
    return new Mixin({ rules: ruleNodes } as any, {}, loc);
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
      { name: new Any(name, { role: 'property' }, loc), value: new Any('', { role: 'any' }, loc) } as any,
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
      const braceIdx = this._source.indexOf('{', loc[0]);
      const bodyStart = braceIdx >= 0 ? braceIdx + 1 : loc[0];
      const closeIdx = this._source.lastIndexOf('}', loc[3] - 1);
      const bodyEnd = closeIdx >= bodyStart ? closeIdx : loc[3];
      const ruleNodes = this._liftStandaloneComments(rawRuleNodes as any, bodyStart, bodyEnd, loc);
      if (hasExplicitParens) {
        // Has explicit parens -- it's a Mixin definition
        const nameNode = new Any(name, { role: 'name' }, loc) as unknown as Any<'name'>;
        const guardText = guard !== undefined ? (guard as any).toTrimmedString?.() ?? '' : '';
        const hasDefault = guardText.includes('default');
        const nonEmptyParams = (argsList as unknown as { value?: unknown[] })?.value?.length
          ? argsList as unknown as List<Node>
          : undefined;
        return new Mixin(
          { name: nameNode, params: nonEmptyParams, rules: ruleNodes, guard: guard as any },
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
      const src = this._source.slice(loc[0], loc[3]);
      if (/^\S+\s+\(/.test(src)) {
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
    return false;
  }

  private _treeHasExtend(node: JessNode): boolean {
    if (node instanceof Extend) {
      return true;
    }
    if (node instanceof CompoundSelector || node instanceof ComplexSelector) {
      return node.value.some(p => this._treeHasExtend(p as JessNode));
    }
    if (node.type === 'SelectorList') {
      const val = (node as unknown as { value?: JessNode[] }).value ?? [];
      return val.some(p => this._treeHasExtend(p));
    }
    return false;
  }

  protected override _buildRuleset(
    children: ReadonlyArray<Child>,
    rawChildren: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const base = super._buildRuleset(children, rawChildren, loc);
    const selector = base.selector;
    if (!selector) {
      return base;
    }
    if (typeof selector === 'string') {
      return base;
    }
    if (this._selectorHasNestedExtend(selector as unknown as JessNode)) {
      this._error(':extend() is not allowed inside a pseudo-class selector', loc[0]);
    }
    const baseRules = Array.isArray(base.rules) ? base.rules as JessNode[] : [];

    const extendKey = (e: JessNode): string => {
      const ext = e as unknown as { target?: { valueOf?(): unknown }; flag?: unknown };
      return `${String(ext.target?.valueOf?.() ?? ext.target)}:${ext.flag}`;
    };

    // Non-SelectorList: simple single-selector extraction.
    if (!(selector instanceof SelectorList)) {
      const { cleanedSelector, extractedExtends } = this._extractExtendsFromSelector(
        selector as unknown as JessNode, loc
      );
      if (extractedExtends.length === 0) {
        return base;
      }
      return new Ruleset(
        { selector: cleanedSelector as any, rules: [...extractedExtends, ...baseRules] },
        undefined, loc
      ) as unknown as Ruleset;
    }

    // SelectorList: extract extends per selector, then decide structure.
    // Also normalize string items to BasicSelector for proper serialization.
    const perSelector: Array<{ clean: JessNode | string | undefined; extends: JessNode[] }> = [];
    let anyExtends = false;
    let anyNormalized = false;
    for (const item of selector.value) {
      const normalized = typeof item === 'string'
        ? this._makeBasicSelector(item as string, loc) as unknown as JessNode
        : item as unknown as JessNode;
      if (normalized !== item) {
        anyNormalized = true;
      }
      const { cleanedSelector: cs, extractedExtends: ee } = this._extractExtendsFromSelector(normalized, loc);
      perSelector.push({ clean: cs, extends: ee });
      if (ee.length > 0) {
        anyExtends = true;
      }
    }

    if (!anyExtends) {
      if (!anyNormalized) {
        return base;
      }
      // No extends, but string items were normalized — rebuild with BasicSelector items.
      const normalizedItems = perSelector.map(s => s.clean).filter(Boolean);
      const combinedSel = normalizedItems.length === 1
        ? normalizedItems[0]!
        : this._makeSelectorList(normalizedItems as any, loc);
      return new Ruleset(
        { selector: combinedSel as any, rules: baseRules },
        undefined, loc
      ) as unknown as Ruleset;
    }

    // If all selectors share identical extend sets → flat Ruleset, deduplicated extends.
    const allExtendKeys = perSelector.map(s => s.extends.map(extendKey).sort().join('|'));
    const allSame = allExtendKeys.every(k => k === allExtendKeys[0]!);

    if (allSame) {
      const uniqueExtends = perSelector[0]!.extends;
      const cleanedItems = perSelector.map(s => s.clean).filter(Boolean);
      const combinedSel = cleanedItems.length === 1
        ? cleanedItems[0]!
        : this._makeSelectorList(cleanedItems as any, loc);
      return new Ruleset(
        { selector: combinedSel as any, rules: [...uniqueExtends, ...baseRules] },
        undefined, loc
      ) as unknown as Ruleset;
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
          {}, loc
        ) as unknown as JessNode);
      }
      if (clean !== undefined) {
        cleanedItems.push(clean);
      }
    }

    const combinedSel = cleanedItems.length === 1
      ? cleanedItems[0]!
      : this._makeSelectorList(cleanedItems as any, loc);

    wrapperRules.push(new Ruleset(
      { selector: combinedSel as any, rules: baseRules },
      undefined, loc
    ) as unknown as JessNode);

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
          // Single string part → wrap as BasicSelector so serializeTypes shows the type
          ? (typeof newParts[0] === 'string'
              ? this._makeBasicSelector(newParts[0], loc) as unknown as JessNode
              : newParts[0] as JessNode)
          : new CompoundSelector(newParts, undefined, loc) as unknown as JessNode;
      return { cleanedSelector, extractedExtends };
    }

    // ComplexSelector: recurse into its CompoundSelector components and pull out
    // any trailing Extend / List<Extend> (the `:extend(...)` pseudo lives at the
    // end of the complex selector — see grammar's LessComplexSelector).
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
        // Single leftover part → unwrap; wrap a bare string as BasicSelector so
        // serializeTypes shows the selector type (mirrors the CompoundSelector branch).
        ? (typeof newParts[0] === 'string'
            ? this._makeBasicSelector(newParts[0], loc) as unknown as JessNode
            : newParts[0] as JessNode)
        : new ComplexSelector(newParts as any, undefined, loc) as unknown as JessNode;
      return { cleanedSelector: newComplex, extractedExtends: allExtends };
    }

    // SelectorList: extract from each item, normalizing string items to BasicSelector.
    if (selector instanceof SelectorList) {
      const allExtends: JessNode[] = [];
      const cleanedItems: any[] = [];
      let changed = false;
      for (const item of selector.value) {
        const { cleanedSelector: cs, extractedExtends: ee } = this._extractExtendsFromSelector(
          typeof item === 'string' ? this._makeBasicSelector(item, loc) as unknown as JessNode : item as any,
          loc
        );
        allExtends.push(...ee);
        if (ee.length > 0 || typeof item === 'string') {
          changed = true;
        }
        if (cs !== undefined) {
          cleanedItems.push(cs);
        }
      }
      if (!changed) {
        return { cleanedSelector: selector, extractedExtends: [] };
      }
      if (allExtends.length === 0) {
        // No extends, but strings were normalized to BasicSelector
        const newSel = cleanedItems.length === 1
          ? cleanedItems[0] as JessNode
          : this._makeSelectorList(cleanedItems, loc) as unknown as JessNode;
        return { cleanedSelector: newSel, extractedExtends: [] };
      }
      const newSel = cleanedItems.length === 1
        ? cleanedItems[0] as JessNode
        : this._makeSelectorList(cleanedItems, loc) as unknown as JessNode;
      return { cleanedSelector: newSel, extractedExtends: allExtends };
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
    const preludeText = this._source.slice(loc[0], loc[3]);
    const optMatch = /^\s*\(([^)]+)\)/.exec(preludeText.replace(/^@import\s*/, ''));
    const opts: string[] = optMatch ? optMatch[1]!.split(',').map(s => s.trim()) : [];
    const ls2 = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const builtNodes = nodeChildren(children);
    const quotedNode = builtNodes.find(n => n.type === 'Quoted') as unknown as { quote?: '"' | '\''; value?: unknown } | undefined;
    let pathNode: Quoted | undefined;
    if (quotedNode) {
      const quote = quotedNode.quote ?? '"';
      const inner = typeof quotedNode.value === 'string'
        ? quotedNode.value
        : (quotedNode.value as any)?.valueOf?.() ?? '';
      const innerNode = new Any(inner, { role: 'any' }, loc) as unknown as string;
      pathNode = new Quoted(innerNode, { quote }, loc);
    } else {
      // Fallback: extract path from preludeText (AtRuleStatement uses scanTo leaves)
      const _qm = preludeText.match(/(['"])([^'"]+)\1/);
      if (_qm) {
        const quote: '"' | '\'' = _qm[1] === '\'' ? '\'' : '"';
        const inner = _qm[2]!;
        const innerNode = new Any(inner, { role: 'any' }, loc) as unknown as string;
        pathNode = new Quoted(innerNode, { quote }, loc);
      }
    }
    let mediaNode: Node | undefined;
    {
      // Remove @name, (options), quoted path, and 'as namespace' to find media query
      let rest = preludeText.replace(/^@-?[_a-zA-Z][-_a-zA-Z0-9]*\s*/, '');
      rest = rest.replace(/^\([^)]*\)\s*/, '');
      rest = rest.replace(/(['"])[^'"]*\1\s*/, '');
      rest = rest.replace(/\bas\s+[^\s;(]+\s*/g, '');
      rest = rest.replace(/;\s*$/, '').trim();
      if (rest) {
        mediaNode = new Any(rest, { role: 'ident' }, loc) as unknown as Node;
      }
    }
    const pathMatch2 = /['"]([^'"]+)['"]/.exec(preludeText);
    const pathStr = pathMatch2 ? pathMatch2[1] : '';
    const isCssImport = pathStr ? LessGrammar._isCssUrl(pathStr, opts) : false;
    if (isCssImport || opts.includes('css')) {
      const nameAny = new Any(name, { role: 'atkeyword' }, loc) as unknown as Node;
      const preludeItems: JessNode[] = [];
      if (pathNode) {
        preludeItems.push(pathNode as unknown as JessNode);
      }
      // A plain (non-Less) import can carry a trailing media-query tail, same as
      // the StyleImport `postlude` option below — don't drop it here.
      if (mediaNode) {
        preludeItems.push(mediaNode as unknown as JessNode);
      }
      const prelude = new Sequence(preludeItems as any, undefined, loc);
      return new AtRuleStatement({ name: nameAny, prelude }, undefined, loc) as unknown as JessNode;
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
    return new StyleImport(
      { path: pathNode as any },
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
    const rawPreludeText = ls.slice(1).find(l => l.value !== '{' && l.value !== '}')?.value.trim();
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
    const nameNode = new Any(name, { role: 'atkeyword' }, loc);
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
    const keywordEnd = comps[0]?.span.end ?? loc[0];
    const braceComp = comps.find(c => c.comp === '{');
    const braceStart = braceComp?.span.start ?? loc[3];
    const preludeText = this._source.slice(keywordEnd, braceStart).trim();
    return this._buildAtRuleFromParts(name, preludeText || undefined, nodeChildren(children), loc);
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
        return new Quoted(es[2]!, { quote: es[1] as '\'' | '"', escaped: true }, loc) as unknown as JessNode;
      }
      const mv = singleVarRe.exec(w);
      if (mv) {
        return new Reference(mv[1]!, { type: 'index' as const, role: 'ident' as const }, loc) as unknown as JessNode;
      }
      if (MEDIA_KEYWORDS.has(w.toLowerCase())) {
        return new Any(w, { role: 'keyword' } as any, loc) as unknown as JessNode;
      }
      if (COMPARISON_OPS.has(w)) {
        return new Any(w, { role: 'operator' } as any, loc) as unknown as JessNode;
      }
      return new Any(w, { role: 'ident' } as any, loc) as unknown as JessNode;
    };

    const buildParen = (inner: string): JessNode => {
      const trimmed = inner.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0 && !/[><=!]/.test(trimmed.slice(0, colonIdx))) {
        const propName = trimmed.slice(0, colonIdx).trim();
        const propVal = trimmed.slice(colonIdx + 1).trim();
        const nameNode = new Any(propName, { role: 'property' } as any, loc) as unknown as JessNode;
        // A bare `@var` value normalizes to an indexed Reference (→ `$[var]`),
        // matching atRulePreludeBareVariableAs:'index' in productions/values.ts.
        const valueNode = singleVarRe.test(propVal)
          ? buildWord(propVal)
          : new Any(propVal, { role: 'ident' } as any, loc) as unknown as JessNode;
        const decl = new Declaration({ name: nameNode as any, value: valueNode as any }, undefined, loc);
        return new Paren(decl as any, undefined, loc) as unknown as JessNode;
      }
      const words = trimmed.split(/\s+/).filter(Boolean).map(w => buildWord(w));
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
          { key: vam[1]! } as unknown as ReferenceValue, {}, loc
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
          accKey = new Quoted(accInner, {}, loc) as unknown as JessNode;
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
                  {}, loc
                ) as unknown as JessNode;
              }
              argsNode = new List([argBase as unknown as Node] as any, undefined, loc) as unknown as JessNode;
            }
          }
          const callPayload: Record<string, unknown> = { name: base };
          if (argsNode) {
            callPayload.args = argsNode;
          }
          base = new Call(callPayload as any, {}, loc) as unknown as JessNode;
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
      return new QueryCondition(tokens as any, undefined, loc) as unknown as JessNode;
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
    const preludeText = this._source.slice(loc[0], loc[3]);
    const ls3 = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
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
      const innerNode = new Any(inner, { role: 'any' }, loc) as unknown as string;
      pathNode = new Quoted(innerNode, { quote }, loc);
    } else {
      // Fallback: extract from preludeText (AtRuleStatement uses scanTo, not Quoted node)
      const qm = /(['"])((?:[^'"\\]|\\.)*)\1/.exec(preludeText);
      if (qm) {
        const quote: '"' | '\'' = qm[1] === '\'' ? '\'' : '"';
        const inner = qm[2]!;
        rawPath = inner;
        const innerNode = new Any(inner, { role: 'any' }, loc) as unknown as string;
        pathNode = new Quoted(innerNode, { quote }, loc);
      }
    }
    const nsMatch = /\bas\s+([^\s;]+)/.exec(preludeText);
    const explicitNs = nsMatch?.[1];
    const isForward = name === '@-export';
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
    const nameAny = new Any(name, { role: 'atkeyword' }, loc) as unknown as Node;
    const preludeNode: JessNode | undefined = pathNode
      ? new Sequence([pathNode as unknown as JessNode] as any, undefined, loc) as unknown as JessNode
      : undefined;
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
    // Inner may be a Sequence node OR a raw Component array (e.g. [Reference, ':', 'bar'])
    const isSeq = inner && typeof inner === 'object' && inner.type === 'Sequence';
    const isRawArray = Array.isArray(inner);
    if (isSeq || isRawArray) {
      const rawSeq: unknown[] = isSeq ? ((inner as any).value ?? []) : (inner as unknown[]);
      // Normalize bare strings to real Any(role:'ident') nodes so both the ':' / @var
      // detection and the value-node construction below operate on real nodes.
      const seqItems: JessNode[] = rawSeq.map(it =>
        typeof it === 'string'
          ? (new Any(it.trim(), { role: 'ident' }, loc) as unknown as JessNode)
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
          const nameAny = new Any(varName, { role: 'property' }, loc) as unknown as JessNode;
          const valNode = seqItems[j + 2]!;
          const valueNode = valNode.type === 'Any'
            ? valNode
            : new Any(String((valNode as any).value ?? ''), { role: 'ident' }, loc) as unknown as JessNode;
          const vd = new VarDeclaration(
            { name: nameAny as any, value: valueNode } as any,
            {} as VarDeclarationOptions,
            loc
          );
          items.push(vd as unknown as JessNode);
          j += 3;
        } else {
          items.push(item);
          j++;
        }
      }
    } else if (inner) {
      const isEmptyAny = inner.type === 'Any' && !String((inner as any).value ?? '').trim();
      if (!isEmptyAny) {
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
      typeof s === 'string' && /^[#.]-?[_a-zA-Z\u0080-\uffff]/.test(s.trim());
    const isCombinator = (s: unknown): s is string =>
      typeof s === 'string' && /^[>+~|]$|^\|\|$/.test(String(s).trim());
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
        const splitSeg = seg.match(/[#.][^#.]*/g) ?? [seg];
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
        base = new Reference(
          { target: base as any, key: innerKey as any } as unknown as ReferenceValue,
          { type: 'variable' as const }, loc
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
        base = new Call(callPayload as any, {}, loc) as unknown as JessNode;
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
            const argRefMatch = /^([.#][^\[\]()\s]+)(\[([^\]]*)\])?$/.exec(callInner);
            if (argRefMatch) {
              const argSel = argRefMatch[1]!;
              const argAccContent = argRefMatch[3]; // may be undefined or empty string
              let argBase: JessNode = new Reference(
                { key: argSel } as unknown as ReferenceValue,
                { role: 'name' } as any, loc
              ) as unknown as JessNode;
              if (argRefMatch[2] !== undefined) {
                const argAccKey: string | number = argAccContent === undefined || argAccContent === ''
                  ? -1
                  : (argAccContent.startsWith('@') ? argAccContent.slice(1) : argAccContent);
                argBase = new Reference(
                  { target: argBase as any, key: argAccKey as any } as unknown as ReferenceValue,
                  {}, loc
                ) as unknown as JessNode;
              }
              argsNode = new List([argBase as unknown as Node] as any, undefined, loc) as unknown as JessNode;
            }
          }
          const callPayload: Record<string, unknown> = { name: base as any };
          if (argsNode) {
            callPayload.args = argsNode;
          }
          base = new Call(callPayload as any, {}, loc) as unknown as JessNode;
        }
      }

      // Step 2: Check for [accessor] suffix
      const accMatch = /^\[([^\]]*)\]/.exec(afterVal);
      if (accMatch) {
        const accText = accMatch[1]!.trim();
        let accessorKey: JessNode | string | number;
        if (accText === '') {
          accessorKey = -1;
        } else if (accText.startsWith('@')) {
          accessorKey = accText.slice(1);
        } else {
          accessorKey = new Quoted(accText, {}, loc) as unknown as JessNode;
        }
        base = new Reference(
          { target: base as any, key: accessorKey as any } as unknown as ReferenceValue,
          {}, loc
        ) as unknown as JessNode;
        const afterAcc = afterVal.slice(accMatch[0].length).trimStart();
        if (/^\(\s*\)/.test(afterAcc)) {
          base = new Call({ name: base as any } as any, {}, loc) as unknown as JessNode;
        }
      } else if (!hasMidCall) {
        // Step 3: Check for trailing () (simple empty call)
        const callMatch = /^\(\s*\)/.exec(afterVal);
        if (callMatch) {
          base = new Call({ name: base as any } as any, {}, loc) as unknown as JessNode;
        }
      }
    }

    return base;
  }

  private _assembleLessValue(
    valItems: Spanned[],
    loc: LocationInfo
  ): { value: JessNode | string } {
    const parts: JessNode[] = [];
    for (const item of valItems) {
      const c = item.comp;
      if (typeof c === 'string') {
        if (c.trim()) {
          parts.push(new Any(c.trim(), { role: 'ident' }, loc) as unknown as JessNode);
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
    return { value: new Sequence(parts as any, undefined, loc) as unknown as JessNode };
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
