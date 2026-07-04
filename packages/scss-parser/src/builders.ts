/**
 * ScssGrammar — Parséman-based SCSS parser, extending LessGrammar.
 *
 * Adds SCSS-specific grammar on top of Less (which in turn extends CSS):
 *   - Variable declarations: $var: value [!default|!global];  →  VarDeclaration
 *   - Variable references:   $var                             →  Reference
 *   - Line comments:         // ...  (added to rw trivia)
 *
 * Inherits from LessGrammar:
 *   - Nested rulesets, & ampersand, relative selectors
 *   - anyDeclaration entry point
 *   - atRuleBody, declarationList, Stylesheet overrides
 *   - Less merge operators on Declaration (harmless for SCSS)
 *
 * Chevrotain note: in the Chevrotain architecture, ScssRecursiveParser
 * extends CssRecursiveParser independently of LessRecursiveParser.
 * Here we take the Parséman inheritance chain
 * CssParser → LessGrammar → ScssGrammar to maximise code reuse.
 */

import {
  sequence,
  choice,
  optional,
  regex,
  literal
} from 'parseman';
import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import { LessGrammar } from '@jesscss/less-parser';
import { spannedComponents } from '@jesscss/css-parser';

import {
  type Node,
  type LocationInfo,
  type TreeContext,
  Any,
  VarDeclaration, type VarDeclarationOptions, type AssignmentType,
  Reference,
  Rules,
  Condition, type ConditionOperator,
  Paren,
  If,
  For,
  While,
  Nil,
  Sequence,
  Mixin,
  Call,
  Rest,
  List,
  F_VISIBLE,
  Func,
  Interpolated,
  InterpolatedSelector,
  CustomDeclaration,
  Quoted,
  INTERPOLATION_PLACEHOLDER,
  isNode,
  N,
  Collection,
  Declaration,
  Expression,
  Operation,
  StyleImport,
  JsImport,
  Extend,
  ExtendFlag,
  AtRuleStatement,
  AtRule,
  Log,
  Ruleset,
  Log,
  SelectorCapture,
  type Selector
} from '@jesscss/core';
import {
  buildScssInterpolatedFromString,
  toInterpReplacement
} from './interp.js';
import {
  quotedLike,
  isPlainCssImportPrelude,
  validateExtendTarget,
  checkForwardPreludeErrors,
  isPlaceholderExtendTarget,
  isScriptUsePath,
  defaultNamespaceFromPath
} from './scss-atrule-helpers.js';
import {
  lowerPlainAtRootRules,
  prefixAtRootSelector
} from './scss-atroot-helpers.js';
import { parseSelectorListExpression } from './productions/helpers.js';
import {
  desugarMapLookup,
  desugarNamespacedCall,
  makeNamespacedReference,
  toDeclKey
} from './scss-value-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JessNode = Node<any, any>;
type Child = JessNode | CSTLeaf | CSTError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function spanToLocation(span: Span): LocationInfo {
  return [span.start, 0, 0, span.end, 0, 0];
}

function nodeChildren(children: ReadonlyArray<Child>): JessNode[] {
  return children.filter((c): c is JessNode => c != null && c._tag === 'node') as JessNode[];
}

// ---------------------------------------------------------------------------
// ScssGrammar
// ---------------------------------------------------------------------------

export class ScssGrammar extends LessGrammar {
  // ── Override rw to include // line comments ───────────────────────────────
  // Must be declared BEFORE _trivia so the field initializer captures this rw.
  rw = regex(/(?:[ \t\n\r\f]+|\/\/[^\n\r]*|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
  protected _trivia = this.rw;
  protected _parseContext?: TreeContext;

  setContext(context?: TreeContext) {
    this._parseContext = context;
  }

  // ── SCSS $variable token ──────────────────────────────────────────────────
  scssVar = regex(/\$-?[_a-zA-Z-￿][-_a-zA-Z0-9-￿]*/);

  // ── VarDeclaration: $color: value [!default|!global]; ────────────────────
  // Overrides LessGrammar.VarDeclaration (which uses g.lessVar).
  VarDeclaration = (g: any) => sequence(
    g.scssVar,
    literal(':'),
    g.valueList,
    optional(choice(literal('!default'), literal('!global'))),
    optional(literal(';'))
  );

  // ── Reference: $var in value positions ───────────────────────────────────
  // Overrides LessGrammar.Reference (which used g.lessVar + optional accessor).
  Reference = (g: any) => g.scssVar;

  // ── buildNode ─────────────────────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/naming-convention */

  protected override buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    _state: unknown,
    _rawChildren: ReadonlyArray<{ _tag: string }>
  ): JessNode {
    const loc = spanToLocation(span);
    switch (type) {
      case 'VarDeclaration':    return this._buildScssVarDeclaration(_rawChildren, loc);
      case 'Reference':         return this._buildScssReference(children, loc);
      case 'ScssComparison':    return this._buildScssComparison(children, loc);
      case 'ScssCondInParens':  return this._buildScssCondInParens(children, loc);
      case 'ScssCondTerm':      return this._buildScssCondTerm(children, loc);
      case 'ScssCondAnd':       return this._buildScssCondJoin(children, loc, 'and');
      case 'ScssCondOr':        return this._buildScssCondJoin(children, loc, 'or');
      case 'ScssRules':         return this._buildScssRules(children, loc);
      case 'ScssIf':            return this._buildScssIf(children, loc);
      case 'ScssEach':          return this._buildScssEach(children, loc);
      case 'ScssFor':           return this._buildScssFor(children, loc);
      case 'ScssWhile':         return this._buildScssWhile(children, loc);
      case 'ScssCallArg':       return this._buildScssCallArg(children, loc);
      case 'ScssCallArgsInner': return this._buildScssCallArgsInner(children, loc);
      case 'ScssMixinParam':    return this._buildScssMixinParam(children, loc);
      case 'ScssMixinParams':   return this._buildScssMixinParams(children, loc);
      case 'ScssMixinName':     return this._buildScssMixinName(children, loc);
      case 'ScssDeclBody':      return this._buildScssRules(children, loc);
      case 'ScssMixin':         return this._buildScssMixin(children, loc);
      case 'ScssIncludeUsing':  return this._buildScssIncludeUsing(children, loc);
      case 'ScssInclude':       return this._buildScssInclude(children, loc);
      case 'ScssContent':       return this._buildScssContent(children, loc);
      case 'ScssFunction':      return this._buildScssFunction(children, loc);
      case 'ScssReturn':        return this._buildScssReturn(children, _rawChildren, loc);
      case 'ScssInterpBare':    return this._buildScssInterpBare(children, loc);
      case 'ScssInterpolatedName': return this._buildScssInterpolatedName(children, loc);
      case 'InterpValue':       return this._buildScssInterpValue(_rawChildren, loc);
      case 'InterpolatedSelector': return this._buildScssInterpolatedSelector(children, loc);
      case 'Declaration':       return this._buildScssDeclaration(children, loc, () =>
        super.buildNode(type, span, children, _state, _rawChildren));
      case 'CustomDeclaration': return this._buildScssCustomDeclaration(children, loc, () =>
        super.buildNode(type, span, children, _state, _rawChildren));
      case 'Quoted':            return this._buildQuoted(children, loc);
      case 'ScssMapPair':       return this._buildScssMapPair(children, loc);
      case 'ScssMapLiteral':    return this._buildScssMapLiteral(children, loc);
      case 'ScssIdentValue':    return this._buildScssIdentValue(children, _rawChildren, loc);
      case 'ScssWithConfigEntry': return this._buildScssWithConfigEntry(_rawChildren, loc);
      case 'ScssWithConfig':    return this._buildScssWithConfig(children, loc);
      case 'ScssUseAs':         return this._buildScssUseAs(children, loc);
      case 'ScssUse':           return this._buildScssUse(children, loc);
      case 'ScssForward':       return this._buildScssForward(children, _rawChildren, loc);
      case 'ScssPlaceholderSelector': return this._buildScssPlaceholderSelector(children, loc);
      case 'ScssPlaceholderRuleset': return this._buildRuleset(children, _rawChildren, loc);
      case 'ScssExtendTarget':  return this._buildScssExtendTarget(children, _rawChildren, loc);
      case 'ScssExtend':        return this._buildScssExtend(children, _rawChildren, loc);
      case 'ScssImportItem':    return this._buildScssImportItem(children, _rawChildren, loc);
      case 'ScssImportAtRule':  return this._buildScssImportAtRule(children, loc);
      case 'ScssNestedProps':   return this._buildScssNestedProps(children, loc);
      case 'ScssDiagnostic':    return this._buildScssDiagnostic(children, loc);
      case 'ScssAtRootFilter':  return this._buildScssAtRootFilter(children, loc);
      case 'ScssAtRootSelector': return this._buildScssAtRootSelector(children, loc);
      case 'ScssAtRootPlain':   return this._buildScssAtRootPlain(children, loc);
      case 'ScssScopeBlock':    return this._buildScssPermissiveAtRule(children, loc);
      case 'ScssLayerBlock':    return this._buildScssLayerBlock(children, loc);
      case 'Call':              return this._buildCall(_rawChildren, loc);
      case 'SquareParen':       return this._buildSquareParen(_rawChildren, loc);
      case 'Paren':             return this._buildScssParen(_rawChildren, loc);
      default:                  return super.buildNode(type, span, children, _state, _rawChildren);
    }
  }

  /* eslint-enable @typescript-eslint/naming-convention */

  // ── Private SCSS AST builders ─────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

  private _buildScssVarDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    // strings-not-nodes: name is the bare ident ($ stripped); value via the
    // shared CSS string-AST value builder.
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('$') ? rawName.slice(1) : rawName;
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === '!default' || c === '!global' || c === ';') {
        end = i;
        break;
      }
    }
    const { value } = this._assembleValue(items.slice(colonIdx + 1, end), loc);
    const hasImportant = items.some(i => i.comp === '!' || i.comp === '!default' || i.comp === '!global');
    return new VarDeclaration(
      { name, value, important: hasImportant || undefined } as any,
      {} as VarDeclarationOptions,
      loc
    );
  }

  private _buildScssReference(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const varName = ls[0]?.value ?? '';
    const key = varName.startsWith('$') ? varName.slice(1) : varName;
    return new Reference(key, { type: 'variable' }, loc);
  }

  // ── @if / @else conditions ─────────────────────────────────────────────────

  /**
   * `left [op right]` → Condition, or a bare operand when there is no operator.
   * `!=` desugars to `=` + negate (matches the Chevrotain scssComparison).
   */
  private _buildScssComparison(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const left = nodes[0] ?? new Any('', {}, loc);
    const opLeaf = ls.find(l => /^(?:==|!=|>=|<=|=|>|<)$/.test(l.value));
    if (!opLeaf || !nodes[1]) {
      return left as unknown as JessNode;
    }
    let op: string = opLeaf.value;
    let negate = false;
    if (op === '!=') {
      op = '=';
      negate = true;
    } else if (op === '==') {
      op = '=';
    }
    return new Condition(
      [left, op as ConditionOperator, nodes[1]],
      negate ? { negate: true } : {},
      loc
    ) as unknown as JessNode;
  }

  /**
   * Every condition term is wrapped in a Paren, matching the Chevrotain
   * `scssConditionInParens` production (both the `( … )` group and the bare
   * comparison / value branch wrap their result in a single Paren).
   */
  private _buildScssCondInParens(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const inner = nodeChildren(children)[0] ?? new Any('', {}, loc);
    return new Paren(inner as any, {}, loc) as unknown as JessNode;
  }

  /** Optional leading `not` negates the term. */
  private _buildScssCondTerm(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const inner = nodeChildren(children)[0] ?? new Any('', {}, loc);
    if (ls.some(l => /^not$/i.test(l.value))) {
      return new Condition([inner as any], { negate: true }, loc) as unknown as JessNode;
    }
    return inner as unknown as JessNode;
  }

  /** Fold a left-associative `and` / `or` chain of terms into Conditions. */
  private _buildScssCondJoin(children: ReadonlyArray<Child>, loc: LocationInfo, op: ConditionOperator) {
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

  /** A `{ … }` control-block body → Rules. */
  private _buildScssRules(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const rules = this._flattenScssImportLists(nodeChildren(children));
    return new Rules(rules, undefined, loc) as unknown as JessNode;
  }

  /**
   * `@if cond { … } (@else if cond { … })* (@else { … })?` → nested `If` chain.
   * Children arrive as alternating condition / Rules nodes, with an optional
   * trailing bare Rules (the final `@else`). Fold from the last branch inward.
   */
  private _buildScssIf(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const conditions: Node[] = [];
    const bodies: Rules[] = [];
    let elseBranch: Rules | undefined;
    let pendingCond: Node | undefined;
    for (const n of nodes) {
      if (n instanceof Rules) {
        if (pendingCond !== undefined) {
          conditions.push(pendingCond);
          bodies.push(n);
          pendingCond = undefined;
        } else {
          elseBranch = n;
        }
      } else {
        pendingCond = n;
      }
    }
    let elseNode: If | Rules | undefined = elseBranch;
    for (let i = conditions.length - 1; i >= 0; i--) {
      elseNode = new If(
        { condition: conditions[i]!, rules: bodies[i]!.rules, else: elseNode },
        undefined,
        loc
      );
    }
    return (elseNode ?? new Any('', {}, loc)) as unknown as JessNode;
  }

  // ── @each / @for / @while loops ───────────────────────────────────────────

  /** A `$name` loop-binding with no value (`paramVar` — prints as `$name`). */
  private _scssParamVar(varName: string, loc: LocationInfo): VarDeclaration {
    return new VarDeclaration(
      { name: new Any(varName, { role: 'property' }, loc), value: new Nil() },
      { paramVar: true },
      loc
    );
  }

  /**
   * `@each $a[, $b …] in <expr> { … }` → `For` with a node iterable.
   * Normalizes to Jess `$for ($a of …)` / `$for ([$a, $b] of …)`.
   */
  private _buildScssEach(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const body = nodes.find((n): n is Rules => n instanceof Rules)!;

    const vars: string[] = [];
    let pastEach = false;
    for (const l of ls) {
      if (/^@each/i.test(l.value)) {
        pastEach = true;
        continue;
      }
      if (pastEach && l.value === 'in') {
        break;
      }
      if (pastEach && l.value.startsWith('$')) {
        vars.push(l.value.slice(1));
      }
    }

    const iterableNodes = nodes.filter(n => n !== body);
    let iterable: Node = iterableNodes.length === 1
      ? iterableNodes[0]!
      : new Sequence(iterableNodes as any, undefined, loc);
    if ((iterable as any).type === 'Expression') {
      iterable = (iterable as any).value;
    }

    const decls = vars.map(v => this._scssParamVar(v, loc));
    const pattern = decls.length === 1
      ? { kind: 'single' as const, value: decls[0]! }
      : { kind: 'tuple' as const, values: decls as [VarDeclaration, ...VarDeclaration[]] };

    return new For(
      { pattern, iterable: { kind: 'node', value: iterable }, rules: body.rules },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  /**
   * `@for $i from <start> (to|through) <end> { … }` → `For` with a range iterable.
   * `through` is inclusive end; `to` is exclusive (`includeEnd: false`).
   */
  private _buildScssFor(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const includeEnd = ls.some(l => l.value === 'through');

    const varLeaf = ls.find(l => l.value.startsWith('$'));
    const varDecl = this._scssParamVar(varLeaf?.value.slice(1) ?? '', loc);

    const body = nodes.find((n): n is Rules => n instanceof Rules)!;
    const exprNodes = nodes.filter(n => n !== body);
    const startExpr = exprNodes[0] ?? new Any('', {}, loc);
    const endExpr = exprNodes[1] ?? new Any('', {}, loc);

    return new For(
      {
        pattern: { kind: 'single', value: varDecl },
        iterable: { kind: 'range', start: startExpr, end: endExpr, includeStart: true, includeEnd },
        rules: body.rules
      },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  /** `@while <cond> { … }` → `While`. */
  private _buildScssWhile(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const body = nodes.find((n): n is Rules => n instanceof Rules)!;
    const condition = nodes.find(n => n !== body) ?? new Any('', {}, loc);
    return new While({ condition, rules: body.rules }, undefined, loc) as unknown as JessNode;
  }

  // ── @mixin / @include / @content ───────────────────────────────────────────

  /** Build a module-qualified or plain mixin `Reference`. */
  private _buildScssMixinName(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const interp = nodes.find(n => isNode(n, N.Interpolated));
    if (interp) {
      return new Reference({ key: interp }, { type: 'mixin', role: 'name' }, loc) as unknown as JessNode;
    }
    const parts = children
      .filter((c): c is CSTLeaf => c._tag === 'leaf')
      .map(l => l.value)
      .filter(v => v !== '.');
    if (parts.length >= 2) {
      let ref: Reference = new Reference(parts[0]!, { type: 'variable' }, loc);
      for (let i = 1; i < parts.length; i++) {
        const isFinal = i === parts.length - 1;
        ref = new Reference(
          { target: ref, key: parts[i]! },
          { type: isFinal ? 'mixin' : 'index', ...(isFinal ? { role: 'name' as const } : {}) },
          loc
        );
      }
      return ref as unknown as JessNode;
    }
    return new Reference({ key: parts[0] ?? '' }, { type: 'mixin', role: 'name' }, loc) as unknown as JessNode;
  }

  /** `$x: val` keyword arg, `val...` spread, or plain value. */
  private _buildScssCallArg(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const varLeaf = ls.find(l => l.value.startsWith('$') && l.value !== '$');
    const hasColon = ls.some(l => l.value === ':');
    const hasSpread = ls.some(l => l.value === '...');
    if (varLeaf && hasColon) {
      const name = varLeaf.value.slice(1);
      const value = nodes.find(n => n !== undefined && !ls.includes(n as any)) ?? nodes[0] ?? new Nil();
      return new VarDeclaration(
        { name: new Any(name, { role: 'property' }, loc), value: value as Node },
        {},
        loc
      ) as unknown as JessNode;
    }
    const value = nodes[0] ?? new Any('', {}, loc);
    if (hasSpread) {
      return new Rest(value as Node, undefined, loc) as unknown as JessNode;
    }
    return value as unknown as JessNode;
  }

  private _buildScssCallArgsInner(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    if (nodes.length === 0) {
      return undefined as unknown as JessNode;
    }
    return new List(nodes as any, undefined, loc) as unknown as JessNode;
  }

  /** Mixin param: `...$rest`, `$rest...`, `$a: default`, or bare `$a`. */
  private _buildScssMixinParam(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const varLeaf = ls.find(l => l.value.startsWith('$'));
    const varName = varLeaf?.value.slice(1) ?? '';
    const hasPrefixEllipsis = ls[0]?.value === '...';
    const hasSuffixEllipsis = ls.some(l => l.value === '...' && ls.indexOf(l) > 0);
    if (hasPrefixEllipsis || hasSuffixEllipsis) {
      return new Rest(varName, undefined, loc) as unknown as JessNode;
    }
    const hasColon = ls.some(l => l.value === ':');
    if (hasColon && nodes[0]) {
      return new VarDeclaration(
        { name: new Any(varName, { role: 'property' }, loc), value: nodes[0] as Node },
        { paramVar: true },
        loc
      ) as unknown as JessNode;
    }
    return new Any(varName, { role: 'property' }, loc) as unknown as JessNode;
  }

  private _buildScssMixinParams(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    return new List(nodes as any, undefined, loc) as unknown as JessNode;
  }

  /** `@mixin name($params) { … }` → `Mixin` (inner vars default to private). */
  private _buildScssMixin(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const interpName = nodes.find(n => isNode(n, N.Interpolated));
    const nameLeaf = ls.find(l => !l.value.startsWith('@') && l.value !== '(' && l.value !== ')'
      && l.value !== '{' && l.value !== '}' && l.value !== ',');
    const name = interpName ?? new Any(nameLeaf?.value ?? '', { role: 'name' }, loc);
    const params = nodes.find(n => n.type === 'List') as List | undefined;
    const body = nodes.find((n): n is Rules => n instanceof Rules)!;
    return new Mixin(
      { name: name as Any<'name'>, params, rules: body.rules },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  /** `using ($c, $n)` param list for `@include … using (…)`. */
  private _buildScssIncludeUsing(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const vars = ls.filter(l => l.value.startsWith('$')).map(l => this._scssParamVar(l.value.slice(1), loc));
    return new List(vars as any, undefined, loc) as unknown as JessNode;
  }

  /**
   * `@include name(args) [using (…)] [ { … } ];` → `Call(Reference(type=mixin))`.
   * An optional content block becomes an anonymous visible `Mixin` on the call.
   */
  private _buildScssInclude(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const nodes = nodeChildren(children);
    const nameRef = nodes.find(n => n.type === 'Reference') as Reference | undefined;
    const lists = nodes.filter(n => n.type === 'List') as List[];
    const hasUsing = ls.some(l => l.value === 'using');
    let args: List | undefined;
    let usingParams: List | undefined;
    if (lists.length === 2) {
      args = lists[0];
      usingParams = lists[1];
    } else if (lists.length === 1) {
      if (hasUsing) {
        usingParams = lists[0];
      } else {
        args = lists[0];
      }
    }
    const contentRules = nodes.find((n): n is Rules => n instanceof Rules);
    let contentNode: Mixin | undefined;
    if (contentRules) {
      contentNode = new Mixin(
        { rules: contentRules.rules, params: usingParams },
        undefined,
        loc
      );
      contentNode.addFlags(F_VISIBLE);
    }
    return new Call(
      { name: nameRef ?? new Reference({ key: '' }, { type: 'mixin', role: 'name' }, loc), args, contentNode: contentNode as Node | undefined },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  /** `@content[(args)];` → `Call(Reference('content', type=mixin))`. */
  private _buildScssContent(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const args = nodes.find(n => n.type === 'List') as List | undefined;
    const ref = new Reference({ key: 'content' }, { type: 'mixin', role: 'name' }, loc);
    return new Call({ name: ref, args }, undefined, loc) as unknown as JessNode;
  }

  /** `@function name($params) { … }` → `Func` with `returnName: 'result'`. */
  private _buildScssFunction(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const interpName = nodes.find(n => isNode(n, N.Interpolated));
    const nameLeaf = ls.find(l => !l.value.startsWith('@') && l.value !== '(' && l.value !== ')'
      && l.value !== '{' && l.value !== '}' && l.value !== ',');
    const name = interpName ?? new Any(nameLeaf?.value ?? '', { role: 'name' }, loc);
    const params = nodes.find(n => n.type === 'List') as List | undefined;
    const body = nodes.find((n): n is Rules => n instanceof Rules)!;
    return new Func(
      { name: name as Any<'name'>, params, body },
      { returnName: 'result' },
      loc
    ) as unknown as JessNode;
  }

  /** `@return <value>;` → `$result: <value>;` */
  private _buildScssReturn(
    children: ReadonlyArray<Child>,
    rawChildren: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const items = spannedComponents(rawChildren);
    const semiIdx = items.findIndex(i => i.comp === ';');
    const valueItems = items.filter((i, idx) =>
      idx > 0 && i.comp !== '@return' && (semiIdx < 0 || idx < semiIdx)
    );
    const { value } = this._assembleValue(valueItems, loc);
    const name = new Any('result', { role: 'property' }, loc);
    return new VarDeclaration({ name, value: value as Node }, undefined, loc) as unknown as JessNode;
  }

  // ── Interpolation (#{…}) ───────────────────────────────────────────────────

  private _buildScssInterpBare(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const expr = nodeChildren(children)[0] ?? new Any('', {}, loc);
    return new Interpolated(
      { source: INTERPOLATION_PLACEHOLDER, replacements: [toInterpReplacement(expr as Node, loc)] },
      { role: 'any' },
      loc
    ) as unknown as JessNode;
  }

  /** `foo-#{$bar}` name segments → Interpolated(role=name) or plain Any. */
  private _buildScssInterpolatedName(children: ReadonlyArray<Child>, loc: LocationInfo) {
    let source = '';
    const replacements: Node[] = [];
    for (const c of children) {
      if (c._tag === 'leaf') {
        const v = (c as CSTLeaf).value;
        if (v === '#{' || v === '}' || v === '.') {
          continue;
        }
        source += v;
      } else if (c._tag === 'node' && isNode(c as JessNode, N.Interpolated)) {
        source += INTERPOLATION_PLACEHOLDER;
        replacements.push(...(c as Interpolated).replacements);
      }
    }
    if (replacements.length === 0) {
      return new Any(source, { role: 'name' }, loc) as unknown as JessNode;
    }
    return new Interpolated({ source, replacements }, { role: 'name' }, loc) as unknown as JessNode;
  }

  private _buildScssInterpValue(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(raw);
    const image = items.map(i => (typeof i.comp === 'string' ? i.comp : '')).join('');
    const result = buildScssInterpolatedFromString(image, loc, 'ident');
    return result as unknown as JessNode;
  }

  private _buildScssInterpolatedSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    let source = '';
    const replacements: Node[] = [];
    for (const c of children) {
      if (c._tag === 'leaf') {
        const v = (c as CSTLeaf).value;
        if (v === '#{' || v === '}') {
          continue;
        }
        source += v;
      } else if (c._tag === 'node' && isNode(c as JessNode, N.Interpolated)) {
        source += INTERPOLATION_PLACEHOLDER;
        replacements.push(...(c as Interpolated).replacements);
      }
    }
    const interp = new Interpolated({ source, replacements }, { role: 'ident' }, loc);
    return new InterpolatedSelector(interp as any, {}, loc) as unknown as JessNode;
  }

  private _scssInterpDeclName(name: unknown, loc: LocationInfo): unknown {
    const str = typeof name === 'string'
      ? name
      : isNode(name as Node, N.Any)
        ? String((name as Any).valueOf())
        : undefined;
    if (str && str.includes('#{')) {
      return buildScssInterpolatedFromString(str, loc, 'property');
    }
    return name;
  }

  private _buildScssDeclaration(
    children: ReadonlyArray<Child>,
    loc: LocationInfo,
    buildLess: () => JessNode
  ) {
    const decl = buildLess() as Declaration;
    const d = decl as { name?: unknown; value?: unknown };
    if (d.name !== undefined) {
      d.name = this._scssInterpDeclName(d.name, loc);
    }
    const valueNodes = nodeChildren(children).filter(n =>
      isNode(n, N.Collection) || isNode(n, N.Sequence) || isNode(n, N.Keyword)
      || isNode(n, N.Reference) || isNode(n, N.Num) || isNode(n, N.Paren) || isNode(n, N.List)
    );
    const collection = valueNodes.find(n => isNode(n, N.Collection));
    if (collection && valueNodes.length > 1) {
      const base = valueNodes.find(n => n !== collection);
      if (base) {
        d.value = new Sequence([base as Node, collection as Node], undefined, loc);
      }
    } else if (collection) {
      d.value = collection;
    }
    return decl as unknown as JessNode;
  }

  private _buildScssCustomDeclaration(
    children: ReadonlyArray<Child>,
    loc: LocationInfo,
    buildLess: () => JessNode
  ) {
    const decl = buildLess() as CustomDeclaration;
    const d = decl as { name?: unknown };
    if (d.name !== undefined) {
      d.name = this._scssInterpDeclName(d.name, loc);
    }
    return decl as unknown as JessNode;
  }

  protected override _buildQuoted(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const text = ls.map(l => l.value).join('');
    const inner = text.slice(1, -1);
    const quote = text[0] as '"' | '\'';
    if (inner.includes('#{')) {
      const value = buildScssInterpolatedFromString(inner, loc, 'any');
      return new Quoted(value, { quote }, loc) as unknown as JessNode;
    }
    return super._buildQuoted(children, loc);
  }

  /** `("k": v, …)` pair inside a map literal. */
  private _buildScssMapPair(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const keyNode = nodes[0] ?? new Any('', { role: 'property' }, loc);
    const valueNode = nodes[1] ?? new Any('', {}, loc);
    const keyStr = toDeclKey(keyNode as Node);
    return new Declaration(
      { name: new Any(keyStr, { role: 'property' }, loc), value: valueNode as Node },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  private _buildScssMapLiteral(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const decls = nodeChildren(children) as Declaration[];
    return new Collection(decls as any, undefined, loc) as unknown as JessNode;
  }

  /** `ns.$var`, `ns.fn(…)`, `ns.\#foo(…)`, or a plain ident. */
  private _buildScssIdentValue(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const identLeaf = ls.find(l => !l.value.startsWith('.') && l.value !== '(' && l.value !== ')'
      && l.value !== '\\');
    const ident = identLeaf?.value ?? '';
    const varLeaf = ls.find(l => l.value.startsWith('$'));
    const dotLeaf = ls.find(l => l.value.startsWith('.') && !l.value.startsWith('$'));
    const hashLeaf = ls.find(l => l.value.startsWith('#'));
    const hasCall = ls.some(l => l.value === '(');
    const hasEscape = ls.some(l => l.value === '\\');

    if (varLeaf && dotLeaf) {
      const nsRef = new Reference(ident, { type: 'variable' }, loc);
      const key = varLeaf.value.slice(1);
      return new Reference({ target: nsRef, key }, { type: 'variable' }, loc) as unknown as JessNode;
    }

    if (hasEscape && hashLeaf && hasCall) {
      const key = hashLeaf.value.slice(1);
      const args = nodeChildren(children).find(n => isNode(n, N.List)) as List | undefined;
      const ref = makeNamespacedReference([ident, key], 'mixin-ruleset', loc);
      const call = new Call({ name: ref, args }, undefined, loc);
      return new Expression(call, undefined, loc) as unknown as JessNode;
    }

    if (dotLeaf && hasCall) {
      const fnName = dotLeaf.value.slice(1);
      if (ident === 'selector' && fnName === 'parse') {
        const items = spannedComponents(raw);
        const open = items.findIndex(i => i.comp === '(');
        let close = items.length;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i]!.comp === ')') {
            close = i;
            break;
          }
        }
        const { value: argValue } = this._assembleValue(items.slice(open + 1, close), loc);
        const firstArg = isNode(argValue as Node, N.List)
          ? (argValue as List).value[0]
          : argValue;
        const selectorText = firstArg && isNode(firstArg as Node, N.Quoted)
          ? typeof (firstArg as Quoted).value === 'string'
            ? (firstArg as Quoted).value as string
            : isNode((firstArg as Quoted).value, N.Any)
              ? String((firstArg as Quoted).value.valueOf())
              : undefined
          : undefined;
        if (selectorText !== undefined) {
          try {
            const selector = parseSelectorListExpression(selectorText);
            return new SelectorCapture(selector, undefined, loc) as unknown as JessNode;
          } catch {
            // fall through to default call desugaring
          }
        }
      }
      const items = spannedComponents(raw);
      const open = items.findIndex(i => i.comp === '(');
      let close = items.length;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]!.comp === ')') {
          close = i;
          break;
        }
      }
      const { value: argValue } = this._assembleValue(items.slice(open + 1, close), loc);
      let args: List | undefined;
      if (argValue !== undefined) {
        args = isNode(argValue as Node, N.List)
          ? argValue as List
          : new List([argValue as Node], undefined, loc);
      }
      const dottedName = `${ident}.${fnName}`;
      const lookupCall = new Call({ name: dottedName, args }, undefined, loc);
      const mapped = desugarMapLookup(lookupCall, loc);
      if (isNode(mapped, N.Reference)) {
        return mapped as unknown as JessNode;
      }
      const memberType = fnName.startsWith('#') ? 'mixin-ruleset' : 'function';
      const memberKey = fnName.startsWith('#') ? fnName.slice(1) : fnName;
      const ref = makeNamespacedReference([ident, memberKey], memberType, loc);
      const call = new Call({ name: ref, args }, undefined, loc);
      if (memberType === 'mixin-ruleset') {
        return new Expression(call, undefined, loc) as unknown as JessNode;
      }
      return new Expression(desugarNamespacedCall(call, loc), undefined, loc) as unknown as JessNode;
    }

    return new Any(ident, { role: 'ident' }, loc) as unknown as JessNode;
  }

  protected override _buildStylesheet(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = this._flattenScssImportLists(nodeChildren(children));
    const lifted = this._liftStandaloneComments(nodes, loc[0], loc[3], loc);
    return new Rules(lifted, undefined, loc);
  }

  private _flattenScssImportLists(nodes: JessNode[]): JessNode[] {
    const flat: JessNode[] = [];
    for (const n of nodes) {
      if (isNode(n, N.List) && ((n as List).options?.role === 'scss-imports'
        || (n as List).options?.role === 'scss-at-root')) {
        flat.push(...(n as List).value);
      } else {
        flat.push(n);
      }
    }
    return flat;
  }

  private _buildScssNestedProps(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const decls = nodeChildren(children).filter(n => isNode(n, N.Declaration)) as Declaration[];
    return new Collection(decls as any, undefined, loc) as unknown as JessNode;
  }

  private _buildScssDiagnostic(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const atLeaf = ls.find(l => l.value.startsWith('@'));
    const level = (atLeaf?.value.slice(1) ?? 'debug') as 'debug' | 'warn' | 'error';
    const message = nodeChildren(children).find(n => !isNode(n, N.Any) || (n as Any).options?.role !== 'atkeyword')
      ?? nodeChildren(children)[0]
      ?? new Any('', {}, loc);
    return new Log({ level, message: message as Node }, undefined, loc) as unknown as JessNode;
  }

  private _buildScssAtRootFilter(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const prelude = nodes.find(n => !(n instanceof Rules)) ?? nodes[0];
    const body = nodes.find((n): n is Rules => n instanceof Rules)!;
    const name = new Any('@at-root', { role: 'atkeyword' }, loc);
    this._error(
      '@at-root prelude/filter forms are not yet supported in Jess. Write the hoisted rules directly instead.',
      loc[0]
    );
    return new AtRule(
      { name, prelude: prelude as Node, rules: body.rules },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  private _buildScssAtRootSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const selector = nodes.find(n => !(n instanceof Rules)) as Selector;
    const body = nodes.find((n): n is Rules => n instanceof Rules)!;
    const context = this._parseContext;
    return new Ruleset(
      {
        selector: prefixAtRootSelector(selector, context),
        rules: body.rules
      },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  private _buildScssAtRootPlain(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const body = nodeChildren(children).find((n): n is Rules => n instanceof Rules)!;
    const context = this._parseContext;
    const lowered = new Rules([...body.rules], undefined, loc);
    lowerPlainAtRootRules(lowered, context);
    if (lowered.rules.length === 0) {
      return new Nil(undefined, undefined, loc) as unknown as JessNode;
    }
    if (lowered.rules.length === 1) {
      return lowered.rules[0]! as unknown as JessNode;
    }
    return new List(lowered.rules, { role: 'scss-at-root' }, loc) as unknown as JessNode;
  }

  private _buildScssWithConfigEntry(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('$') ? rawName.slice(1) : rawName;
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === '!default' || c === '!global' || c === ',' || c === ')') {
        end = i;
        break;
      }
    }
    const { value } = this._assembleValue(items.slice(colonIdx + 1, end), loc);
    const sawDefault = items.slice(end).some(i => i.comp === '!default');
    const sawGlobal = items.slice(end).some(i => i.comp === '!global');
    return new VarDeclaration(
      { name: new Any(name, { role: 'property' }, loc) as unknown as Node, value: value as Node },
      {
        assign: (sawDefault ? '?:' : ':') as AssignmentType,
        setDefined: sawGlobal
      },
      loc
    ) as unknown as JessNode;
  }

  private _buildScssWithConfig(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const decls = nodeChildren(children).filter(n => isNode(n, N.VarDeclaration));
    return new Collection(decls as Node[], undefined, loc) as unknown as JessNode;
  }

  private _buildScssUseAs(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const nsLeaf = ls.find(l => l.value !== 'as');
    return new Any(nsLeaf?.value ?? '', { role: 'ident' }, loc) as unknown as JessNode;
  }

  private _buildScssUse(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const pathNode = nodeChildren(children).find(n => isNode(n, N.Quoted)) as Quoted | undefined;
    const withConfig = nodeChildren(children).find(n => isNode(n, N.Collection)) as Collection | undefined;
    const useAs = nodeChildren(children).find(n => isNode(n, N.Any) && (n as Any).options?.role === 'ident');
    const namespace = useAs ? String((useAs as Any).valueOf()) : undefined;
    const rawPath = pathNode?.valueOf() ?? '';

    if (rawPath.startsWith('sass:')) {
      const mod = rawPath.slice('sass:'.length);
      const rewritten = `#sass/${mod}`;
      const q = quotedLike(pathNode!, rewritten, loc);
      return new JsImport(
        { path: q },
        { namespace: namespace ?? defaultNamespaceFromPath(rawPath) },
        loc
      ) as unknown as JessNode;
    }

    if (isScriptUsePath(rawPath)) {
      return new JsImport(
        { path: pathNode! },
        { namespace: namespace ?? defaultNamespaceFromPath(rawPath) },
        loc
      ) as unknown as JessNode;
    }

    return new StyleImport(
      {
        path: pathNode!,
        with: withConfig ? { node: withConfig, type: 'set' } : undefined
      },
      {
        type: 'compose',
        namespace,
        importOptions: {}
      },
      loc
    ) as unknown as JessNode;
  }

  private _buildScssForward(
    children: ReadonlyArray<Child>,
    _raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const pathNode = nodeChildren(children).find(n => isNode(n, N.Quoted)) as Quoted | undefined;
    const withConfig = nodeChildren(children).find(n => isNode(n, N.Collection)) as Collection | undefined;
    const preludeText = this._source.slice(loc[0], loc[3]);
    const pathMatch = /(['"])([^'"]+)\1/.exec(preludeText);
    const afterPath = pathMatch
      ? preludeText.slice(preludeText.indexOf(pathMatch[0]) + pathMatch[0].length)
      : '';
    const preludeExtra = afterPath.replace(/\bwith\s*\([^)]*\)\s*;?\s*$/, '').replace(/;\s*$/, '').trim();
    checkForwardPreludeErrors(preludeExtra, msg => this._error(msg, loc[0]));

    return new StyleImport(
      {
        path: pathNode!,
        with: withConfig ? { node: withConfig, type: 'set' } : undefined
      },
      {
        type: 'compose',
        importOptions: { forward: true }
      },
      loc
    ) as unknown as JessNode;
  }

  private _buildScssPlaceholderSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const raw = ls[0]?.value ?? '';
    const name = `\\${raw.slice(1)}`;
    return this._makeBasicSelector(name, loc);
  }

  private _buildScssPermissiveAtRule(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const braceIdx = children.findIndex(c => c._tag === 'leaf' && (c as CSTLeaf).value === '{');
    const preludeChildren = braceIdx >= 0 ? children.slice(1, braceIdx) : children.slice(1);
    const bodyChildren = braceIdx >= 0 ? children.slice(braceIdx + 1) : [];
    const prelude = new Sequence(nodeChildren(preludeChildren) as Node[], undefined, loc);
    return new AtRule(
      { name, prelude, rules: nodeChildren(bodyChildren) },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  private _buildScssLayerBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const braceIdx = children.findIndex(c => c._tag === 'leaf' && (c as CSTLeaf).value === '{');
    const preludeChildren = braceIdx >= 0 ? children.slice(1, braceIdx) : children.slice(1);
    const bodyChildren = braceIdx >= 0 ? children.slice(braceIdx + 1) : [];
    const preludeNodes = nodeChildren(preludeChildren);
    const prelude = preludeNodes.length === 1
      ? preludeNodes[0]
      : preludeNodes.length > 0
        ? new Sequence(preludeNodes as Node[], undefined, loc)
        : undefined;
    return new AtRule(
      { name, prelude, rules: nodeChildren(bodyChildren) },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  protected override _buildQueryAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c?._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const braceIdx = children.findIndex(c => c._tag === 'leaf' && (c as CSTLeaf).value === '{');
    const preludeChildren = braceIdx >= 0 ? children.slice(1, braceIdx) : children.slice(1);
    const bodyChildren = braceIdx >= 0 ? children.slice(braceIdx + 1) : [];
    const prelude = new Sequence(nodeChildren(preludeChildren) as Node[], undefined, loc);
    return new AtRule(
      { name, prelude, rules: nodeChildren(bodyChildren) },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  protected _buildScssParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const inner = this._betweenParens(spannedComponents(rawChildren));
    const { value } = this._assembleValue(inner, loc);
    if (value && isNode(value as Node, N.Operation)) {
      return new Expression(value as Node, undefined, loc) as unknown as JessNode;
    }
    if (value && isNode(value as Node, N.List) && (value as List).options?.sep === '/'
      && (value as List).value.length === 2) {
      const [left, right] = (value as List).value;
      const operation = new Operation([left!, '/', right!], undefined, loc);
      return new Expression(operation, undefined, loc) as unknown as JessNode;
    }
    return new Paren(value as unknown as Node, undefined, loc) as unknown as JessNode;
  }

  private _buildScssExtendTarget(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    for (const c of children) {
      if (typeof c === 'string') {
        return c as unknown as JessNode;
      }
    }
    const placeholderLeaf = children.find((c): c is CSTLeaf =>
      c?._tag === 'leaf' && typeof (c as CSTLeaf).value === 'string' && (c as CSTLeaf).value.startsWith('%')
    );
    if (placeholderLeaf) {
      return `\\${placeholderLeaf.value.slice(1)}` as unknown as JessNode;
    }
    const items = nodeChildren(children);
    if (items.length === 1) {
      return items[0]!;
    }
    if (items.length > 1) {
      return this._makeSelectorList(items, loc);
    }
    const spanItems = spannedComponents(raw).filter(i => i.comp !== ',');
    if (spanItems.length === 1 && typeof spanItems[0]!.comp === 'string') {
      const sel = spanItems[0]!.comp as string;
      return (sel.startsWith('%') ? `\\${sel.slice(1)}` : sel) as unknown as JessNode;
    }
    return items[0] as unknown as JessNode;
  }

  private _scssExtendTargetFrom(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    _loc: LocationInfo
  ): Selector | string {
    for (const c of children) {
      if (typeof c === 'string') {
        return c;
      }
      if (c != null && typeof c === 'object' && '_tag' in c && (c as { _tag: string })._tag === 'node') {
        const n = c as JessNode;
        if (['SelectorList', 'BasicSelector', 'CompoundSelector', 'ComplexSelector'].includes(n.type)) {
          return n as unknown as Selector;
        }
      }
    }
    const items = spannedComponents(raw).filter(i => i.comp !== '@extend' && i.comp !== ';' && i.comp !== '!optional');
    if (items.length === 1 && typeof items[0]!.comp === 'string') {
      const sel = items[0]!.comp as string;
      if (sel.startsWith('%')) {
        return `\\${sel.slice(1)}`;
      }
      return sel;
    }
    return nodeChildren(children)[0] as unknown as Selector;
  }

  private _buildScssExtend(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const target = this._scssExtendTargetFrom(children, raw, loc);
    validateExtendTarget(
      target as Node,
      this._parseContext?.opts?.allowExtendSelectors,
      msg => this._error(msg, loc[0])
    );
    const prelude = this._source.slice(loc[0], loc[3]);
    const namespace = /@extend\s+%/.test(prelude) || isPlaceholderExtendTarget(target)
      ? '*'
      : undefined;
    return new Extend(
      { target: target as unknown as Selector, flag: ExtendFlag.All, namespace },
      undefined,
      loc
    ) as unknown as JessNode;
  }

  private _buildScssImportItem(
    children: ReadonlyArray<Child>,
    raw: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const prelude = nodeChildren(children).find(n => isNode(n, N.Quoted) || isNode(n, N.Url)) as Node | undefined;
    const pathSpan = spannedComponents(raw).find(i =>
      isNode(i.comp as Node, N.Quoted) || isNode(i.comp as Node, N.Url) || (typeof i.comp === 'string' && (i.comp.startsWith('"') || i.comp.startsWith('\'') || i.comp.startsWith('url')))
    );
    let extraText: string | undefined;
    if (pathSpan) {
      const tail = raw.filter(c => c._tag === 'leaf' && (c as CSTLeaf).value !== '@import')
        .map(c => (c as CSTLeaf).value)
        .join('');
      const pathText = typeof pathSpan.comp === 'string' ? pathSpan.comp : '';
      const idx = tail.indexOf(pathText);
      if (idx >= 0) {
        extraText = tail.slice(idx + pathText.length).replace(/^[\s,]+/, '').replace(/[,;]\s*$/, '').trim() || undefined;
      }
    }
    const seqItems: Node[] = [];
    if (prelude) {
      seqItems.push(prelude);
    }
    if (extraText) {
      seqItems.push(new Any(extraText, { role: 'ident' }, loc) as unknown as Node);
    }
    return new Sequence(seqItems, undefined, loc) as unknown as JessNode;
  }

  private _buildScssImportAtRule(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const items = nodeChildren(children).filter(n => isNode(n, N.Sequence));
    const importName = new Any('@import', { role: 'atkeyword' }, loc) as unknown as Node;
    const built: JessNode[] = [];
    for (const item of items) {
      const seq = item as Sequence;
      const prelude = seq.value[0];
      const extra = seq.value[1];
      const extraText = extra && isNode(extra, N.Any) ? String((extra as Any).valueOf()).trim() : undefined;
      const itemLoc = (Array.isArray(seq.location) ? seq.location : loc) as LocationInfo;
      if (!prelude) {
        continue;
      }
      if (!isPlainCssImportPrelude(prelude as Node, extraText) && isNode(prelude as Node, N.Quoted)) {
        built.push(new StyleImport(
          { path: prelude as Quoted },
          { type: 'import', importOptions: { multiple: true } },
          itemLoc
        ) as unknown as JessNode);
        continue;
      }
      const preludeNodes = [prelude as Node];
      if (extraText) {
        preludeNodes.push(new Any(extraText, { role: 'ident' }, itemLoc) as unknown as Node);
      }
      built.push(new AtRuleStatement(
        {
          name: importName,
          prelude: new Sequence(preludeNodes, undefined, itemLoc)
        },
        undefined,
        itemLoc
      ) as unknown as JessNode);
    }
    if (built.length === 1) {
      return built[0]!;
    }
    return new List(built, { role: 'scss-imports' }, loc) as unknown as JessNode;
  }

  protected override _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const call = super._buildCall(rawChildren, loc) as Call;
    const nameNode = call.name;
    const stringName = typeof nameNode === 'string'
      ? nameNode
      : isNode(nameNode, N.Reference) && typeof nameNode.key === 'string'
        ? nameNode.key
        : '';

    const mapped = desugarMapLookup(
      new Call({ name: stringName, args: call.args }, call.options, loc),
      loc
    );
    if (isNode(mapped, N.Reference)) {
      return mapped as unknown as JessNode;
    }

    const desugared = desugarNamespacedCall(
      new Call({ name: stringName, args: call.args }, call.options, loc),
      loc
    );
    const name = desugared.name;

    if (stringName === 'selector.parse') {
      const argValues = isNode(desugared.args, N.List) ? desugared.args.value : [];
      const firstArg = argValues[0];
      const selectorText = firstArg && isNode(firstArg, N.Quoted)
        ? typeof firstArg.value === 'string'
          ? firstArg.value
          : isNode(firstArg.value, N.Any)
            ? String(firstArg.value.valueOf())
            : undefined
        : undefined;
      if (selectorText !== undefined) {
        try {
          const selector = parseSelectorListExpression(selectorText);
          return new SelectorCapture(selector, undefined, loc) as unknown as JessNode;
        } catch {
          return desugared as unknown as JessNode;
        }
      }
      return desugared as unknown as JessNode;
    }

    if (typeof name === 'string' && name.includes('.')) {
      return new Expression(desugared, undefined, loc) as unknown as JessNode;
    }

    if (isNode(name, N.Reference) && name.options?.type === 'function') {
      return new Call({ name, args: desugared.args }, undefined, loc) as unknown as JessNode;
    }

    if (typeof name === 'string') {
      const ref = new Reference(
        { key: name },
        { type: 'function', fallbackValue: true },
        loc
      );
      return new Call(
        { name: ref, args: desugared.args },
        undefined,
        loc
      ) as unknown as JessNode;
    }

    return desugared as unknown as JessNode;
  }

  protected override _buildSquareParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const paren = super._buildSquareParen(rawChildren, loc) as Paren;
    const inner = (paren as unknown as { value?: Node }).value;
    const delimiter = isNode(inner as Node, N.Any) && (inner as Any).options?.role === 'ident'
      ? 'square'
      : 'paren';
    return new Paren(inner as Node, { delimiter }, loc) as unknown as JessNode;
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
