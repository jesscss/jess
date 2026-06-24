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
  spannedComponents, type Spanned
} from '@jesscss/css-parser';

import {
  type Node,
  type LocationInfo,
  Any, Ruleset,
  type Selector,
  ComplexSelector, type ComplexSelectorValue,
  SelectorList,
  Declaration, type DeclarationOptions,
  VarDeclaration, type VarDeclarationOptions,
  Reference, type ReferenceValue,
  Ampersand, List, DefaultGuard, Extend, Call,
  Interpolated, InterpolatedSelector, Sequence, CustomDeclaration,
  Color, Paren, Condition, type ConditionOperator
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
// LessGrammar
// ---------------------------------------------------------------------------

export class LessGrammar extends CssParser {
  // ── buildNode ─────────────────────────────────────────────────────────────
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
      case 'VarDeclaration':      return this._buildVarDeclaration(raw, loc);
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
      case 'AtRuleBlock':
        this._warnAtRulePreludeVars(span);
        return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'NamedColor':          return this._buildNamedColor(children, loc);
      case 'GuardCondition':      return new Paren({ node: nodeChildren(children)[0] ?? new Any('', {}, loc) }, {}, loc) as unknown as JessNode;
      case 'Comparison':          return this._buildComparison(children, loc);
      case 'Guard':               return this._buildGuard(children, loc);
      case 'PseudoSelector':      return this._buildLessPseudo(type, span, children, _state, raw, loc);
      case 'InterpolatedSelector': return this._buildInterpolatedSelector(children, loc);
      case 'MixinCall':           return this._buildMixinCall(children, raw, loc);
      case 'MixinArgs':           return this._buildMixinArgs(children, loc);
      case 'AnonymousMixinDefinition': return this._buildAnonMixin(children, loc) as unknown as JessNode;
      case 'MixinOrQualifiedRule': return this._buildMixinOrQualified(children, loc);
      case 'EscapedValue':        return this._buildEscapedValue(children, loc);
      case 'ExtendStatement':     return this._buildExtendStatement(children, raw, loc);
      default:                    return super.buildNode(type, span, children, _state, raw);
    }
  }

  // ── Private Less AST builders ─────────────────────────────────────────────

  private _buildVarDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === 'important' || c === ';') {
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
    const { value } = this._assembleValue(valItems, loc);
    const hasImportant = items.some(i => i.comp === '!');
    return new VarDeclaration(
      { name, value, important: hasImportant || undefined } as any,
      {} as VarDeclarationOptions,
      loc
    );
  }

  private _buildReference(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const varName = ls[0]?.value ?? '';
    const key = varName.startsWith('@') ? varName.slice(1) : varName;
    const hasAccessor = ls.some(l => l.value === '[');
    if (hasAccessor) {
      const accessorNode = nodeChildren(children)[0];
      const accessorLeaf = ls.find(l => l.value !== varName && l.value !== '[' && l.value !== ']');
      const accessKey = accessorNode
        ? String(accessorNode)
        : (accessorLeaf?.value ?? '');
      const target = new Reference(key, { type: 'variable' }, loc);
      return new Reference(
        { target, key: accessKey } as unknown as ReferenceValue,
        { type: 'index' },
        loc
      );
    }
    return new Reference(key, { type: 'variable' }, loc);
  }

  private _buildNamedColor(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    return new Color({ node: name }, {}, loc) as unknown as JessNode;
  }

  private _buildComparison(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const left = nodes[0] ?? new Any('', {}, loc);
    const op = ls.find(l => />=|<=|=~|[<>=]/.test(l.value));
    const right = nodes[1] ?? new Any('', {}, loc);
    if (op) {
      return new Condition(
        [left, op.value as ConditionOperator, right],
        {},
        loc
      ) as unknown as JessNode;
    }
    return new Condition([left], {}, loc) as unknown as JessNode;
  }

  private _buildGuard(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const nodes = nodeChildren(children);
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const hasNot = ls.some(l => l.value === 'not');
    if (ls.some(l => l.value === 'default()')) {
      const paren = new Paren(
        new DefaultGuard('default()', {}, loc) as any,
        {}, loc
      );
      return (hasNot
        ? new Condition([paren as any], { negate: true }, loc)
        : paren) as unknown as JessNode;
    }
    const andOrIdx = ls.findIndex(l => l.value === 'and' || l.value === 'or');
    if (andOrIdx >= 0 && nodes.length >= 2) {
      const op = ls[andOrIdx]!.value as ConditionOperator;
      const left = nodes[0]!;
      const right = nodes[1]!;
      return new Condition([left, op, right], { negate: hasNot }, loc) as unknown as JessNode;
    }
    if (nodes.length === 1) {
      return new Condition([nodes[0]!], { negate: hasNot }, loc) as unknown as JessNode;
    }
    return new Condition([new Any('', {}, loc)], { negate: hasNot }, loc) as unknown as JessNode;
  }

  private _buildInterpolatedSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const source = ls.map(l => l.value).join('');
    const replacements = ls
      .filter(l => l.value.startsWith('@{'))
      .map(l => new Reference(l.value.slice(2, -1), { type: 'variable' }, loc) as unknown as Node);
    const interp = new Interpolated({ source, replacements }, {}, loc);
    return new InterpolatedSelector(interp as any, {}, loc) as unknown as JessNode;
  }

  private _buildLessPseudo(
    type: string, span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    if (ls.some(l => l.value === 'extend')) {
      const argNode = nodeChildren(children)[0];
      const argText = ls.find(l => !/^::?$/.test(l.value) && l.value !== 'extend')?.value ?? '';
      const target = (argNode ?? argText) as unknown as Selector;
      return new Extend({ target }, {}, loc) as unknown as JessNode;
    }
    return super.buildNode(type, span, children, state, raw);
  }

  private _buildLessDeclaration(raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(raw);
    const decl = this._buildDeclaration(raw, loc);
    const colonIdx = items.findIndex(i => i.comp === ':');
    const merge = colonIdx > 0 ? items[colonIdx - 1]?.comp : undefined;
    const assign = merge === '+_' ? '+_:' : merge === '+' ? '+,:' : undefined;
    if (assign) {
      const d = decl as unknown as { _options?: Record<string, unknown>; options?: Record<string, unknown> };
      d._options = { ...(d._options ?? {}), assign };
    }
    return decl;
  }

  private _buildAmpersand(children: ReadonlyArray<Child>, loc: LocationInfo): JessNode {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const hasParen = ls.some(l => l.value === '(');
    if (!hasParen) {
      return new Ampersand(undefined, {}, loc) as unknown as JessNode;
    }
    const content = ls.find(l => l.value !== '&' && l.value !== '(' && l.value !== ')')?.value ?? '';
    const trimmed = content.trim();
    const appendValue = trimmed === 'nil'
      ? ''
      : trimmed.replace(/^(['"])([\s\S]*)\1$/, '$2');
    return new Ampersand(appendValue, {}, loc) as unknown as JessNode;
  }

  private _buildExtendStatement(
    children: ReadonlyArray<Child>, raw: ReadonlyArray<{ _tag: string }>, loc: LocationInfo
  ): JessNode {
    const argNode = nodeChildren(children)[0];
    const text = this._source.slice(loc[0], loc[3]);
    const flag = /\ball\s*\)/.test(text) ? 'all' : undefined;
    const m = /:extend\(\s*([^)]*?)(?:\s+all)?\s*\)/.exec(text);
    const target = (argNode ?? (m ? m[1]!.trim() : '')) as unknown as Selector;
    return new Extend({ target, flag } as any, {}, loc) as unknown as JessNode;
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
    const propName = ls[0]?.value ?? '';
    const valueNodes = nodeChildren(children);
    if (valueNodes.length > 0) {
      const value = valueNodes.length === 1 && valueNodes[0]!.type === 'Sequence'
        ? valueNodes[0]!
        : new Sequence(valueNodes as any, undefined, loc);
      return new CustomDeclaration({ name: propName, value: value as any }, undefined, loc);
    }
    return this._buildCustomDeclaration(children, loc);
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
    const nameParts: string[] = [];
    for (const l of ls) {
      if (l.value === '(' || l.value === ';') {
        break;
      }
      nameParts.push(l.value);
    }
    const name = nameParts.join('');
    const argsList = nodeChildren(children).find(n => n.type === 'List');
    if (!argsList) {
      this._warn(
        'Calling a mixin without parentheses is deprecated and will be removed.',
        'mixin-call-no-parens'
      );
    } else {
      const items = raw as Array<{ _tag: string }>;
      const argsIdx = items.findIndex(i => i._tag === 'node');
      if (argsIdx > 0 && items[argsIdx - 1]?._tag === 'trivia') {
        this._warn(
          'Whitespace between a mixin name and parentheses is deprecated.',
          'mixin-call-whitespace'
        );
      }
    }
    const ref = new Reference(
      { key: name } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any,
      loc
    );
    return new Call(
      { name: ref as any, args: (argsList ?? new List([] as any, {} as any, loc)) as any },
      {}, loc
    ) as unknown as JessNode;
  }

  private _buildMixinArgs(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const inner = ls.find(l => l.value !== '(' && l.value !== ')')?.value ?? '';
    const trimmed = inner.trim();
    if (!trimmed) {
      return new List([] as any, {} as any, loc);
    }
    const sep = trimmed.includes(';') ? ';' : ',';
    const items = this._splitTopLevel(trimmed, sep)
      .map(p => p.trim()).filter(Boolean)
      .map(p => this._mixinArgPart(p, loc));
    return new List(items as any, { sep } as any, loc);
  }

  private _mixinArgPart(part: string, loc: LocationInfo): JessNode {
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
    return new Any(part, { role: 'ident' }, loc) as unknown as JessNode;
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
    const nodes = nodeChildren(children);
    const rules = nodes.filter(n => n.type !== 'List');
    return new Ruleset(
      { selector: '.', rules },
      { deferSelectorMaterialization: true } as any,
      loc
    );
  }

  private _buildMixinOrQualified(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const nodes = nodeChildren(children);
    const hasBlock = ls.some(l => l.value === '{');
    const nameParts: string[] = [];
    for (const l of ls) {
      if (l.value === '(' || l.value === '{' || l.value === '}' || l.value === ';' || l.value === ')') {
        break;
      }
      nameParts.push(l.value);
    }
    const name = nameParts.join('');
    const argsList = nodes.find(n => n.type === 'List');
    const guard = nodes.find(n => n.type === 'Paren' || n.type === 'Condition' || n.type === 'DefaultGuard');
    if (hasBlock) {
      const ruleNodes = nodes.filter(n => n !== argsList && n !== guard);
      return new Ruleset(
        { selector: name || '&', rules: ruleNodes, guard: guard as any },
        undefined, loc
      ) as unknown as JessNode;
    }
    const ref = new Reference(
      { key: name } as unknown as ReferenceValue,
      { type: 'mixin-ruleset', role: 'name' } as any,
      loc
    );
    return new Call(
      { name: ref as any, args: (argsList ?? new List([] as any, {} as any, loc)) as any },
      {}, loc
    ) as unknown as JessNode;
  }

  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
