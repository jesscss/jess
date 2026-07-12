import {
  Interpolated,
  Quoted,
  Reference,
  INTERPOLATION_PLACEHOLDER,
  isNode,
  N,
  type Selector
} from '@jesscss/core';

// Pre-compiled regex for @{variable} interpolation - more efficient than creating new instances
const INTERPOLATION_REGEX = /([$@])\{([^}]+)\}/g;

export const createInterpolatedReference = (
  prefix: string,
  varName: string,
  location?: any,
  context?: any
): Reference => {
  const isProperty = prefix === '$';
  const key = isProperty
    ? new Quoted(varName, { quote: '\'' }, location, context)
    : varName;
  return new Reference(
    { key },
    { type: isProperty ? 'index' : 'variable', role: 'ident' },
    location,
    context
  );
};

export const getInterpolatedNode = (
  name: string,
  location?: any,
  context?: any
): Interpolated => {
  const replacements: any[] = [];
  let source = name;
  let result;

  INTERPOLATION_REGEX.lastIndex = 0;
  while ((result = INTERPOLATION_REGEX.exec(name)) !== null) {
    const [match, prefix, varName] = result;
    source = source.replace(match, INTERPOLATION_PLACEHOLDER);
    replacements.push(createInterpolatedReference(prefix, varName, location, context));
  }

  return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
};

export const normalizeMixinReferenceKey = (selector: Selector): { key: string | string[]; rawKey: Selector } => {
  if (isNode(selector, N.BasicSelector | N.InterpolatedSelector)) {
    return { key: selector.valueOf(), rawKey: selector };
  }

  if (isNode(selector, N.CompoundSelector)) {
    return {
      key: selector.value.map(node => node.valueOf()),
      rawKey: selector
    };
  }

  if (isNode(selector, N.ComplexSelector)) {
    const path: string[] = [];
    let canUsePath = true;

    for (const node of selector.value) {
      if (isNode(node, N.BasicSelector | N.InterpolatedSelector)) {
        path.push(node.valueOf());
        continue;
      }
      if (isNode(node, N.CompoundSelector)) {
        path.push(...node.value.map(child => child.valueOf()));
        continue;
      }
      if (isNode(node, N.Combinator) && (node.value === '>' || node.value === ' ')) {
        continue;
      }
      canUsePath = false;
      break;
    }

    if (canUsePath && path.length > 0) {
      return { key: path, rawKey: selector };
    }
  }

  return { key: selector.valueOf(), rawKey: selector };
};

/* Handle both @{variable} interpolation and @id-@num variable variables */
export const getInterpolatedOrString = (name: string, location?: any, context?: any): Interpolated | string => {
  // First check for @{variable} interpolation syntax
  const matches: Array<{ fullMatch: string; prefix: string; varName: string; index: number }> = [];

  // Reset regex state and collect all matches
  INTERPOLATION_REGEX.lastIndex = 0;
  let result;
  while ((result = INTERPOLATION_REGEX.exec(name)) !== null) {
    const [fullMatch, prefix, varName] = result;
    if (varName && prefix) {
      matches.push({
        fullMatch,
        prefix,
        varName,
        index: result.index
      });
    }
  }

  if (matches.length > 0) {
    // Build source string and replacements
    let source = name;
    const replacements: any[] = [];
    let offset = 0; // Track how much the string has been modified

    // Process matches in forward order to maintain correct indices
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      const adjustedIndex = match.index - offset;
      const beforeMatch = source.substring(0, adjustedIndex);
      const afterMatch = source.substring(adjustedIndex + match.fullMatch.length);

      source = beforeMatch + INTERPOLATION_PLACEHOLDER + afterMatch;
      offset += match.fullMatch.length - INTERPOLATION_PLACEHOLDER.length;

      const ref = createInterpolatedReference(match.prefix, match.varName, location, context);
      replacements.push(ref); // Add to end to maintain order
    }

    return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
  }

  // If no interpolation found, check for @id-@num variable variables
  const atPos = name.indexOf('@', 1);
  const dollarPos = name.indexOf('$', 1);

  if (atPos === -1 && dollarPos === -1) {
    if (name.startsWith('@') || name.startsWith('$')) {
      return name.slice(1);
    } else {
      return name;
    }
  }

  const nextPos = atPos !== -1 ? atPos : dollarPos;
  const start = name.slice(1, nextPos);
  const end = name.slice(nextPos);
  const type: 'variable' | 'index' = end.startsWith('@') ? 'variable' : 'index';
  // For @id-@num variable variables, we need to create an Interpolated node
  const endResult = getInterpolatedOrString(end, location, context);
  if (typeof endResult === 'string') {
    const endKey = type === 'index'
      ? new Quoted(endResult, { quote: '\'' }, location, context)
      : endResult;
    return new Interpolated({
      source: start + INTERPOLATION_PLACEHOLDER,
      replacements: [
        new Reference(
          { key: endKey },
          { type, role: 'ident' },
          location,
          context
        )
      ]
    }, { role: 'ident' });
  } else {
    /**
     * endResult is already an Interpolated node, so we need to handle this
     * differently.
     *
     * @todo - test deep nesting
     */
    return new Interpolated({
      source: start + INTERPOLATION_PLACEHOLDER,
      replacements: [type === 'index' ? new Quoted(endResult, { quote: '\'' }, location, context) : endResult]
    }, { role: 'ident' });
  }
};
