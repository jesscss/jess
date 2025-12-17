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
/**
 * Handles flattening and serializing of at-rules and rulesets
 */
export function serializeRulesContainer(node: AtRule | Ruleset, options: FinalPrintOptions): string {
  const w = options.writer;
  const depth = options.depth;
  const idt = options.indent;
  const inFrames = options.inFrames;
  const frameHeaders = options.frameHeaders;

  if (node.type === 'Ruleset' && node.value.selector instanceof Nil) {
    return '';
  }
  let header = node.getHeaderString(options);

  const mark = w.mark();

  const rules = node.value.rules;
  if (!rules) {
    w.add(header);
    return w.getSince(mark);
  }

  const rulesToRender = rules.flatRules(true);
  if (rulesToRender.length === 0) {
    return '';
  }

  /** Don't output selector yet. Let's see if any child rules need hoisting. */
  for (let i = 0; i < rulesToRender.length; i++) {
    let n = rulesToRender[i]!;
    let next = rulesToRender[i + 1];
    if (isNode(n, ['Ruleset', 'AtRule']) && n.isHoisted(options)) {
      /** @todo - close and open frames */
      n.toString({ ...options, depth: depth + 1 });
      /** @todo - Upon re-opening frames, clone the header without comments! */
      continue;
    }
    if (!inFrames.includes(node)) {
      /** Render all frame openings */
      normalizeIndent(idt, header);
      inFrames.push(node);
      frameHeaders.push(header);
      for (let i = 0; i < inFrames.length; i++) {
        let s = frameHeaders[i]!;
        w.add(s);
      }
    }
    if (isNode(n, 'Declaration')) {
      w.add(idt + '  ');
      n.processPrePost('pre');
      let out = w.capture(() => n.toTrimmedString({ ...options, depth: depth + 1 }));
      w.add(out);
      /** @todo - optionally add semi-colon for compression */
      // if (n.requiredSemi && next) {
      //   w.add(';');
      // }
      w.add(';\n');
      n.processPrePost('post');
    } else {
      n.toString({ ...options, depth: depth + 1 });
    }
  }
  if (inFrames.includes(node)) {
    inFrames.pop();
    frameHeaders.pop();
  }
  w.add(idt + '}');

  return w.getSince(mark);
}