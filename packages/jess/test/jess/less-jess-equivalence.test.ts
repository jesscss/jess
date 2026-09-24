/**
 * Cross-dialect equivalence harness — `docs/design/JESS-EQUIVALENCE-HARNESS.md`.
 *
 *   .less → .css   ==   .less → .jess → .css
 *
 * Both arms run on jess's own engine with ONE explicit configuration, so the gate
 * is byte identity:
 *
 *   arm A    `Compiler.safeRender(file.less)`                         → cssA
 *   convert  `Compiler.safeCompile(file.less)` (the product parse) → `emitJess` → write `file.jess`
 *   arm B    `Compiler.safeRender(file.jess)`                         → cssB
 *   gate     cssB === cssA
 *
 * The emitter prints the PARSED tree — nothing is evaluated — so a variable stays
 * a variable and a mixin stays a mixin; the round trip cannot pass by flattening.
 * The corpus is copied to a temp directory and EVERY `.less` file in it is
 * converted, so an `@import` resolves to its converted sibling. Both arms read the
 * copy, so they see the same files.
 *
 * Every non-passing fixture is listed in {@link KNOWN} with a cause and a reason:
 *
 *   p35            the Less AST carries bare math (an `Operation` or a `/` atom
 *                  outside an `Expression`), which `.jess` computes only inside
 *                  `$( … )`. Ledger P35 lowers Less math into `Expression`; these
 *                  entries are expected to flip when it lands.
 *   cannot-express `.jess` has no spelling for a construct the file uses (the
 *                  emitter threw `NoJessSpelling`, or `.jess` evaluates the
 *                  printed construct differently).
 *   lost-info      the conversion dropped a fact the Less arm used.
 *
 * RATCHET (the `bootstrap-corpus.test.ts` convention): an unlisted fixture must
 * pass, a listed fixture must fail with exactly its recorded outcome, and a listed
 * fixture that starts passing fails the gate until its entry is removed.
 * `JESS_EQUIVALENCE_REPORT=<file>` writes every observed outcome as JSON.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as glob from 'glob';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { emitJess, NoJessSpelling } from '@jesscss/core';
import { importTargetSpelling } from '@jesscss/core/ast';
import { parse as parseJess } from '@jesscss/jess-parser';
import { parse as parseLess } from '@jesscss/less-parser';
import * as lessFunctionModule from '@jesscss/fns/less';
import { lessFns } from '@jesscss/fns/less/registry';
import jessPlugin from '@jesscss/plugin-jess';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { getExpectedOutputFiles } from '../../src/config.js';
import { Compiler, type ConfigOptions } from '../../src/index.js';
import {
  getTestCases,
  lessFixturePackagesPlugin,
  lessHarnessFunctionsPlugin,
  resolveLessTestDataRoot
} from '../test-utils.js';

type Mode = 'flat' | 'nested';
const MODES: readonly Mode[] = ['flat', 'nested'];

/**
 * What one fixture did in one `collapseNesting` mode.
 *   `p35` / `cannot-express` — the emitter threw `NoJessSpelling` (P35 when every gap is bare math)
 *   `arm-a-error`  — the Less arm itself does not render, so there is nothing to compare
 *   `arm-b-parse`  — the emitted `.jess` does not parse (an emitter defect)
 *   `arm-b-error`  — the `.jess` arm renders with errors
 *   `css-mismatch` — both render; the bytes differ
 */
type Outcome = 'pass' | 'p35' | 'cannot-express' | 'arm-a-error' | 'arm-b-parse' | 'arm-b-error' | 'css-mismatch';
type Cause = 'p35' | 'cannot-express' | 'lost-info' | 'no-arm-a';

interface Known {
  readonly cause: Cause;
  readonly reason: string;

  /** The observed outcome in both modes, or per mode where they differ. */
  readonly outcome: Outcome | Readonly<Record<Mode, Outcome>>;
}

const ALL_EXTEND_KINDS = ['class', 'simple', 'basic', 'pseudo', 'complex', 'compound', 'placeholder'] as const;

/**
 * The options whose DIALECT defaults differ between `.less` and `.jess`, pinned
 * to the Less values for both arms so neither falls back to its own dialect's
 * defaults.
 */
const PINNED_COMPILE = {
  mathMode: 'parens-division',
  unitMode: 'preserve',
  allowLeakyScope: true,
  allowCallerScope: false,
  processImports: true,
  allowExtendSelectors: [...ALL_EXTEND_KINDS]
} as const;

const P35 = 'P35 not landed';
const TIMEOUT_MS = 30_000;

/* ------------------------------------------------------------------ corpora */

interface Fixture {
  readonly corpus: string;

  /** Corpus-relative path of the `.less` entry. */
  readonly file: string;
  readonly config: ConfigOptions;
}

interface Corpus {
  readonly name: string;
  readonly source: string;
  copy: string;

  /** Directory (relative to the copy) whose `.less` files are converted. */
  readonly convertRoot: string;

  /**
   * Where the copy sits under the temp root, and the packages a bare import in
   * the corpus names, each mapped to a directory under the temp root. The copy
   * gets its OWN `node_modules` with exactly these links, so package resolution
   * never walks up into whatever `node_modules` the machine happens to have —
   * that walk found `@less/test-data` locally and a dangling link in CI.
   */
  readonly layout: string;
  readonly packages: ReadonlyArray<readonly [name: string, dir: string]>;
  readonly fixtures: readonly Fixture[];
  readonly plugins: (copy: string) => unknown[];
}

const testData = resolveLessTestDataRoot();
const requireFrom = createRequire(import.meta.url);
const bootstrapRoot = path.dirname(requireFrom.resolve('bootstrap-less-port/package.json'));

/** The fixture set `all-less.test.ts` discovers: every `.less` with a golden. */
const allLessFixtures = (): Fixture[] => {
  const files = [
    ...glob.sync(path.join(testData, 'tests-{unit,config}/*/*.less')),
    ...glob.sync(path.join(testData, 'tests-{unit,config}/*/*/*.less'))
  ].sort();
  const fixtures: Fixture[] = [];
  for (const full of files) {
    let config: ConfigOptions;
    try {
      config = getTestCases(full)[0]!.config as ConfigOptions;
    } catch {
      continue;
    }
    fixtures.push({ corpus: 'all-less', file: path.relative(testData, full), config });
  }
  return fixtures;
};

const CORPORA: Corpus[] = [
  {
    name: 'all-less',
    source: testData,
    copy: '',
    convertRoot: '.',

    /*
     * The upstream checkout layout: the Less plugin maps `@less/test-import-module`
     * to the `packages/` sibling of `packages/test-data`, and remote jsDelivr
     * imports name `@less/test-data` itself.
     */
    layout: 'packages/test-data',
    packages: [['@less/test-data', 'packages/test-data'], ['@less/test-import-module', 'packages/test-import-module']],
    fixtures: allLessFixtures(),
    plugins: () => [
      lessPlugin({ plugins: [lessHarnessFunctionsPlugin] }),
      lessCompatPlugin(),
      lessFixturePackagesPlugin(),
      jessPlugin()
    ]
  },
  {
    name: 'bootstrap-less-port@2.5.1',
    source: bootstrapRoot,
    copy: '',
    convertRoot: 'less',
    layout: 'bootstrap-less-port',
    packages: [],
    fixtures: ['bootstrap.less', 'bootstrap-grid.less', 'bootstrap-reboot.less']
      .map(file => ({ corpus: 'bootstrap-less-port@2.5.1', file: `less/${file}`, config: {} })),
    plugins: copy => [
      lessPlugin(),
      jsPlugin({ jsReadRoot: path.join(copy, 'less'), runtimeApi: 'less' }),
      lessCompatPlugin(),
      jessPlugin()
    ]
  }
];

/* --------------------------------------------------------------- execution */

/** A tree without its source positions and serializer memos (`_`-prefixed). */
const shape = (tree: object): string =>
  JSON.stringify(tree, (key, value: unknown) => (key.startsWith('_') ? undefined : value));

/** The one explicit configuration both arms of a fixture render with. */
function configFor(corpus: Corpus, fixture: Fixture, mode: Mode | null): ConfigOptions {
  const { compile = {}, language = {}, output, ...rest } = fixture.config;
  const { plugins: fixturePlugins = [], ...fixtureCompile } = compile;
  const lessOptions = { bubbleRootAtRules: true, ...(language.less ?? {}) };
  const fixtureOutput = Array.isArray(output) ? {} : (output ?? {});
  return {
    ...rest,
    compile: {
      ...PINNED_COMPILE,
      ...fixtureCompile,
      jsReadRoot: corpus.copy,
      plugins: [...corpus.plugins(corpus.copy), ...fixturePlugins]
    },

    // Language options apply per dialect, so the SAME object goes to both.
    language: { ...language, less: lessOptions, jess: lessOptions },
    output: mode === null ? fixtureOutput : { ...fixtureOutput, collapseNesting: mode === 'flat' }
  } as ConfigOptions;
}

/**
 * `.jess` imports name the file they load. The converter wrote `foo.jess` next to
 * every `foo.less`, so a Less import of `foo` or `foo.less` becomes `foo.jess`.
 */
const importPath = (spelling: string): string => {
  const ext = path.extname(spelling);
  return ext === '' ? `${spelling}.jess` : ext === '.less' ? `${spelling.slice(0, -5)}.jess` : spelling;
};

/**
 * The Less built-ins, as `.jess` reaches them: the trusted `#less` module
 * (ledger C13), imported per file with `@-from … import (…)` — the named-binding
 * projection `DIALECT-TO-JESS-COMPILED-CONVERSION.md` records. Derived from the
 * Less registry itself: call name → the module's export name.
 */
const LESS_FUNCTIONS = {
  from: '#less',
  names: new Map(Object.entries(lessFunctionModule).flatMap(([exported, fn]) =>
    (lessFns as readonly unknown[]).includes(fn) && typeof fn === 'function' ? [[fn.name.toLowerCase(), exported] as const] : []))
};

/**
 * Per converted file: its `NoJessSpelling` gaps (`null` when it converted) and
 * the corpus files its top-level imports load, so a fixture is charged with the
 * gaps of every partial it pulls in.
 */
type Conversion =
  | { readonly gaps: readonly string[] | null; readonly imports: readonly string[]; readonly reprint?: string }
  | { readonly parseError: string };

async function convertCorpus(corpus: Corpus): Promise<Map<string, Conversion>> {
  const results = new Map<string, Conversion>();
  const byFile = new Map(corpus.fixtures.map(f => [f.file, f]));
  const files = glob.sync('**/*.less', { cwd: path.join(corpus.copy, corpus.convertRoot), ignore: ['**/node_modules/**'] })
    .map(f => path.join(corpus.convertRoot, f))
    .sort();
  for (const file of files) {
    const full = path.join(corpus.copy, file);

    // A partial parses with its directory's configuration, exactly as when imported.
    const fixture = byFile.get(file) ?? {
      corpus: corpus.name,
      file,
      config: (() => {
        try {
          const found = getExpectedOutputFiles(full);
          return (Array.isArray(found) ? found[0]!.config : found.config) as ConfigOptions;
        } catch {
          return {};
        }
      })()
    };
    const compiler = new Compiler(configFor(corpus, fixture, null));
    try {
      const { document, errors } = await compiler.safeCompile(full, { suppressWarnings: true });
      if (document === null || errors.length > 0) {
        results.set(file, { parseError: errors[0]?.message ?? 'no document' });
        continue;
      }
      const imports = document.rules.flatMap((rule) => {
        if (rule.type !== 'StyleImport') {
          return [];
        }
        const spelling = importTargetSpelling(rule.target);
        const target = path.resolve(path.dirname(full), path.extname(spelling) === '' ? `${spelling}.less` : spelling);
        return fs.existsSync(target) ? [path.relative(corpus.copy, target)] : [];
      });
      try {
        const jess = emitJess(document, { importPath, functions: LESS_FUNCTIONS });
        fs.writeFileSync(full.replace(/\.less$/u, '.jess'), jess);

        /*
         * The print must be a fixed point of parse-then-print: the `.jess` tree it
         * parses to prints back to text that parses to the SAME tree. A spelling
         * the grammar reads as a different node fails here even where the CSS
         * happens to agree. (Trees, not text: comments are trivia, and a `.jess`
         * statement without a source span cannot anchor one in the same place.)
         */
        let reprint: string | undefined;
        try {
          const tree = parseJess(jess, { allowExtendSelectors: [...ALL_EXTEND_KINDS] });

          // A `.jess` tree already carries its `@-from` imports; only the Less source needs them added.
          const again = parseJess(emitJess(tree), { allowExtendSelectors: [...ALL_EXTEND_KINDS] });
          reprint = shape(again) === shape(tree) ? undefined : 'tree changed';
        } catch (error) {
          reprint = String(error);
        }
        results.set(file, { gaps: null, imports, ...(reprint === undefined ? {} : { reprint }) });
      } catch (error) {
        if (!(error instanceof NoJessSpelling)) {
          throw error;
        }
        results.set(file, { gaps: [...new Set(error.gaps.map(g => `${g.nodeType}: ${g.reason}`))], imports });
      }
    } finally {
      compiler.dispose();
    }
  }
  return results;
}

interface Observation {
  readonly outcome: Outcome;
  readonly detail?: string;
}

type Diagnostics = Awaited<ReturnType<Compiler['safeRender']>>['errors'];

const firstError = (errors: Diagnostics): string =>
  errors.length === 0 ? '' : `${errors[0]!.code}: ${String(errors[0]!.message).split('\n')[0]}`;

/** A file's own gaps plus those of every partial it imports, transitively. */
function gapsOf(file: string, conversions: ReadonlyMap<string, Conversion>, seen = new Set<string>()): string[] {
  const conversion = conversions.get(file);
  if (conversion === undefined || 'parseError' in conversion || seen.has(file)) {
    return [];
  }
  seen.add(file);
  return [
    ...(conversion.gaps ?? []).map(g => (seen.size === 1 ? g : `${g} [in ${file}]`)),
    ...conversion.imports.flatMap(dep => gapsOf(dep, conversions, seen))
  ];
}

async function observe(corpus: Corpus, fixture: Fixture, mode: Mode, conversions: ReadonlyMap<string, Conversion>): Promise<Observation> {
  const conversion = conversions.get(fixture.file);
  const full = path.join(corpus.copy, fixture.file);
  const compiler = new Compiler(configFor(corpus, fixture, mode));
  try {
    const a = await compiler.safeRender(full, { suppressWarnings: true });
    if (a.css === null || a.errors.length > 0) {
      return { outcome: 'arm-a-error', detail: firstError(a.errors) };
    }
    if (conversion === undefined || 'parseError' in conversion) {
      return { outcome: 'arm-a-error', detail: conversion?.parseError ?? 'not converted' };
    }
    const gaps = gapsOf(fixture.file, conversions);
    if (gaps.length > 0) {
      const p35 = gaps.every(g => g.includes(P35));
      return { outcome: p35 ? 'p35' : 'cannot-express', detail: [...new Set(gaps)].join(' | ') };
    }
    const b = await compiler.safeRender(full.replace(/\.less$/u, '.jess'), { suppressWarnings: true });
    if (b.css === null || b.errors.length > 0) {
      const detail = firstError(b.errors);
      return { outcome: detail.startsWith('parse/') ? 'arm-b-parse' : 'arm-b-error', detail };
    }
    if (b.css === a.css) {
      return { outcome: 'pass' };
    }
    const la = a.css.split('\n');
    const lb = b.css.split('\n');
    const at = la.findIndex((line, i) => line !== lb[i]);
    return { outcome: 'css-mismatch', detail: `line ${at + 1}: ${JSON.stringify(la[at])} vs ${JSON.stringify(lb[at])}` };
  } finally {
    compiler.dispose();
  }
}

/* ------------------------------------------------------------------ ratchet */

/**
 * Every fixture that does not pass, with its cause. Keyed `<corpus>:<file>`.
 * Hand-edited on purpose: closing a gap is removing its line.
 */
const KNOWN = new Map<string, Known>([
  ['all-less:tests-config/3rd-party/bootstrap4.less', {
    cause: 'lost-info',
    outcome: 'arm-b-error',
    reason: 'a bare package import (`bootstrap-less-port/less/bootstrap`) became file-relative (`./…`, the migration guide\'s rewrite); the converter does not observe that Less resolved it as a package'
  }],
  ['all-less:tests-config/at-rules-compressed-evaluation/at-rules-compressed-evaluation.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only (+1 more)'
  }],
  ['all-less:tests-config/compression/compression.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only'
  }],
  ['all-less:tests-config/debug/all/linenumbers-all.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Ruleset: `when` guard on a ruleset: the `.jess` `Ruleset` rule takes no guard [in tests-config/debug/linenumbers.less]'
  }],
  ['all-less:tests-config/debug/comments/linenumbers-comments.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Ruleset: `when` guard on a ruleset: the `.jess` `Ruleset` rule takes no guard [in tests-config/debug/linenumbers.less]'
  }],
  ['all-less:tests-config/debug/mediaquery/linenumbers-mediaquery.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Ruleset: `when` guard on a ruleset: the `.jess` `Ruleset` rule takes no guard [in tests-config/debug/linenumbers.less]'
  }],
  ['all-less:tests-config/filemanagerPlugin/filemanager.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: import/not-found: Import not found'
  }],
  ['all-less:tests-config/functions-harness/functions-harness.less', {
    cause: 'cannot-express',
    outcome: 'css-mismatch',
    reason: 'a function registered by a Less `plugins` entry is a Less-document global; `.jess` has no ambient function namespace'
  }],
  ['all-less:tests-config/globalVars/extended.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-config/modifyVars/extended.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-config/namespacing/namespacing-1.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'LookupStep: `var` step with Less 1-based indexing: no `.jess` accessor spells it (+2 more)'
  }],
  ['all-less:tests-config/namespacing/namespacing-2.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: a chain rooted at a mixin call: `.jess` accessors root at a `$` binding'
  }],
  ['all-less:tests-config/namespacing/namespacing-3.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Lookup: a variable inside an at-rule prelude: `.jess` preludes take CSS leaves or a whole `${…}` (+3 more)'
  }],
  ['all-less:tests-config/namespacing/namespacing-4.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: a chain rooted at a mixin call: `.jess` accessors root at a `$` binding'
  }],
  ['all-less:tests-config/namespacing/namespacing-5.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Param: literal-value pattern parameter: `MixinParam` is always `$name` (+3 more)'
  }],
  ['all-less:tests-config/namespacing/namespacing-6.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: call on a scoped (Less `@name`) binding: `.jess` `$name()` reads the live store only (+3 more)'
  }],
  ['all-less:tests-config/namespacing/namespacing-7.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Ruleset: `when` guard on a ruleset: the `.jess` `Ruleset` rule takes no guard'
  }],
  ['all-less:tests-config/namespacing/namespacing-8.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Lookup: Less `$prop` property accessor: `.jess` `$.prop` reads the entry surface, a different lookup (+1 more)'
  }],
  ['all-less:tests-config/namespacing/namespacing-functions.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: a chain rooted at a mixin call: `.jess` accessors root at a `$` binding (+3 more)'
  }],
  ['all-less:tests-config/namespacing/namespacing-media.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: a chain rooted at a mixin call: `.jess` accessors root at a `$` binding'
  }],
  ['all-less:tests-config/namespacing/namespacing-operations.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-config/preProcessorPlugin/preProcessor.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: resolve/name-not-found: Name not found'
  }],
  ['all-less:tests-config/rewrite-urls-all/rewrite-urls-all.less', {
    cause: 'cannot-express',
    outcome: 'css-mismatch',
    reason: 'URL rewriting (`rewriteUrls`/`rootpath`) is a Less-plugin transform; `.jess` documents get no URL rewrite'
  }],
  ['all-less:tests-config/rewrite-urls-local/rewrite-urls-local.less', {
    cause: 'cannot-express',
    outcome: 'css-mismatch',
    reason: 'URL rewriting (`rewriteUrls`/`rootpath`) is a Less-plugin transform; `.jess` documents get no URL rewrite'
  }],
  ['all-less:tests-config/rootpath-rewrite-urls-all/rootpath-rewrite-urls-all.less', {
    cause: 'cannot-express',
    outcome: 'css-mismatch',
    reason: 'URL rewriting (`rewriteUrls`/`rootpath`) is a Less-plugin transform; `.jess` documents get no URL rewrite'
  }],
  ['all-less:tests-config/rootpath-rewrite-urls-local/rootpath-rewrite-urls-local.less', {
    cause: 'cannot-express',
    outcome: 'css-mismatch',
    reason: 'URL rewriting (`rewriteUrls`/`rootpath`) is a Less-plugin transform; `.jess` documents get no URL rewrite'
  }],
  ['all-less:tests-config/sourcemaps/comprehensive/comprehensive.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a selector: `.jess` `${name}` reads the live store only'
  }],
  ['all-less:tests-config/static-urls/urls.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout (+1 more)'
  }],
  ['all-less:tests-config/strict-imports/strict-imports.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: an import inside a block: `.jess` imports are `Stylesheet`-level statements'
  }],
  ['all-less:tests-config/units/loose/loose.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Comment: a comment between value parts: `ValueSpaceGroup` separators are whitespace only'
  }],
  ['all-less:tests-config/units/no-strict/no-strict.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Comment: a comment between value parts: `ValueSpaceGroup` separators are whitespace only'
  }],
  ['all-less:tests-config/units/strict/strict-units.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-config/url-args/urls.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout (+1 more)'
  }],
  ['all-less:tests-unit/at-rule-variable-deprecated/at-rule-variable-deprecated.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: parse/unsupported-bare-variable-interpolation: Bare @variable interpolation is not valid here.'
  }],
  ['all-less:tests-unit/at-rule-variable-interpolation/at-rule-variable-interpolation.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only (+1 more)'
  }],
  ['all-less:tests-unit/at-rules-bubbling/at-rules-bubbling.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'AtRuleBlock: `@keyframes` inside a ruleset body: `rulesetBodyItem` has no `Keyframes` arm'
  }],
  ['all-less:tests-unit/at-rules-keyword-comments/at-rules-keyword-comments.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout (+1 more)'
  }],
  ['all-less:tests-unit/at-rules-targeted/at-rules-targeted.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'AtRuleStatement: `@charset` after another statement: `Charset` is only the first statement'
  }],
  ['all-less:tests-unit/at-rules/at-rules.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'AtRuleStatement: `@charset` after another statement: `Charset` is only the first statement (+1 more)'
  }],
  ['all-less:tests-unit/calc/calc.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/color-functions/modern-syntax.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/color-functions/modern.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/color-functions/operations.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/comments/comments.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout (+1 more)'
  }],
  ['all-less:tests-unit/comments/comments2.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/container/container.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Declaration: value-on-new-line layout: the `.jess` `Declaration` reducer never records it (+1 more)'
  }],
  ['all-less:tests-unit/css-3/css-3.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout'
  }],
  ['all-less:tests-unit/css-escapes/css-escapes.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'MixinCall: a mixin name outside `mixinNameToken` (e.g. an escaped or `!`-bearing name) (+1 more)'
  }],
  ['all-less:tests-unit/css-grid/css-grid.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Declaration: value-on-new-line layout: the `.jess` `Declaration` reducer never records it'
  }],
  ['all-less:tests-unit/css-guards/css-guards.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Ruleset: `when` guard on a ruleset: the `.jess` `Ruleset` rule takes no guard'
  }],
  ['all-less:tests-unit/detached-rulesets/detached-rulesets.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: call on a scoped (Less `@name`) binding: `.jess` `$name()` reads the live store only (+1 more)'
  }],
  ['all-less:tests-unit/extend-clearfix/extend-clearfix.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Declaration: a property name that is not an identifier (a Less map key such as `100` or `<`): the `.jess` `Declaration` name is an `Identifier`'
  }],
  ['all-less:tests-unit/extend-selector/extend-selector.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'ExtendInstruction: per-branch extend subject: `$extend` always extends the whole rule (+1 more)'
  }],
  ['all-less:tests-unit/extract-and-length/extract-and-length.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'FunctionCall: not an `ExpressionAtom`: `$( … )` and guard operands take references, numbers, colors, strings, keywords and `( … )` groups (+2 more)'
  }],
  ['all-less:tests-unit/functions-each/functions-each.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a selector: `.jess` `${name}` reads the live store only (+7 more)'
  }],
  ['all-less:tests-unit/functions/functions.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'FunctionCall: a function name that is not an identifier (Less `%()`) (+6 more)'
  }],
  ['all-less:tests-unit/functions/legacy/functions.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: parse/syntax-error: Unexpected Less input after a complete stylesheet.'
  }],
  ['all-less:tests-unit/ie-filters-REMOVED/legacy/ie-filters.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: parse/syntax-error: Unexpected Less input after a complete stylesheet.'
  }],
  ['all-less:tests-unit/import/import-inline.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: an import inside a block: `.jess` imports are `Stylesheet`-level statements (+1 more)'
  }],
  ['all-less:tests-unit/import/import-interpolation.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: an interpolated or escaped import target: `.jess` imports take a plain quoted path (+1 more)'
  }],
  ['all-less:tests-unit/import/import-module.less', {
    cause: 'lost-info',
    outcome: 'arm-b-error',
    reason: 'bare package imports (`@less/test-import-module/…`) became file-relative (`./…`, the migration guide\'s rewrite); the converter does not observe that Less resolved them as a package'
  }],
  ['all-less:tests-unit/import/import-once.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: import option `(multiple)`: `@-import` takes no option clause (`@-reference` parses only as an inert at-rule)'
  }],
  ['all-less:tests-unit/import/import-reference-issues.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: import option `(reference)`: `@-import` takes no option clause (`@-reference` parses only as an inert at-rule) (+2 more)'
  }],
  ['all-less:tests-unit/import/import-reference.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: import option `(reference)`: `@-import` takes no option clause (`@-reference` parses only as an inert at-rule) (+9 more)'
  }],
  ['all-less:tests-unit/import/import-remote.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: import option `(reference)`: `@-import` takes no option clause (`@-reference` parses only as an inert at-rule)'
  }],
  ['all-less:tests-unit/import/import.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Plugin: `@-plugin` parses only as an inert at-rule statement; `.jess` script integration is `@-use`/`@-from` (+4 more)'
  }],
  ['all-less:tests-unit/javascript-REMOVED/legacy/javascript.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: parse/unsupported-inline-javascript: Inline backtick JavaScript is not supported.'
  }],
  ['all-less:tests-unit/layer/layer.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: an import inside a block: `.jess` imports are `Stylesheet`-level statements (+2 more)'
  }],
  ['all-less:tests-unit/math-css-vars/math-css-vars.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/media/media.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only (+1 more)'
  }],
  ['all-less:tests-unit/merge/merge.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Declaration: merge `+:`: the `.jess` `Declaration` rule has no merge marker (+2 more)'
  }],
  ['all-less:tests-unit/mixins-guards-default-func/mixins-guards-default-func.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Param: literal-value pattern parameter: `MixinParam` is always `$name` (+2 more)'
  }],
  ['all-less:tests-unit/mixins-guards/mixins-guards.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'FunctionCall: not an `ExpressionAtom`: `$( … )` and guard operands take references, numbers, colors, strings, keywords and `( … )` groups (+6 more)'
  }],
  ['all-less:tests-unit/mixins-important/mixins-important.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Param: literal-value pattern parameter: `MixinParam` is always `$name` (+1 more)'
  }],
  ['all-less:tests-unit/mixins-interpolated/mixins-interpolated.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a selector: `.jess` `${name}` reads the live store only (+2 more)'
  }],
  ['all-less:tests-unit/mixins-named-args/mixins-named-args.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/mixins-nested/mixins-nested.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/mixins-pattern/mixins-pattern.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Param: rest/variadic parameter: `MixinParam` has no `...` form (+2 more)'
  }],
  ['all-less:tests-unit/mixins/maps.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'VariableDeclaration: bound to a mixin call: no `.jess` value spelling for a call\'s output (+1 more)'
  }],
  ['all-less:tests-unit/mixins/mixins-advanced.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'MixinCall: spread argument: no `.jess` call spelling splats a list (+1 more)'
  }],
  ['all-less:tests-unit/mixins/mixins.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only (+1 more)'
  }],
  ['all-less:tests-unit/namespace-targeted/namespace-targeted.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: a chain rooted at a mixin call: `.jess` accessors root at a `$` binding'
  }],
  ['all-less:tests-unit/nesting/nesting.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'VariableDeclaration: bound to a mixin call: no `.jess` value spelling for a call\'s output (+1 more)'
  }],
  ['all-less:tests-unit/operations/operations-advanced.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/operations/operations.less', {
    cause: 'p35',
    outcome: 'p35',
    reason: 'bare Less math (an `Operation` or `/` atom outside an `Expression`) — P35 not landed'
  }],
  ['all-less:tests-unit/parse-interpolation/parse-interpolation.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a selector: `.jess` `${name}` reads the live store only'
  }],
  ['all-less:tests-unit/parser-property-interp/parser-property-interp.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a `Lookup` spliced into a name: `${…}` takes a variable name'
  }],
  ['all-less:tests-unit/permissive-parse/permissive-parse.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: parse/unsupported-bare-variable-interpolation: Bare @variable interpolation is not valid here.'
  }],
  ['all-less:tests-unit/plugin-module/plugin-module.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: plugin/load-failed: Plugin "clean-css" could not be loaded: Less @plugin function "index.js" threw: Less @plugin require("./lib/clean") is not supported in the Deno sandbox yet.'
  }],
  ['all-less:tests-unit/plugin-preeval/plugin-preeval.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: plugin/load-failed: Plugin "../../plugin/plugin-preeval" could not be loaded: Less @plugin function "plugin-preeval.js" threw: Cannot read properties of undefined (reading \'Visitor\')'
  }],
  ['all-less:tests-unit/plugin/plugin.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: plugin/load-failed: Plugin "../../plugin/plugin-set-options" could not be loaded: Less @plugin function "plugin-set-options.js" threw: setOptions() not called before install'
  }],
  ['all-less:tests-unit/property-accessors/property-accessors.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Lookup: Less `$prop` property accessor: `.jess` `$.prop` reads the entry surface, a different lookup (+3 more)'
  }],
  ['all-less:tests-unit/property-name-interp/property-name-interp.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a name: `.jess` `${name}` reads the live store only (+2 more)'
  }],
  ['all-less:tests-unit/property-targeted/property-targeted.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Lookup: Less `$prop` property accessor: `.jess` `$.prop` reads the entry surface, a different lookup'
  }],
  ['all-less:tests-unit/selectors/selectors.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only (+1 more)'
  }],
  ['all-less:tests-unit/starting-style/starting-style.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Declaration: merge `+_:`: the `.jess` `Declaration` rule has no merge marker (+1 more)'
  }],
  ['all-less:tests-unit/strings/strings.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only'
  }],
  ['all-less:tests-unit/urls/urls.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: import/not-found: Import not found'
  }],
  ['all-less:tests-unit/variables-in-at-rules/variables-in-at-rules.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only'
  }],
  ['all-less:tests-unit/variables/variable-advanced.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Interpolation: a scoped (Less `@{name}`) read spliced into a string: `.jess` `${name}` reads the live store only (+2 more)'
  }],
  ['all-less:tests-unit/variables/variables.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Important: `!important` on a variable value is undecided for `.jess` (inventory row) (+2 more)'
  }],
  ['all-less:tests-unit/whitespace/whitespace.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout'
  }],
  ['bootstrap-less-port@2.5.1:less/bootstrap-grid.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Plugin: `@-plugin` parses only as an inert at-rule statement; `.jess` script integration is `@-use`/`@-from` [in less/_functions.less] (+17 more)'
  }],
  ['bootstrap-less-port@2.5.1:less/bootstrap-reboot.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Plugin: `@-plugin` parses only as an inert at-rule statement; `.jess` script integration is `@-use`/`@-from` [in less/_functions.less] (+44 more)'
  }],
  ['bootstrap-less-port@2.5.1:less/bootstrap.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Plugin: `@-plugin` parses only as an inert at-rule statement; `.jess` script integration is `@-use`/`@-from` [in less/_functions.less] (+104 more)'
  }]
]);

/* -------------------------------------------------------------------- suite */

const observed = new Map<string, Partial<Record<Mode, Observation>>>();

beforeAll(async () => {
  for (const corpus of CORPORA) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `jess-equivalence-${corpus.name.replace(/[^a-z0-9]+/giu, '-')}-`));
    corpus.copy = path.join(root, corpus.layout);
    const copy = (from: string, to: string): void => fs.cpSync(from, to, {
      recursive: true,
      dereference: true,
      filter: source => source !== path.join(from, 'node_modules')
    });
    copy(corpus.source, corpus.copy);
    for (const [name, dir] of corpus.packages) {
      const target = path.join(root, dir);
      const from = path.resolve(corpus.source, path.relative(corpus.layout, dir));
      if (!fs.existsSync(target) && fs.existsSync(from)) {
        copy(from, target);
      }
      fs.mkdirSync(path.dirname(path.join(root, 'node_modules', name)), { recursive: true });
      fs.symlinkSync(target, path.join(root, 'node_modules', name), 'dir');
    }
  }
}, 120_000);

afterAll(() => {
  if (process.env.JESS_EQUIVALENCE_REPORT) {
    fs.writeFileSync(process.env.JESS_EQUIVALENCE_REPORT, `${JSON.stringify(Object.fromEntries(observed), null, 1)}\n`);
  }
  for (const corpus of CORPORA) {
    if (corpus.copy && !process.env.JESS_EQUIVALENCE_REPORT) {
      fs.rmSync(path.resolve(corpus.copy, path.relative(corpus.layout, '.')), { recursive: true, force: true });
    }
  }
});

for (const corpus of CORPORA) {
  describe(`equivalence: ${corpus.name}`, () => {
    let conversions = new Map<string, Conversion>();

    beforeAll(async () => {
      conversions = await convertCorpus(corpus);
    }, 300_000);

    it('discovers the corpus', () => {
      expect(corpus.fixtures.length).toBeGreaterThan(0);
    });

    it('every converted file re-prints to itself', () => {
      const unstable = [...conversions].flatMap(([file, c]) => ('reprint' in c && c.reprint !== undefined ? [`${file}: ${c.reprint}`] : []));
      expect(unstable).toEqual([]);
    });

    for (const fixture of corpus.fixtures) {
      for (const mode of MODES) {
        it(`${fixture.file} [${mode}]`, async () => {
          const result = await observe(corpus, fixture, mode, conversions);
          const key = `${corpus.name}:${fixture.file}`;
          observed.set(key, { ...observed.get(key), [mode]: result });
        }, TIMEOUT_MS);
      }
    }
  });
}

describe('converted function imports', () => {
  it('imports exactly the Less built-ins a file calls, under their call names', () => {
    const printed = emitJess(parseLess('@charset "utf-8";\n.a { b: lighten(#00f, 10%); c: data-uri("x.png"); d: rgba(1, 2, 3, 0.5); e: unknown(1); }'), { functions: LESS_FUNCTIONS });
    expect(printed.split('\n').slice(0, 2)).toEqual([
      '@charset "utf-8";',
      '@-from "#less" import (dataUri as data-uri, lighten, rgba);'
    ]);
  });
});

describe('equivalence ratchet', () => {
  it('every fixture matches its KNOWN entry (or passes when unlisted)', () => {
    const drift: string[] = [];
    for (const [key, modes] of observed) {
      const known = KNOWN.get(key);
      for (const mode of MODES) {
        const seen = modes[mode]?.outcome;
        if (seen === undefined) {
          continue;
        }
        const expected = known === undefined
          ? 'pass'
          : typeof known.outcome === 'string' ? known.outcome : known.outcome[mode];
        if (seen !== expected) {
          drift.push(`${key} [${mode}]: expected ${expected}, observed ${seen}${modes[mode]?.detail ? ` — ${modes[mode]!.detail}` : ''}`);
        }
      }
    }
    for (const key of KNOWN.keys()) {
      if (!observed.has(key)) {
        drift.push(`${key}: listed in KNOWN but not in the corpus`);
      }
    }
    if (drift.length > 0) {
      // The package ratchet reports only test NAMES; the drift itself goes to stderr.
      console.error(`equivalence ratchet drift:\n${drift.join('\n')}`);
    }
    expect(drift.join('\n'), drift.join('\n')).toBe('');
  });

  it('every KNOWN cause agrees with its outcome', () => {
    // `p35` and `no-arm-a` are read off the outcome; the other two causes are judgement.
    const implied = new Map<Outcome, Cause>([['p35', 'p35'], ['arm-a-error', 'no-arm-a']]);
    const wrong = [...KNOWN].filter(([, k]) => {
      const outcomes = (typeof k.outcome === 'string' ? [k.outcome] : Object.values(k.outcome)).filter(o => o !== 'pass');
      return outcomes.some(o => (implied.get(o) ?? null) !== (k.cause === 'p35' || k.cause === 'no-arm-a' ? k.cause : null));
    }).map(([key]) => key);
    expect(wrong).toEqual([]);
  });
});
