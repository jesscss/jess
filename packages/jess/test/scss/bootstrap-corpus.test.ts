/**
 * Bootstrap (Sass) corpus — parse + eval inventory.
 *
 * SCSS is an explicit NON-GOAL for feature completeness: it only has to prove
 * the eval MODEL/shape is right. So this file is a RATCHET, not a gate. Every
 * corpus file gets a reported outcome; the suite fails only if the measured
 * pass counts drop BELOW the recorded floors, or if a file recorded as passing
 * starts failing. Individual unimplemented-SCSS failures are recorded, never
 * thrown — a red build here would be noise, not signal.
 *
 * Two lanes, deliberately different in scope:
 *
 *   parse — every `.scss` under `bootstrap/scss/**`, through the SCSS plugin's
 *           `safeParse` (the product path). Parsing is context-free, so
 *           partials are meaningful standalone and all of them are in scope.
 *   eval  — the four self-contained Bootstrap entry points only, through
 *           `Compiler.safeRender` (import resolution + eval + serialize).
 *           Partials are NOT eval'd standalone: they reference variables and
 *           mixins from siblings, so a standalone failure would be a fixture
 *           artifact rather than a real model gap.
 *
 * The per-construct explanation of these failures lives in
 * `scss-construct-support.test.ts` — that matrix is the categorized inventory;
 * this file measures how far it reaches across a real-world codebase.
 *
 * `JESS_SCSS_CORPUS_REPORT=1` rewrites CORPUS-REPORT.json / CORPUS-REPORT.md
 * next to this file.
 */
import { describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';
import scssPlugin from '@jesscss/plugin-scss';

const req = createRequire(import.meta.url);
const bootstrapRoot = path.dirname(req.resolve('bootstrap/package.json'));
const scssRoot = path.join(bootstrapRoot, 'scss');
const bootstrapVersion: string = JSON.parse(
  readFileSync(path.join(bootstrapRoot, 'package.json'), 'utf8')
).version;

const rel = (p: string) => path.relative(scssRoot, p).split(path.sep).join('/');

/** Self-contained entry points — the only files that are meaningful to eval. */
const ENTRY_POINTS = [
  'bootstrap.scss',
  'bootstrap-grid.scss',
  'bootstrap-reboot.scss',
  'bootstrap-utilities.scss'
];

const PER_FILE_TIMEOUT_MS = 30_000;

/**
 * Blocking constructs, each validated in isolation by
 * `scss-construct-support.test.ts`. A file is attributed to every blocker it
 * contains — files usually hit several, so these counts overlap by design.
 */
const BLOCKERS: Array<[string, RegExp]> = [
  ['bare-truthy @if condition', /@(?:if|else if)\s+(?:not\s+)?[(]?(?:\$[\w-]+\s*[{)]|[a-z-]+\()/],
  ['interpolation as a standalone selector compound', /(?:^|[\s,>+~])#\{/m],
  ['interpolation inside a var() name', /var\(\s*--[^)]*#\{/],
  ['@include with a trailing content block', /@include[^;{]*\{\s*$/m],
  ['@content', /@content/],
  ['@warn / @error / @debug', /@(?:warn|error|debug)\b/],
  ['leading combinator (implicit &)', /^\s*[>+~]\s*\S/m],
  ['interpolated pseudo-element', /::?#\{/],
  ['plain custom property declaration', /^\s*--[a-zA-Z][\w-]*\s*:/m],
  ['multiline nested paren list', /\(\s*\n(?:[^()\n]*\n)*?\s*\(/],
  ['@while', /@while/],
  ['line comment inside a paren list', /\(\s*\n\s*\/\//]
];

type Outcome = 'pass' | 'fail';

interface LaneResult {
  file: string;
  outcome: Outcome;
  /** `line:col` of the point where the parser gave up. */
  at?: string;
  /** Source line at that point, trimmed. */
  source?: string;
  /** Every known blocking construct present in the file. */
  blockers?: string[];
  detail?: string;
  bytes?: number;
}

const firstLine = (e: unknown): string => {
  const message = typeof e === 'object' && e !== null && 'message' in e ? e.message : e;
  return String(message).split('\n')[0].trim();
};

const blockersIn = (src: string): string[] =>
  BLOCKERS.filter(([, re]) => re.test(src)).map(([name]) => name);

/** Turn the parser's byte offset into a `line:col` plus the offending line. */
const locate = (src: string, offset: number) => {
  const before = src.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = src.indexOf('\n', offset);
  return {
    at: `${before.split('\n').length}:${offset - lineStart}`,
    source: src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd).trim().slice(0, 120)
  };
};

const allFiles = glob.sync(path.join(scssRoot, '**/*.scss')).map(rel).sort();

const parseResults: LaneResult[] = [];
const evalResults: LaneResult[] = [];

const runParse = (file: string): LaneResult => {
  const full = path.join(scssRoot, file);
  const source = readFileSync(full, 'utf8');
  const result = scssPlugin().safeParse(full, source);
  if (result.errors.length === 0 && result.document) {
    return { file, outcome: 'pass' };
  }
  // The plugin diagnostic flattens the parser's position, so re-run the raw
  // parser purely to recover the offset for the report.
  let at: string | undefined;
  let sourceLine: string | undefined;
  try {
    parse(source);
  } catch (error) {
    if (
      typeof error === 'object' && error !== null
      && 'offset' in error && typeof error.offset === 'number'
    ) {
      ({ at, source: sourceLine } = locate(source, error.offset));
    }
  }
  return {
    file,
    outcome: 'fail',
    at,
    source: sourceLine,
    blockers: blockersIn(source),
    detail: result.errors.length > 0 ? firstLine(result.errors[0]) : 'no document returned'
  };
};

const runEval = async (file: string): Promise<LaneResult> => {
  const full = path.join(scssRoot, file);
  // collapseNesting mirrors dart-sass `expanded` output, which is the shape the
  // cross-engine benchmark comparison reads.
  const compiler = new Compiler({
    output: { collapseNesting: true },
    compile: { plugins: [scssPlugin()] }
  });
  try {
    const result = await compiler.safeRender(full, { suppressWarnings: true });
    if (result.errors.length > 0) {
      return { file, outcome: 'fail', detail: firstLine(result.errors[0]) };
    }
    if (result.css === null) {
      return { file, outcome: 'fail', detail: 'no css returned' };
    }
    return { file, outcome: 'pass', bytes: result.css.length };
  } catch (error) {
    return { file, outcome: 'fail', detail: firstLine(error) };
  } finally {
    compiler.dispose();
  }
};

describe(`Bootstrap ${bootstrapVersion} SCSS corpus`, () => {
  it('discovers the corpus', () => {
    expect(allFiles.length).toBeGreaterThan(50);
    for (const entry of ENTRY_POINTS) {
      expect(allFiles).toContain(entry);
    }
  });

  describe('parse', () => {
    allFiles.forEach((file) => {
      it(`parses ${file}`, () => {
        parseResults.push(runParse(file));
      });
    });
  });

  describe('eval', () => {
    ENTRY_POINTS.forEach((file) => {
      it(`evaluates ${file}`, async () => {
        evalResults.push(await runEval(file));
      }, PER_FILE_TIMEOUT_MS);
    });
  });
});

// ── ratchet ──────────────────────────────────────────────────────────────────

/**
 * Measured floors for Bootstrap 5.3.8. RAISE these as the SCSS model improves;
 * never lower them without an owner decision recorded in CORPUS-REPORT.md.
 */
const PARSE_PASS_FLOOR = 29;
const EVAL_PASS_FLOOR = 0;
/** Entry points known to evaluate end-to-end. Add each one as it graduates. */
const PASSING_EVAL_ENTRIES: string[] = [];

describe('Bootstrap SCSS corpus ratchet', () => {
  it('does not regress below the recorded parse/eval floors', () => {
    const parsePassed = parseResults.filter(r => r.outcome === 'pass');
    const evalPassed = evalResults.filter(r => r.outcome === 'pass');

    if (process.env.JESS_SCSS_CORPUS_REPORT) {
      writeReport(parseResults, evalResults);
    }

    expect(
      parsePassed.length,
      `parse regressed: ${parsePassed.length} of ${parseResults.length} parsed, floor is ${PARSE_PASS_FLOOR}`
    ).toBeGreaterThanOrEqual(PARSE_PASS_FLOOR);

    expect(
      evalPassed.length,
      `eval regressed: ${evalPassed.length} of ${evalResults.length} evaluated, floor is ${EVAL_PASS_FLOOR}`
    ).toBeGreaterThanOrEqual(EVAL_PASS_FLOOR);

    const evalPassedNames = new Set(evalPassed.map(r => r.file));
    for (const entry of PASSING_EVAL_ENTRIES) {
      expect(
        evalPassedNames.has(entry),
        `${entry} previously evaluated end-to-end and now fails`
      ).toBe(true);
    }
  });
});

// ── report ───────────────────────────────────────────────────────────────────

function writeReport(parseLane: LaneResult[], evalLane: LaneResult[]) {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const failed = parseLane.filter(r => r.outcome === 'fail');

  const counts = BLOCKERS.map(([name]) => ({
    name,
    files: failed.filter(r => r.blockers?.includes(name)).length
  })).sort((a, b) => b.files - a.files);

  const json = {
    generated: new Date().toISOString(),
    bootstrap: bootstrapVersion,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    parse: {
      total: parseLane.length,
      pass: parseLane.length - failed.length,
      blockerCounts: counts,
      results: parseLane
    },
    eval: {
      total: evalLane.length,
      pass: evalLane.filter(r => r.outcome === 'pass').length,
      results: evalLane
    }
  };
  writeFileSync(path.join(here, 'CORPUS-REPORT.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8');

  const l: string[] = [];
  l.push(`# Bootstrap ${bootstrapVersion} SCSS corpus report`, '');
  l.push('Generated by `bootstrap-corpus.test.ts` with `JESS_SCSS_CORPUS_REPORT=1`.', '');
  l.push('Reporting-only — outcomes measured, not gated. SCSS is a non-goal for feature');
  l.push('completeness; this inventory records where the eval model stands. The isolated');
  l.push('per-construct evidence is in `scss-construct-support.test.ts`.', '');
  l.push('## Run provenance', '');
  l.push(`- Generated: \`${json.generated}\``);
  l.push(`- Bootstrap: \`${bootstrapVersion}\``);
  l.push(`- Runner: \`${process.version}\` on \`${json.platform}\``, '');
  l.push('## Parse lane (all `bootstrap/scss/**/*.scss`)', '');
  l.push(`- files: **${json.parse.total}**, parsed: **${json.parse.pass}**, failed: **${failed.length}**`, '');
  l.push('Blocking constructs, by number of failing files that contain them. Files');
  l.push('usually hit several blockers, so these counts overlap by design.', '');
  l.push('| blocking construct | failing files |', '|---|--:|');
  counts.forEach(c => l.push(`| ${c.name} | ${c.files} |`));
  l.push('');
  l.push('### Parse failures', '');
  l.push('| file | gave up at | source | blockers |', '|---|---|---|---|');
  failed.forEach(r => l.push(
    `| \`${r.file}\` | ${r.at ?? '—'} | \`${(r.source ?? '').replace(/\|/g, '\\|')}\` | ${(r.blockers ?? []).join('; ') || '—'} |`
  ));
  l.push('');
  l.push('## Eval lane (self-contained entry points)', '');
  l.push(`- entries: **${json.eval.total}**, evaluated: **${json.eval.pass}**, failed: **${json.eval.total - json.eval.pass}**`, '');
  l.push('| entry | outcome | detail |', '|---|---|---|');
  evalLane.forEach(r => l.push(
    `| \`${r.file}\` | ${r.outcome} | ${r.detail ?? (r.bytes ? `${r.bytes}B css` : '—')} |`
  ));
  l.push('');
  writeFileSync(path.join(here, 'CORPUS-REPORT.md'), l.join('\n'), 'utf8');
}
