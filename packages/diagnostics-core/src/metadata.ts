import { createRequire } from 'node:module';
import type { CssDiagnosticMetadata } from './types.js';

const require = createRequire(import.meta.url);
const webCssData: unknown = require('@vscode/web-custom-data/data/browsers.css-data.json');
const knownCssProperties: unknown = require('known-css-properties');

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

export const defaultCssDiagnosticMetadata: CssDiagnosticMetadata = {
  isKnownProperty(name) {
    const lower = name.toLowerCase();
    return CSS_PROPERTY_SET.has(lower) || WEB_PROPERTY_SET.has(lower);
  },
  isKnownAtRule(name) {
    const lower = name.startsWith('@') ? name.toLowerCase() : `@${name.toLowerCase()}`;
    return AT_RULE_SET.has(lower);
  }
};
