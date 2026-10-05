import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import { createTriviaMapFromParseman } from '@jesscss/core/ast';
import type { TriviaMap } from '@jesscss/core';
import { parseCst } from '../src/cst-host.js';

/**
 * Shared driver for each dialect's `interpreter-parity.test.ts`.
 *
 * Every parser package ships each grammar variant twice from one `.ts` source:
 * `lib/grammar/<variant>.js`, lowered to a table by the parseman macro, and
 * `lib/grammar/interpreter/<variant>.js`, the same combinator graph run by
 * parseman's interpreter. The two engines must agree on every input, so these
 * helpers parse one corpus through both and compare the whole result.
 *
 * The bundles are read from the package's BUILT `lib/`: the test is about the
 * shipped artifacts, and a source import would be macro-compiled by vitest's
 * own parseman plugin.
 */

const REPO = fileURLToPath(new URL('../../../../..', import.meta.url));

export const AST_VARIANTS = ['ast', 'ast/positions'] as const;
export const CST_VARIANTS = ['cst', 'cst/positions'] as const;

export type Variant = (typeof AST_VARIANTS)[number] | (typeof CST_VARIANTS)[number];

/** Every file under `dir` (repo-relative) ending in `extension`, sorted. */
export function fixtureFiles(dir: string, extension: string): string[] {
  const root = join(REPO, dir);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith(extension) && !name.split(/[\\/]/).includes('node_modules'))
    .map(name => join(root, name))
    .sort();
}

/** Valid CSS is valid in every dialect, so every package parses the CSS fixtures too. */
export const CSS_FIXTURES = fixtureFiles('packages/syntax/css/css-parser/test/css', '.css');

function fixtureId(file: string): string {
  return relative(REPO, file).split('\\').join('/');
}

function readFixture(file: string): string {
  return readFileSync(file, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The grammar a variant module exports: the one binding named `*Grammar`. */
function grammarOf(module: unknown, file: string): Record<string, unknown> {
  expect(isRecord(module), file).toBe(true);
  const names = isRecord(module) ? Object.keys(module).filter(name => name.endsWith('Grammar')) : [];
  expect(names, `${file} must export exactly one *Grammar`).toHaveLength(1);
  const grammar = isRecord(module) ? module[names[0]!] : undefined;
  if (!isRecord(grammar)) {
    throw new TypeError(`${file}: ${names[0]} is not a grammar record`);
  }
  return grammar;
}

/**
 * Proves the interpreter twin was not macro-compiled, then loads both.
 *
 * A macro artifact imports the `parseman/table` runtime and no combinators
 * (their names still appear inside its `composedPieces` provenance strings,
 * which is why this reads the import statements rather than counting calls).
 * The interpreter twin imports `choice`/`sequence` from `parseman` itself and
 * never touches the table runtime.
 */
export async function loadEnginePair(
  libDir: string,
  variant: Variant
): Promise<Record<Engine, Record<string, unknown>>> {
  const compiledFile = join(libDir, 'grammar', `${variant}.js`);
  const interpreterFile = join(libDir, 'grammar', 'interpreter', `${variant}.js`);
  const compiledCode = readFileSync(compiledFile, 'utf8');
  const interpreterCode = readFileSync(interpreterFile, 'utf8');

  expect(compiledCode).toMatch(/^import \{[^}]*\btableRules\b[^}]*\} from "parseman\/table";$/m);
  expect(interpreterCode).not.toContain('parseman/table');
  expect(interpreterCode).not.toMatch(/type:\s*"macro"/);
  const combinators = /^import \{([^}]*)\} from "parseman";$/m.exec(interpreterCode)?.[1] ?? '';
  expect(combinators).toMatch(/\bchoice\b/);
  expect(combinators).toMatch(/\bsequence\b/);

  return {
    compiled: grammarOf(await import(compiledFile), compiledFile),
    interpreter: grammarOf(await import(interpreterFile), interpreterFile)
  };
}

export const ENGINES = ['compiled', 'interpreter'] as const;

const VARIANTS: readonly Variant[] = [...AST_VARIANTS, ...CST_VARIANTS];
const CST_HOST = pathToFileURL(fileURLToPath(new URL('../lib/cst-host.js', import.meta.url))).href;

/**
 * Loads `engine`'s four grammar variants in a fresh Node and parses `source`
 * with each, counting every call to `Function` and `eval` from before parseman
 * loads. The child also runs with `--disallow-code-generation-from-strings`,
 * Node's form of a Content-Security-Policy without `'unsafe-eval'`. Counting
 * matters as well as the flag: a path that tries `new Function`, catches the
 * `EvalError` and falls back still parses, but a browser reports the attempt as
 * a policy violation.
 */
function runtimeCodegen(libDir: string, engine: Engine, source: string): { calls: number; parsed: Record<string, unknown> } {
  const dir = engine === 'compiled' ? 'grammar' : join('grammar', 'interpreter');
  const grammars = VARIANTS.map(variant => [variant, pathToFileURL(join(libDir, dir, `${variant}.js`)).href]);
  const script = `let calls = 0;
const RealFunction = globalThis.Function;
globalThis.Function = new Proxy(RealFunction, {
  construct(target, args, newTarget) { calls++; return Reflect.construct(target, args, newTarget); },
  apply(target, self, args) { calls++; return Reflect.apply(target, self, args); }
});
const realEval = globalThis.eval;
globalThis.eval = code => { calls++; return realEval(code); };
const { run } = await import('parseman');
const { parseCst } = await import(${JSON.stringify(CST_HOST)});
const source = ${JSON.stringify(source)};
const parsed = {};
for (const [variant, url] of ${JSON.stringify(grammars)}) {
  try {
    const module = await import(url);
    const grammar = module[Object.keys(module).find(name => name.endsWith('Grammar'))];
    parsed[variant] = variant.startsWith('cst') ? parseCst(grammar, source, 'Stylesheet', {}, []).ok : run(grammar.Stylesheet, source).ok;
  } catch (error) {
    parsed[variant] = error.name + ': ' + error.message;
  }
}
process.stdout.write(JSON.stringify({ calls, parsed }));`;
  const child = spawnSync(
    process.execPath,
    ['--disallow-code-generation-from-strings', '--input-type=module', '-e', script],
    { cwd: dirname(libDir), encoding: 'utf8' }
  );
  expect(child.stderr, 'child stderr').toBe('');
  return JSON.parse(child.stdout) as { calls: number; parsed: Record<string, unknown> };
}

/*
 * PINNED DEFECT, interpreter engine of the composed dialects (Less, SCSS, Jess):
 * parseman 0.51's runtime `compose()` rebuilds every composed piece from
 * serialized source with `eval`/`new Function` (jess#325), so their interpreter
 * grammars throw `EvalError` where code generation is disallowed. CSS composes
 * nothing at runtime, and the compiled grammars — what Node and browser bundles
 * load — are clean. Remove with the parseman release whose `compose()` links.
 */
export const COMPOSED_CODEGEN_PINS: ReadonlyMap<Engine, string> = new Map([
  ['interpreter', 'runtime compose() evaluates serialized source (jess#325)']
]);

/**
 * Every variant of `engine` loads and parses `source` without turning a string
 * into code, so a page whose policy omits `'unsafe-eval'` can use it. A PINNED
 * engine asserts the current, wrong behaviour instead, and fails once it is fixed.
 */
export function assertNoRuntimeCodegen(libDir: string, engine: Engine, source: string, pinned?: string): void {
  const { calls, parsed } = runtimeCodegen(libDir, engine, source);
  const clean = calls === 0 && VARIANTS.every(variant => parsed[variant] === true);
  if (pinned !== undefined) {
    expect(clean, `${engine}: PINNED (${pinned}) no longer generates code — remove the pin`).toBe(false);
    return;
  }
  expect(parsed).toEqual(Object.fromEntries(VARIANTS.map(variant => [variant, true])));
  expect(calls, `${engine}: Function/eval calls`).toBe(0);
}

function isTriviaMap(value: Record<string, unknown>): value is Record<string, unknown> & TriviaMap {
  return typeof value.entries === 'function' && typeof value.commentRuns === 'function';
}

function triviaRuns(trivia: TriviaMap, direction: 'before' | 'after'): unknown[] {
  return [...trivia.entries(direction)].map(([offset, run]) => [offset, run.start, run.end, run.hasComment]);
}

/**
 * A parse result as plain data both engines can be compared on.
 *
 * - A trivia map is closures over its runs, so it is read out through its
 *   public `entries()` rather than compared as functions.
 * - Any other function is a per-parse closure with no comparable identity.
 * - The CST aliases `children` to `rules` on every node; walking both would
 *   visit each subtree twice per level, and `rules` already carries it.
 * - A class instance keeps its constructor name, so a node that changes class
 *   still differs.
 */
function project(value: unknown): unknown {
  if (typeof value === 'function') {
    return '<function>';
  }
  if (Array.isArray(value)) {
    return value.map(project);
  }
  if (value instanceof Map) {
    return { $map: [...value].map(([key, item]) => [project(key), project(item)]) };
  }
  if (!isRecord(value)) {
    return value;
  }
  if (isTriviaMap(value)) {
    return { $trivia: { before: triviaRuns(value, 'before'), after: triviaRuns(value, 'after') } };
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const out: Record<string, unknown> = {};
  if (prototype !== Object.prototype && prototype !== null) {
    out.$class = value.constructor.name;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'children' && child === value.rules) {
      continue;
    }
    out[key] = project(child);
  }
  return out;
}

/**
 * What a parse produced, success or failure, projected for `toStrictEqual`:
 * a thrown parse error is reduced to the facts an author sees.
 */
export function outcome(parse: () => unknown): unknown {
  try {
    return { ok: true, value: project(parse()) };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return {
      ok: false,
      name: error.name,
      message: error.message,
      offset: 'offset' in error ? error.offset : undefined
    };
  }
}

export type Engine = 'compiled' | 'interpreter';

/** Known engine divergences for one variant: fixture id (repo-relative) -> reason. */
export type Pins = ReadonlyMap<string, string>;

/**
 * Parse every file with both engines and require identical outcomes.
 *
 * A PINNED fixture asserts the current, wrong behaviour: it must STILL
 * diverge, so the pin fails — and has to be removed — the moment the engines
 * converge. Every divergence is a defect in one engine; a pin is a record of
 * it, not an acceptance.
 */
export function assertEnginesAgree(
  files: readonly string[],
  parse: (engine: Engine, source: string) => unknown,
  pinned: Pins = new Map()
): void {
  const ids = new Set(files.map(fixtureId));
  for (const id of pinned.keys()) {
    expect(ids.has(id), `pinned fixture ${id} is not in the corpus`).toBe(true);
  }
  for (const file of files) {
    const id = fixtureId(file);
    const source = readFixture(file);
    const compiled = parse('compiled', source);
    const interpreter = parse('interpreter', source);
    if (pinned.has(id)) {
      expect.soft(interpreter, `${id}: PINNED divergence is gone — remove the pin`).not.toStrictEqual(compiled);
    } else {
      expect.soft(interpreter, id).toStrictEqual(compiled);
    }
  }
}

/** A CST parse; its root trivia index is read out the way the AST path reads it. */
export function cstOutcome(
  grammar: Record<string, unknown>,
  source: string,
  select: readonly string[]
): unknown {
  return outcome(() => {
    const result = parseCst(grammar, source, 'Stylesheet', {}, select);
    return { ...result, rootTrivia: createTriviaMapFromParseman(source, result.rootTrivia?.index) };
  });
}
