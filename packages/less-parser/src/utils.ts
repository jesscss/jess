import { Interpolated, InterpolatedReference, INTERPOLATION_PLACEHOLDER } from '@jesscss/core';

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

      const ref = new InterpolatedReference(
        match.varName,
        { referenceType: match.prefix === '$' ? 'property' : 'variable' },
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
    if (name.startsWith('@') || name.startsWith('$')) {
      return name.slice(1);
    } else {
      return name;
    }
  }

  const nextPos = atPos !== -1 ? atPos : dollarPos;
  const start = name.slice(1, nextPos);
  const end = name.slice(nextPos);
  const type: 'variable' | 'property' = end.startsWith('@') ? 'variable' : 'property';
  // For @id-@num variable variables, we need to create an Interpolated node
  const endResult = getInterpolatedOrString(end, location, context);
  if (typeof endResult === 'string') {
    return new Interpolated({
      source: start + INTERPOLATION_PLACEHOLDER,
      replacements: [
        new InterpolatedReference(
          endResult,
          { referenceType: type },
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
      replacements: [endResult]
    }, { role: 'ident' });
  }
};
