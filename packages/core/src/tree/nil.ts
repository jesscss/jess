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
import type { Context } from '../context.js';
import type { FinalPrintOptions } from './util/print.js';

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
  static override childKeys = null;

  override allowRoot = true;
  override allowRuleRoot = true;
  constructor(
    value?: '',
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super('', options, location, false);
    this._treeContext = treeContext;
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

  /** @internal */
  override writeSyntax(_options: FinalPrintOptions): void {}

  override resolve(_context: Context): this {
    return this;
  }
}

export function createPublicNil(): Nil {
  return new Nil();
}

export const nil = defineType(Nil, 'Nil');
