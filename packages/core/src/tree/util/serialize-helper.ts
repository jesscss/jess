import type { AtRule } from '../at-rule';
import type { Ruleset } from '../ruleset';
import type { FinalPrintOptions } from './print';
import { isNode } from './is-node';
import { Nil } from '../nil';

/**
 * Normalizes the indent of a multi-line string by replacing initial whitespace.
 */
export function normalizeIndent(indent: string, multiLineString: string): string {
  return multiLineString.replace(/^\s+/gm, indent);
}

export function indent(depth: number): string {
  return ''.padStart(depth * 2);
}
/**
 * Handles flattening and serializing of at-rules and rulesets
 */
export function serializeRulesContainer(node: AtRule | Ruleset, options: FinalPrintOptions): string {
  const w = options.writer;
  let inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (node.type === 'Ruleset' && node.value.selector instanceof Nil) {
    return '';
  }
  // let header = node.getHeaderString(options);

  const mark = w.mark();

  const rules = node.value.rules;
  if (!rules) {
    w.add(node.getHeaderString(options, true));
    return w.getSince(mark);
  }

  const rulesToRender = rules.flatRules(true);
  if (rulesToRender.length === 0) {
    return '';
  }

  const hoisted = node.isHoisted(options);
  // const isRuleset = isNode(node, 'Ruleset');
  const treeFrames = options.treeFrames!;
  if (hoisted) {
    options.inFrames = inFrames = treeFrames?.filter(f => isNode(f, 'AtRule')) ?? [];
    /** Make sure we still push to treeFrames */
    treeFrames.push(node);
  } else {
    options.inFrames = inFrames = treeFrames!;
  }
  inFrames.push(node);

  let lastRenderedFrames = options.lastRenderedFrames;

  /** Don't output selector yet. Let's see if any child rules need hoisting. */
  for (let idx = 0; idx < rulesToRender.length; idx++) {
    let n = rulesToRender[idx]!;

    if (!n.visible && !n.fullRender) {
      continue;
    }

    if (isNode(n, ['Ruleset', 'AtRule'])) {
      n.toString(options);
      continue;
    }

    let matches = -1;
    /** Close current frames if needed */
    for (let i = 0; i < lastRenderedFrames.length; i++) {
      if (inFrames[i] !== lastRenderedFrames[i]) {
        break;
      }
      matches = i;
    }
    for (let i = lastRenderedFrames.length - 1; i > matches; i--) {
      w.add(indent(i) + '}\n');
      frameHeaders.pop();
      lastRenderedFrames.pop();
      options.depth = i;
    }

    for (let i = matches + 1; i < inFrames.length; i++) {
      let s = frameHeaders[i];
      let f = inFrames[i]!;
      lastRenderedFrames.push(f);
      if (s === undefined) {
        s = inFrames[i]!.getHeaderString({ ...options, depth: i });
        frameHeaders[i] = s;
      } else if (s === '') {
        s = inFrames[i]!.getHeaderString({ ...options, depth: i }, true);
        frameHeaders[i] = s;
      }
      options.depth = i;
      w.add(s!);
    }

    // if (isNode(n, 'Declaration')) {
    w.add(indent(options.depth) + '  ');
    n.processPrePost('pre');
    let out = w.capture(() => n.toTrimmedString({ ...options, depth: options.depth + 1 }));
    w.add(out);
    /** @todo - optionally add semi-colon for compression */
    // if (n.requiredSemi && next) {
    //   w.add(';');
    // }
    if (n.requiredSemi) {
      w.add(';');
    }
    w.add('\n');
    n.processPrePost('post');
    // }
    // else {
    //   n.toString({ ...options, depth: options.depth + 1 });
    // }
  }

  if (hoisted) {
    treeFrames.pop();
  }
  inFrames.pop();
  frameHeaders.pop();
  let renderedLength = lastRenderedFrames.length;
  if (treeFrames.length < renderedLength) {
    w.add(indent(renderedLength - 1) + '}\n');
    lastRenderedFrames.pop();
  }

  return w.getSince(mark);
}