import { createRequire } from 'node:module';
import type { CssDiagnosticMetadata, CssFeatureStatus } from './types.js';

const require = createRequire(import.meta.url);
const webCssData: unknown = require('@vscode/web-custom-data/data/browsers.css-data.json');
const cssFunctions: unknown = require('css-functions-list/index.json');
const htmlTags: unknown = require('html-tags');
const knownCssProperties: unknown = require('known-css-properties');
const mathmlTagNames: unknown = require('mathml-tag-names');
const svgTags: unknown = require('svg-tags');

function ownValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function arrayField(value: unknown, key: string): readonly unknown[] {
  const field = ownValue(value, key);
  return Array.isArray(field) ? field : [];
}

function stringField(value: unknown, key: string): string | undefined {
  const field = ownValue(value, key);
  return typeof field === 'string' ? field : undefined;
}

function cssFeatureStatus(value: unknown): CssFeatureStatus | undefined {
  if (value === 'standard'
    || value === 'experimental'
    || value === 'nonstandard'
    || value === 'obsolete'
    || value === 'deprecated') {
    return value;
  }
  return undefined;
}

const cssProperties = arrayField(knownCssProperties, 'all')
  .filter((value): value is string => typeof value === 'string');

const CSS_PROPERTY_SET = new Set(cssProperties.map(property => property.toLowerCase()));
const CSS_PROPERTY_STATUS = new Map<string, CssFeatureStatus>();
const WEB_PROPERTY_SET = new Set(
  arrayField(webCssData, 'properties')
    .map((property) => {
      const name = stringField(property, 'name')?.toLowerCase();
      if (name !== undefined && name.length > 0) {
        const status = cssFeatureStatus(stringField(property, 'status'));
        if (status !== undefined) {
          CSS_PROPERTY_STATUS.set(name, status);
        }
      }
      return name;
    })
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
interface PropertyValueData {
  readonly restrictions: ReadonlySet<string>;
  readonly keywords: ReadonlySet<string>;
}

const PROPERTY_VALUE_DATA = new Map<string, PropertyValueData>();
const AT_RULE_DESCRIPTOR_VALUE_DATA = new Map<string, PropertyValueData>();
for (const property of arrayField(webCssData, 'properties')) {
  const name = stringField(property, 'name')?.toLowerCase();
  const atRule = stringField(property, 'atRule')?.toLowerCase();
  if (name === undefined || name.length === 0) {
    continue;
  }
  const restrictions = arrayField(property, 'restrictions');
  const restrictionSet = new Set(
    restrictions.filter((value): value is string => typeof value === 'string' && value.length > 0)
  );
  const values = arrayField(property, 'values')
    .map(value => stringField(value, 'name')?.toLowerCase())
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (restrictionSet.size === 0 && values.length === 0) {
    continue;
  }
  const data = {
    restrictions: restrictionSet,
    keywords: new Set(values)
  };
  if (atRule === undefined || atRule.length === 0) {
    PROPERTY_VALUE_DATA.set(name, data);
  } else {
    AT_RULE_DESCRIPTOR_VALUE_DATA.set(`${atRule}\u0000${name}`, data);
  }
}
const AT_RULE_SET = new Set(
  arrayField(webCssData, 'atDirectives')
    .map(rule => stringField(rule, 'name')?.toLowerCase())
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);
const AT_RULE_DESCRIPTOR_SET = new Map<string, Set<string>>();
for (const property of arrayField(webCssData, 'properties')) {
  const name = stringField(property, 'name')?.toLowerCase();
  const atRule = stringField(property, 'atRule')?.toLowerCase();
  if (name === undefined || atRule === undefined || name.length === 0 || atRule.length === 0) {
    continue;
  }
  let descriptors = AT_RULE_DESCRIPTOR_SET.get(atRule);
  if (descriptors === undefined) {
    descriptors = new Set();
    AT_RULE_DESCRIPTOR_SET.set(atRule, descriptors);
  }
  descriptors.add(name);
}
AT_RULE_DESCRIPTOR_SET.get('@font-face')?.add('font-family');
const CSS_FUNCTION_SET = new Set(
  (Array.isArray(cssFunctions) ? cssFunctions : [])
    .map(fn => typeof fn === 'string' ? fn.toLowerCase() : undefined)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);
const LENGTH_UNITS = new Set([
  'cap', 'ch', 'em', 'ex', 'ic', 'lh', 'rcap', 'rch', 'rem', 'rex', 'ric', 'rlh',
  'dvb', 'dvh', 'dvi', 'dvmax', 'dvmin', 'dvw',
  'lvb', 'lvh', 'lvi', 'lvmax', 'lvmin', 'lvw',
  'svb', 'svh', 'svi', 'svmax', 'svmin', 'svw',
  'vb', 'vh', 'vi', 'vw', 'vmin', 'vmax', 'vm',
  'px', 'mm', 'cm', 'in', 'pt', 'pc', 'q', 'mozmm',
  'fr',
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'
]);
const ANGLE_UNITS = new Set(['deg', 'grad', 'turn', 'rad']);
const TIME_UNITS = new Set(['s', 'ms']);
const FREQUENCY_UNITS = new Set(['hz', 'khz']);
const RESOLUTION_UNITS = new Set(['dpi', 'dpcm', 'dppx', 'x']);
const COLOR_VALUE_FUNCTIONS = new Set([
  'color',
  'color-mix',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'light-dark',
  'oklab',
  'oklch',
  'rgb',
  'rgba'
]);
const IMAGE_VALUE_FUNCTIONS = new Set([
  'cross-fade',
  'element',
  'image',
  'image-set',
  'linear-gradient',
  'paint',
  'radial-gradient',
  'repeating-conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'url'
]);
const CSS_MATH_FUNCTIONS = new Set([
  'abs',
  'acos',
  'asin',
  'atan',
  'atan2',
  'calc',
  'clamp',
  'cos',
  'exp',
  'hypot',
  'log',
  'max',
  'min',
  'mod',
  'pow',
  'rem',
  'round',
  'sign',
  'sin',
  'sqrt',
  'tan'
]);
const RANGE_MEDIA_FEATURE_NAMES = [
  'aspect-ratio',
  'color',
  'color-index',
  'device-aspect-ratio',
  'device-height',
  'device-width',
  'height',
  'horizontal-viewport-segments',
  'monochrome',
  'resolution',
  'vertical-viewport-segments',
  'width'
];
const DISCRETE_MEDIA_FEATURE_NAMES = [
  'any-hover',
  'any-pointer',
  'color-gamut',
  'display-mode',
  'dynamic-range',
  'environment-blending',
  'forced-colors',
  'grid',
  'hover',
  'inverted-colors',
  'light-level',
  'nav-controls',
  'orientation',
  'overflow-block',
  'overflow-inline',
  'pointer',
  'prefers-color-scheme',
  'prefers-contrast',
  'prefers-reduced-data',
  'prefers-reduced-motion',
  'prefers-reduced-transparency',
  'scan',
  'scripting',
  'update',
  'video-color-gamut',
  'video-dynamic-range'
];
const MEDIA_FEATURE_NAME_SET = new Set([
  ...RANGE_MEDIA_FEATURE_NAMES,
  ...RANGE_MEDIA_FEATURE_NAMES.flatMap(name => [`min-${name}`, `max-${name}`]),
  ...DISCRETE_MEDIA_FEATURE_NAMES
]);
const MEDIA_FEATURE_ALLOWED_KEYWORDS = new Map<string, ReadonlySet<string>>([
  ['any-hover', new Set(['hover', 'none'])],
  ['any-pointer', new Set(['coarse', 'fine', 'none'])],
  ['color-gamut', new Set(['p3', 'rec2020', 'srgb'])],
  ['display-mode', new Set(['browser', 'fullscreen', 'minimal-ui', 'picture-in-picture', 'standalone'])],
  ['dynamic-range', new Set(['high', 'standard'])],
  ['environment-blending', new Set(['additive', 'opaque', 'subtractive'])],
  ['forced-colors', new Set(['active', 'none'])],
  ['hover', new Set(['hover', 'none'])],
  ['inverted-colors', new Set(['inverted', 'none'])],
  ['nav-controls', new Set(['back', 'none'])],
  ['orientation', new Set(['landscape', 'portrait'])],
  ['overflow-block', new Set(['none', 'paged', 'scroll'])],
  ['overflow-inline', new Set(['none', 'scroll'])],
  ['pointer', new Set(['coarse', 'fine', 'none'])],
  ['prefers-color-scheme', new Set(['dark', 'light'])],
  ['prefers-contrast', new Set(['custom', 'less', 'more', 'no-preference'])],
  ['prefers-reduced-data', new Set(['no-preference', 'reduce'])],
  ['prefers-reduced-motion', new Set(['no-preference', 'reduce'])],
  ['prefers-reduced-transparency', new Set(['no-preference', 'reduce'])],
  ['resolution', new Set(['infinite'])],
  ['scan', new Set(['interlace', 'progressive'])],
  ['scripting', new Set(['enabled', 'initial-only', 'none'])],
  ['update', new Set(['fast', 'none', 'slow'])],
  ['video-color-gamut', new Set(['p3', 'rec2020', 'srgb'])],
  ['video-dynamic-range', new Set(['high', 'standard'])]
]);
const MEDIA_FEATURE_ALLOWED_TYPES = new Map<string, ReadonlySet<string>>([
  ['aspect-ratio', new Set(['ratio'])],
  ['color', new Set(['integer'])],
  ['color-index', new Set(['integer'])],
  ['device-aspect-ratio', new Set(['ratio'])],
  ['device-height', new Set(['length'])],
  ['device-width', new Set(['length'])],
  ['grid', new Set(['mq-boolean'])],
  ['height', new Set(['length'])],
  ['horizontal-viewport-segments', new Set(['integer'])],
  ['monochrome', new Set(['integer'])],
  ['resolution', new Set(['resolution'])],
  ['vertical-viewport-segments', new Set(['integer'])],
  ['width', new Set(['length'])]
]);
const DEPRECATED_HTML_TYPE_SELECTORS = [
  'acronym', 'applet', 'basefont', 'big', 'bgsound', 'blink', 'center',
  'content', 'dir', 'font', 'frame', 'frameset', 'isindex', 'keygen',
  'listing', 'marquee', 'menuitem', 'multicol', 'nextid', 'nobr', 'noembed',
  'noframes', 'plaintext', 'param', 'popup', 'rb', 'rtc', 'selectmenu',
  'shadow', 'spacer', 'strike', 'tt', 'xmp'
];
const EXPERIMENTAL_HTML_TYPE_SELECTORS = [
  'fencedframe', 'geolocation', 'install', 'listbox', 'model', 'portal',
  'selectedcontent', 'selectlist', 'usermedia'
];
const EXTRA_SVG_TYPE_SELECTORS = ['hatch', 'hatchpath', 'hatchPath'];
const htmlTagList = ownValue(htmlTags, 'default');
const mathmlTagList = ownValue(mathmlTagNames, 'mathmlTagNames');
const HTML_TYPE_SELECTOR_SET = new Set([
  ...(Array.isArray(htmlTagList) ? htmlTagList : []),
  ...DEPRECATED_HTML_TYPE_SELECTORS,
  ...EXPERIMENTAL_HTML_TYPE_SELECTORS
].filter((name): name is string => typeof name === 'string' && name.length > 0).map(name => name.toLowerCase()));
const SVG_TYPE_SELECTOR_SET = new Set([
  ...(Array.isArray(svgTags) ? svgTags : []),
  ...EXTRA_SVG_TYPE_SELECTORS
].filter((name): name is string => typeof name === 'string' && name.length > 0));
const MATHML_TYPE_SELECTOR_SET = new Set(
  (Array.isArray(mathmlTagList) ? mathmlTagList : [])
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .map(name => name.toLowerCase())
);
const PSEUDO_CLASS_SET = new Set(
  arrayField(webCssData, 'pseudoClasses')
    .map(pseudo => stringField(pseudo, 'name')?.toLowerCase())
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);
const PSEUDO_ELEMENT_SET = new Set(
  arrayField(webCssData, 'pseudoElements')
    .map(pseudo => stringField(pseudo, 'name')?.toLowerCase())
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);

function baseMediaFeatureName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith('min-')) {
    return lower.slice(4);
  }
  if (lower.startsWith('max-')) {
    return lower.slice(4);
  }
  return lower;
}

function unprefixedIdentifier(name: string): string {
  if (name.startsWith('-webkit-')) {
    return name.slice(8);
  }
  if (name.startsWith('-moz-')) {
    return name.slice(5);
  }
  if (name.startsWith('-ms-')) {
    return name.slice(4);
  }
  if (name.startsWith('-o-')) {
    return name.slice(3);
  }
  return name;
}

function hasAllowedNumericResultType(types: ReadonlySet<string> | undefined): boolean {
  return types !== undefined
    && (
      types.has('integer')
      || types.has('length')
      || types.has('ratio')
      || types.has('resolution')
    );
}

function acceptsZeroLength(value: number | undefined, restrictions: ReadonlySet<string>): boolean {
  return value === 0
    && (
      restrictions.has('length')
      || restrictions.has('line-width')
    );
}

function acceptsDimension(unit: string | undefined, restrictions: ReadonlySet<string>): boolean {
  if (unit === undefined) {
    return false;
  }
  const lower = unit.toLowerCase();
  return (restrictions.has('length') && LENGTH_UNITS.has(lower))
    || (restrictions.has('line-width') && LENGTH_UNITS.has(lower))
    || (restrictions.has('angle') && ANGLE_UNITS.has(lower))
    || (restrictions.has('time') && TIME_UNITS.has(lower))
    || (restrictions.has('frequency') && FREQUENCY_UNITS.has(lower))
    || (restrictions.has('resolution') && RESOLUTION_UNITS.has(lower));
}

function isKnownDimensionUnit(unit: string | undefined): boolean {
  if (unit === undefined) {
    return false;
  }
  const lower = unit.toLowerCase();
  return LENGTH_UNITS.has(lower)
    || ANGLE_UNITS.has(lower)
    || TIME_UNITS.has(lower)
    || FREQUENCY_UNITS.has(lower)
    || RESOLUTION_UNITS.has(lower);
}

function acceptsNumericFunction(functionName: string | undefined, restrictions: ReadonlySet<string>): boolean {
  return functionName !== undefined
    && CSS_MATH_FUNCTIONS.has(functionName)
    && hasNumericRestriction(restrictions);
}

function hasNumericRestriction(restrictions: ReadonlySet<string>): boolean {
  return restrictions.has('length')
    || restrictions.has('line-width')
    || restrictions.has('percentage')
    || restrictions.has('number')
    || restrictions.has('integer')
    || restrictions.has('number(0-1)')
    || restrictions.has('angle')
    || restrictions.has('time')
    || restrictions.has('resolution');
}

function knownCssDataValue(data: PropertyValueData, value: CssPropertyValueFact, allowCssWide: boolean): boolean | undefined {
  const lowerValue = unprefixedIdentifier(value.normalized);
  if (allowCssWide && CSS_WIDE_KEYWORDS.has(lowerValue)) {
    return true;
  }
  if (data.keywords.has(lowerValue)) {
    return true;
  }
  const restrictions = data.restrictions;
  if (value.kind === 'unknown') {
    return undefined;
  }
  if (value.kind === 'keyword') {
    return restrictions.has('identifier') ? true : false;
  }
  if (value.kind === 'color') {
    return restrictions.has('color');
  }
  if (value.kind === 'integer') {
    const numberValue = value.numericValue;
    return restrictions.has('integer')
      || restrictions.has('number')
      || (restrictions.has('number(0-1)') && numberValue !== undefined && numberValue >= 0 && numberValue <= 1)
      || acceptsZeroLength(numberValue, restrictions);
  }
  if (value.kind === 'number') {
    const numberValue = value.numericValue;
    return restrictions.has('number')
      || (restrictions.has('number(0-1)') && numberValue !== undefined && numberValue >= 0 && numberValue <= 1)
      || acceptsZeroLength(numberValue, restrictions);
  }
  if (value.kind === 'percentage') {
    return restrictions.has('percentage');
  }
  if (value.kind === 'dimension') {
    if (!isKnownDimensionUnit(value.unit)) {
      return undefined;
    }
    return acceptsDimension(value.unit, restrictions);
  }
  if (value.kind === 'function') {
    const functionName = value.functionName;
    if (functionName === undefined) {
      return undefined;
    }
    if (data.keywords.has(`${functionName}()`)
      || (restrictions.has('url') && functionName === 'url')
      || (restrictions.has('color') && COLOR_VALUE_FUNCTIONS.has(functionName))
      || (restrictions.has('image') && IMAGE_VALUE_FUNCTIONS.has(functionName))
      || acceptsNumericFunction(functionName, restrictions)) {
      return true;
    }
    if (!CSS_FUNCTION_SET.has(functionName)) {
      return undefined;
    }
    return restrictions.has('url') || restrictions.has('color') || restrictions.has('image') || hasNumericRestriction(restrictions)
      ? false
      : undefined;
  }
  return undefined;
}

export const defaultCssDiagnosticMetadata: CssDiagnosticMetadata = {
  isKnownProperty(name) {
    const lower = name.toLowerCase();
    return CSS_PROPERTY_SET.has(lower) || WEB_PROPERTY_SET.has(lower);
  },
  cssPropertyStatus(name) {
    return CSS_PROPERTY_STATUS.get(name.toLowerCase());
  },
  isKnownPropertyValue(name, value) {
    const data = PROPERTY_VALUE_DATA.get(name.toLowerCase());
    if (data === undefined) {
      return undefined;
    }
    return knownCssDataValue(data, value, true);
  },
  isKnownAtRule(name) {
    const lower = name.startsWith('@') ? name.toLowerCase() : `@${name.toLowerCase()}`;
    return AT_RULE_SET.has(lower);
  },
  isKnownAtRuleDescriptor(atRuleName, descriptorName) {
    const lowerAtRule = atRuleName.startsWith('@') ? atRuleName.toLowerCase() : `@${atRuleName.toLowerCase()}`;
    const descriptors = AT_RULE_DESCRIPTOR_SET.get(lowerAtRule);
    return descriptors?.has(descriptorName.toLowerCase());
  },
  isKnownAtRuleDescriptorValue(atRuleName, descriptorName, value) {
    const lowerAtRule = atRuleName.startsWith('@') ? atRuleName.toLowerCase() : `@${atRuleName.toLowerCase()}`;
    const data = AT_RULE_DESCRIPTOR_VALUE_DATA.get(`${lowerAtRule}\u0000${descriptorName.toLowerCase()}`);
    return data === undefined ? undefined : knownCssDataValue(data, value, false);
  },
  isKnownFunction(name) {
    return CSS_FUNCTION_SET.has(name.toLowerCase());
  },
  isKnownMediaFeatureName(name) {
    return MEDIA_FEATURE_NAME_SET.has(name.toLowerCase());
  },
  isKnownMediaFeatureValue(name, value) {
    const featureName = baseMediaFeatureName(name);
    if (!MEDIA_FEATURE_NAME_SET.has(name.toLowerCase()) && !MEDIA_FEATURE_NAME_SET.has(featureName)) {
      return undefined;
    }
    const keywords = MEDIA_FEATURE_ALLOWED_KEYWORDS.get(featureName);
    const types = MEDIA_FEATURE_ALLOWED_TYPES.get(featureName);
    if (value.kind === 'unknown') {
      return undefined;
    }
    if (value.kind === 'keyword') {
      return keywords?.has(unprefixedIdentifier(value.normalized)) ?? false;
    }
    if (value.kind === 'integer') {
      const numberValue = value.numericValue;
      return types?.has('integer') === true
        || types?.has('ratio') === true
        || (numberValue === 0 && (types?.has('length') === true || types?.has('resolution') === true || types?.has('mq-boolean') === true))
        || (numberValue === 1 && types?.has('mq-boolean') === true);
    }
    if (value.kind === 'number') {
      return types?.has('ratio') === true
        || (value.numericValue === 0 && (types?.has('length') === true || types?.has('resolution') === true));
    }
    if (value.kind === 'dimension') {
      const unit = value.unit;
      return unit !== undefined
        && (
          (types?.has('length') === true && LENGTH_UNITS.has(unit))
          || (types?.has('resolution') === true && RESOLUTION_UNITS.has(unit))
        );
    }
    if (value.kind === 'percentage') {
      return false;
    }
    if (value.kind === 'ratio') {
      return types?.has('ratio') === true;
    }
    if (value.kind === 'function') {
      const functionName = value.functionName;
      if (functionName === 'env') {
        return true;
      }
      return functionName !== undefined
        && CSS_MATH_FUNCTIONS.has(functionName)
        && hasAllowedNumericResultType(types);
    }
    return undefined;
  },
  isKnownPseudoClass(name) {
    const lower = name.startsWith(':') ? name.toLowerCase() : `:${name.toLowerCase()}`;
    return PSEUDO_CLASS_SET.has(lower);
  },
  isKnownPseudoElement(name) {
    const lower = name.startsWith('::') ? name.toLowerCase() : `::${name.replace(/^:/, '').toLowerCase()}`;
    return PSEUDO_ELEMENT_SET.has(lower);
  },
  isKnownTypeSelector(name) {
    return HTML_TYPE_SELECTOR_SET.has(name.toLowerCase())
      || SVG_TYPE_SELECTOR_SET.has(name)
      || MATHML_TYPE_SELECTOR_SET.has(name.toLowerCase());
  }
};
