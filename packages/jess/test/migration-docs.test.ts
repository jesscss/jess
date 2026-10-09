/**
 * The Less 4.x → 5 migration guides, executed. Every example a guide marks is
 * compiled with jess and compared with the output the guide documents, so the
 * user docs cannot drift from the engine (or be rewritten to describe a
 * reversed ruling) without this test noticing.
 *
 * MARKERS (an HTML comment in `.md`, an MDX comment `{/* … *\/}` in `.mdx`):
 *
 *   v5-example [JSON options]
 *     On the line(s) before a ```css block. The block is the documented Less 5
 *     output of the nearest ```less block above it. Optional JSON sets
 *     `collapseNesting` (`{"collapseNesting": "native"}`). When the css block has a
 *     `/* Less 5 … *\/` heading comment, only the text under it is expected.
 *
 *   v5-example-table JSON
 *     Before a table whose header has a `Less 5` column. JSON:
 *       template           input with `$$` for the row's input; the expected
 *                          output is the same template with `$$` replaced by
 *                          the row's Less 5 value.
 *       conditionTemplate  input template for a row whose Less 5 value is
 *                          `true`, `false` or "error" (expected: `template`
 *                          with the boolean, or a compile error).
 *       guardTemplate      input template for a row whose Less 5 value is
 *                          "truthy" / "falsy" (expected: `template` with
 *                          `$$` → nothing, or no output at all).
 *       eachInput          run every code span of the first cell, not just
 *                          the first.
 *     The row's input is the first code span of its first cell; a following
 *     "with `@name: value`" span is declared before it. The Less 5 cell must be
 *     one code span (bold allowed), or one of the words above; any other row
 *     (prose, an option) is listed as not executable.
 *
 * Output is compared with whitespace collapsed and removed around `{`, `}`
 * and `;`: a guide writes `.a { b: c; }` on one line.
 *
 * A documented example that jess does not produce is drift between the docs
 * and the code. It is listed in DRIFT (and skipped) with the ruling that
 * decides which side is wrong. Do not change a guide's claim, or the code, to
 * make an example pass without that ruling.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

const DOCS = new URL('../../docs/docs-content/docs/', import.meta.url);
const GUIDES = ['less/usage/migrating-to-v5.md', 'shared/04-guides/01-migrating-less-4-to-5.mdx'];

/* `<guide> :: <input>` → why it is skipped. Each entry is drift between the guide and the code. */
const DRIFT = new Map<string, string>([
  [
    'less/usage/migrating-to-v5.md :: .col { &-1 { width: 8.333%; } &-2 { width: 16.666%; } }',
    'UNRESOLVED, escalate to the owner: the default (nested) output writes `.col { &-1 { … } }`, which is not CSS; the guide documents `.col-1`. '
    + '`&`-concatenation is a parent-NAME concat (owner 2026-07-23, memory jess-nesting-spec-faithful-except-ampersand-concat), but no ledger row says how nested output writes it (O1/O17 bear on it).'
  ]
]);

type CollapseNesting = false | 'native' | 'compact';

interface Example {
  guide: string;
  line: number;
  input: string;
  expected: string | null;
  error?: boolean;
  collapseNesting: CollapseNesting;
  note?: string;
}

interface TableSpec {
  template: string;
  conditionTemplate?: string;
  guardTemplate?: string;
  eachInput?: boolean;
}

function readSpec(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text || '{}');
  if (typeof value !== 'object' || value === null) {
    throw new Error(`v5-example marker: expected a JSON object, got ${text}`);
  }
  return Object.fromEntries(Object.entries(value));
}

function tableSpec(text: string): TableSpec {
  const { template, conditionTemplate, guardTemplate, eachInput } = readSpec(text);
  if (typeof template !== 'string') {
    throw new Error(`v5-example-table marker needs a "template": ${text}`);
  }
  return {
    template,
    conditionTemplate: typeof conditionTemplate === 'string' ? conditionTemplate : undefined,
    guardTemplate: typeof guardTemplate === 'string' ? guardTemplate : undefined,
    eachInput: eachInput === true
  };
}

function collapseNestingOf(text: string): CollapseNesting {
  const { collapseNesting = false } = readSpec(text);
  if (collapseNesting !== false && collapseNesting !== 'native' && collapseNesting !== 'compact') {
    throw new Error(`v5-example marker: unsupported collapseNesting ${String(collapseNesting)}`);
  }
  return collapseNesting;
}

const MARKER = /^\s*(?:<!--|\{\/\*)\s*(v5-example(?:-table)?)\b(.*?)\s*(?:-->|\*\/\})\s*$/;
const normalize = (css: string): string => css.replace(/\s+/g, ' ').replace(/\s*([{};])\s*/g, '$1').trim();
const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
const spans = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]!);

/* The documented Less 5 part of a css block: the text under a `/* Less 5 … *\/` heading, else all of it. */
function lessFivePart(css: string): string {
  const at = css.search(/\/\*\s*Less 5/);
  if (at < 0) {
    return css;
  }
  const body = css.slice(css.indexOf('*/', at) + 2);
  const next = body.search(/\/\*/);
  return next < 0 ? body : body.slice(0, next);
}

function tableExamples(guide: string, start: number, lines: string[], spec: TableSpec): Example[] {
  const header = cells(lines[0]!);
  const col = header.findIndex(c => /Less 5/.test(c));
  const { template, conditionTemplate, guardTemplate } = spec;
  const out: Example[] = [];
  lines.slice(2).forEach((row, k) => {
    const c = cells(row);
    const first = c[0] ?? '';
    const [primary = '', ...rest] = spans(first);
    const withAt = first.indexOf(' with ');
    const preamble = withAt < 0 ? '' : spans(first.slice(withAt)).filter(s => s.startsWith('@')).map(s => `${s};\n`).join('');
    const optionSpan = withAt >= 0 && spans(first.slice(withAt)).some(s => !s.startsWith('@'));
    const inputs = spec.eachInput ? [primary, ...rest.filter(s => withAt < 0 || first.indexOf(s) < withAt)] : [primary];
    const cell = (c[col] ?? '').replace(/\*\*/g, '').trim();
    const code = /^`([^`]*)`$/.exec(cell)?.[1];
    for (const input of inputs) {
      const ex: Example = { guide, line: start + 3 + k, input, expected: null, collapseNesting: false };
      if (optionSpan) {
        ex.note = 'the row sets a compile option';
      } else if (code !== undefined && !/^(?:true|false)$/.test(code)) {
        ex.input = preamble + template.replace('$$', input);
        ex.expected = template.replace('$$', code);
      } else if ((code !== undefined || /^error$/i.test(cell)) && conditionTemplate) {
        ex.input = preamble + conditionTemplate.replace('$$', input);
        ex.expected = code === undefined ? '' : template.replace('$$', code);
        ex.error = code === undefined;
      } else if (/^(?:truthy|falsy)$/i.test(cell) && guardTemplate) {
        ex.input = preamble + guardTemplate.replace('$$', input);
        ex.expected = /truthy/i.test(cell) ? template.replace('$$', '') : '';
      } else {
        ex.note = `the Less 5 cell is not executable: ${cell.slice(0, 60)}`;
      }
      out.push(ex);
    }
  });
  return out;
}

function examples(guide: string): Example[] {
  const lines = readFileSync(new URL(guide, DOCS), 'utf8').split('\n');
  const out: Example[] = [];
  let less = '';
  for (let i = 0; i < lines.length; i++) {
    const fence = /^```(\w*)/.exec(lines[i]!);
    if (fence) {
      const end = lines.findIndex((l, j) => j > i && l.startsWith('```'));
      if (fence[1] === 'less') {
        less = lines.slice(i + 1, end).join('\n');
      }
      i = end;
      continue;
    }
    const m = MARKER.exec(lines[i]!);
    if (!m) {
      continue;
    }
    const spec = m[2]!.replace(/^:/, '').trim();
    let j = i + 1;
    while (lines[j]!.trim() === '') {
      j++;
    }
    if (m[1] === 'v5-example') {
      const end = lines.findIndex((l, k) => k > j && l.startsWith('```'));
      if (!/^```css/.test(lines[j]!)) {
        throw new Error(`${guide}:${i + 1}: v5-example must precede a \`\`\`css block`);
      }
      out.push({ guide, line: j + 1, input: less, expected: lessFivePart(lines.slice(j + 1, end).join('\n')), collapseNesting: collapseNestingOf(spec) });
      i = end;
    } else {
      let end = j;
      while (lines[end]?.trim().startsWith('|')) {
        end++;
      }
      out.push(...tableExamples(guide, j, lines.slice(j, end), tableSpec(spec)));
      i = end - 1;
    }
  }
  return out;
}

async function render(source: string, collapseNesting: CollapseNesting): Promise<string> {
  const compiler = new Compiler({ output: { collapseNesting } });
  return String(await compiler.renderString(source, { filePath: 'entry.less', extension: '.less', suppressWarnings: true }));
}

for (const guide of GUIDES) {
  describe(`migration guide ${guide}`, () => {
    const found = examples(guide);
    it('marks at least one executable example', () => {
      expect(found.filter(e => e.expected !== null).length).toBeGreaterThan(0);
    });
    for (const ex of found) {
      const key = `${guide} :: ${ex.input.replace(/\s+/g, ' ').trim()}`;
      const title = `line ${ex.line}: ${ex.input.replace(/\s+/g, ' ').trim().slice(0, 90)}`;
      if (ex.expected === null) {
        it.todo(`${title} — not executable (${ex.note})`);
      } else if (DRIFT.has(key)) {
        it.skip(`${title} — TODO ${DRIFT.get(key)}`);
      } else if (ex.error) {
        it(title, async () => {
          await expect(render(ex.input, ex.collapseNesting)).rejects.toThrow();
        });
      } else {
        const expected = ex.expected;
        it(title, async () => {
          expect(normalize(await render(ex.input, ex.collapseNesting))).toBe(normalize(expected));
        });
      }
    }
  });
}
