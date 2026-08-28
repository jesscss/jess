/*
 * The WRONG-NODE half of the over-narrow probe.
 *
 * `over-narrow-probe.test.ts` asks only "did this parse". That question has a
 * blind spot the survey hit immediately: the CSS grammar ACCEPTS `svg|circle`,
 * because `|` is in its combinator list
 * (`packages/syntax/css/css-parser/src/grammar.ts:998`), and so reports a clean
 * `parses: true` for a selector whose meaning it got wrong — a namespaced type
 * selector read as two type selectors joined by a combinator. An acceptance-only
 * instrument scores that as a pass.
 *
 * This file therefore prints the CST shape for the probes where acceptance alone
 * proves nothing. It is a reporting instrument, not a gate, for the same reason
 * as its sibling; the assertion it does carry is the control that it can tell
 * two different shapes apart at all.
 */
import { describe, expect, it } from 'vitest';
import { run } from 'parseman';
import { cssGrammar } from '../../packages/syntax/css/css-parser/src/grammar.js';
import { lessGrammar } from '../../packages/syntax/less/less-parser/src/grammar.js';

type Node = { type?: string; children?: readonly unknown[] };

function shape(node: unknown, depth: number): string {
  if (node === null || typeof node !== 'object') {
    return typeof node === 'string' ? JSON.stringify(node) : String(node);
  }
  const record = node as Node;
  const label = typeof record.type === 'string' ? record.type : '?';
  if (depth === 0) {
    return `${label}(…)`;
  }
  const children = Array.isArray(record.children) ? record.children : [];
  if (children.length === 0) {
    return label;
  }
  return `${label}(${children.map(child => shape(child, depth - 1)).join(' ')})`;
}

const CASES: readonly { readonly name: string; readonly source: string }[] = [
  { name: 'svg|circle — namespaced type selector', source: 'svg|circle { fill: red }' },
  { name: 'svg circle — descendant, for contrast', source: 'svg circle { fill: red }' },
  { name: 'svg>circle — child, for contrast', source: 'svg>circle { fill: red }' },
  { name: '*|a — universal namespace', source: '*|a { color: red }' },
  { name: 'svg|* — namespace, universal local', source: 'svg|* { fill: red }' },
  { name: '[a=b i] — attribute flag', source: '[a=b i] { color: red }' },
  { name: '[a=b] — attribute, no flag', source: '[a=b] { color: red }' }
];

describe('over-narrow node probe', () => {
  it('distinguishes two different selector shapes (control)', () => {
    const namespaced = run(cssGrammar.Stylesheet!, 'svg|circle{a:b}', { trivia: cssGrammar.whitespace });
    const descendant = run(cssGrammar.Stylesheet!, 'svg circle{a:b}', { trivia: cssGrammar.whitespace });
    expect(namespaced.ok).toBe(true);
    expect(descendant.ok).toBe(true);
    expect(JSON.stringify(namespaced.value)).not.toBe(JSON.stringify(descendant.value));
  });

  it('prints the shapes', () => {
    const lines: string[] = [];
    for (const { name, source } of CASES) {
      for (const [dialect, grammar] of [['css', cssGrammar], ['less', lessGrammar]] as const) {
        const result = run(grammar.Stylesheet!, source, { trivia: grammar.whitespace });
        lines.push(
          `${dialect.padEnd(5)} ${name}\n      ok=${result.ok} `
          + `unconsumedFrom=${String(result.unconsumedFrom)}\n      ${shape(result.value, 7)}`
          + `\n      ${JSON.stringify(result.value)?.slice(0, 900)}`
        );
      }
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(CASES.length * 2);
  });
});
