/**
 * This file is the entry point for the Node class.
 * It imports from node-base.ts, applies prototype patches,
 * and re-exports everything.
 *
 * This ensures that ANY import of Node gets the patched version,
 * regardless of whether it goes through tree/index.ts or not.
 */

// First, import everything from node-base (the pure Node class)
export * from './node-base.js';
import { Node } from './node-base.js';

// Import dependencies needed for patching (these import from node-base, not node)
import { Nil } from './nil.js';
import { Any } from './any.js';
import { TreeContext } from '../context.js';
import { type Operator } from './util/calculate.js';

const LEGACY_DATA_INTERNAL = new Set([
  'parent', 'index', 'frames', 'pre', 'post', 'state', 'nodeType',
  'isSelector', 'keySetLibrary', 'role',
  'fullRender',
  'rulesetRegistry', 'mixinRegistry', 'declarationRegistry', 'functionRegistry',
  'rulesIndexed', '_indexing',
  'pendingExtends',
  '_valueOf', '_keySet', '_visibleKeySet', '_requiredKeySet'
]);

function getLegacyData(this: Node) {
  const childKeys = (this.constructor as typeof Node).childKeys;

  if (Array.isArray(childKeys)) {
    const extraKeys = Object.keys(this).filter((key) => {
      return !key.startsWith('_') && !LEGACY_DATA_INTERNAL.has(key) && !childKeys.includes(key);
    });

    if (childKeys.length === 1 && extraKeys.length === 0) {
      return (this as any)[childKeys[0]!];
    }

    const out: Record<string, unknown> = {};
    for (const key of childKeys) {
      const value = (this as any)[key];
      if (value !== undefined) {
        out[key] = value;
      }
    }
    for (const key of extraKeys) {
      const value = (this as any)[key];
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  const directValue = (this as any).value;
  if (directValue !== undefined) {
    return directValue;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(this)) {
    if (key.startsWith('_') || LEGACY_DATA_INTERNAL.has(key)) {
      continue;
    }
    const value = (this as any)[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Patch Node.prototype.nil to return a Nil instance
 */
Node.prototype.nil = function() {
  return new Nil();
};

/**
 * Patch Node.prototype.operate for string concatenation
 */
Node.prototype.operate = function(b: Node, op: Operator) {
  let aVal = this.toString();
  let bVal = b.toString();
  if (op === '+') {
    return new Any(aVal + bVal).inherit(this);
  }
  throw new Error(`Cannot operate on ${this.type}`);
};

/**
 * Define a fallback treeContext for testing.
 * Reads from _meta.treeContext (set by constructor), falls back to
 * a lazily-created empty TreeContext for nodes created without one.
 */
Object.defineProperty(Node.prototype, 'treeContext', {
  get() {
    let context = this._meta?.treeContext;
    if (!context) {
      context = this._treeContext;
      if (!context) {
        context = this._treeContext = new TreeContext();
      }
    }
    return context;
  }
});

Object.defineProperty(Node.prototype, 'data', {
  get: getLegacyData,
  set(value) {
    this.setData(value);
  }
});
