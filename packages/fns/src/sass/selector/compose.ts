/**
 * `&` composition over parsed selectors, as Dart Sass's `selector.nest()` and
 * `selector.append()` compose them. Every selector is read by the dialect's
 * selector-list production ({@link readSelector}) and composed from its parsed
 * compounds and combinators; the result is the selector value `&` and
 * `selector.parse()` are, never text read again.
 */
import { interleave, selectorValue, type FnCtx, type ValueGroup } from '@jesscss/core/value';
import { pseudoHasAmpersand, pseudoJoin, simpleSelector, simpleSelectorIsPlaceholder, simpleTokenText, textHoldsParentRef } from '@jesscss/core/ast';
import type { Combinator, SelectorBranch, SelectorTerm, SimpleSelector, SimpleToken } from '@jesscss/core/ast';
import { readSelector } from './parse.js';

/**
 * A selector as it is composed: its compounds, each the simple selectors it is,
 * and the combinators written between them. Two compounds side by side are a
 * descendant pair, so joining two selectors is joining their parts.
 */
type Complex = readonly (Combinator | readonly SimpleToken[])[];

const termSimples = (term: SelectorTerm): readonly SimpleToken[] => term.type === 'CompoundSelector' ? term.value : [term];

function complexOf(branch: SelectorBranch): Complex {
  if (branch.type !== 'ComplexSelector' && branch.type !== 'RelativeSelector') {
    return [termSimples(branch)];
  }
  const out: (Combinator | readonly SimpleToken[])[] = [];
  for (const part of branch.value) {
    if (typeof part !== 'string') {
      out.push(termSimples(part));
    } else if (part !== ' ') {
      out.push(part);
    }
  }
  return out;
}

const components = (complex: Complex): string[] =>
  complex.map(part => typeof part === 'string' ? part : part.map(simpleTokenText).join(''));

const complexText = (complex: Complex): string => components(complex).join(' ');

const listText = (list: readonly Complex[]): string => list.map(complexText).join(', ');

/** The `$selectors` arguments, each read as the selectors it holds. */
function readAll(items: readonly ValueGroup[], ctx: FnCtx, parents: boolean): Complex[][] {
  if (items.length === 0) {
    throw new TypeError('$selectors: At least one selector must be passed.');
  }
  return items.map(item => readSelector(item, ctx, '', parents).map(complexOf));
}

/** The parser's `&` token, alone or opening a name it continues (`&`, `&-x`, `&__el`). */
const isParent = (simple: SimpleToken): simple is SimpleSelector & { text: string } =>
  simple.type === 'SimpleSelector' && simple.text !== null && textHoldsParentRef(simple.text);

const holdsParent = (simple: SimpleToken): boolean => simple.type === 'PseudoSelector' ? pseudoHasAmpersand(simple) : isParent(simple);

const complexHoldsParent = (complex: Complex): boolean => complex.some(part => typeof part !== 'string' && part.some(holdsParent));

/**
 * `simple` with `suffix` continuing its name (`.a` and `-x` are `.a-x`). Only a
 * simple selector that ends with a name has one to continue: a class, id,
 * placeholder, type or argument-less pseudo; an attribute, universal or
 * functional pseudo selector has none.
 */
function withSuffix(simple: SimpleToken, suffix: string): SimpleToken {
  const text = simpleTokenText(simple);
  const named = simple.type === 'PseudoSelector'
    ? simple.args === null && simple.arg === null && !endsUnescaped(text, ')')
    : !isParent(simple) && !text.startsWith('[') && !endsUnescaped(text, ')') && !endsUnescaped(text, '*');
  if (!named) {
    throw new TypeError(`Selector "${text}" can't have a suffix`);
  }
  return simpleSelector(text + suffix);
}

/**
 * Whether `text` ends with `char` as written rather than escaped (`.a\*` is the
 * class `a*`). A simple selector the parser reduced to text keeps no kind, so its
 * last character says whether it ends with a name. ponytail: an escaped
 * backslash before that character (`.a\\*`) reads as an escape of it.
 */
const endsUnescaped = (text: string, char: string): boolean => text.endsWith(char) && text[text.length - 2] !== '\\';

/** Whether a type selector's text names a namespace (`ns|b`, `*|b`, `|b`), its `|` as written rather than escaped. */
const namespaced = (text: string): boolean => /(?:^|[^\\])\|/.test(text);

/**
 * `parent` with `suffix` glued onto its last simple selector and `rest` after it,
 * in its last compound: where an `&` compound (`&-x.b`) or an appended compound
 * stands in for `parent`.
 */
function joinCompound(parent: Complex, suffix: string, rest: readonly SimpleToken[]): Complex {
  const last = parent[parent.length - 1];
  if (last === undefined || typeof last === 'string') {
    throw new TypeError(`Selector "${complexText(parent)}" can't be used as a parent in a compound selector.`);
  }
  const simples = suffix === '' ? last : [...last.slice(0, -1), withSuffix(last[last.length - 1]!, suffix)];
  return [...parent.slice(0, -1), [...simples, ...rest]];
}

/**
 * What one compound of a child selector is under `parents`, one entry per
 * selector it becomes: a pseudo whose selector argument holds `&` has that
 * argument nested in all of `parents` (`:not(&)` under `.a, .b` is
 * `:not(.a, .b)`), and an opening `&` stands for each parent in turn.
 */
function compoundWithin(simples: readonly SimpleToken[], parents: readonly Complex[]): readonly Complex[] {
  if (simples.slice(1).some(isParent)) {
    throw new TypeError('"&" may only used at the beginning of a compound selector.');
  }
  const resolved = simples.map(simple => simple.type === 'PseudoSelector' && simple.args !== null && pseudoHasAmpersand(simple)
    ? simpleSelector(pseudoJoin(simple, nestWithin(parents, simple.args.selectors.map(complexOf), false).map(complexText)))
    : simple);
  const first = simples[0]!;
  if (!isParent(first)) {
    return [[resolved]];
  }
  const suffix = first.text.slice(1);
  return suffix === '' && resolved.length === 1 ? parents : parents.map(parent => joinCompound(parent, suffix, resolved.slice(1)));
}

/**
 * `children` nested in `parents`, as Dart Sass nests a selector list: a child
 * with no `&` follows each parent (when `implicit`; a pseudo's argument has no
 * implicit parent), each `&` of a child stands for each parent in turn, the
 * leftmost `&` most significant, and the children's results interleave.
 */
function nestWithin(parents: readonly Complex[], children: readonly Complex[], implicit = true): Complex[] {
  return interleave(children.map((child) => {
    if (!complexHoldsParent(child)) {
      return implicit ? parents.map(parent => [...parent, ...child]) : [child];
    }
    let out: Complex[] = [[]];
    for (const part of child) {
      const options = typeof part === 'string' ? [[part]] : compoundWithin(part, parents);
      out = out.flatMap(done => options.map(option => [...done, ...option]));
    }
    return out;
  }));
}

/**
 * `children` appended to `parents`, as Dart Sass's `selector.append()` does: each
 * child's first compound is glued onto each parent's last, a type selector
 * opening it continuing the parent's last name (`.a` and `-b` are `.a-b`). A child
 * that opens with a combinator, a universal selector or a namespace has nothing
 * to glue.
 */
function appendTo(parents: readonly Complex[], children: readonly Complex[]): Complex[] {
  return interleave(children.map((child) => {
    const [head, ...rest] = child;
    const first = head === undefined || typeof head === 'string' ? undefined : head[0];
    const text = first === undefined ? '' : simpleTokenText(first);

    /* A type, universal or namespaced selector: a simple selector the parser reduced to text that opens with no other selector's sigil. */
    const type = first?.type === 'SimpleSelector' && !simpleSelectorIsPlaceholder(first) && !/^[.#:[]/.test(text);
    if (head === undefined || typeof head === 'string' || first === undefined || (type && (text.startsWith('*') || namespaced(text)))) {
      throw new TypeError(`Can't append ${complexText(child)} to ${listText(parents)}.`);
    }
    return parents.map(parent => [...joinCompound(parent, type ? text : '', type ? head.slice(1) : head), ...rest]);
  }));
}

const valueOf = (list: readonly Complex[]): ValueGroup => selectorValue(list.map(components));

/** Sass `selector.nest($selectors...)` / the global `selector-nest()`: each selector nested in the ones before it. */
export function nestSelectors(items: readonly ValueGroup[], ctx: FnCtx): ValueGroup {
  const [first, ...rest] = readAll(items, ctx, true);
  return valueOf(rest.reduce((parents, children) => nestWithin(parents, children), first!));
}

/** Sass `selector.append($selectors...)` / the global `selector-append()`: each selector appended to the ones before it. */
export function appendSelectors(items: readonly ValueGroup[], ctx: FnCtx): ValueGroup {
  const [first, ...rest] = readAll(items, ctx, false);
  return valueOf(rest.reduce(appendTo, first!));
}
