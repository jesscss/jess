import {
  Selector,
  ComplexSelector,
  CompoundSelector,
  BasicSelector,
  SelectorList,
  Combinator,
  Node
} from '@jesscss/core';
import { createLessProxy } from '../transform/proxy';
import { toLessNode } from '../transform/to-less';
import { toLessNode } from '../transform/to-less';
import { mapJessTypeToLessType } from '../transform/type-map';
import type { LessNode } from '../types';

/**
 * Flatten a hierarchical Jess selector into Less's flat Element array
 * 
 * Less expects: Element[] where each Element has { combinator, value }
 * Jess has: ComplexSelector → CompoundSelector[] → BasicSelector[]
 */
function flattenSelectorToElements(
  selector: Selector,
  cache?: WeakMap<any, any>
): LessNode[] {
  const elements: LessNode[] = [];

  if (selector instanceof SelectorList) {
    // SelectorList contains multiple selectors - Less expects a single Selector
    // For now, we'll take the first selector, but this might need special handling
    if (selector.value.length > 0) {
      const first = selector.value[0];
      if (first) {
        return flattenSelectorToElements(first, cache);
      }
    }
    return [];
  }

  if (selector instanceof ComplexSelector) {
    // ComplexSelector contains CompoundSelector[] with Combinators between them
    const compounds = selector.value;
    
    for (let i = 0; i < compounds.length; i++) {
      const compound = compounds[i];
      
      // Get combinator (default to ' ' for space)
      let combinator: Combinator | undefined;
      if (i > 0) {
        // Combinator is between compounds
        // Less's Element includes the combinator, so we need to find it
        // For now, default to space combinator
        combinator = new Combinator(' ' as any);
      } else {
        // First element has no combinator (or empty combinator)
        // Use space as default for Less compatibility
        combinator = new Combinator(' ');
      }

      // Flatten compound selector
      if (compound instanceof CompoundSelector) {
        const basicSelectors = compound.value;
        for (let j = 0; j < basicSelectors.length; j++) {
          const basic = basicSelectors[j];
          if (!basic) continue;
          
          // Use combinator only for first element of compound
          const elementCombinator = j === 0 ? combinator : new Combinator(' ');
          
          // Create Less Element structure
          // Less Element: { combinator, value, isVariable }
          const element = createLessProxy(basic, cache, (prop, target) => {
            const basicSel = target as BasicSelector;
            
            if (prop === 'type') {
              return 'Element';
            }
            
            if (prop === 'combinator') {
              return toLessNode(elementCombinator, { cache });
            }
            
            if (prop === 'value') {
              return basicSel.value;
            }
            
            if (prop === 'isVariable') {
              return false; // BasicSelector is not a variable
            }
            
            if (prop === 'accept') {
              return function(visitor: any) {
                // Less Element's accept() should call visitor.visit() on the element
                // But we need to use the cached proxy to prevent creating new proxies
                // and causing infinite loops
                // The element proxy is already created above, so we can use it directly
                // by accessing it through the cache or by using the element from the elements array
                // For now, just call visitor.visit() - the processing WeakSet should prevent loops
                if (visitor.visit) {
                  // Use the element proxy that was already created
                  // We need to get it from the cache or recreate it consistently
                  const lessElement = createLessProxy(basicSel, cache, (p, t) => {
                    if (p === 'type') return 'Element';
                    if (p === 'combinator') return toLessNode(elementCombinator, { cache });
                    if (p === 'value') return (t as BasicSelector).value;
                    if (p === 'isVariable') return false;
                    return undefined;
                  });
                  const result = visitor.visit(lessElement);
                  // If visitor returned a different node, we'd need to convert back
                  // But for now, just return the original
                  return basicSel;
                }
                return basicSel;
              };
            }
            
            return undefined;
          });
          
          elements.push(element);
        }
      } else if (compound instanceof BasicSelector) {
        // Single basic selector
        const element = createLessProxy(compound, cache, (prop, target) => {
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
          
          return undefined;
        });
        
        elements.push(element);
      }
    }
  } else if (selector instanceof CompoundSelector) {
      // Single compound selector - flatten to elements
      const basicSelectors = selector.value;
      for (let i = 0; i < basicSelectors.length; i++) {
        const basic = basicSelectors[i];
        if (!basic) continue;
        const combinator = new Combinator(' ');
      
      const element = createLessProxy(basic, cache, (prop, target) => {
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
        
        return undefined;
      });
      
      elements.push(element);
    }
  } else if (selector instanceof BasicSelector) {
    // Single basic selector
    const element = createLessProxy(selector, cache, (prop, target) => {
      const basicSel = target as BasicSelector;
      
      if (prop === 'type') {
        return 'Element';
      }
      
      if (prop === 'combinator') {
        // Empty combinator for first element - use space as default
        return toLessNode(new Combinator(' '), { cache });
      }
      
      if (prop === 'value') {
        return basicSel.value;
      }
      
      if (prop === 'isVariable') {
        return false;
      }
      
      return undefined;
    });
    
    elements.push(element);
  }

  return elements;
}

/**
 * Transform a Jess Selector to a Less-compatible Selector
 * 
 * Less Selector is an array of Element nodes
 */
export function transformSelectorToLess(
  jessSelector: Selector | SelectorList,
  cache?: WeakMap<any, any>
): LessNode {
  // Less Selector is an array of Elements
  const elements = flattenSelectorToElements(jessSelector, cache);
  
  // Create a proxy that represents a Less Selector (array of Elements)
  return createLessProxy(jessSelector, cache, (prop, target) => {
    // Map 'type' property
    if (prop === 'type') {
      return 'Selector';
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'elements' property (Less Selector has elements array)
    if (prop === 'elements') {
      return elements;
    }

    // Map array-like access (Less Selector is array-like)
    if (typeof prop === 'string' && /^\d+$/.test(prop)) {
      const index = parseInt(prop, 10);
      return elements[index];
    }

    // Map 'length' property
    if (prop === 'length') {
      return elements.length;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        // Less Selector accepts visitor and visits each element
        // CRITICAL: All elements should already be Less proxies from flattenSelectorToElements
        // If they're not, we need to convert them to prevent infinite loops
        for (const element of elements) {
          if (element && element.accept) {
            // Element is already a Less proxy - call accept directly
            element.accept(visitor);
          } else if (element) {
            // Element is not a proxy - this shouldn't happen, but convert it just in case
            // This prevents infinite loops if somehow a Jess node got through
            const lessElement = toLessNode(element as any, { cache });
            if (lessElement && lessElement.accept) {
              lessElement.accept(visitor);
            } else if (lessElement && visitor.visit) {
              visitor.visit(lessElement);
            }
          }
        }
        return jessSelector;
      };
    }

    return undefined;
  });
}
