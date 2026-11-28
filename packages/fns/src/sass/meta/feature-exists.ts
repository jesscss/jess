import { checkAny, define, isValueGroupArray, makeBool } from '@jesscss/core/value';
import { exactArgs } from './args.js';
import { describeValue } from './inspect.js';

/** The feature names Dart Sass 1.101.7 reports as supported. */
const FEATURES = new Set(['global-variable-shadowing', 'extend-selector-pseudoclass', 'units-level-3', 'at-error', 'custom-property']);

/**
 * Sass `meta.feature-exists($feature)` / the global `feature-exists()`:
 * whether `$feature`, quoted or not, names one of Dart Sass's {@link FEATURES}.
 */
const featureExists = define('feature-exists', {
  params: [{ name: 'feature', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: (items) => {
    exactArgs(items, ['feature']);
    const feature = items[0]!;
    if (isValueGroupArray(feature) || (feature.type !== 'Quoted' && feature.type !== 'Keyword')) {
      throw new TypeError(`$feature: ${describeValue(feature)} is not a string.`);
    }
    return makeBool(FEATURES.has(feature.type === 'Quoted' ? feature.value : feature.text));
  }
});

export { featureExists };
export default featureExists;
