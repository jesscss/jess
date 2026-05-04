/**
 * Import from node-base to avoid circular dependency.
 * The patching of Node.prototype.nil happens in node.ts
 */
import {
  Node,
  F_VISIBLE,
  F_STATIC,
  defineType,
  type LocationInfo,
  type NodeOptions
} from './node-base.js';
import type { Context, TreeContext } from '../context.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

export interface Nil extends Node<''> {
  valueOf(): '';
  eval(context: Context): Nil;
}

/**
 * A Node type that outputs nothing.
 *
 * We need this for things like rulesets,
 * which need dynamically-linked nodes
 *
 * This is also the default value for declarations like:
 * `$var:;`
 */
export class Nil extends Node<''> {
  override allowRoot = true;
  override allowRuleRoot = true;
  constructor(
    value?: any,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext) {
    super('', options, location, treeContext);
    this.addFlag(F_STATIC);
    this.removeFlag(F_VISIBLE);
    // Nil nodes should never render, even if fullRender is set on prototype (e.g., in tests)
    this.fullRender = false;
  }

  foo() {}

  override toTrimmedString() {
    return '';
  }

  override toString() {
    return '';
  }

  override render(context: Context, options?: PrintOptions): string {
    getPrintOptions({ ...options, context });
    return '';
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export const nil = defineType(Nil, 'Nil');
