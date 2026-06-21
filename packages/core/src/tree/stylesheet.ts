import {
  defineType,
  type LocationInfo,
  type Node,
  type NodeOptions,
  type TreeContext
} from './node.js';
import { Rules, type RulesOptions } from './rules.js';

/**
 * Root stylesheet node for parser paths that need a document-shaped Rules root.
 *
 * Keep this deliberately slim: document services such as source text, spans,
 * trivia, diagnostics, and lazy line maps should be added here only when a
 * parser or editor path proves they replace heavier side machinery.
 */
export class Stylesheet extends Rules {
  constructor(
    value: Node[],
    options?: RulesOptions & NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value, options, location, treeContext);
  }
}

export const stylesheet = defineType<Node[], typeof Stylesheet>(Stylesheet, 'Stylesheet', 'stylesheet');
