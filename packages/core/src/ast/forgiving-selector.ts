/**
 * `:is()` and `:where()` take a `<forgiving-selector-list>` (Selectors 4 §4.2,
 * §4.4, §16.1): an item that is not a selector is dropped by a browser and
 * the others still match. Owner 2026-10-20: *"it should parse then... sure
 * warning is ok"*. The parse keeps such an item as written and records it; the
 * compiler warns at it (`css/forgiving-selector-item`).
 */
import { simpleSelector } from './nodes.js';
import type { SelectorBranch, SelectorCapture, SimpleSelector, Stylesheet } from './nodes.js';
import { withSourceSpan, type AstSourceSpan } from './provenance.js';
import { recoveredInTree } from './grammar-helpers.js';
import { authoredSource, isSelectorBranch } from './css-grammar-helpers.js';

/**
 * A `:is()` / `:where()` item a parse kept as written because it is not a
 * selector (`forgivingSelectorItem`), recorded on the run's
 * `state.document.forgivenSelectorItems` for the compiler's
 * `css/forgiving-selector-item` warning.
 */
export interface ForgivenSelectorItem {
  readonly item: SimpleSelector;

  /**
   * The node whose presence in the accepted tree keeps the item
   * ({@link recoveredInTree}): the item, or the `selector(…)` capture that
   * keeps its list as text (`adoptForgivenSelectorItems`).
   */
  recoveredValue: object;
}

/**
 * One item of a `:is()` / `:where()` argument: the selector it parsed as, or,
 * when it is not a selector, the item kept as written, so
 * `.card:is(.active, 1px)` matches as `.card:is(.active)`. A kept item is
 * recorded on the run's `state.document.forgivenSelectorItems`; an empty one
 * (`:is()`) is valid and is not.
 */
export function forgivingSelectorItem(children: readonly unknown[], span: AstSourceSpan, state: unknown): SelectorBranch {
  const only = children.length === 1 ? children[0] : undefined;

  /* A selector item keeps where it is written too, so a capture can report an interpolation in it there. */
  if (isSelectorBranch(only)) {
    return withSourceSpan(only, span);
  }
  const written = authoredSource(span, state, 'A forgiving selector-list item');
  const kept = written.trim();
  const start = span.start + written.length - written.trimStart().length;
  const item = withSourceSpan(simpleSelector(kept), { start, end: start + kept.length });
  if (kept !== '') {
    forgivenSelectorItemsOfState(state)?.push({ item, recoveredValue: item });
  }
  return item;
}

/**
 * Keep on a parsed document the forgiven items its run recorded that are in
 * the accepted tree ({@link recoveredInTree}), once each.
 */
export function withForgivenSelectorItems(document: Stylesheet, recorded: readonly ForgivenSelectorItem[]): Stylesheet {
  if (recorded.length > 0) {
    document._forgiven = [...new Set(recoveredInTree(document, recorded).map(entry => entry.item))];
  }
  return document;
}

/** The forgiven `:is()` / `:where()` items of a parsed document ({@link withForgivenSelectorItems}). */
export function forgivenSelectorItemsOf(document: Stylesheet): readonly SimpleSelector[] {
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
