import { Node } from '../node.js';
import { indent } from './serialize-helper.js';
import { OutputWriter, type FinalPrintOptions } from './print.js';

export function isProgressiveCoreBlockChild(rule: Node): boolean {
  return rule.type === 'Ruleset' || rule.type === 'AtRule';
}

export function writeIndentedCoreBlockChild(rule: Node, options: FinalPrintOptions): void {
  const childIndent = indent(options.depth);
  const blockWriter = new OutputWriter(options.compress);
  rule.writeSyntax({
    ...options,
    writer: blockWriter,
    depth: 0
  });
  const block = normalizeDetachedBlockIndent(blockWriter.toString());
  if (!block) {
    return;
  }
  options.writer.add(childIndent, rule);
  options.writer.add(block.replace(/\n(?=.)/gu, `\n${childIndent}`), rule);
  if (!options.writer.endsWith('\n')) {
    options.writer.add('\n');
  }
}

function normalizeDetachedBlockIndent(block: string): string {
  const lines = block.split('\n');
  let minIndent: number | undefined;
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const length = line.match(/^[ \t]*/u)?.[0].length ?? 0;
    minIndent = minIndent === undefined ? length : Math.min(minIndent, length);
  }
  if (!minIndent) {
    return block;
  }
  return lines.map(line => line.trim() === '' ? line : line.slice(minIndent)).join('\n');
}
