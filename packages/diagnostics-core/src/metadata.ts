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
