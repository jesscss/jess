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
  Any,
  VarDeclaration, type VarDeclarationOptions,
  Reference,
  Rules,
  Condition, type ConditionOperator,
  Paren,
  If,
  For,
  While,
  Nil,
  Sequence
} from '@jesscss/core';

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
  return children.filter((c): c is JessNode => c._tag === 'node') as JessNode[];
}

// ---------------------------------------------------------------------------
// ScssGrammar
// ---------------------------------------------------------------------------

export class ScssGrammar extends LessGrammar {
  // ── Override rw to include // line comments ───────────────────────────────
  // Must be declared BEFORE _trivia so the field initializer captures this rw.
  rw = regex(/(?:[ \t\n\r\f]+|\/\/[^\n\r]*|\/\*(?:[^*]|\*(?!\/))*\*\/)+/);
  protected _trivia = this.rw;

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
    return new Rules(nodeChildren(children) as any, undefined, loc) as unknown as JessNode;
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

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
