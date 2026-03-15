import type { Selector } from '../selector.js';
import { N } from '../node-type.js';
import type { ExtendSelectorKind } from '../../types/config.js';
import { isNode } from './is-node.js';

export type ExtendSelectorMatch = {
  kind: ExtendSelectorKind;
  selector: Selector;
};

function getSelectorKinds(selector: Selector): ExtendSelectorKind[] {
  if (isNode(selector, N.BasicSelector)) {
    return ['simple', 'basic'];
  }
  if (isNode(selector, N.PseudoSelector)) {
    return ['simple', 'pseudo'];
  }
  if (isNode(selector, N.CompoundSelector)) {
    return ['compound'];
  }
  if (isNode(selector, N.ComplexSelector)) {
    return ['complex'];
  }
  return ['simple'];
}

export function findDisallowedExtendSelector(
  selector: Selector,
  allowed?: readonly ExtendSelectorKind[]
): ExtendSelectorMatch | undefined {
  if (!allowed) {
    return undefined;
  }

  if (isNode(selector, N.SelectorList)) {
    for (const item of selector.data) {
      const disallowed = findDisallowedExtendSelector(item, allowed);
      if (disallowed) {
        return disallowed;
      }
    }
    return undefined;
  }

  const kinds = getSelectorKinds(selector);
  if (kinds.some(kind => allowed.includes(kind))) {
    return undefined;
  }

  return {
    kind: kinds[0]!,
    selector
  };
}

export function formatAllowedExtendSelectors(allowed: readonly ExtendSelectorKind[]): string {
  if (allowed.length === 0) {
    return 'no selector kinds';
  }
  if (allowed.length === 1) {
    return `${allowed[0]} selectors`;
  }
  const head = allowed.slice(0, -1).join(', ');
  return `${head}, or ${allowed[allowed.length - 1]} selectors`;
}
