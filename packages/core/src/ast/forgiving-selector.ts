/**
 * `:is()` and `:where()` take a `<forgiving-selector-list>` (Selectors 4 §4.2,
 * §4.4, §16.1): an item that is not a selector is dropped by a browser and
 * the others still match. Owner 2026-10-20: *"it should parse then... sure
 * warning is ok"*. The parse keeps such an item as written and records it; the
 * compiler warns at it (`css/forgiving-selector-item`).
 */
import { complexSelector, interpolatedSimpleSelector, interpolation, relativeSelector, selectorTermOf, selist, simpleSelector } from './nodes.js';
import type { Interpolation, SelectorBranch, SelectorCapture, SelectorList, SimpleSelector, Stylesheet } from './nodes.js';
import { withSourceSpan, type AstSourceSpan } from './provenance.js';
import { recoveredInTree } from './grammar-helpers.js';
import { appendInterpolationLiteral, authoredSource, branchSegments, isInterpolation, isSelectorBranch, tokenText, withTriviaGaps } from './css-grammar-helpers.js';

/**
 * A `:is()` / `:where()` item a parse kept because it is not a selector
 * (`forgivingSelectorItem`, `forgivingSelectorList`), recorded on the run's
 * `state.document.forgivenSelectorItems` for the compiler's
 * `css/forgiving-selector-item` warning.
 */
export interface ForgivenSelectorItem {
  readonly item: SelectorBranch;

  /** The item as written, without its padding; empty for an empty item. */
  readonly written: string;

  /**
   * The node whose presence in the accepted tree keeps the item
   * ({@link recoveredInTree}): the item, or the `selector(…)` capture that
   * keeps its list as text (`adoptForgivenSelectorItems`).
   */
  recoveredValue: object;
}

/** What `ForgivingSelectorRest` reads: the rest of an item past its selector, one simple holding its text and interpolations. */
export interface ForgivingSelectorRest {
  readonly rest: SimpleSelector;
}

function isForgivingSelectorRest(value: unknown): value is ForgivingSelectorRest {
  return typeof value === 'object' && value !== null && 'rest' in value && !('type' in value);
}

/**
 * The rest of a `:is()` / `:where()` item past its selector, as the grammar
 * read it: text and, in a dialect that reads one there, its interpolations,
 * which evaluate as they do in any selector. The padding before the closing
 * `,` or `)` is not part of it.
 */
export function forgivingSelectorRest(children: readonly unknown[]): ForgivingSelectorRest {
  const parts: Interpolation['parts'] = [];
  for (const child of children) {
    if (isInterpolation(child)) {
      parts.push(...child.parts);
    } else {
      appendInterpolationLiteral(parts, tokenText(child));
    }
  }
  const last = parts[parts.length - 1];
  if (last !== undefined && 'lit' in last) {
    parts[parts.length - 1] = { lit: last.lit.trimEnd() };
  }
  const only = parts.length === 1 ? parts[0] : undefined;
  return { rest: only !== undefined && 'lit' in only ? simpleSelector(only.lit) : interpolatedSimpleSelector(interpolation(parts)) };
}

/**
 * One item of a `:is()` / `:where()` argument. A selector stays the selector
 * it parsed as. An item that is not a selector is kept as written but keeps
 * its structure (owner 2026-10-20: *"it should parse then... sure warning is
 * ok"*): the selector it opens with, then its rest as one simple, joined as
 * written (a space where trivia separated them), so its interpolations and an
 * `&` evaluate as they do in any selector. A browser drops it, so
 * `.card:is(.active, 1px)` matches as `.card:is(.active)`. A relative item
 * (`> .a`, not a `<complex-real-selector>`) is kept and warned too. An empty
 * item is the list's to judge (`forgivingSelectorList`).
 */
export function forgivingSelectorItem(children: readonly unknown[], span: AstSourceSpan, triviaLog: readonly number[], state: unknown): SelectorBranch {
  const prefix = isSelectorBranch(children[0]) ? children[0] : undefined;
  const rest = children.find(isForgivingSelectorRest);
  if (prefix !== undefined && rest === undefined && prefix.type !== 'RelativeSelector') {
    /* A selector item keeps where it is written too, so a capture can report an interpolation in it there. */
    return withSourceSpan(prefix, span);
  }
  const written = authoredSource(span, state, 'A forgiving selector-list item');
  const kept = written.trim();
  const start = span.start + written.length - written.trimStart().length;
  const gapped = withTriviaGaps(children, triviaLog);
  const item = withSourceSpan(
    rest === undefined
      ? prefix ?? simpleSelector('')
      : prefix === undefined ? rest.rest : withRest(prefix, rest.rest, gapped[gapped.indexOf(rest) - 1] === ' '),
    { start, end: start + kept.length }
  );
  if (kept !== '') {
    forgivenSelectorItemsOfState(state)?.push({ item, written: kept, recoveredValue: item });
  }
  return item;
}

/* A selector with the rest of its item after it: as one more compound term past a space, or glued to its last term. */
function withRest(prefix: SelectorBranch, rest: SimpleSelector, spaced: boolean): SelectorBranch {
  const segments = branchSegments(prefix);
  const last = segments[segments.length - 1]!;
  if (spaced) {
    segments.push({ combinator: ' ', term: rest });
  } else {
    const [first, ...more] = last.term.type === 'CompoundSelector' ? last.term.value : [last.term];
    segments[segments.length - 1] = { ...last, term: selectorTermOf([first!, ...more, rest]) };
  }
  if (prefix.type === 'RelativeSelector') {
    return relativeSelector(prefix.value[0], segments);
  }
  const [head, second, ...tail] = segments;
  return second === undefined ? head.term : complexSelector([head, second, ...tail]);
}

/**
 * A `:is()` / `:where()` argument: its items as a selector list. An empty item
 * beside another (`:is(.a,,.b)`, `:is(.a,)`) is dropped by a browser like any
 * item that is not a selector, so it is recorded too; an empty argument
 * (`:is()`) is a valid selector that matches nothing.
 */
export function forgivingSelectorList(children: readonly unknown[], state: unknown): SelectorList {
  const items = children.filter(isSelectorBranch);
  if (items.length > 1) {
    for (const item of items) {
      if (item.type === 'SimpleSelector' && item.text === '') {
        forgivenSelectorItemsOfState(state)?.push({ item, written: '', recoveredValue: item });
      }
    }
  }
  return selist(...items);
}

/**
 * Keep on a parsed document the forgiven items its run recorded that are in
 * the accepted tree ({@link recoveredInTree}), once each.
 */
export function withForgivenSelectorItems(document: Stylesheet, recorded: readonly ForgivenSelectorItem[]): Stylesheet {
  if (recorded.length > 0) {
    document._forgiven = [...new Map(recoveredInTree(document, recorded).map(entry => [entry.item, entry] as const)).values()];
  }
  return document;
}

/** The forgiven `:is()` / `:where()` items of a parsed document ({@link withForgivenSelectorItems}). */
export function forgivenSelectorItemsOf(document: Stylesheet): readonly ForgivenSelectorItem[] {
  return document._forgiven ?? [];
}

/**
 * Where a run collects its forgiven items: `state.document`, the one object a
 * run's reducers share and write (parseman hands a reducer a shallow copy of
 * the state, so only a reference carries a write back).
 */
export function forgivenSelectorItemsOfState(state: unknown): ForgivenSelectorItem[] | undefined {
  const document = typeof state === 'object' && state !== null && 'document' in state ? state.document : undefined;
  return typeof document === 'object' && document !== null && 'forgivenSelectorItems' in document && Array.isArray(document.forgivenSelectorItems)
    ? document.forgivenSelectorItems
    : undefined;
}

/**
 * Point each forgiven item recorded inside a `selector(…)` capture's list (the
 * reduction's `children`) at the capture, which keeps the list only as text,
 * so the capture's presence in the tree keeps them ({@link recoveredInTree}).
 */
export function adoptForgivenSelectorItems(children: readonly unknown[], capture: SelectorCapture, state: unknown): SelectorCapture {
  const recorded = forgivenSelectorItemsOfState(state);
  const list = children.find(child => typeof child === 'object' && child !== null && 'type' in child && child.type === 'SelectorList');
  if (recorded === undefined || recorded.length === 0 || list === undefined) {
    return capture;
  }
  const inList = new Set<unknown>();
  const stack: unknown[] = [list];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'object' && item !== null && !inList.has(item)) {
      inList.add(item);
      stack.push(...Object.values(item));
    }
  }
  for (const entry of recorded) {
    if (inList.has(entry.recoveredValue)) {
      entry.recoveredValue = capture;
    }
  }
  return capture;
}
