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
