/**
 * JessGrammar — the Jess build host, extending the CSS builder base directly.
 *
 * Inheritance chain: `CssParser → JessGrammar`. Jess is authored on the CSS base
 * (cleanest AST shapes); it does NOT inherit Less/SCSS builders. Every Jess node
 * type gets its own build case in `buildNode` below (added per feature); anything
 * inherited (Ruleset, Declaration, selectors, values, CSS at-rules) falls through
 * to `super.buildNode` (CssParser).
 *
 * The functional parse host (`BuilderHost`) in ./functional-parser.ts extends this
 * class, so `this._source` / `this._warnings` / `this._errors` come from CssParser.
 */
import { CssParser, spannedComponents, type Spanned } from '@jesscss/css-parser';
import {
  type Node, type LocationInfo,
  Reference, type ReferenceOptions, type ReferenceValue,
  VarDeclaration, AssignmentType,
  Num, Quoted, Expression, Condition, type ConditionOperator,
  Interpolated, InterpolatedSelector, INTERPOLATION_PLACEHOLDER,
  Declaration, Collection,
  If, For, While, Rules,
  Mixin, Call, List, Nil,
  Extend, ExtendFlag, BasicSelector,
  SelectorCapture, SelectorList, Selector,
  StyleImport, JsImport,
  type ForPattern, type ForIterable
} from '@jesscss/core';
import type { Span } from 'parseman';

type CSTLeaf = { _tag: 'leaf'; value: string };
type CSTLike = { _tag: string };

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

function isLeaf(c: unknown): c is CSTLeaf {
  return !!c && (c as CSTLike)._tag === 'leaf';
}

export function loc(span: Span): LocationInfo {
  return { start: span.start, end: span.end } as LocationInfo;
}

export class JessGrammar extends CssParser {
  protected override buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<Node | CSTLike>,
    state: unknown,
    rawChildren: ReadonlyArray<CSTLike>
  ) {
    switch (type) {
      case 'Reference':      return this._buildJessReference(children, loc(span));
      case 'DollarInterp':   return this._buildJessInterp(children, loc(span));
      case 'InterpolatedSelector': return this._buildJessInterpolatedSelector(children, loc(span));
      case 'VarDeclaration': return this._buildJessVarDeclaration(children, rawChildren, loc(span));
      case 'Collection':     return this._buildJessCollection(children, loc(span));
      case 'CollectionEntry': return this._buildJessCollectionEntry(children, rawChildren, loc(span));
      case 'If':             return this._buildJessIf(children, loc(span));
      case 'For':            return this._buildJessFor(children, rawChildren, loc(span));
      case 'While':          return this._buildJessWhile(children, loc(span));
      case 'Mixin':          return this._buildJessMixin(children, loc(span));
      case 'MixinParam':     return this._buildJessMixinParam(children, rawChildren, loc(span));
      case 'MixinCall':      return this._buildJessMixinCall(children, loc(span));
      case 'AnonMixin':      return this._buildJessAnonMixin(children, loc(span));
      case 'SelectorCapture': return this._buildJessSelectorCapture(children, rawChildren, loc(span));
      case 'Extend':         return this._buildJessExtend(children, rawChildren, loc(span));
      case 'Apply':          return this._buildJessApply(rawChildren, loc(span));
      case 'ComposeAtRule':  return this._buildJessCompose(children, rawChildren, loc(span));
      case 'ExportAtRule':   return this._buildJessExport(children, loc(span));
      case 'ImportAtRule':   return this._buildJessImportAt(children, loc(span));
      case 'UseAtRule':      return this._buildJessUse(children, rawChildren, loc(span));
      case 'FromAtRule':     return this._buildJessFrom(children, rawChildren, loc(span));
      case 'Expression':     return this._buildJessExpression(children, loc(span));
      case 'Condition':      return this._buildJessCondition(children, loc(span));
      case 'JessKeyword':    return this._valueKeyword((children.find(isLeaf)?.value) ?? '', loc(span)) as unknown as Node;
      default:
        return super.buildNode(type, span, children as never, state, rawChildren);
    }
  }

  // ── `$` references ──────────────────────────────────────────────────────────
  // Fold `$name` + a chain of `.key` (declaration lookup) / `[key]` (index for a
  // number, property for a string) into left-associative nested Reference nodes.
  // A trailing `?` marks the outermost reference optional (undefined → nil).
  private _buildJessReference(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const ls = children.filter(isLeaf);
    let head = (ls[0]?.value ?? '$').slice(1); // strip leading `$`
    // `$!foo` is a live binding: a `!` right after `$` → readMode 'snapshot'
    // (the option that renders back as `!`).
    const live = head[0] === '!';
    if (live) {
      head = head.slice(1);
    }
    const baseOptions: ReferenceOptions = live
      ? { type: 'variable', readMode: 'snapshot' }
      : { type: 'variable' };
    let base: Node = new Reference(head, baseOptions, location) as unknown as Node;
    let fallback = false;

    for (let i = 1; i < ls.length;) {
      const tok = ls[i]!.value;
      if (tok === '?') {
        fallback = true;
        i += 1;
        continue;
      }
      if (tok === '.') {
        const key = ls[i + 1]!.value;
        base = new Reference(
          { target: base, key } as unknown as ReferenceValue,
          { type: 'declaration' },
          location
        ) as unknown as Node;
        i += 2;
        continue;
      }
      if (tok === '[') {
        const rawKey = ls[i + 1]!.value;
        const { key, type } = this._referenceBracketKey(rawKey, location);
        base = new Reference(
          { target: base, key } as unknown as ReferenceValue,
          { type },
          location
        ) as unknown as Node;
        i += 3; // `[` key `]`
        continue;
      }
      i += 1;
    }

    if (fallback) {
      (base as unknown as { options: ReferenceOptions }).options.fallbackValue = true;
    }
    return base;
  }

  // ── Interpolation `$[key]` ───────────────────────────────────────────────────
  // Base-less, role 'ident'. Bare ident → variable ($[foo]); quoted → property
  // ($['foo']). Renders back with brackets (see reference.ts writeSyntax).
  private _buildJessInterp(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const key = children.filter(isLeaf).map(l => l.value).find(v => v !== '$' && v !== '[' && v !== ']') ?? '';
    return this._jessInterpKeyRef(key, location);
  }

  // Build the `role:'ident'` Reference for a `$[key]` interpolation key. Bare
  // ident → variable ($[foo]); quoted → literal property ($['foo']). Shared by
  // the value-form `$[…]` (DollarInterp) and selector/propname interpolation.
  private _jessInterpKeyRef(key: string, location: LocationInfo): Node {
    if (key[0] === '"' || key[0] === '\'') {
      return new Reference(
        { key: new Quoted(key.slice(1, -1), { quote: key[0] as '"' | '\'' }, location) } as unknown as ReferenceValue,
        { type: 'property', role: 'ident' },
        location
      ) as unknown as Node;
    }
    return new Reference(key, { type: 'variable', role: 'ident' }, location) as unknown as Node;
  }

  // ── Interpolation in SELECTORS ───────────────────────────────────────────────
  // `.widget-$[side]` → InterpolatedSelector wrapping an Interpolated (source with
  // `%%` placeholders + Reference replacements, role 'ident'). Leaves arrive as a
  // mix of literal text runs and `$[key]` tokens; each `$[…]` becomes a placeholder
  // + a `role:'ident'` Reference replacement, mirroring less-parser's `@{…}` branch.
  private _buildJessInterpolatedSelector(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const ls = children.filter(isLeaf);
    const replacements: Node[] = [];
    let source = '';
    for (const l of ls) {
      if (l.value.startsWith('$[')) {
        const inner = l.value.slice(2, -1); // strip `$[` … `]`
        replacements.push(this._jessInterpKeyRef(inner, location));
        source += INTERPOLATION_PLACEHOLDER;
      } else {
        source += l.value;
      }
    }
    const interp = new Interpolated({ source, replacements }, { role: 'ident' }, location);
    return new InterpolatedSelector(interp as never, {}, location) as unknown as Node;
  }

  /**
   * Map a `[key]` bracket leaf to its Reference key node + lookup TYPE. The key's
   * FORM chooses the type (and thus which namespace eval looks up); all render as
   * `[key]` on a target, the key node's surface making them visually distinct:
   *   [foo]     bare ident → VARIABLE `$foo`          (type 'variable')
   *   ['foo']   quoted     → PROPERTY (Declaration)   (type 'property')
   *   [0]       number     → numerical index          (type 'index')
   *   [$foo]    reference  → DYNAMIC lookup            (type 'index' — reserved
   *                          for dynamic/numerical; the variable value is the key)
   */
  private _referenceBracketKey(raw: string, location: LocationInfo): { key: unknown; type: ReferenceOptions['type'] } {
    if (raw[0] === '$') {
      const live = raw[1] === '!';
      const name = raw.slice(live ? 2 : 1);
      const keyRef = new Reference(name, live ? { type: 'variable', readMode: 'snapshot' } : { type: 'variable' }, location);
      return { key: keyRef, type: 'index' };
    }
    if (raw[0] === '"' || raw[0] === '\'') {
      return {
        key: new Quoted(raw.slice(1, -1), { quote: raw[0] as '"' | '\'' }, location),
        type: 'property'
      };
    }
    if (/^[+-]?\d/.test(raw)) {
      return { key: new Num(parseFloat(raw), undefined, location), type: 'index' };
    }
    // bare ident → variable lookup (`[foo]` ≡ `$foo` on the target)
    return { key: raw, type: 'variable' };
  }

  // ── Expressions: `$( … )` ────────────────────────────────────────────────────
  // Wrap the inner arithmetic / comparison tree in one Expression node. A single
  // bare keyword operand (`$(red)`) arrives as a leaf; convert it to a Keyword.
  private _buildJessExpression(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    // The inner operand is always a node now (bare keywords are JessKeyword).
    const inner = children.find(c => (c as CSTLike)._tag === 'node') as Node | undefined;
    return new Expression(
      (inner ?? this._valueKeyword('', location)) as unknown as Node,
      undefined, location
    ) as unknown as Node;
  }

  // A Condition covers three grammar shapes, all typed `Condition`:
  //   `$(a OP b)`             — arithmetic comparison inside `$()` (binary)
  //   `$if`/`$while` headers  — comparison + logical `and`/`or` + `not (…)`
  // Operators arrive as leaves (`=`/`>`/`<`/`>=`/`<=`/`and`/`or`, or a leading
  // `not`); operands as built nodes (or bare keyword leaves in `$()`). A leading
  // `not` negates the single inner sub-condition. Comparison/logical operators
  // fold left-associatively into nested binary Conditions.
  private _buildJessCondition(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const compareOps = new Set(['>', '<', '>=', '<=', '=']);
    const logicalOps = new Set(['and', 'or']);
    const operands: Node[] = [];
    const ops: ConditionOperator[] = [];
    let negate = false;

    for (const c of children) {
      if (isLeaf(c)) {
        const t = c.value.trim(); // op leaves may carry surrounding whitespace
        if (t === '(' || t === ')') {
          continue;
        }
        if (t === 'not') {
          negate = true;
          continue;
        }
        if (compareOps.has(t) || logicalOps.has(t)) {
          ops.push(t as ConditionOperator);
          continue;
        }
        if (t === '') {
          continue;
        }
        operands.push(this._valueKeyword(t, location) as unknown as Node);
      } else if ((c as CSTLike)._tag === 'node') {
        operands.push(c as Node);
      }
    }

    // `not (inner)` — one operand, no ops: negate the inner sub-condition.
    if (negate && ops.length === 0 && operands.length === 1) {
      return new Condition([operands[0]!], { negate: true }, location) as unknown as Node;
    }

    // Fold left-associatively: (((a op0 b) op1 c) …).
    let left = operands[0]!;
    for (let i = 0; i < ops.length; i++) {
      left = new Condition([left, ops[i]!, operands[i + 1]!], undefined, location) as unknown as Node;
    }
    if (negate) {
      return new Condition([left], { negate: true }, location) as unknown as Node;
    }
    return left;
  }

  // ── Variable declarations ───────────────────────────────────────────────────
  // `$name<op> value;` with op ∈ `:` (default), `+:` (Add), `?:` (CondAssign).
  private _buildJessVarDeclaration(children: ReadonlyArray<Node | CSTLike>, rawChildren: ReadonlyArray<CSTLike>, location: LocationInfo): Node {
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.replace(/^\$/, '');

    const opIdx = items.findIndex(i => i.comp === ':' || i.comp === '+:' || i.comp === '?:');
    const op = items[opIdx]?.comp as string | undefined;

    let end = items.length;
    let bangIdx = -1;
    for (let i = opIdx + 1; i < items.length; i++) {
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

    // A Collection RHS (`$x: { … }`) arrives as a single built Collection node,
    // not a value-leaf run — take it directly instead of running _assembleValue.
    const collectionRhs = children.find(c => (c as CSTLike)._tag === 'node' && (c as Node).type === 'Collection') as Node | undefined;

    let value: Node | string;
    if (collectionRhs) {
      value = collectionRhs;
    } else {
      const valueItems = items.slice(opIdx + 1, end) as Spanned[];
      ({ value } = this._assembleValue(valueItems, location) as { value: Node | string });
    }

    let important: string | undefined;
    if (bangIdx >= 0) {
      const bang = items[bangIdx]!;
      const kw = items[bangIdx + 1];
      const impEnd = kw && typeof kw.comp === 'string' && kw.comp.toLowerCase() === 'important'
        ? kw.span.end
        : bang.span.end;
      important = this._source.slice(bang.span.start, impEnd);
    }

    const assign = op === '+:' ? AssignmentType.Add : op === '?:' ? AssignmentType.CondAssign : undefined;

    return new VarDeclaration(
      { name, value, important } as never,
      assign ? { assign } : {},
      location
    ) as unknown as Node;
  }

  // ── Collections / maps ───────────────────────────────────────────────────────
  // `{ key: value; nested: { … } }` → Collection (a Rules subclass holding the
  // entry Declarations). Keys are arbitrary; a leading `_` marks a private key —
  // parse-transparent here, honoured by eval.
  private _buildJessCollection(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const entries = children.filter(
      c => (c as CSTLike)._tag === 'node' && (c as Node).type === 'Declaration'
    ) as Node[];
    return new Collection(entries as never, undefined, location) as unknown as Node;
  }

  // A single `key: value` entry → Declaration. The value is either a nested
  // Collection (arriving as a built node) or an ordinary value list.
  private _buildJessCollectionEntry(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const items = spannedComponents(rawChildren);
    const nameItem = items[0];
    const name = typeof nameItem?.comp === 'string' ? nameItem.comp : '';
    const colonIdx = items.findIndex(i => i.comp === ':');

    const nested = children.find(
      c => (c as CSTLike)._tag === 'node' && (c as Node).type === 'Collection'
    ) as Node | undefined;

    let value: Node | string;
    if (nested) {
      value = nested;
    } else {
      let end = items.length;
      for (let i = colonIdx + 1; i < items.length; i++) {
        if (items[i]!.comp === ';') {
          end = i;
          break;
        }
      }
      const valueItems = items.slice(colonIdx + 1, end) as Spanned[];
      ({ value } = this._assembleValue(valueItems, location) as { value: Node | string });
    }

    return new Declaration({ name, value } as never, undefined, location) as unknown as Node;
  }

  // ── Control flow ─────────────────────────────────────────────────────────────
  // Control bodies do NOT create scope; the block's rules merge into the parent.
  // The condition is the first built node; the body rules are the remaining nodes
  // MINUS any nested If (an `$else if`/`$else` chain) — that trails the body.
  //
  // The `If` node builds a chain: each `$else if` becomes a nested `If` as the
  // `else`, and a final `$else` becomes a `Rules`. Because `elseClause`s arrive
  // flat (the grammar is `If body many(elseClause)`), fold them right-to-left.
  private _controlBodyRules(children: ReadonlyArray<Node | CSTLike>): Node[] {
    return children.filter(c => (c as CSTLike)._tag === 'node') as Node[];
  }

  private _buildJessIf(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    // Split the flat node stream at the elseClause boundaries. The grammar emits:
    //   Condition, <body nodes…>, [elseClause: (if-cond, <body…>) | <body…>]*
    // Leaves (`$if`, `(`, `)`, `$else`, `if`, `{`, `}`) mark the segment breaks.
    // Re-walk the raw children in order, grouping into (marker → nodes) segments.
    const segments: Array<{ kind: 'if' | 'elseif' | 'else'; nodes: Node[] }> = [];
    let current: { kind: 'if' | 'elseif' | 'else'; nodes: Node[] } | undefined;
    let sawElse = false;
    for (const c of children) {
      if (isLeaf(c)) {
        const t = c.value.trim();
        if (t === '$if') {
          current = { kind: 'if', nodes: [] };
          segments.push(current);
          sawElse = false;
        } else if (t === '$else') {
          sawElse = true;
        } else if (t === 'if' && sawElse) {
          current = { kind: 'elseif', nodes: [] };
          segments.push(current);
          sawElse = false;
        } else if (t === '{' && sawElse) {
          current = { kind: 'else', nodes: [] };
          segments.push(current);
          sawElse = false;
        }
        continue;
      }
      if ((c as CSTLike)._tag === 'node') {
        current?.nodes.push(c as Node);
      }
    }

    // Build innermost-first so each `else` links to the next segment.
    let elseBranch: Node | undefined;
    for (let i = segments.length - 1; i >= 1; i--) {
      const seg = segments[i]!;
      if (seg.kind === 'else') {
        elseBranch = new Rules(seg.nodes as never, undefined, location) as unknown as Node;
      } else {
        // elseif: first node is its Condition, the rest are body rules.
        const [cond, ...body] = seg.nodes;
        elseBranch = new If(
          { condition: cond!, rules: body, else: elseBranch } as never,
          undefined, location
        ) as unknown as Node;
      }
    }

    const head = segments[0]!;
    const [condition, ...body] = head.nodes;
    return new If(
      { condition: condition!, rules: body, else: elseBranch } as never,
      undefined, location
    ) as unknown as Node;
  }

  private _buildJessWhile(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const nodes = this._controlBodyRules(children);
    const [condition, ...rules] = nodes;
    return new While(
      { condition: condition!, rules } as never,
      undefined, location
    ) as unknown as Node;
  }

  // `$for (<binding> of <iterable>) { … }`. Binding vars arrive as `$x` leaves;
  // the iterable is either a range (a Range built here from bound nodes + `to`/
  // `step`/`>`/`<` markers) or a single value node. Body rules are the trailing
  // nodes that are not consumed by the header.
  private _buildJessFor(
    children: ReadonlyArray<Node | CSTLike>,
    _rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const bindingNames: string[] = [];
    const headerNodes: Node[] = []; // range bounds / iterable — before `of` handled below
    const bodyNodes: Node[] = [];
    let sawOf = false;
    let sawTo = false;
    let excludeStart = false;
    let excludeEnd = false;
    let sawStep = false;
    const rangeBounds: Node[] = [];
    let stepNode: Node | undefined;
    let iterableNode: Node | undefined;
    let inBody = false;

    for (const c of children) {
      if (isLeaf(c)) {
        const t = c.value.trim();
        if (t === 'of') {
          sawOf = true;
          continue;
        }
        if (t === 'to') {
          sawTo = true;
          continue;
        }
        if (t === 'step') {
          sawStep = true;
          continue;
        }
        if (t === '>' && !sawTo && sawOf) {
          excludeStart = true;
          continue;
        }
        if (t === '<' && sawTo) {
          excludeEnd = true;
          continue;
        }
        if (t === '{') {
          inBody = true;
          continue;
        }
        if (t === '$for') {
          continue;
        } // the control keyword, not a binding
        if (t.startsWith('$') && !sawOf) {
          bindingNames.push(t.slice(1));
          continue;
        }
        continue;
      }
      if ((c as CSTLike)._tag !== 'node') {
        continue;
      }
      const node = c as Node;
      if (inBody) {
        bodyNodes.push(node);
        continue;
      }
      if (!sawOf) {
        headerNodes.push(node);
        continue;
      }
      // after `of`: either range bounds or the iterable
      if (sawStep) {
        stepNode = node;
        continue;
      }
      if (sawTo) {
        rangeBounds.push(node);
        continue;
      }
      // could be the range start OR the whole iterable; disambiguate after loop
      rangeBounds.push(node);
      iterableNode = node;
    }

    const pattern = this._buildForPattern(bindingNames, location);

    let iterable: ForIterable;
    if (sawTo) {
      iterable = {
        kind: 'range',
        start: rangeBounds[0]!,
        end: rangeBounds[1]!,
        ...(stepNode ? { step: stepNode } : {}),
        includeStart: !excludeStart,
        includeEnd: !excludeEnd
      };
    } else {
      iterable = { kind: 'node', value: iterableNode ?? rangeBounds[0]! };
    }

    return new For(
      { pattern, iterable, rules: bodyNodes } as never,
      undefined, location
    ) as unknown as Node;
  }

  // ── Mixins ───────────────────────────────────────────────────────────────────
  // DEFINITION `name(params) [when guard] { body }` → Mixin{ name, params, rules,
  // guard }. `name` is the raw mixin name (`.m` / `#ns` / `bare`). Params are a
  // List of the built MixinParam nodes (each a VarDeclaration — bare `$name` has a
  // Nil value, `$name: default` carries the default). The guard is the built
  // Condition child; body rules are the remaining node children.
  private _buildJessMixin(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const name = children.filter(isLeaf).map(l => l.value)
      .find(v => v !== '(' && v !== ')' && v !== '{' && v !== '}' && v !== 'when' && v !== ',') ?? '';

    const nodes = children.filter(c => (c as CSTLike)._tag === 'node') as Node[];
    // MixinParam builds to a VarDeclaration tagged `paramVar` — that flag (not the
    // node type) distinguishes definition params from body VarDeclarations.
    const isParam = (n: Node): boolean =>
      n.type === 'VarDeclaration'
      && Boolean((n as unknown as { options?: { paramVar?: boolean } }).options?.paramVar);
    const params = nodes.filter(isParam);
    // The guard is a Condition that is NOT one of the body rules; the grammar
    // places it (from `when (…)`) before the body block. A body Declaration/
    // Ruleset is never a Condition, so type alone disambiguates.
    const guard = nodes.find(n => n.type === 'Condition');
    const rules = nodes.filter(n => !isParam(n) && n !== guard);

    const paramsList = params.length
      ? new List(params as never, undefined, location)
      : undefined;

    return new Mixin(
      {
        name,
        ...(paramsList ? { params: paramsList } : {}),
        rules,
        ...(guard ? { guard } : {})
      } as never,
      undefined,
      location
    ) as unknown as Node;
  }

  // A single mixin definition param → VarDeclaration. Bare `$name` gets a Nil
  // value (required arg, no default); `$name: default` carries the assembled
  // default value. (This mirrors the Mixin `params` shape the evaluator reads:
  // a VarDeclaration name = param name, its value = the default.)
  private _buildJessMixinParam(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const items = spannedComponents(rawChildren);
    const rawName = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    const name = rawName.replace(/^\$/, '');
    const colonIdx = items.findIndex(i => i.comp === ':');

    let value: Node | string;
    if (colonIdx >= 0) {
      const valueItems = items.slice(colonIdx + 1) as Spanned[];
      ({ value } = this._assembleValue(valueItems, location) as { value: Node | string });
    } else {
      value = new Nil('', {}, location) as unknown as Node;
    }

    return new VarDeclaration(
      { name, value } as never,
      { paramVar: true } as never,
      location
    ) as unknown as Node;
  }

  // CALL `$ > <chain>(args)` → Call{ name: nested mixin-References, args: List }.
  // Chain steps arrive as leaves (`.m` / `#ns` / `bare`); fold them left-assoc
  // into nested `type:'mixin'` References on a base-less `$` root (so the name
  // renders back as `$ > #ns > .mixin`). Args are the built value nodes.
  private _buildJessMixinCall(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const steps = children.filter(isLeaf).map(l => l.value)
      .filter(v => v !== '$' && v !== '>' && v !== '(' && v !== ')' && v !== ';' && v !== ',');
    const args = children.filter(c => (c as CSTLike)._tag === 'node') as Node[];

    let base: Node = new Reference('', { type: 'variable' }, location) as unknown as Node;
    for (const step of steps) {
      base = new Reference(
        { target: base, key: step } as unknown as ReferenceValue,
        { type: 'mixin' },
        location
      ) as unknown as Node;
    }

    return new Call(
      { name: base, args: new List(args as never, undefined, location) } as never,
      undefined,
      location
    ) as unknown as Node;
  }

  // ── Anonymous mixins & functions ─────────────────────────────────────────────
  // `@(params) { … }` / `@{ … }` / `@(params) > { … }` / `@(params) > <expr>` → a
  // NAMELESS Mixin (core has no separate anon/function class). A FUNCTION is marked
  // by the `>` return operator; per the docs a function is "a mixin that looks up
  // the final `return:` assignment", so the single-expression form `@() > <expr>`
  // is normalised here into a body of one `return: <expr>` Declaration — the block
  // form `@() > { return: … }` already carries its `return` decl(s) verbatim.
  private _buildJessAnonMixin(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const hasReturn = children.some(c => isLeaf(c) && c.value === '>');
    const hasBlock = children.some(c => isLeaf(c) && c.value === '{');
    const isExprFn = hasReturn && !hasBlock;

    const nodes = children.filter(c => (c as CSTLike)._tag === 'node') as Node[];
    const isParam = (n: Node): boolean =>
      n.type === 'VarDeclaration'
      && Boolean((n as unknown as { options?: { paramVar?: boolean } }).options?.paramVar);
    const params = nodes.filter(isParam);
    const bodyNodes = nodes.filter(n => !isParam(n));

    let rules: Node[];
    if (isExprFn) {
      // Single-expression function → `return: <expr>`. `valueSequence` yields one
      // or more value nodes; a lone node is the value, several become a space List.
      const value: Node = bodyNodes.length === 1
        ? bodyNodes[0]!
        : new List(bodyNodes as never, undefined, location) as unknown as Node;
      rules = [new Declaration({ name: 'return', value } as never, undefined, location) as unknown as Node];
    } else {
      rules = bodyNodes;
    }

    const paramsList = params.length
      ? new List(params as never, undefined, location)
      : undefined;

    return new Mixin(
      { ...(paramsList ? { params: paramsList } : {}), rules } as never,
      undefined,
      location
    ) as unknown as Node;
  }

  // ── Selector capture `*[…]` ──────────────────────────────────────────────────
  // `*[.notice]` / `*[.a, .b]` → a core `SelectorCapture` wrapping a Selector node
  // (renders back `*[…]`, NO `$`). The inner SelectorList child may arrive as a
  // Selector node, a bare selector STRING (a lone `.notice` collapses to text in
  // the CSS builder), or an array of items; coerce it to a real Selector so the
  // capture's writeSyntax/eval have a node to work with.
  private _buildJessSelectorCapture(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    // The selector payload is the built SelectorList child, sitting between the `*`
    // `[` and the `]` in `children`. It arrives as a bare array (the CSS builder
    // returns `(Selector|string)[]` for a comma list), a Selector node, or a bare
    // string (a lone `.notice` collapses to text). The `*`/`[`/`]` are leaf tokens.
    const payload = children.find(
      c => Array.isArray(c) || c instanceof Selector
        || (typeof c === 'string' && c !== '*' && c !== '[' && c !== ']')
        || (!isLeaf(c) && (c as CSTLike)._tag === 'node')
    );
    const selector = this._captureSelectorFrom(payload, location);
    return new SelectorCapture(selector as never, undefined, location) as unknown as Node;
  }

  // Coerce a captured selector payload into a Selector NODE. The CSS SelectorList
  // builder collapses a lone selector to a bare STRING, a complex/compound one to a
  // Selector node, and a COMMA LIST to a plain array of items. Normalise all three:
  // a string → BasicSelector; an array → SelectorList; a built Selector passes
  // through.
  private _captureSelectorFrom(payload: unknown, location: LocationInfo): Selector {
    const toSel = (c: unknown): Selector =>
      typeof c === 'string'
        ? new BasicSelector(c, undefined, location) as unknown as Selector
        : c as Selector;
    if (Array.isArray(payload)) {
      return SelectorList.create(payload.map(toSel) as never) as unknown as Selector;
    }
    return toSel(payload);
  }

  // ── `$extend` statement ──────────────────────────────────────────────────────
  // `$extend <target> [, <target>]* [!exact];` → a core `Extend{ target, flag }`.
  // Target text is reassembled from the leaf run (`$extend`, `!exact`, `;`, and the
  // `,` separators are dropped); a namespace `ns|` folds into the Extend.namespace.
  // Jess/Sass default is a partial match (`All`); `!exact` selects Less's exact
  // match. A comma list builds one Extend per target wrapped in a List.
  private _buildJessExtend(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const items = spannedComponents(rawChildren);
    const flag = items.some(i => i.comp === '!exact') ? ExtendFlag.Exact : ExtendFlag.All;

    // A capture (`$extend *[.sel];`) or a variable holding one (`$extend $type;`)
    // arrives as a BUILT node target — use it directly. (These are single-target;
    // the text-run path below handles literal-selector comma lists.)
    const nodeTargets = children.filter(
      c => !isLeaf(c) && ((c as Node).type === 'SelectorCapture' || (c as Node).type === 'Reference')
    ) as Node[];
    if (nodeTargets.length) {
      const made = nodeTargets.map(t =>
        new Extend({ target: t as never, flag } as never, {}, location) as unknown as Node
      );
      return made.length === 1 ? made[0]! : new List(made as never, undefined, location) as unknown as Node;
    }

    // Group the selector-text leaves into per-target strings, splitting on `,`.
    const targets: Array<{ ns?: string; text: string }> = [];
    let cur: { ns?: string; text: string } = { text: '' };
    for (const it of items) {
      const c = it.comp;
      if (typeof c !== 'string') {
        continue;
      }
      if (c === '$extend' || c === '!exact' || c === ';') {
        continue;
      }
      if (c === ',') {
        if (cur.text || cur.ns) {
          targets.push(cur);
        }
        cur = { text: '' };
        continue;
      }
      if (c.endsWith('|')) {
        cur.ns = c.slice(0, -1);
        continue;
      }
      cur.text += c;
    }
    if (cur.text || cur.ns) {
      targets.push(cur);
    }

    // The target must be a Selector NODE (Extend.writeSyntax calls target.write­
    // Syntax); a bare string crashes it. Wrap the selector text in a BasicSelector
    // (same shape core's `asExtendSelectorNode` produces for a string).
    const makeExtend = (t: { ns?: string; text: string }): Node =>
      new Extend(
        {
          target: new BasicSelector(t.text, undefined, location) as never,
          flag,
          ...(t.ns ? { namespace: t.ns } : {})
        } as never,
        {},
        location
      ) as unknown as Node;

    if (targets.length <= 1) {
      return makeExtend(targets[0] ?? { text: '' });
    }
    return new List(targets.map(makeExtend) as never, undefined, location) as unknown as Node;
  }

  // ── `$apply` — selectors as mixins ────────────────────────────────────────────
  // `$apply .rounded, .shadow;` → one mixin CALL per listed selector, each of the
  // shape `$ > *[.sel]()`: a `Call` whose name is a base-less `type:'mixin'`
  // Reference keyed by a `SelectorCapture` of that selector (`$apply .foo` ≈
  // `$ > *[.foo]`; adjudicated — surface is `$apply <list>`, never `$|…`). A single
  // selector → the lone Call; a comma list → a List of Calls.
  private _buildJessApply(rawChildren: ReadonlyArray<CSTLike>, location: LocationInfo): Node {
    // Reassemble per-selector text from the leaf run, splitting on `,` (`$apply`
    // and `;` dropped). Each selector is one apply target.
    const selectors: string[] = [];
    let cur = '';
    for (const it of spannedComponents(rawChildren)) {
      const c = it.comp;
      if (typeof c !== 'string') {
        continue;
      }
      if (c === '$apply' || c === ';') {
        continue;
      }
      if (c === ',') {
        if (cur) {
          selectors.push(cur);
        }
        cur = '';
        continue;
      }
      cur += c;
    }
    if (cur) {
      selectors.push(cur);
    }

    const makeApplyCall = (sel: string): Node => {
      const capture = new SelectorCapture(
        new BasicSelector(sel, undefined, location) as never,
        undefined,
        location
      );
      const base = new Reference('', { type: 'variable' }, location);
      const name = new Reference(
        { target: base, key: capture } as unknown as ReferenceValue,
        { type: 'mixin' },
        location
      );
      return new Call(
        { name, args: new List([], undefined, location) } as never,
        undefined,
        location
      ) as unknown as Node;
    };

    if (selectors.length <= 1) {
      return makeApplyCall(selectors[0] ?? '');
    }
    return new List(selectors.map(makeApplyCall) as never, undefined, location) as unknown as Node;
  }

  // ── Jess `@-` at-rules ────────────────────────────────────────────────────────
  // The quoted path arrives as a built `Quoted` node child; namespace / `as` / import
  // specifier names arrive as leaves. `@-compose`/`@-export`/`@-import` → StyleImport;
  // `@-use`/`@-from` → JsImport (distinct `source` per adjudication #3).

  private _importPath(children: ReadonlyArray<Node | CSTLike>): Node {
    return children.find(c => !isLeaf(c) && (c as Node).type === 'Quoted') as Node;
  }

  // Read the namespace after an `as` leaf (`as theme` / `as *`) from a leaf run.
  private _asNamespace(rawChildren: ReadonlyArray<CSTLike>): string | undefined {
    const comps = spannedComponents(rawChildren).map(i => i.comp);
    const asIdx = comps.indexOf('as');
    if (asIdx >= 0 && typeof comps[asIdx + 1] === 'string') {
      return comps[asIdx + 1] as string;
    }
    return undefined;
  }

  // `@-compose 'path' [as ns|*];` → StyleImport{ type: 'compose' }.
  private _buildJessCompose(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const path = this._importPath(children);
    const namespace = this._asNamespace(rawChildren);
    return new StyleImport(
      { path } as never,
      { type: 'compose', importOptions: {}, ...(namespace ? { namespace } : {}) } as never,
      location
    ) as unknown as Node;
  }

  // `@-export 'path';` → StyleImport{ type: 'compose', importOptions: { forward } }.
  private _buildJessExport(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const path = this._importPath(children);
    return new StyleImport(
      { path } as never,
      { type: 'compose', importOptions: { forward: true } } as never,
      location
    ) as unknown as Node;
  }

  // `@-import 'path';` → StyleImport{ type: 'import' }. (Renders `@import` — core
  // deliberately overlaps the CSS at-rule; it does NOT round-trip to `@-import`.)
  private _buildJessImportAt(children: ReadonlyArray<Node | CSTLike>, location: LocationInfo): Node {
    const path = this._importPath(children);
    return new StyleImport(
      { path } as never,
      { type: 'import', importOptions: {} } as never,
      location
    ) as unknown as Node;
  }

  // `@-use 'path' [as ns];` → JsImport{ source: 'use' } (namespace-module form).
  private _buildJessUse(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const path = this._importPath(children);
    const namespace = this._asNamespace(rawChildren);
    return new JsImport(
      { path } as never,
      { source: 'use', ...(namespace ? { namespace } : {}) } as never,
      location
    ) as unknown as Node;
  }

  // `@-from 'path' import (a, b as c) | * as ns;` → JsImport{ source: 'from' }.
  // ESM-style import: either a namespace import (`* as ns`, one `['*', ns]` spec) or
  // a named-import list (each `name` or `name as alias` → a `[name, alias?]` spec).
  private _buildJessFrom(
    children: ReadonlyArray<Node | CSTLike>,
    rawChildren: ReadonlyArray<CSTLike>,
    location: LocationInfo
  ): Node {
    const path = this._importPath(children);
    // Walk the leaf run after `import`, collecting specifiers. `as` binds the
    // preceding name to the following alias; `(` `)` `,` are structural.
    const comps = spannedComponents(rawChildren)
      .map(i => i.comp)
      .filter((c): c is string => typeof c === 'string');
    const importIdx = comps.indexOf('import');
    const rest = importIdx >= 0 ? comps.slice(importIdx + 1) : [];

    const imports: Array<[string, string] | string> = [];
    let pendingName: string | undefined;
    let expectAlias = false;
    for (const c of rest) {
      if (c === '(' || c === ')' || c === ';') {
        continue;
      }
      if (c === ',') {
        if (pendingName !== undefined) {
          imports.push(pendingName);
        }
        pendingName = undefined;
        expectAlias = false;
        continue;
      }
      if (c === 'as') {
        expectAlias = true;
        continue;
      }
      if (expectAlias) {
        imports.push([pendingName ?? '*', c]);
        pendingName = undefined;
        expectAlias = false;
        continue;
      }
      if (pendingName !== undefined) {
        imports.push(pendingName);
      }
      pendingName = c;
    }
    if (pendingName !== undefined) {
      imports.push(pendingName);
    }

    return new JsImport(
      { path, imports } as never,
      { source: 'from' } as never,
      location
    ) as unknown as Node;
  }

  private _buildForPattern(bindingNames: string[], location: LocationInfo): ForPattern {
    const decls = bindingNames.map(
      name => new VarDeclaration({ name, value: '' } as never, {}, location)
    );
    if (decls.length === 1) {
      return { kind: 'single', value: decls[0]! } as unknown as ForPattern;
    }
    return { kind: 'tuple', values: decls as never } as unknown as ForPattern;
  }
}

/* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
