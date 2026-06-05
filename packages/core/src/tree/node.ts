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
import { type Operator } from './util/calculate.js';

export type { TreeContext } from '../context.js';

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
