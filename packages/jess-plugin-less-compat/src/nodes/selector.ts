import {
  Selector,
  ComplexSelector,
  CompoundSelector,
  BasicSelector,
  SelectorList,
  Combinator,
  Ampersand,
  Node
} from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { createFromAdapter } from '../transform/adapter.js';
import type { LessNode } from '../types.js';

/**
 * Flatten a hierarchical Jess selector into Less's flat Element array.
 * Less expects: Element[] where each Element has { combinator, value }
 * Jess now models complex selectors as an interleaved stream of selector
 * components and explicit combinators. Less still expects flat Elements with
 * the combinator attached to the following selector component.
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
    const components = selector.value;
    let nextCombinatorValue = '';

    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      if (!component) {
        continue;
      }
      if (component instanceof Combinator) {
        nextCombinatorValue = component.value;
        continue;
      }

      if (component instanceof CompoundSelector) {
        for (let j = 0; j < component.value.length; j++) {
          const simple = component.value[j];
          if (!simple) {
            continue;
          }
          const elementCombinator = createLessCombinator(j === 0 ? nextCombinatorValue : '');
          elements.push(createElementProxy(simple, elementCombinator, cache));
        }
      } else if (component instanceof BasicSelector || component instanceof Ampersand) {
        const elementCombinator = createLessCombinator(nextCombinatorValue);
        elements.push(createElementProxy(component, elementCombinator, cache));
      } else if (component instanceof Node) {
        const elementCombinator = createLessCombinator(nextCombinatorValue);
        elements.push(createElementProxy(component, elementCombinator, cache));
      }

      nextCombinatorValue = '';
    }
  } else if (selector instanceof CompoundSelector) {
    for (let i = 0; i < selector.value.length; i++) {
      const basic = selector.value[i];
      if (!basic) {
        continue;
      }
      const combinator = createLessCombinator(i === 0 ? '' : '');
      elements.push(createElementProxy(basic, combinator, cache));
    }
  } else if (selector instanceof BasicSelector || selector instanceof Ampersand) {
    elements.push(createElementProxy(selector, createLessCombinator(''), cache));
  }

  return elements;
}

function createLessCombinator(value: string): LessNode {
  const base = new Combinator(' ');
  return createLessProxy(base, undefined, (prop) => {
    if (prop === 'type') {
      return 'Combinator';
    }
    if (prop === 'value') {
      return value;
    }
    if (prop === 'emptyOrWhitespace') {
      return value === '' || value === ' ';
    }
    return undefined;
  });
}

function createElementProxy(
  basic: Node,
  combinator: LessNode,
  cache?: WeakMap<any, any>
): LessNode {
  // Create without sharing cache (avoids collision with any Selector proxy
  // already cached for this BasicSelector). Then store the Element proxy in
  // the shared cache so toLessNode returns it when the Jess walker visits
  // this BasicSelector — matching the original code's caching behavior.
  const proxy = createLessProxy(basic, undefined, (prop, target) => {
    const basicSel = target as Node;
    if (prop === 'type') {
      return 'Element';
    }
    if (prop === 'combinator') {
      return combinator;
    }
    if (prop === 'value') {
      return (basicSel as { value?: unknown }).value;
    }
    if (prop === 'isVariable') {
      return false;
    }
    if (prop === 'accept') {
      return function(visitor: any) {
        if (combinator && visitor.visit) {
          visitor.visit(combinator);
        }
        const value = (basicSel as { value?: unknown }).value;
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
