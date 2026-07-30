import { createRequire } from 'node:module';
import type { CssDiagnosticMetadata } from './types.js';

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

const cssProperties = arrayField(knownCssProperties, 'all')
  .filter((value): value is string => typeof value === 'string');

const CSS_PROPERTY_SET = new Set(cssProperties.map(property => property.toLowerCase()));
const WEB_PROPERTY_SET = new Set(
  arrayField(webCssData, 'properties')
    .map(property => stringField(property, 'name')?.toLowerCase())
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);
const AT_RULE_SET = new Set(
  arrayField(webCssData, 'atDirectives')
    .map(rule => stringField(rule, 'name')?.toLowerCase())
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
);
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
const RESOLUTION_UNITS = new Set(['dpi', 'dpcm', 'dppx', 'x']);
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

export const defaultCssDiagnosticMetadata: CssDiagnosticMetadata = {
  isKnownProperty(name) {
    const lower = name.toLowerCase();
    return CSS_PROPERTY_SET.has(lower) || WEB_PROPERTY_SET.has(lower);
  },
  isKnownAtRule(name) {
    const lower = name.startsWith('@') ? name.toLowerCase() : `@${name.toLowerCase()}`;
    return AT_RULE_SET.has(lower);
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
