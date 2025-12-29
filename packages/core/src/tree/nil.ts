/**
 * Import from node-base to avoid circular dependency.
 * The patching of Node.prototype.nil happens in node.ts
 */
import {
  Node,
  F_VISIBLE,
  defineType,
  type LocationInfo,
  type NodeOptions
} from './node-base';
import type { Context, TreeContext } from '../context';

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
  type = 'Nil';
  shortType = 'nil';
  override allowRoot = true;
  override allowRuleRoot = true;
  override state = 0b0000; // 0b0000 means no flags are set

  constructor(
    value?: any,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext) {
    super('', options, location, treeContext);
    // Nil nodes should not be visible (they serialize to empty strings)
    this.removeFlag(F_VISIBLE);
    // Nil nodes should never render, even if fullRender is set on prototype (e.g., in tests)
    this.fullRender = false;
  }

  override toTrimmedString() { return ''; }
  override toString() { return ''; }
}

export const nil = defineType(Nil, 'Nil');