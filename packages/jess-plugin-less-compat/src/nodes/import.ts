import { StyleImport, Node } from '@jesscss/core';
import { createLessProxy } from '../transform/proxy.js';
import { toLessNode } from '../transform/to-less.js';
import { mapJessTypeToLessType } from '../transform/type-map.js';
import { fromLessNode } from '../transform/from-less.js';
import type { LessNode } from '../types.js';

/**
 * Transform a Jess StyleImport to a Less-compatible Import
 */
export function transformImportToLess(
  jessImport: StyleImport,
  cache?: WeakMap<any, any>
): LessNode {
  return createLessProxy(jessImport, cache, (prop, target) => {
    const imp = target as StyleImport;

    // Map 'type' property
    if (prop === 'type') {
      return mapJessTypeToLessType(imp.type);
    }

    // Map 'typeIndex'
    if (prop === 'typeIndex') {
      return undefined;
    }

    // Map 'path' property
    if (prop === 'path') {
      const path = imp.path;
      if (path instanceof Node) {
        return toLessNode(path, { cache });
      }
      return path;
    }

    // Map 'options' property (Less uses this for import options)
    // Jess stores import options in options.importOptions
    if (prop === 'options') {
      return imp.options?.importOptions || {};
    }

    // Map 'currentFileInfo' property
    if (prop === 'currentFileInfo') {
      const loc = imp.location;
      if (Array.isArray(loc)) {
        return {};
      }
      return loc || {};
    }

    // Map 'index' property
    if (prop === 'index') {
      const loc = imp.location;
      if (Array.isArray(loc) || !loc) {
        return undefined;
      }
      return (loc as any).index;
    }

    // Map 'accept' method for visitor traversal
    if (prop === 'accept') {
      return function(visitor: any) {
        const lessImport = transformImportToLess(imp, cache);
        const result = visitor.visit(lessImport);
        if (result !== lessImport) {
          return fromLessNode(result, { cache });
        }
        return imp;
      };
    }

    return undefined;
  });
}
