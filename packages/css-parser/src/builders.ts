/**
 * CssBuilders — builder methods and AST helpers for the CSS grammar.
 *
 * This is the builder-only half of the CSS parser: no grammar rules,
 * no Parséman Parser base class. Grammar rules live in grammar-fn.ts
 * (the macro-compiled functional grammar), which uses CssBuilders via
 * a thin BuilderHost subclass.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

import type { Span } from 'parseman';
import type { CSTLeaf, CSTError } from 'parseman';
import {
  createPackedFieldSpans,
  setPackedFieldSpan,
  createPackedSegmentSpans,
  setPackedSegmentSpan
} from '@jesscss/parser';

import {
  Node,
  type LocationInfo,
  type TriviaMap,
  type Trivia,
  makeTrivia,
  nil,
  Rules, Ruleset,
  type Selector,
  BasicSelector, CompoundSelector, type CompoundSelectorComponent,
  ComplexSelector, type ComplexSelectorValue,
  Combinator,
  SelectorList,
  Declaration, CustomDeclaration,
  Any, Dimension, Num, Color, ColorFormat,
  Sequence, List,
  Call, Paren, Url,
  Quoted,
  AtRule, AtRuleStatement,
  AttributeSelector, type AttributeSelectorValue,
  PseudoSelector
} from '@jesscss/core';

// ---------------------------------------------------------------------------
// Recognized CSS color keywords (full match, case-insensitive). Exported so the
// Less grammar can reuse it instead of maintaining a parallel list.
// ---------------------------------------------------------------------------

export const CSS_COLOR_NAMES = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque',
  'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood',
  'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'currentcolor', 'darkblue', 'darkcyan', 'darkgoldenrod',
  'darkgray', 'darkgrey', 'darkgreen', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon',
  'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey',
  'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey',
  'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'grey', 'green', 'greenyellow',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgrey', 'lightgreen',
  'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray',
  'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose',
  'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'transparent',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'
]);

// Pseudo-classes/elements whose argument is itself a selector (kept structured).
const SELECTOR_PSEUDOS = new Set([
  'is', 'where', 'not', 'has', 'matches', 'any', '-moz-any', '-webkit-any',
  'host', 'host-context', 'slotted', 'nth-child', 'nth-last-child',
  'nth-of-type', 'nth-last-of-type'
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JessNode = Node<any, any>;
type Child = JessNode | CSTLeaf | CSTError;

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function spanToLocation(span: Span): LocationInfo {
  return [span.start, 0, 0, span.end, 0, 0];
}

function nodeChildren(children: ReadonlyArray<Child>): JessNode[] {
  return children.filter((c): c is JessNode => c._tag === 'node') as JessNode[];
}

function leafText(children: ReadonlyArray<Child>): string {
  return children
    .filter((c): c is CSTLeaf => c._tag === 'leaf')
    .map(l => l.value)
    .join('');
}

export type Component = string | JessNode;

export function toComponent(c: unknown): Component | null {
  if (typeof c === 'string') {
    return c;
  }
  if (c && typeof c === 'object' && '_tag' in c) {
    const tag = (c as { _tag: string })._tag;
    if (tag === 'leaf') {
      return (c as CSTLeaf).value;
    }
    if (tag === 'node') {
      return c as JessNode;
    }
  }
  return null;
}

export type Spanned = { comp: Component; span: Span };

export function spannedComponents(rawChildren: ReadonlyArray<{ _tag: string }>): Spanned[] {
  const out: Spanned[] = [];
  for (const rc of rawChildren as Array<{ _tag: string; value?: string; span?: Span }>) {
    if (rc._tag === 'leaf' && rc.span) {
      out.push({ comp: rc.value ?? '', span: rc.span });
    } else if (rc._tag === 'node' && (rc as unknown as JessNode).span) {
      out.push({ comp: rc as unknown as JessNode, span: (rc as unknown as JessNode).span });
    }
  }
  return out;
}

export function setFieldSpan(node: JessNode, fieldIndex: number, fieldCount: number, span: Span) {
  const n = node as unknown as { fieldSpans?: number[] };
  n.fieldSpans ??= createPackedFieldSpans(fieldCount);
  setPackedFieldSpan(n.fieldSpans, fieldIndex, span.start, span.end);
}

export function setValueSpans(node: JessNode, spans: ReadonlyArray<Span>) {
  const packed = createPackedSegmentSpans(spans.length);
  spans.forEach((s, i) => setPackedSegmentSpan(packed, i, s.start, s.end));
  (node as unknown as { valueSpans?: number[] }).valueSpans = packed;
}

export function fieldIndexOf(node: JessNode, key: string): { index: number; count: number } {
  const keys = (node.constructor as unknown as { childKeys?: readonly string[] }).childKeys ?? [];
  return { index: keys.indexOf(key), count: keys.length };
}

// ---------------------------------------------------------------------------
// Parse result + trivia
// ---------------------------------------------------------------------------

/**
 * Build a TriviaMap backed by the flat log written by scanTrivia during parsing.
 * log = [runStart_0, runEnd_0, ...] — two numbers per run.
 * The before/after Maps are built lazily on first lookup.
 */
export function buildLazyTriviaMap(log: number[], src: string): TriviaMap {
  let before: Map<number, Trivia> | undefined;
  let after: Map<number, Trivia> | undefined;

  const build = () => {
    before = new Map<number, Trivia>();
    after = new Map<number, Trivia>();
    for (let i = 0; i < log.length; i += 2) {
      const run = makeTrivia(src, log[i]!, log[i + 1]!);
      after.set(log[i]!, run);
      before.set(log[i + 1]!, run);
    }
  };

  return {
    lookup(offset, direction) {
      if (offset === undefined) {
        return undefined;
      }
      if (!before) {
        build();
      }
      return direction === 'before' ? before!.get(offset) : after!.get(offset);
    },
    entries(direction) {
      if (!before) {
        build();
      }
      return (direction === 'before' ? before! : after!).entries();
    },
    has(offset, direction) {
      if (offset === undefined) {
        return false;
      }
      if (!before) {
        build();
      }
      return (direction === 'before' ? before! : after!).has(offset);
    }
  };
}

export type CssParseResult<T extends Node = Node> = {
  tree: T;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string }>;
  trivia: TriviaMap;
};

// ---------------------------------------------------------------------------
// Helpers used by builders
// ---------------------------------------------------------------------------

/** True if [start, end) in src contains whitespace outside a block comment. */
// AUDIT - Massive code smell. Either Parseman has a big API gap or we're doing something dumb.
function hasWhitespaceOutsideComments(src: string, start: number, end: number): boolean {
  let i = start;
  while (i < end) {
    const c = src.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) {
      return true;
    }
    if (c === 47 && i + 1 < end && src.charCodeAt(i + 1) === 42) {
      i += 2;
      while (i + 1 < end && !(src.charCodeAt(i) === 42 && src.charCodeAt(i + 1) === 47)) {
        i++;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return false;
}

// ---------------------------------------------------------------------------
// CssParser — builder methods only (no grammar rules, no Parser base).
// Subclassed by BuilderHost in grammar-fn.ts to provide an instance for mk().
// ---------------------------------------------------------------------------

export class CssParser {
  protected _source = '';
  protected _strictEOF = false;
  protected _warnings: Array<{ message: string; deprecation?: string }> = [];
  protected _errors: Array<{ message: string; offset?: number }> = [];

  protected _warn(message: string, deprecation?: string) {
    this._warnings.push(deprecation ? { message, deprecation } : { message });
  }

  protected _error(message: string, offset?: number) {
    this._errors.push(offset !== undefined ? { message, offset } : { message });
  }

  // ── buildNode ─────────────────────────────────────────────────────────────
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */

  protected buildNode(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    state: unknown,
    rawChildren: ReadonlyArray<{ _tag: string }>
  ) {
    return this._dispatchBuild(type, span, children, rawChildren);
  }

  protected _dispatchBuild(
    type: string,
    span: Span,
    children: ReadonlyArray<JessNode | CSTLeaf | CSTError>,
    rawChildren: ReadonlyArray<{ _tag: string }>
  ) {
    const loc = spanToLocation(span);
    switch (type) {
      case 'Stylesheet':        return this._buildStylesheet(children, loc);
      case 'Ruleset':           return this._buildRuleset(children, rawChildren, loc) as unknown as JessNode;
      case 'SelectorList':      return this._buildSelectorList(rawChildren, loc);
      case 'ComplexSelector':   return this._buildComplexSelector(rawChildren, loc);
      case 'CompoundSelector':  return this._buildCompoundSelector(rawChildren, span);
      case 'AttributeSelector': return this._buildAttributeSelector(children, loc);
      case 'PseudoSelector':    return this._buildPseudoSelector(children, loc);
      case 'Declaration':       return this._buildDeclaration(rawChildren, loc);
      case 'CustomDeclaration': return this._buildCustomDeclaration(children, loc);
      case 'Dimension':         return this._buildDimension(children, loc);
      case 'Num':               return new Num(parseFloat(leafText(children)), undefined, loc);
      case 'Color':             return this._buildColor(leafText(children), loc);
      case 'Url':               return this._buildUrl(children, loc);
      case 'Call':              return this._buildCall(rawChildren, loc);
      case 'Paren':             return this._buildParen(rawChildren, loc);
      case 'SquareParen':       return this._buildSquareParen(rawChildren, loc);
      case 'Quoted':            return this._buildQuoted(children, loc);
      case 'AtRuleBlock':       return this._buildAtRuleBlock(children, loc) as unknown as JessNode;
      case 'AtRuleStatement':   return this._buildAtRuleStatement(children, loc);
      case 'BadStatement':      return this._buildBadStatement(loc) as unknown as JessNode;
      default:                  return new Any(leafText(children) || type, {}, loc);
    }
  }

  /**
   * The grammar's last-resort catch-all (a `scanTo` arm) matched, meaning no real
   * rule could parse this run of input. Record ONE syntax error (first failure
   * wins — default "1 error and stop") and return a bare string so the swallowed
   * text drops out of the AST instead of becoming a node. Empty / `;`-only runs
   * are normal recovery and are not errors.
   */
  protected _buildBadStatement(loc: LocationInfo): string {
    // NOTE: error emission still DISABLED. After the css completeness fixes
    // (!important case, &-nesting, at-rule body recovery, custom-property nesting
    // via parseman balanced(), legacy star-hack) the catch-all's false positives
    // dropped from 7 to 2: (1) escape.css — CSS escape forms the grammar still
    // doesn't cover (\;, url(a;a), \62 olor, \@noat); (2) atrule-unknown.css — an
    // UNKNOWN at-rule body is opaque, so the net must not error inside it (a
    // context-aware suppression, not a completeness gap). Resolve both, then enable.
    void loc;
    return '';
  }

  protected _buildStylesheet(children: ReadonlyArray<Child>, loc: LocationInfo) {
    return new Rules(nodeChildren(children), undefined, loc);
  }

  protected _buildRuleset(
    children: ReadonlyArray<Child>,
    rawChildren: ReadonlyArray<{ _tag: string }>,
    loc: LocationInfo
  ) {
    const sel = spannedComponents(rawChildren)[0];
    const selector = (sel?.comp ?? '') as string | Selector;
    const rules = nodeChildren(children.slice(1));
    const node = new Ruleset({ selector, rules }, undefined, loc);
    if (sel) {
      const { index, count } = fieldIndexOf(node as unknown as JessNode, 'selector');
      if (index >= 0) {
        setFieldSpan(node as unknown as JessNode, index, count, sel.span);
      }
    }
    return node;
  }

  protected _buildSelectorList(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren).filter(i => i.comp !== ',');
    if (items.length === 1) {
      return items[0]!.comp as unknown as JessNode;
    }
    const node = new SelectorList(
      items.map(i => i.comp) as unknown as (Selector | string)[],
      undefined, loc
    );
    setValueSpans(node as unknown as JessNode, items.map(i => i.span));
    return node;
  }

  protected _buildComplexSelector(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    if (items.length === 1) {
      return items[0]!.comp as unknown as JessNode;
    }
    const node = new ComplexSelector(
      items.map(i => i.comp) as unknown as ComplexSelectorValue,
      undefined, loc
    );
    setValueSpans(node as unknown as JessNode, items.map(i => i.span));
    return node;
  }

  protected _buildCompoundSelector(
    rawChildren: ReadonlyArray<{ _tag: string }>,
    span: Span
  ) {
    const loc = spanToLocation(span);
    const parts: Component[] = [];
    const partSpans: Span[] = [];
    let group: Spanned[] = [];

    const flush = () => {
      if (group.length === 0) {
        return;
      }
      if (group.length === 1) {
        parts.push(group[0]!.comp);
        partSpans.push(group[0]!.span);
      } else {
        const start = group[0]!.span.start;
        const end = group[group.length - 1]!.span.end;
        const compound = new CompoundSelector(
          group.map(g => g.comp) as unknown as CompoundSelectorComponent[],
          undefined,
          spanToLocation({ start, end })
        );
        setValueSpans(compound as unknown as JessNode, group.map(g => g.span));
        parts.push(compound as unknown as JessNode);
        partSpans.push({ start, end });
      }
      group = [];
    };

    let prevEnd = span.start;
    for (const rc of rawChildren as Array<{ _tag: string; value?: string; span?: Span }>) {
      if ((rc._tag !== 'leaf' && rc._tag !== 'node') || !rc.span) {
        continue;
      }
      if (group.length > 0 && hasWhitespaceOutsideComments(this._source, prevEnd, rc.span.start)) {
        const prevSpanEnd = group[group.length - 1]!.span.end;
        flush();
        parts.push(' ');
        partSpans.push({ start: prevSpanEnd, end: rc.span.start });
      }
      group.push({
        comp: rc._tag === 'leaf' ? (rc.value ?? '') : (rc as unknown as JessNode),
        span: rc.span
      });
      prevEnd = rc.span.end;
    }
    flush();

    if (parts.length === 1) {
      return parts[0]! as unknown as JessNode;
    }
    const node = new ComplexSelector(parts as unknown as ComplexSelectorValue, undefined, loc);
    setValueSpans(node as unknown as JessNode, partSpans);
    return node;
  }

  protected _buildAttributeSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children
      .filter((c): c is CSTLeaf => c._tag === 'leaf')
      .filter(l => l.value !== '[' && l.value !== ']');
    const name = ls[0]?.value ?? '';
    const opRe = /^[*~|^$]?=$/;
    const opIdx = ls.findIndex(l => opRe.test(l.value));
    const rawValue = opIdx >= 0 ? ls[opIdx + 1]?.value : undefined;
    const attrNode: AttributeSelectorValue = {
      name,
      ...(opIdx >= 0 ? { op: ls[opIdx]!.value } : {}),
      ...(rawValue !== undefined ? { value: this._attrValueNode(rawValue, loc) } : {}),
      ...(opIdx >= 0 && ls[opIdx + 2] ? { mod: ls[opIdx + 2]!.value } : {})
    };
    return new AttributeSelector(attrNode, undefined, loc);
  }

  protected _attrValueNode(raw: string, loc: LocationInfo) {
    if ((raw.startsWith('\'') && raw.endsWith('\'')) || (raw.startsWith('"') && raw.endsWith('"'))) {
      return new Quoted(raw.slice(1, -1), { quote: raw[0] as '"' | '\'' }, loc);
    }
    return new Any(raw, {}, loc);
  }

  protected _buildPseudoSelector(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const prefix = ls[0]?.value ?? ':';
    const pseudoName = ls[1]?.value ?? '';
    const argNode = nodeChildren(children)[0] as Node | undefined;
    let arg = argNode;
    let argValueSpans: number[] | undefined;
    if (argNode && !SELECTOR_PSEUDOS.has(pseudoName.toLowerCase())) {
      const v = (argNode as unknown as { value?: unknown }).value;
      if (Array.isArray(v)) {
        arg = v as unknown as Node;
        argValueSpans = (argNode as unknown as { valueSpans?: number[] }).valueSpans;
      }
    }
    const node = new PseudoSelector({ name: prefix + pseudoName, arg }, undefined, loc);
    if (argValueSpans) {
      (node as unknown as { valueSpans?: number[] }).valueSpans = argValueSpans;
    }
    return node;
  }

  protected _buildDeclaration(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const nameItem = items[0];
    const name = (typeof nameItem?.comp === 'string' ? nameItem.comp : '') || '';
    const colonIdx = items.findIndex(i => i.comp === ':');
    let end = items.length;
    for (let i = colonIdx + 1; i < items.length; i++) {
      const c = items[i]!.comp;
      if (c === '!' || c === 'important' || c === ';') {
        end = i;
        break;
      }
    }
    const valueItems = items.slice(colonIdx + 1, end);
    const { value, span: valueSpan } = this._assembleValue(valueItems, loc);
    const hasImportant = items.some(i => i.comp === '!');
    const node = new Declaration(
      { name, value, important: hasImportant || undefined },
      undefined, loc
    );
    const jn = node as unknown as JessNode;
    const { index: nameIdx, count } = fieldIndexOf(jn, 'name');
    if (nameItem && nameIdx >= 0) {
      setFieldSpan(jn, nameIdx, count, nameItem.span);
    }
    const valueIdx = fieldIndexOf(jn, 'value').index;
    if (valueSpan && valueIdx >= 0) {
      setFieldSpan(jn, valueIdx, count, valueSpan);
    }
    return node;
  }

  protected _assembleValue(items: Spanned[], loc: LocationInfo): { value: Component; span: Span | undefined } {
    const content = items.filter(i => i.comp !== ',');
    if (content.length === 0) {
      return { value: new Any('', {}, loc), span: undefined };
    }
    const span: Span = {
      start: content[0]!.span.start,
      end: content[content.length - 1]!.span.end
    };
    const segments: Spanned[][] = [[]];
    for (const it of items) {
      if (it.comp === ',') {
        segments.push([]);
      } else {
        segments.at(-1)!.push(it);
      }
    }
    const segValues = segments.map(seg => this._assembleSegment(seg, loc));
    if (segValues.length === 1) {
      return { value: segValues[0]!, span };
    }
    const listValues = segValues.map((v) => {
      if (!Array.isArray(v)) {
        return v;
      }
      const parts = (v as Component[]).map(c =>
        typeof c === 'string' ? (new Any(c, { role: 'ident' }, loc) as unknown as Component) : c);
      return new Sequence(parts as unknown as Node[], undefined, loc) as unknown as Component;
    });
    const list = new List(listValues as unknown as Node[], undefined, loc);
    setValueSpans(list as unknown as JessNode, segments.map(seg => ({
      start: seg[0]!.span.start,
      end: seg[seg.length - 1]!.span.end
    })));
    return { value: list as unknown as Component, span };
  }

  protected _assembleSegment(seg: Spanned[], loc: LocationInfo): Component {
    if (seg.length === 1) {
      return seg[0]!.comp;
    }
    const grouped = this._groupSlashes(seg.map(s => s.comp), loc);
    if (grouped.length === 1) {
      return grouped[0]!;
    }
    return grouped as unknown as Component;
  }

  protected _groupSlashes(comps: Component[], loc: LocationInfo): Component[] {
    if (!comps.includes('/' as unknown as Component)) {
      return comps;
    }
    const asNode = (c: Component): Component =>
      typeof c === 'string' ? (new Any(c, { role: 'ident' }, loc) as unknown as Component) : c;
    const out: Component[] = [];
    let i = 0;
    while (i < comps.length) {
      if (i + 1 < comps.length && comps[i + 1] === ('/' as unknown as Component)) {
        const run: Component[] = [asNode(comps[i]!)];
        i += 1;
        while (i < comps.length && comps[i] === ('/' as unknown as Component)) {
          i += 1;
          if (i < comps.length) {
            run.push(asNode(comps[i]!));
            i += 1;
          }
        }
        out.push(new List(run as unknown as Node[], { sep: '/' } as any, loc) as unknown as Component);
      } else {
        out.push(comps[i]!);
        i += 1;
      }
    }
    return out;
  }

  protected _buildCustomDeclaration(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const propName = ls[0]?.value ?? '';
    const valueText = ls.slice(2).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new CustomDeclaration(
      { name: propName, value: new Any(valueText, {}, loc) },
      undefined, loc
    );
  }

  protected _buildDimension(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    return new Dimension(
      { number: parseFloat(ls[0]?.value ?? '0'), unit: ls[1]?.value ?? '' },
      undefined, loc
    );
  }

  protected _buildColor(text: string, loc: LocationInfo) {
    return new Color(text, { format: ColorFormat.HEX }, loc);
  }

  protected _buildUrl(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const innerNode = nodeChildren(children)[0];
    if (innerNode) {
      return new Url(innerNode as Node, undefined, loc);
    }
    const inner = ls
      .filter(l => !/^url\($/i.test(l.value) && l.value !== ')')
      .map(l => l.value).join('').trim();
    return new Url(inner as unknown as Node, undefined, loc);
  }

  protected _buildCall(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const name = typeof items[0]?.comp === 'string' ? items[0]!.comp : '';
    if (!items.some(it => it.comp === '(')) {
      return name;
    }
    const args = this._assembleArgs(this._betweenParens(items), loc);
    return new Call({ name, args: args as unknown as List<Node> }, undefined, loc);
  }

  protected _buildParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const inner = this._betweenParens(spannedComponents(rawChildren));
    const { value } = this._assembleValue(inner, loc);
    return new Paren(value as unknown as Node, undefined, loc);
  }

  protected _buildSquareParen(rawChildren: ReadonlyArray<{ _tag: string }>, loc: LocationInfo) {
    const items = spannedComponents(rawChildren);
    const open = items.findIndex(i => i.comp === '[');
    let close = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.comp === ']') {
        close = i;
        break;
      }
    }
    const inner = items.slice(open + 1, close);
    const { value } = this._assembleValue(inner, loc);
    return new Paren(value as unknown as Node, { delimiter: 'square' } as any, loc);
  }

  protected _betweenParens(items: Spanned[]): Spanned[] {
    const open = items.findIndex(i => i.comp === '(');
    let close = items.length;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.comp === ')') {
        close = i;
        break;
      }
    }
    return items.slice(open + 1, close);
  }

  protected _assembleArgs(items: Spanned[], loc: LocationInfo) {
    if (items.some(it => it.comp === ';')) {
      const semiSegs: Spanned[][] = [[]];
      for (const it of items) {
        if (it.comp === ';') {
          semiSegs.push([]);
        } else {
          semiSegs.at(-1)!.push(it);
        }
      }
      const parts = semiSegs.filter(s => s.length > 0).map(s => this._assembleArgs(s, loc));
      return new List(parts as unknown as Node[], { sep: ';' } as any, loc);
    }
    const segments: Spanned[][] = [[]];
    for (const it of items) {
      if (it.comp === ',') {
        segments.push([]);
      } else {
        segments.at(-1)!.push(it);
      }
    }
    const nonEmpty = segments.filter(s => s.length > 0);
    const values = nonEmpty.map((seg) => {
      const assembled = this._assembleSegment(seg, loc);
      if (Array.isArray(assembled)) {
        const parts = (assembled as Component[]).map(c => this._argComponent(c, loc));
        return new Sequence(parts as unknown as Node[], undefined, loc) as unknown as Component;
      }
      return this._argComponent(assembled, loc);
    });
    const list = new List(values as unknown as Node[], undefined, loc);
    if (nonEmpty.length) {
      setValueSpans(list as unknown as JessNode, nonEmpty.map(seg => ({
        start: seg[0]!.span.start,
        end: seg[seg.length - 1]!.span.end
      })));
    }
    return list;
  }

  protected _argComponent(comp: Component, loc: LocationInfo): Component {
    const colored = this._colorize(comp, loc);
    if (typeof colored === 'string') {
      return new Any(colored, { role: 'ident' }, loc) as unknown as Component;
    }
    return colored;
  }

  protected _colorize(comp: Component, loc: LocationInfo): Component {
    if (typeof comp === 'string' && CSS_COLOR_NAMES.has(comp.toLowerCase())) {
      return new Color({ node: comp }, {}, loc) as unknown as Component;
    }
    return comp;
  }

  protected _buildQuoted(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const text = leafText(children);
    return new Quoted(text.slice(1, -1), { quote: text[0] as '"' | '\'' }, loc);
  }

  protected _buildAtRuleBlock(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    const preludeText = ls.slice(1)
      .find(l => l.value !== '{' && l.value !== '}')
      ?.value.trim();
    const preludeNode = preludeText
      ? new List(
        preludeText.split(/[ \t\n\r\f]+/).map(tok => new Any(tok, { role: 'ident' }, loc)),
        undefined, loc
      )
      : undefined;
    return new AtRule(
      { name, prelude: preludeNode, rules: nodeChildren(children) },
      undefined, loc
    );
  }

  protected _buildAtRuleStatement(children: ReadonlyArray<Child>, loc: LocationInfo) {
    const ls = children.filter((c): c is CSTLeaf => c._tag === 'leaf');
    const name = ls[0]?.value ?? '';
    if (name.toLowerCase() === '@charset') {
      const text = this._source.slice(loc[0], loc[3]);
      return new Any(text, { role: 'charset' }, loc);
    }
    const preludeText = ls.slice(1).filter(l => l.value !== ';').map(l => l.value).join('').trim();
    return new AtRuleStatement(
      { name, prelude: preludeText ? new Any(preludeText, {}, loc) : undefined },
      undefined, loc
    );
  }
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
