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
import { createLessAdapter } from '../transform/less-adapter.js';
import { toLessNode } from '../transform/to-less.js';
import type {
  LessNode,
  RawLessCombinator
} from '../types.js';

/**
 * Flatten a hierarchical Jess selector into Less's flat Element array.
 * Less expects: Element[] where each Element has { combinator, value }
 * Jess now models complex selectors as an interleaved stream of selector
 * components and explicit combinators. Less still expects flat Elements with
 * the combinator attached to the following selector component.
 */
function flattenSelectorToElements(
  selector: string | Selector | SelectorList,
  cache?: WeakMap<Node, unknown>
): LessNode[] {
  const elements: LessNode[] = [];

  if (typeof selector === 'string') {
    elements.push(createElementAdapter(selector, createLessCombinator(''), cache));
    return elements;
  }

  if (selector instanceof SelectorList) {
    const selectorListValue = selector.value;
    if (selectorListValue.length > 0 && selectorListValue[0]) {
      return flattenSelectorToElements(selectorListValue[0], cache);
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
        const compoundValue = component.value;
        for (let j = 0; j < compoundValue.length; j++) {
          const simple = compoundValue[j];
          if (!simple) {
            continue;
          }
          const elementCombinator = createLessCombinator(j === 0 ? nextCombinatorValue : '');
          elements.push(createElementAdapter(simple, elementCombinator, cache));
        }
      } else if (typeof component === 'string') {
        const elementCombinator = createLessCombinator(nextCombinatorValue);
        elements.push(createElementAdapter(component, elementCombinator, cache));
      } else if (component instanceof BasicSelector || component instanceof Ampersand) {
        const elementCombinator = createLessCombinator(nextCombinatorValue);
        elements.push(createElementAdapter(component, elementCombinator, cache));
      } else if (component instanceof Node) {
        const elementCombinator = createLessCombinator(nextCombinatorValue);
        elements.push(createElementAdapter(component, elementCombinator, cache));
      }

      nextCombinatorValue = '';
    }
  } else if (selector instanceof CompoundSelector) {
    const compoundSelValue = selector.value;
    for (let i = 0; i < compoundSelValue.length; i++) {
      const basic = compoundSelValue[i];
      if (!basic) {
        continue;
      }
      const combinator = createLessCombinator(i === 0 ? '' : '');
      elements.push(createElementAdapter(basic, combinator, cache));
    }
  } else if (selector instanceof BasicSelector || selector instanceof Ampersand) {
    elements.push(createElementAdapter(selector, createLessCombinator(''), cache));
  }

  return elements;
}

function createLessCombinator(value: string): RawLessCombinator {
  return {
    type: 'Combinator',
    typeIndex: undefined,
    value,
    emptyOrWhitespace: value === '' || value === ' ',
    accept() {
      return value;
    }
  };
}

function createElementAdapter(
  basic: string | Node,
  combinator: RawLessCombinator,
  cache?: WeakMap<Node, unknown>
): LessNode {
  if (typeof basic === 'string') {
    return {
      type: 'Element',
      typeIndex: undefined,
      combinator,
      value: basic,
      isVariable: false,
      accept(visitor: { visit?: (n: unknown) => void }) {
        if (combinator && visitor.visit) {
          visitor.visit(combinator);
        }
        return basic;
      }
    };
  }

  const adapter = createLessAdapter(basic, {
    lessType: 'Element',
    fields: {
      combinator: () => combinator,
      value: target => 'value' in target ? target.value : undefined,
      isVariable: () => false
    },
    accept: (target, visitor: { visit?: (n: unknown) => void }) => {
      if (combinator && visitor.visit) {
        visitor.visit(combinator);
      }
      const value = 'value' in target ? target.value : undefined;
      if (value && typeof value === 'object' && value instanceof Node) {
        const lessValue = toLessNode(value, { cache });
        if (lessValue && visitor.visit) {
          visitor.visit(lessValue);
        }
      }
      return target;
    }
  });
  if (cache) {
    cache.set(basic, adapter);
  }
  return adapter;
}

export function transformSelectorToLess(
  sel: string | Selector | SelectorList,
  cache?: WeakMap<Node, unknown>
): LessNode {
  const elements = flattenSelectorToElements(sel, cache);
  if (typeof sel === 'string') {
    return {
      type: 'Selector',
      typeIndex: undefined,
      elements,
      length: elements.length,
      accept(visitor: { visitArray?: (nodes: unknown[]) => void }) {
        if (visitor.visitArray) {
          visitor.visitArray(elements);
        }
        return sel;
      }
    };
  }

  const adapter = createLessAdapter(sel, {
    lessType: 'Selector',
    fields: {
      elements: () => elements,
      length: () => elements.length
    },
    accept: (node, visitor) => {
      for (const element of elements) {
        if (element?.accept) {
          element.accept(visitor);
        } else if (element && visitor.visitArray) {
          visitor.visitArray([element]);
        }
      }
      return node;
    }
  }, cache);

  for (let i = 0; i < elements.length; i++) {
    Object.defineProperty(adapter as object, String(i), {
      enumerable: true,
      configurable: true,
      get: () => elements[i]
    });
  }

  return adapter;
}
