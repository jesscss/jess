/**
 * This file is the entry point for the Node class.
 * It imports from node-base.ts, applies prototype patches,
 * and re-exports everything.
 *
 * This ensures that ANY import of Node gets the patched version,
 * regardless of whether it goes through tree/index.ts or not.
 */

// First, import everything from node-base (the pure Node class)
export * from './node-base';
import { Node } from './node-base';

// Import dependencies needed for patching (these import from node-base, not node)
import { Nil } from './nil';
import { Any } from './any';
import { TreeContext } from '../context';
import { type Operator } from './util/calculate';

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
 */
Object.defineProperty(Node.prototype, 'treeContext', {
  get() {
    let context = this._treeContext;
    if (!context) {
      context = this._treeContext = new TreeContext();
    }
    return context;
  }
});
