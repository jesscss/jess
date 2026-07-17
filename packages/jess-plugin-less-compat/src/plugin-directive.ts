import { getProp, hasMethod, isUnknownArray } from './less-runtime.js';

/** The plugin path and optional option string parsed from a `@plugin` prelude. */
export interface ParsedPluginDirective {
  pluginPath?: string;
  pluginOptions?: string;
}

/**
 * Parse a deprecated `@plugin (options) "path"` prelude into its path and option
 * string. The prelude is a dynamic Less/Jess value (string, Quoted/Url node, or a
 * Sequence/Expression/List of nodes), so every access is guarded.
 */
export function parsePluginPrelude(prelude: unknown): ParsedPluginDirective {
  let pluginPath: string | undefined;
  let pluginOptions: string | undefined;

  if (prelude) {
    type NodeValueLike = { type?: unknown; value?: unknown };
    type ValueOfLike = { valueOf(): unknown };

    const isObjectLike = (value: unknown): value is NodeValueLike =>
      typeof value === 'object' && value !== null;

    const hasValueOf = (value: unknown): value is ValueOfLike =>
      isObjectLike(value) && typeof value.valueOf === 'function';

    const valueOfString = (value: unknown, trim = false): string | undefined => {
      if (!hasValueOf(value)) {
        return undefined;
      }
      const output = value.valueOf();
      return typeof output === 'string'
        ? (trim ? output.trim() : output)
        : undefined;
    };

    const stringFromNodeValue = (value: unknown): string | undefined => {
      if (typeof value === 'string') {
        return value;
      }
      const valueResult = valueOfString(value);
      if (valueResult !== undefined) {
        return valueResult;
      }
      if (isObjectLike(value) && typeof value.value === 'string') {
        return value.value;
      }
      return undefined;
    };

    // Helper to extract string value from a node (Quoted, Url, or string)
    const extractStringValue = (node: unknown): string | undefined => {
      if (!node) {
        return undefined;
      }
      if (typeof node === 'string') {
        return node;
      }
      if (!isObjectLike(node)) {
        return undefined;
      }
      if (node.type === 'Quoted' && node.value) {
        // Quoted.value can be string | Any | Interpolated
        const value = stringFromNodeValue(node.value);
        if (value !== undefined) {
          return value;
        }
        return valueOfString(node);
      }
      if (node.type === 'Url' && node.value) {
        // Url.value can be Quoted, string, or other
        const value = stringFromNodeValue(node.value);
        if (value !== undefined) {
          return value;
        }
        if (isObjectLike(node.value) && node.value.type === 'Quoted') {
          return extractStringValue(node.value);
        }
        return valueOfString(node);
      }
      return valueOfString(node, true);
    };

    // Prelude might contain options in parentheses followed by the plugin path
    // Less.js syntax: @plugin (options) "path"
    // The prelude might be a Sequence with options and path, or just the path
    const preludeType = isObjectLike(prelude) ? prelude.type : undefined;
    const preludeValue = isObjectLike(prelude) ? prelude.value : undefined;

    // Extract any parenthesized options node preceding the path at `values[i]`.
    const optionsFromPrevItem = (prevItem: unknown, allowValueOfPair: boolean): void => {
      const prevType = getProp(prevItem, 'type');
      const prevValue = getProp(prevItem, 'value');
      // Options might be in a Paren node or as a string
      if (prevItem && prevType === 'Paren' && prevValue) {
        const optionsValue = hasMethod(prevValue, 'valueOf') ? prevValue.valueOf() : String(prevValue);
        if (typeof optionsValue === 'string') {
          pluginOptions = optionsValue.trim();
        }
      } else if (allowValueOfPair && prevItem && hasMethod(prevItem, 'valueOf')) {
        const optionsValue = prevItem.valueOf();
        if (typeof optionsValue === 'string' && optionsValue.includes('=')) {
          pluginOptions = optionsValue.trim();
        }
      }
    };

    // Scan a node array for the path (Quoted/Url) plus any preceding options.
    const scanForPath = (items: unknown[], allowValueOfPair: boolean): void => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const extracted = extractStringValue(item);
        if (item && extracted !== undefined) {
          pluginPath = extracted;
          if (i > 0) {
            optionsFromPrevItem(items[i - 1], allowValueOfPair);
          }
          if (pluginPath) {
            break;
          }
        }
      }
    };

    if (typeof prelude === 'string') {
      pluginPath = prelude;
    } else if (preludeType === 'Quoted' || preludeType === 'Url') {
      pluginPath = extractStringValue(prelude);
    } else if (preludeType === 'Sequence' && isUnknownArray(preludeValue)) {
      // Sequence might contain: [options in parens, quoted path]
      scanForPath(preludeValue, true);
    } else if (preludeType === 'Expression' && preludeValue) {
      // Expression might contain options and a Quoted or Url node
      scanForPath(isUnknownArray(preludeValue) ? preludeValue : [preludeValue], false);
    } else if (preludeType === 'List' && preludeValue) {
      // List might contain options and path
      scanForPath(isUnknownArray(preludeValue) ? preludeValue : [preludeValue], false);
    } else if (preludeValue && typeof preludeValue === 'string') {
      // Fallback: direct string value
      pluginPath = preludeValue;
    }
    if (!pluginPath && hasMethod(prelude, 'valueOf')) {
      const fallbackValue = prelude.valueOf();
      if (typeof fallbackValue === 'string') {
        pluginPath = fallbackValue;
      }
    }
  }

  return { pluginPath, pluginOptions };
}

/**
 * Detect a deprecated `@plugin` directive anywhere in a parsed tree. The parser
 * no longer always threads the caller's TreeContext onto the root tree's
 * `_treeContext`, so the raw source may be unavailable; this walks the parsed
 * tree, where `@plugin` appears as an AtRule/AtRuleStatement/Directive named
 * `@plugin` (or `plugin`).
 */
export function treeContainsPluginDirective(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== 'object' || depth > 32) {
    return false;
  }
  const candidate: { type?: unknown; name?: unknown; rules?: unknown } = node;
  const type = candidate.type;
  if (type === 'AtRule' || type === 'AtRuleStatement' || type === 'Directive') {
    const name = candidate.name;
    let nameValue: string | undefined;
    if (typeof name === 'string') {
      nameValue = name;
    } else if (name && typeof name === 'object') {
      const inner: unknown = (name as { value?: unknown }).value;
      if (typeof inner === 'string') {
        nameValue = inner;
      }
    }
    if (nameValue === '@plugin' || nameValue === 'plugin') {
      return true;
    }
  }
  const rules = candidate.rules;
  if (Array.isArray(rules)) {
    for (const child of rules) {
      if (treeContainsPluginDirective(child, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}
