/**
 * Import from node-base to avoid circular dependency.
 * The patching of Node.prototype.nil happens in node.ts
 */
import {
  Node,
  F_ALLOW_ROOT,
  F_VISIBLE,
  F_STATIC,
  defineType,
  type LocationInfo,
  type NodeOptions
} from './node-base.js';
import type { Context } from '../context.js';
import type { FinalPrintOptions, PrintOptions } from './util/print.js';
import { renderInvisibleEffect, type RenderBuffer } from './util/render-buffer.js';

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

  // Invariant 7: each node owns its value; Nil's is always the empty string.
  readonly value: '' = '';

  constructor(
    value?: '',
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: Context['treeContext']
  ) {
    super('', options, location);
    this._treeContext = treeContext;
    this.addFlag(F_STATIC);
    this.addFlag(F_ALLOW_ROOT);
    this.removeFlag(F_VISIBLE);
  }

  override toTrimmedString() {
    return '';
  }

  override toString() {
    return '';
  }

  /** @internal */
  override writeSyntax(_options: FinalPrintOptions): void {}

  // Static-by-type invisibility: Nil is never CSS output. The no-op render
  // keeps the base render() gate off the common hot path (Focus D.1 stage 2).
  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): string;
  override render(context: Context, options?: PrintOptions): string;
  override render(_context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string {
    return renderInvisibleEffect(undefined, bufferOrOptions) as string;
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export function createPublicNil(): Nil {
  return new Nil();
}

export const nil = defineType(Nil, 'Nil');
