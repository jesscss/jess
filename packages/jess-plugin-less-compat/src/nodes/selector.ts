import {
  Selector,
  ComplexSelector,
  CompoundSelector,
  BasicSelector,
  SelectorList,
  Combinator,
  Node
} from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { createFromAdapter } from '../transform/adapter.js';
import type { LessNode } from '../types.js';

/**
 * Flatten a hierarchical Jess selector into Less's flat Element array.
 * Less expects: Element[] where each Element has { combinator, value }
 * Jess has: ComplexSelector -> CompoundSelector[] -> BasicSelector[]
 */
function flattenSelectorToElements(
  selector: Selector,
  cache?: WeakMap<any, any>
): LessNode[] {
  const elements: LessNode[] = [];

  if (selector instanceof SelectorList) {
    if (selector.value.length > 0 && selector.value[0]) {
      return flattenSelectorToElements(selector.value[0], cache);
    }
    return [];
  }

  if (selector instanceof ComplexSelector) {
    const compounds = selector.value;
    for (let i = 0; i < compounds.length; i++) {
      const compound = compounds[i];
      const combinator = new Combinator(i > 0 ? ' ' as any : ' ');

      if (compound instanceof CompoundSelector) {
        for (let j = 0; j < compound.value.length; j++) {
          const basic = compound.value[j];
          if (!basic) {
            continue;
          }
          const elementCombinator = j === 0 ? combinator : new Combinator(' ');
          elements.push(createElementProxy(basic, elementCombinator, cache));
        }
      } else if (compound instanceof BasicSelector) {
        elements.push(createElementProxy(compound, combinator, cache));
      }
    }
  } else if (selector instanceof CompoundSelector) {
    for (let i = 0; i < selector.value.length; i++) {
      const basic = selector.value[i];
      if (!basic) {
        continue;
      }
      elements.push(createElementProxy(basic, new Combinator(' '), cache));
    }
  } else if (selector instanceof BasicSelector) {
    elements.push(createElementProxy(selector, new Combinator(' '), cache));
  }

  return elements;
}

function createElementProxy(
  basic: BasicSelector | any,
  combinator: Combinator,
  cache?: WeakMap<any, any>
): LessNode {
  // Create without sharing cache (avoids collision with any Selector proxy
  // already cached for this BasicSelector). Then store the Element proxy in
  // the shared cache so toLessNode returns it when the Jess walker visits
  // this BasicSelector — matching the original code's caching behavior.
  const proxy = createLessProxy(basic, undefined, (prop, target) => {
    const basicSel = target as BasicSelector;
    if (prop === 'type') {
      return 'Element';
    }
    if (prop === 'combinator') {
      return toLessNode(combinator, { cache });
    }
    if (prop === 'value') {
      return basicSel.value;
    }
    if (prop === 'isVariable') {
      return false;
    }
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessCombinator = toLessNode(combinator, { cache });
        if (lessCombinator && visitor.visit) {
          visitor.visit(lessCombinator);
        }
        const value = basicSel.value;
        if (value && typeof value === 'object') {
          const lessValue = toLessNode(value as Node, { cache });
          if (lessValue && visitor.visit) {
            visitor.visit(lessValue);
          }
        }
        return basicSel;
      };
    }
    return undefined;
  });
  if (cache) {
    cache.set(basic, proxy);
  }
  return proxy;
}

export const transformSelectorToLess = createFromAdapter<Selector | SelectorList>({
  lessType: 'Selector',
  fields: {
    elements: (sel, cache) => flattenSelectorToElements(sel as Selector, cache),
    length: (sel, cache) => flattenSelectorToElements(sel as Selector, cache).length
  },
  dynamicField: (prop, sel, cache) => {
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      return flattenSelectorToElements(sel as Selector, cache)[parseInt(prop, 10)];
    }
    return undefined;
  },
  accept: (sel, visitor, cache) => {
    const elements = flattenSelectorToElements(sel as Selector, cache);
    for (const element of elements) {
      if (element?.accept) {
        element.accept(visitor);
      } else if (element) {
        const lessElement = toLessNode(element as any, { cache });
        if (lessElement?.accept) {
          lessElement.accept(visitor);
        } else if (lessElement && visitor.visitArray) {
          visitor.visitArray([lessElement]);
        }
      }
    }
    return sel;
  }
});
