import { Interpolated, Reference, INTERPOLATION_PLACEHOLDER } from '@jesscss/core';

// Pre-compiled regex for @{variable} interpolation - more efficient than creating new instances
const INTERPOLATION_REGEX = /([$@]){([^}]+)}/g;

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

      const ref = new Reference(
        { key: match.varName },
        { type: match.prefix === '@' ? 'variable' : 'property' },
        location,
        context
      );
      replacements.push(ref); // Add to end to maintain order
    }

    return new Interpolated({ source, replacements }, { role: 'ident' }, location, context);
  }

  // If no interpolation found, check for @id-@num variable variables
  const atPos = name.indexOf('@', 1);
  const dollarPos = name.indexOf('$', 1);

  if (atPos === -1 && dollarPos === -1) {
    return name.slice(1);
  }

  const nextPos = atPos !== -1 ? atPos : dollarPos;
  const start = name.slice(1, nextPos);
  const end = name.slice(nextPos);
  const isVariable = atPos !== -1;

  // For @id-@num variable variables, we need to create an Interpolated node
  const endResult = getInterpolatedOrString(end, location, context);
  if (typeof endResult === 'string') {
    return new Interpolated({
      source: start + INTERPOLATION_PLACEHOLDER,
      replacements: [
        new Reference(
          { key: endResult },
          { type: isVariable ? 'variable' : 'property', role: 'ident' }
        )
      ]
    }, { role: 'ident' });
  } else {
    // endResult is already an Interpolated node, so we need to handle this differently
    // This is a complex case where we have nested variable variables
    return new Interpolated({
      source: start + INTERPOLATION_PLACEHOLDER,
      replacements: [
        new Reference(
          { key: endResult.value.source },
          { type: isVariable ? 'variable' : 'property', role: 'ident' }
        )
      ]
    }, { role: 'ident' });
  }
};
