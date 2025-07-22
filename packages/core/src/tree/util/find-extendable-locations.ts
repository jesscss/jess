import { type Selector } from '../selector';
import { SimpleSelector } from '../selector-simple';
import { SelectorList } from '../selector-list';
import { ComplexSelector } from '../selector-complex';
import { CompoundSelector } from '../selector-compound';
import { PseudoSelector } from '../selector-pseudo';
import { isNode } from './is-node';

/**
 * Represents a location within a selector tree where a target can be extended
 */
export interface ExtendLocation {
  /** Path to the extendable location within the selector tree */
  path: Array<string | number>;
  /** Index within a selector list if applicable */
  targetIndex?: number;
  /** The actual selector node that matched */
  matchedNode: Selector;
  /** Context about what type of extension this enables */
  extensionType: 'replace' | 'append' | 'wrap';
  /** The parent node containing the match (for reconstruction) */
  parentNode?: Selector;
}

/**
 * Result of searching for extendable locations
 */
export interface ExtendSearchResult {
  locations: ExtendLocation[];
  hasMatches: boolean;
}

/**
 * Recursively searches a selector tree to find all locations where a target selector appears
 * This is designed specifically for extend use cases, not CSS cascade matching
 *
 * @param selector - The selector tree to search within
 * @param target - The target selector to find
 * @returns ExtendSearchResult with all found locations
 */
export function findExtendableLocations(
  selector: Selector,
  target: Selector
): ExtendSearchResult {
  const locations: ExtendLocation[] = [];

  // Start recursive search from root
  searchWithinSelector(selector, target, [], locations);

  return {
    locations,
    hasMatches: locations.length > 0
  };
}

/**
 * Recursively searches within a selector for target matches
 *
 * @param current - Current selector being examined
 * @param target - Target selector to find
 * @param currentPath - Current path in the selector tree
 * @param locations - Array to collect found locations
 */
function searchWithinSelector(
  current: Selector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  // Check if current selector exactly matches target using structural comparison
  // NOT valueOf() which might do unwanted normalization
  if (isStructurallyEqual(current, target)) {
    locations.push({
      path: [...currentPath],
      matchedNode: current,
      extensionType: determineExtensionType(current, currentPath)
    });
    // For exact matches, also search within if it's a container type
    // This allows finding nested matches within the same node
  }

  // Search within different selector types
  if (isNode(current, 'SelectorList')) {
    searchWithinSelectorList(current, target, currentPath, locations);
  } else if (isNode(current, 'CompoundSelector')) {
    searchWithinCompoundSelector(current, target, currentPath, locations);
  } else if (isNode(current, 'ComplexSelector')) {
    searchWithinComplexSelector(current, target, currentPath, locations);
  } else if (isNode(current, 'PseudoSelector')) {
    searchWithinPseudoSelector(current, target, currentPath, locations);
  }
  // SimpleSelector doesn't have nested content to search
}

/**
 * Searches within a selector list
 */
function searchWithinSelectorList(
  selectorList: SelectorList,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  selectorList.value.forEach((selector, index) => {
    searchWithinSelector(selector, target, [...currentPath, index], locations);
  });
}

/**
 * Searches within a compound selector
 */
function searchWithinCompoundSelector(
  compound: CompoundSelector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  compound.value.forEach((component, index) => {
    searchWithinSelector(component, target, [...currentPath, index], locations);
  });
}

/**
 * Searches within a complex selector
 */
function searchWithinComplexSelector(
  complex: ComplexSelector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  complex.value.forEach((component, index) => {
    // Skip combinators, only search selector components
    if (!isNode(component, 'Combinator')) {
      searchWithinSelector(component as Selector, target, [...currentPath, index], locations);
    }
  });
}

/**
 * Searches within a pseudo-selector
 */
function searchWithinPseudoSelector(
  pseudo: PseudoSelector,
  target: Selector,
  currentPath: Array<string | number>,
  locations: ExtendLocation[]
): void {
  const arg = pseudo.value.arg;
  if (arg && isSelector(arg)) {
    searchWithinSelector(arg as Selector, target, [...currentPath, 'arg'], locations);
  }
}

/**
 * Helper to check if a value is a Selector
 */
function isSelector(value: any): boolean {
  return value && typeof value === 'object' && 'valueOf' in value && 'isSelector' in value;
}

/**
 * Checks if two selectors are structurally equal (same type and content)
 * This is different from valueOf() comparison which might do normalization
 */
function isStructurallyEqual(a: Selector, b: Selector): boolean {
  // Quick check: if they're the exact same object reference
  if (a === b) return true;

  // Check if they're the same node type
  if (a.type !== b.type) return false;

  // For simple selectors, use valueOf comparison
  if (isNode(a, 'SimpleSelector') && isNode(b, 'SimpleSelector')) {
    return a.valueOf() === b.valueOf();
  }

  // For pseudo-selectors, compare name and arguments
  if (isNode(a, 'PseudoSelector') && isNode(b, 'PseudoSelector')) {
    if (a.value.name !== b.value.name) return false;

    const aArg = a.value.arg;
    const bArg = b.value.arg;

    // Both have no args
    if (!aArg && !bArg) return true;

    // One has arg, other doesn't
    if (!aArg || !bArg) return false;

    // Both have args - compare them recursively
    if (isSelector(aArg) && isSelector(bArg)) {
      return isStructurallyEqual(aArg as Selector, bArg as Selector);
    }

    // Fallback to string comparison for other arg types
    return String(aArg) === String(bArg);
  }

  // For other selector types, use valueOf as fallback
  // This handles compound, complex, and selector list comparisons
  if (isNode(a, 'CompoundSelector') || isNode(a, 'ComplexSelector') || isNode(a, 'SelectorList')) {
    return a.valueOf() === b.valueOf();
  }

  // Default fallback
  return false;
}

/**
 * Determines the appropriate extension type based on the match location
 */
function determineExtensionType(
  matchedNode: Selector,
  path: Array<string | number>
): 'replace' | 'append' | 'wrap' {
  // If we're inside a pseudo-selector argument (like :where() or :is())
  if (path.some(segment => segment === 'arg')) {
    return 'append'; // Can append to pseudo-selector argument lists
  }

  // If we're in a selector list context
  if (path.some(segment => typeof segment === 'number')) {
    return 'append'; // Can append to selector lists
  }

  // Default to replace for direct matches
  return 'replace';
}

/**
 * Applies an extension at a specific location within a selector tree
 *
 * @param selector - The original selector
 * @param location - The location where to apply the extension
 * @param extendWith - The selector to extend with
 * @returns The modified selector with extension applied
 */
export function applyExtensionAtLocation(
  selector: Selector,
  location: ExtendLocation,
  extendWith: Selector
): Selector {
  return applyExtensionAtPath(selector, location.path, location.matchedNode, extendWith, location.extensionType);
}

/**
 * Recursively applies an extension at a specific path
 */
function applyExtensionAtPath(
  current: Selector,
  path: Array<string | number>,
  matchedNode: Selector,
  extendWith: Selector,
  extensionType: 'replace' | 'append' | 'wrap'
): Selector {
  if (path.length === 0) {
    // We've reached the target location
    return applyExtension(current, matchedNode, extendWith, extensionType);
  }

  const [nextSegment, ...remainingPath] = path;

  if (isNode(current, 'SelectorList')) {
    // For selector lists, we need special handling
    if (remainingPath.length === 0) {
      // We're targeting a specific item in the list
      const index = nextSegment as number;
      if (extensionType === 'append') {
        // For append, add the extension to the list (not replace the individual item)
        const newValue = [...current.value, extendWith];
        return new SelectorList(newValue).inherit(current);
      } else {
        // For replace, replace the specific item
        const newValue = [...current.value];
        newValue[index] = extendWith;
        return new SelectorList(newValue).inherit(current);
      }
    } else {
      // Navigate deeper into the list
      const index = nextSegment as number;
      const newValue = [...current.value];
      newValue[index] = applyExtensionAtPath(
        newValue[index]!, remainingPath, matchedNode, extendWith, extensionType
      );
      return new SelectorList(newValue).inherit(current);
    }
  }

  if (isNode(current, 'CompoundSelector')) {
    const index = nextSegment as number;
    const newValue = [...current.value];
    newValue[index] = applyExtensionAtPath(
      newValue[index]!, remainingPath, matchedNode, extendWith, extensionType
    ) as SimpleSelector;
    return new CompoundSelector(newValue).inherit(current);
  }

  if (isNode(current, 'ComplexSelector')) {
    const index = nextSegment as number;
    const newValue = [...current.value];
    newValue[index] = applyExtensionAtPath(
      newValue[index] as Selector, remainingPath, matchedNode, extendWith, extensionType
    ) as any;
    return new ComplexSelector(newValue).inherit(current);
  }

  if (isNode(current, 'PseudoSelector') && nextSegment === 'arg') {
    const arg = current.value.arg as Selector;

    // Special handling for pseudo-selector arguments
    if (remainingPath.length === 0) {
      // Direct match in the argument - create a list or extend existing list
      let newArg: Selector;
      if (isNode(arg, 'SelectorList')) {
        const newSelectors = [...arg.value, extendWith];
        newArg = new SelectorList(newSelectors).inherit(arg);
      } else {
        newArg = new SelectorList([arg, extendWith]);
      }

      return new PseudoSelector({
        name: current.value.name,
        arg: newArg
      }).inherit(current);
    } else {
      // Navigate deeper into the argument
      const newArg = applyExtensionAtPath(arg, remainingPath, matchedNode, extendWith, extensionType);
      return new PseudoSelector({
        name: current.value.name,
        arg: newArg
      }).inherit(current);
    }
  }

  throw new Error(`Unable to apply extension at path: ${path.join('.')}`);
}

/**
 * Applies the actual extension based on the extension type
 */
function applyExtension(
  current: Selector,
  matchedNode: Selector,
  extendWith: Selector,
  extensionType: 'replace' | 'append' | 'wrap'
): Selector {
  switch (extensionType) {
    case 'replace':
      return extendWith;

    case 'append':
      // For append within a selector list context, we add to the current list
      if (isNode(current, 'SelectorList')) {
        const newSelectors = [...current.value, extendWith];
        return new SelectorList(newSelectors).inherit(current);
      } else {
        // For append at the selector level, create a list with the current and extension
        return new SelectorList([current, extendWith]);
      }

    case 'wrap':
      // For now, treat wrap the same as append
      // This could be enhanced for specific wrapping scenarios
      return new SelectorList([current, extendWith]);

    default:
      throw new Error(`Unknown extension type: ${extensionType}`);
  }
}
