import type { IslandProviderKey, ParserConfigKey } from './types.js';

/** Serializes a provider key for registry lookup. */
export function providerKeyString(key: IslandProviderKey): string {
  return [
    key.language,
    key.islandKind,
    key.targetShape,
    stableConfigKey(key.parserConfigKey)
  ].join('|');
}

/** Serializes a provider key plus source identity and span for request caches. */
export function requestCacheKey(
  key: IslandProviderKey,
  sourceVersion: string | number,
  start: number,
  end: number
): string {
  return [
    providerKeyString(key),
    String(sourceVersion),
    String(start),
    String(end)
  ].join('|');
}

/**
 * Produces deterministic config keys for structurally equal parser options.
 *
 * Object keys are sorted so cache identity does not depend on insertion order.
 */
export function stableConfigKey(value: ParserConfigKey | undefined): string {
  if (value === undefined) {
    return '';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableConfigKey(item)).join(',')}]`;
  }

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableConfigKey(entryValue)}`)
    .join(',')}}`;
}
