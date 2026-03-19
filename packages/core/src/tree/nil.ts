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

export interface Nil extends Node<''> {
  type: 'Nil';
  shortType: 'nil';
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
  static override childKeys = null as null;

  constructor(
    value?: any,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext) {
    super('' as any, options, location, treeContext);
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlag(F_STATIC);
    this.removeFlag(F_VISIBLE);
    // Nil nodes should never render, even if fullRender is set on prototype (e.g., in tests)
    this.fullRender = false;
  }

  override toTrimmedString() {
    return '';
  }

  override toString() {
    return '';
  }
}

export const nil = defineType(Nil, 'Nil');