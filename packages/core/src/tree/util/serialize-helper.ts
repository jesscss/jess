import type { AtRule } from '../at-rule.js';
import type { Ruleset } from '../ruleset.js';
import type { FinalPrintOptions } from './print.js';
import { isNode } from './is-node.js';
import { Nil } from '../nil.js';

/**
 * Normalizes the indent of a multi-line string by replacing initial whitespace.
 */
export function normalizeIndent(multiLineString: string, indent: string, maintainRelative?: boolean): string {
  if (!maintainRelative) {
    return multiLineString.replace(/^\s*/, indent).replace(/[ \t\r\f]*\n\s*/g, '\n' + indent);
  }

  // Find the first line's original indent length
  const firstLineMatch = multiLineString.match(/^(?:\n*|[ \t\r\f]*\n+)(\s*)/);
  const firstLineOriginalIndentLength = firstLineMatch ? firstLineMatch[1]!.length : 0;

  // Use replace with callback to process each line in one pass
  let isFirstLine = true;
  return multiLineString.replace(/(?:^|\n)(\s*)([^\n]*)/g, (match, lineIndent, lineContent) => {
    if (isFirstLine) {
      isFirstLine = false;
      return indent + lineContent.trimEnd();
    }

    const lineOriginalIndentLength = lineIndent.length;
    // Calculate the difference from the first line's indent
    const indentDifference = lineOriginalIndentLength - firstLineOriginalIndentLength;
    // Apply the difference to the new indent to maintain relative spacing
    const newLineIndent = indent + ' '.repeat(Math.max(0, indentDifference));
    return '\n' + newLineIndent + lineContent.trimEnd();
  });
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
      n.toTrimmedString(options);
      continue;
    }

    let matches = -1;
    /** Close current frames if needed */
    for (let i = 0; i < lastRenderedFrames.length; i++) {
      if (inFrames[i]?.valueOf() !== lastRenderedFrames[i]?.valueOf()) {
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
    let idt = indent(options.depth + 1);

    let pre = w.capture(() => n.processPrePost('pre', undefined, options));
    /** normalize pre spacing */
    let out = w.capture(() => n.toTrimmedString({ ...options, depth: options.depth + 1 }));
    if (isNode(n, 'Declaration')) {
      pre = pre.replace(/^[\s\S]*\n([ \t]*)$/g, '$1');
      if (n.value.name.valueOf().startsWith('--')) {
        w.add(idt);
        w.add(out, n);
      } else {
        w.add(normalizeIndent(pre + out, idt, true), n);
      }
    } else {
      w.add(idt);
      w.add(out, n);
    }
    /** @todo - optionally add semi-colon for compression */
    // if (n.requiredSemi && next) {
    //   w.add(';');
    // }
    if (n.requiredSemi) {
      w.add(';');
    }
    w.add('\n');
    let post = w.capture(() => n.processPrePost('post', undefined, options));

    if (!/^\s*$/.test(post)) {
      w.add(normalizeIndent(post, idt));
    }
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
    options.depth--;
    lastRenderedFrames.pop();
  }

  return w.getSince(mark);
}