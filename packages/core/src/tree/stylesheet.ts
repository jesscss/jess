import { defineType, type LocationInfo, type NodeOptions } from './node.js';
import { Rules, type RulesOptions } from './rules.js';
import type { TreeContext } from '../context.js';
import type { Node } from './node.js';

export type StylesheetOptions = RulesOptions & NodeOptions;

/**
 * Root stylesheet node.
 *
 * This is intentionally just a semantic root over the normal `Rules` body.
 * Source maps, diagnostics, deferred spans, and editor indexes can be added
 * when a caller proves they need them, but the default parse result should not
 * allocate document-side services.
 */
export class Stylesheet extends Rules<Node[], StylesheetOptions> {
  constructor(
    value: Node[] = [],
    options?: StylesheetOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext, value);
    this._sourceRoot = this;
  }
}

export const stylesheet = defineType(Stylesheet, 'Stylesheet');
