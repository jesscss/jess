import { Any, Collection, Color, ColorFormat, Declaration, Dimension, Node, Quoted, Rules } from '@jesscss/core';
import { LessAdapterBase } from './less-adapter.js';

// Less.js types
export type LessNode = any;

export interface FromLessOptions {
  /** Cache conversions to avoid repeated work */
  cache?: WeakMap<any, Node>;
  /** When true, boolean return values are treated as "no output" (Less statement context) */
  statementContext?: boolean;
}

/**
 * Convert a Less node back to a Jess node
 *
 * @param lessNode - The Less node to convert
 * @param options - Conversion options
 * @returns A Jess node
 */
export function fromLessNode(
  lessNode: LessNode,
  options?: FromLessOptions
): Node {
  if (!lessNode) {
    return lessNode;
  }

  const cache = options?.cache || new WeakMap();

  // Check cache first
  if (cache.has(lessNode)) {
    const cached = cache.get(lessNode);
    if (cached) {
      return cached;
    }
  }

  // If it's already a Jess node wrapped in an adapter, extract it
  if (lessNode instanceof LessAdapterBase) {
    cache.set(lessNode, lessNode.jessNode);
    return lessNode.jessNode;
  }

  // If it's a Less node that was created by a visitor, we need to reconstruct
  // For now, if we can't convert it back, return the original adapter target
  // TODO: Implement full reverse conversion for all node types

  // Check if it has a __jessNode property (we might store this during conversion)
  if (lessNode && typeof lessNode === 'object' && '__jessNode' in lessNode) {
    return lessNode.__jessNode;
  }

  // Minimal reverse conversions for Less-created nodes used in Less.js plugins
  if (lessNode && typeof lessNode === 'object' && typeof lessNode.type === 'string') {
    if (lessNode.type === 'Quoted') {
      const quote = (lessNode.quote === '\'' || lessNode.quote === '"') ? lessNode.quote : '"';
      const value = typeof lessNode.value === 'string' ? lessNode.value : String(lessNode.value);
      const escaped = !!lessNode.escaped;
      const out = new Quoted(value, { quote, escaped });
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'Anonymous') {
      const value = typeof lessNode.value === 'string' ? lessNode.value : String(lessNode.value);
      const out = new Any(value);
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'Dimension' || lessNode.type === 'Num') {
      const n = typeof lessNode.value === 'number' ? lessNode.value : Number(lessNode.value);
      const u = typeof lessNode.unit === 'string' ? lessNode.unit : '';
      const out = new Dimension({ number: n, unit: u || undefined });
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'Color') {
      const rgb = Array.isArray(lessNode.rgb) ? lessNode.rgb : [0, 0, 0];
      const [r = 0, g = 0, b = 0] = rgb;
      const alpha = typeof lessNode.alpha === 'number' ? lessNode.alpha : 1;
      const out = new Color({ rgb: [r, g, b], alpha }, { format: ColorFormat.HEX });
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'Declaration' || lessNode.type === 'Rule') {
      const prop = String(lessNode.name ?? '');
      const val = lessNode.value;
      const valueStr = val && typeof val === 'object' && typeof val.value === 'string'
        ? val.value
        : String(val ?? '');
      const out = new Declaration({
        name: new Any(prop, { role: 'property' as const }),
        value: new Any(valueStr)
      });
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'DetachedRuleset') {
      const ruleset = lessNode.ruleset;
      const rules = (ruleset && Array.isArray(ruleset.rules)) ? ruleset.rules : [];
      const nodes: Node[] = [];
      for (const rr of rules) {
        if (rr && typeof rr === 'object' && (rr.type === 'Declaration' || rr.type === 'Rule')) {
          const prop = String(rr.name ?? '');
          const val = rr.value;
          const valueStr = val && typeof val === 'object' && typeof val.value === 'string'
            ? val.value
            : String(val ?? '');
          const decl = new Declaration({
            name: new Any(prop, { role: 'property' as const }),
            value: new Any(valueStr)
          });
          nodes.push(decl);
        }
      }
      const out = new Collection(nodes);
      cache.set(lessNode, out);
      return out;
    }

    if (lessNode.type === 'AtRule') {
      const n = String(lessNode.name ?? '');
      const v = String(lessNode.value ?? '');
      const line = `${n} ${v};`;
      const out = n === '@charset'
        ? new Any(line, { role: 'charset' as const })
        : new Any(line);
      cache.set(lessNode, out);
      return out;
    }
  }

  // If we can't convert it, try to return the original node
  // This is a fallback - in practice, visitors shouldn't create new nodes
  // that we can't track back to their originals
  throw new Error(
    `Cannot convert Less node back to Jess: ${lessNode?.type || 'unknown type'}. `
    + `Less visitors should not create new nodes, only modify existing ones.`
  );
}

/**
 * Convert a Less plugin function return value to a Jess node.
 * Handles primitives (number, boolean), Less nodes (via fromLessNode), and toCSS() objects.
 * Use this for @plugin-loaded function results so conversion is centralized here.
 */
export function fromLessPluginReturnValue(
  value: unknown,
  options?: FromLessOptions
): Node | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return new Any(String(value));
  }
  if (value === true || value === false) {
    if (options?.statementContext) {
      return undefined;
    }
    return new Any(String(value));
  }
  if (typeof value === 'object' && value !== null) {
    if ('type' in value && typeof value.type === 'string') {
      return fromLessNode(value, options);
    }
    if ('toCSS' in value && typeof value.toCSS === 'function') {
      try {
        const css: unknown = value.toCSS();
        return new Any(typeof css === 'string' ? css : String(css));
      } catch {
        // ignore
      }
    }
  }
  if (value instanceof Node) {
    return value;
  }
  return new Any(String(value));
}

/**
 * Convert an entire Less tree back to Jess Rules
 *
 * @param lessTree - The Less tree to convert
 * @param options - Conversion options
 * @returns A Jess Rules tree
 */
export function fromLessTree(
  lessTree: LessNode,
  _options?: FromLessOptions
): Rules {
  // TODO: Implement tree conversion
  // This will recursively convert all nodes back to Jess format
  // For now, if it's an adapter, extract the original
  if (lessTree instanceof LessAdapterBase && lessTree.jessNode instanceof Rules) {
    return lessTree.jessNode;
  }

  throw new Error('Cannot convert Less tree back to Jess Rules');
}
