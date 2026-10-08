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
  lessTestDataRemoteImports,
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
 * The modes whose DIALECT defaults differ between `.less` and `.jess`, pinned
 * to the Less values for both arms so neither falls back to its own dialect's
 * defaults.
 */
const PINNED_MODES = {
  mathMode: 'parens-division',
  unitMode: 'preserve',
  allowLeakyScope: true,
  allowCallerScope: false,
  processImports: true
} as const;
const PINNED_COMPILE = { ...PINNED_MODES, allowExtendSelectors: [...ALL_EXTEND_KINDS] } as const;

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
     * to the `packages/` sibling of `packages/test-data`. Remote jsDelivr imports
     * of `@less/test-data` are answered from the copy, as in all-less.test.ts.
     */
    layout: 'packages/test-data',
    packages: [['@less/test-data', 'packages/test-data'], ['@less/test-import-module', 'packages/test-import-module']],
    fixtures: allLessFixtures(),
    plugins: copy => [
      lessPlugin({ plugins: [lessHarnessFunctionsPlugin] }),
      lessCompatPlugin(),
      lessFixturePackagesPlugin(),
      lessTestDataRemoteImports(copy),
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

  /*
   * The pins are language settings, under the fixture's own canonical modes, from
   * its `compile` block and its `language.less`: a language setting wins over a
   * compile one (ledger C19), so a fixture's compile mode joins the pins' tier to
   * win over them. A fixture's deprecated spelling (`math`, `strictUnits`) sits in
   * the same object as the pinned canonical name, which wins, so those fixtures
   * render under the pins in both arms: `.jess` reads only the canonical names.
   */
  const fixtureModes = Object.fromEntries(Object.entries(fixtureCompile).filter(
    ([name, value]) => value !== undefined && Object.hasOwn(PINNED_MODES, name)
  ));
  const lessOptions = { ...PINNED_MODES, bubbleRootAtRules: true, ...fixtureModes, ...(language.less ?? {}) };
  const fixtureOutput = Array.isArray(output) ? {} : (output ?? {});
  return {
    ...rest,
    compile: {
      allowExtendSelectors: PINNED_COMPILE.allowExtendSelectors,
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
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'Reference: a chain rooted at a mixin call: `.jess` accessors root at a `$` binding'
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
  ['all-less:tests-unit/color-functions/rgba.less', {
    cause: 'lost-info',
    outcome: 'arm-b-error',
    reason: 'a built-in call Less writes out as CSS when it cannot compute it (`rgba(var(--color-accent), 0.2)`) converts to a call through its imported binding (`$rgba(…)`), which ruling J1 makes an eval error'
  }],
  ['all-less:tests-unit/comments/comments.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'List: a list laid out across lines or around comments: the `.jess` `Value` rule keeps no separator layout (+1 more)'
  }],
  ['all-less:tests-unit/comments/comments2.less', {
    cause: 'lost-info',
    outcome: 'css-mismatch',
    reason: 'a block comment inside a function argument is dropped (`linear-gradient(#333 /*{comment}*/, #111)` vs `linear-gradient(#333, #111)`)'
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
    reason: 'the Less arm itself does not render: parse/unsupported-inline-javascript: Inline JavaScript was removed in Less v5. Move it to a module loaded with @use.'
  }],
  ['all-less:tests-unit/layer/layer.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'StyleImport: an import inside a block: `.jess` imports are `Stylesheet`-level statements (+2 more)'
  }],
  ['all-less:tests-unit/math-css-vars/math-css-vars.less', {
    cause: 'lost-info',
    outcome: 'arm-b-error',
    reason: 'a built-in call Less writes out as CSS when it cannot compute it (`sin(var(--angle))`) converts to a call through its imported binding (`$sin(…)`), which ruling J1 makes an eval error'
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
  ['all-less:tests-unit/operations/operations.less', {
    cause: 'cannot-express',
    outcome: 'cannot-express',
    reason: 'FunctionCall: not an `ExpressionAtom`: `$( … )` and guard operands take references, numbers, colors, strings, keywords and `( … )` groups | Operation: an operand grouping the left-folding precedence ladder cannot reproduce without a `( … )` block'
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
    reason: 'the Less arm itself does not render: plugin/load-failed: Plugin "clean-css" could not be loaded: Less @plugin function "index.js" threw: Less @plugin require("http") is not supported: only relative requires ("./file", "../file") of CommonJS files inside the script root are.'
  }],
  ['all-less:tests-unit/plugin-preeval/plugin-preeval.less', {
    cause: 'no-arm-a',
    outcome: 'arm-a-error',
    reason: 'the Less arm itself does not render: plugin/unsupported-feature: Plugin "plugin-preeval.js" uses less.visitors, which is not supported'
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
    const printed = emitJess(parseLess('@charset "utf-8";\n.a { b: lighten(#00f, 10%); c: data-uri("x.png"); d: rgba(1, 2, 3, 0.5); e: unknown(1); f: fade(rgba(1, 2, 3, 0.5), 10%); }'), { functions: LESS_FUNCTIONS });
    expect(printed.split('\n').slice(0, 2)).toEqual([
      '@charset "utf-8";',
      '@-from "#less" import (dataUri as data-uri, fade, lighten, rgba);'
    ]);
    expect(printed).toContain('.a {\n  b: $lighten(#00f, 10%);\n  c: $data-uri("x.png");\n  d: rgba(1, 2, 3, 0.5);\n  e: unknown(1);\n  f: $fade($rgba(1, 2, 3, 0.5), 10%);\n}');
  });

  /*
   * Ledger F5: Less writes a CSS-shaped color call in a property's value out as
   * authored and never dispatches it, so the converter prints it as a plain CSS
   * call. A variable's value, which a callable may read, keeps the binding.
   */
  it('prints a CSS-shaped color call a property writes out as a plain call', () => {
    const printed = emitJess(parseLess('@c: rgba(1, 2, 3, 0.5);\n.a { b: rgb(0 128 255); c: hsl(198deg 28% 50% / 50%); d: alpha(@c); }'), { functions: LESS_FUNCTIONS });
    expect(printed).toContain('$c: $rgba(1, 2, 3, 0.5);');
    expect(printed).toContain('.a {\n  b: rgb(0 128 255);\n  c: hsl(198deg 28% 50% / 50%);\n  d: $alpha($^c);\n}');
  });
});

/*
 * The Less corpus has no paren group around one value or a function call outside
 * `calc()`, so the ratchet cannot see one. Each case renders the Less source and
 * its converted `.jess` and compares the bytes. (`@@name`, `$prop`, a map member
 * and a splice of a value holding a comment have no `.jess` spelling yet.)
 */
describe('round trip of paren groups', () => {
  const render = async (source: string, language: 'less' | 'jess'): Promise<string> =>
    new Compiler().renderString(source, { language, extension: `.${language}` });
  const cases = [
    '.x { a: (10vh); b: (percentage(0.5)); c: var(--a, (10px)); d: (10px) * 2; e: (unit(5, px)); }',
    '@w: 10px; @a: 1px + 2px; @p: percentage(0.5); .x { a: (@w); b: (@a); c: ((10px)); d: (@p); }',
    '.m(@x) { a: (@x); } .y { .m(1px + 2px); } .z { .m(10px); }'
  ];
  for (const less of cases) {
    it(less, async () => {
      const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
      expect(await render(jess, 'jess'), jess).toBe(await render(less, 'less'));
    });
  }

  it('a group a computation holds is judged where it is written, not inside the `calc()` that reads it', async () => {
    /*
     * `(@v + 30px)` lowers to `$(($^v + 30px))`; `((@v + 30px))` is a group
     * inside the boundary in Less too. Read through a variable inside `calc()`,
     * each is the value it computed, not a group authored in the math function.
     */
    const less = '@v: 10px; @c: (@v + 30px); @d: ((@v + 30px)); .x { a: calc(100% - @c); b: calc(100% - @d); }';
    const css = '.x {\n  a: calc(100% - 40px);\n  b: calc(100% - 40px);\n}\n';
    expect(await render(less, 'less')).toBe(css);
    expect(await render(emitJess(parseLess(less), { functions: LESS_FUNCTIONS }), 'jess')).toBe(css);
  });
});

describe('converted custom properties', () => {
  it('prints a custom property\'s value comments in the value, once', () => {
    expect(emitJess(parseLess('.a { --x: /* c */ red; --y: a /* d */ b; /* e */ z: 1; }')))
      .toBe('.a {\n  --x: /* c */ red;\n  --y: a /* d */ b;\n  /* e */\n  z: 1;\n}\n');
  });
});

/*
 * `tests-config/math-strict/css.less` has no expected CSS, so it is converted as
 * a corpus file rather than ratcheted as a fixture. Once its slashes stopped being
 * bare math it converted, and the re-print gate caught two spellings `.jess`
 * cannot read back. The emitter names them instead of printing them.
 */
describe('spellings the emitter names instead of printing', () => {
  it('names an empty declaration value and an IE-style name=value argument', () => {
    let gaps: string[] = [];
    try {
      emitJess(parseLess('.m { margin: ; filter: alpha(opacity=100); }'), { functions: LESS_FUNCTIONS });
    } catch (error) {
      if (!(error instanceof NoJessSpelling)) {
        throw error;
      }
      gaps = error.gaps.map(g => `${g.nodeType}: ${g.reason}`);
    }
    expect(gaps).toEqual([
      'Declaration: an empty declaration value (`margin: ;`): the `.jess` `Declaration` rule requires a value',
      'FunctionCall: an IE-style `name=value` argument (`alpha(opacity=100)`): no `.jess` `CallArgument` spelling reads it back'
    ]);
  });

  /* A body-form extend the render walk applies where a body lands (X16, X19) has no `.jess` spelling: printing the body without it would drop it. */
  it('names a body-form extend in a mixin definition, an at-rule block, a detached ruleset and an each() callback', () => {
    for (const [source, owner] of [
      ['.m() { &:extend(.z); }', 'a mixin definition (ledger X16)'],
      ['.y { @media print { &:extend(.z); } }', 'an at-rule block (ledger X19)'],
      ['@r: { &:extend(.z); };', 'a detached ruleset (ledger X19)'],
      ['@l: a; .y { each(@l, { &:extend(.z); }); }', 'an `each()` callback (ledger X19)']
    ] as const) {
      let gaps: string[] = [];
      try {
        emitJess(parseLess(source), { functions: LESS_FUNCTIONS });
      } catch (error) {
        if (!(error instanceof NoJessSpelling)) {
          throw error;
        }
        gaps = error.gaps.map(g => `${g.nodeType}: ${g.reason}`);
      }
      expect(gaps, source).toContain(`ExtendInstruction: a body-form extend in ${owner} has no \`.jess\` spelling yet`);
    }
  });
});

describe('a Less paren group lowers to a group inside the boundary', () => {
  it('prints `(@a + 3px)` as `$(($^a + 3px))` and bare `@a + 3px` as `$($^a + 3px)`', () => {
    /*
     * Less parens are the computation boundary AND the author's parens, which
     * the value keeps where its math is kept as written (J16). `$( … )` alone
     * is only the boundary, so the group is written inside it.
     */
    expect(emitJess(parseLess('.a {\n  b: (@a + 3px);\n  c: @a + 3px;\n}\n')))
      .toBe('.a {\n  b: $(($^a + 3px));\n  c: $($^a + 3px);\n}\n');
  });
});

/*
 * The corpus cannot see this case: every fixture that holds a unitless number
 * ± a unit is listed in KNOWN for another cause. A unitless operand adopts the
 * other operand's unit in every dialect (owner 2026-10-06, ledger V27), so both
 * arms compute `4 + 3px` to `7px`.
 */
describe('targeted round trip: a unitless number ± a unit', () => {
  it('both arms compute it', async () => {
    const less = '@a: 4;\n.a {\n  b: (@a + 3px);\n  c: @a * 2px;\n}\n';
    const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
    const render = async (source: string, extension: '.less' | '.jess') => {
      const result = await new Compiler({ compile: { ...PINNED_COMPILE, plugins: [lessPlugin(), jessPlugin()] }, quiet: true })
        .renderToResult({ source, filePath: `entry${extension}`, extension }, { quiet: true });
      return result.css.replace(/\s+/g, ' ').trim();
    };
    expect(await render(less, '.less')).toBe('.a { b: 7px; c: 8px; }');
    expect(await render(jess, '.jess')).toBe(await render(less, '.less'));
  });
});

/*
 * Math that does not compute — two units that do not convert, or a keyword
 * operand — lowers into `$( … )` like all Less math (P35), an authored group
 * as `$(( … ))`. `.jess` answers an explicit `unitMode` exactly as `.less`
 * does (owner 2026-10-06; `strict` is only its default), so under each rung
 * both arms write the same bytes and report the same diagnostics.
 */
describe('targeted round trip: kept math', () => {
  it('`.less` and its `.jess` lowering agree under every explicit `unitMode`', async () => {
    const less = '@a: 4px;\n@x: @a + 1em;\n.a {\n  b: (@a + 3em);\n  c: @a - 3em;\n  d: @x;\n  e: calc(@x * 2);\n  f: (foo + 1);\n}\n';
    const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
    const render = async (source: string, extension: '.less' | '.jess', unitMode: 'loose' | 'preserve' | 'strict') => {
      const result = await new Compiler({ compile: { ...PINNED_COMPILE, unitMode, plugins: [lessPlugin(), jessPlugin()] }, quiet: true })
        .renderToResult({ source, filePath: `entry${extension}`, extension }, { quiet: true });
      return {
        css: result.css.replace(/\s+/g, ' ').trim(),
        warnings: result.warnings.map(w => w.code),
        errors: result.errors.map(e => e.code)
      };
    };
    for (const unitMode of ['loose', 'preserve', 'strict'] as const) {
      expect(await render(jess, '.jess', unitMode), unitMode).toEqual(await render(less, '.less', unitMode));
    }
    const kept = await render(less, '.less', 'preserve');
    expect(kept.css).toContain('calc(4px + 3em)');
    expect(kept.warnings).toContain('eval/unexpressible-unit');
    expect((await render(less, '.less', 'strict')).errors).toEqual(['eval/invalid-unit-arithmetic']);
  });
});

/*
 * Once a sheet is `.jess`, it answers the `.jess` default (owner: "once it is a .jess
 * file, it should error"): the conversion writes mixed-unit math honestly as `$( … )`,
 * never in a form that dodges `unitMode: 'strict'`, so the converted sheet stops the
 * compile where the `.less` one kept the math. The equivalence harness compares the two
 * under one explicit `unitMode` ({@link PINNED_MODES}), where they agree. A `.less` sheet
 * imported by a `.jess` one keeps the Less default (DESIGN-DECISIONS C19).
 */
/*
 * The slash before the alpha in a CSS colour function's modern syntax is a
 * separator, never division (css-color-4 §4, ledger F5): under `math: always`
 * Less lowers `255 / 50%` to a computation, and neither arm divides it, so
 * the converter prints it as the separator (`rgb(0 128 255 / 50%)`, never
 * `rgb(0 128 $(255 / 50%))`). A `/` anywhere else, a paren group the author
 * wrote around one included, is still Less math.
 */
describe('targeted round trip: the alpha slash of a colour function', () => {
  it('neither arm divides it under `math: always`, and the converter prints it as a separator', async () => {
    const colours = ['rgb(0 128 255 / 50%)', 'rgba(0 128 255 / 0.5)', 'hsl(198deg 28% 50% / 50%)', 'hsla(198 28% 50% / 0.5)',
      'hwb(1 2% 3% / 0.5)', 'lab(50% 40 59.5 / 0.5)', 'lch(52.2% 72.2 50 / 0.5)', 'oklab(59% 0.1 0.1 / 0.5)',
      'oklch(60% 0.15 50 / 0.5)', 'color(srgb 1 0 0 / 50%)', 'color(display-p3 1 0.5 0 / 0.5)'];
    const less = `@a: 50%; .a {\n${colours.map((c, i) => `  c${i}: ${c};\n`).join('')}  v: rgb(0 128 255 / @a);\n  p: hwb(1 2% (6% / 2));\n  d: 10px / 2;\n}\n`;
    const jess = emitJess(parseLess(less, { mathMode: 'always' }), { functions: LESS_FUNCTIONS });
    for (const colour of colours) {
      expect(jess).toContain(colour);
    }
    expect(jess).toContain('v: rgb(0 128 255 / $^a);');
    expect(jess).toContain('d: $(10px / 2);');
    const render = async (source: string, extension: '.less' | '.jess'): Promise<string> =>
      new Compiler({ compile: { ...PINNED_COMPILE, mathMode: 'always' } }).renderString(source, { extension });
    const css = await render(less, '.less');
    expect(await render(jess, '.jess')).toBe(css);
    expect(css).toBe(`.a {\n${colours.map((c, i) => `  c${i}: ${c};\n`).join('')}  v: rgb(0 128 255 / 50%);\n  p: hwb(1 2% 3%);\n  d: 5px;\n}\n`);
  });
});

describe('targeted round trip: the converted sheet answers the .jess default', () => {
  it('errors on mixed units by default, and agrees under an explicit unitMode', async () => {
    const less = '@a: 4px;\n@x: @a + 1em;\n.m(@v) { m: @v; }\n.a {\n  b: (@a + 3em);\n  d: @x;\n  g: 1px + 1em;\n  .m(1px + 1em);\n}\n';
    const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
    for (const honest of ['$($^a + 1em)', '$(($^a + 3em))', '$(1px + 1em)']) {
      expect(jess).toContain(honest);
    }
    const render = async (source: string, extension: '.less' | '.jess', compile: ConfigOptions['compile'] = {}) => {
      const result = await new Compiler({ compile: { plugins: [lessPlugin(), jessPlugin()], ...compile }, quiet: true })
        .renderToResult({ source, filePath: `entry${extension}`, extension }, { quiet: true });
      return { css: result.css.replace(/\s+/g, ' ').trim(), errors: result.errors.map(e => e.code) };
    };
    expect((await render(less, '.less')).errors).toEqual([]);
    expect((await render(jess, '.jess')).errors).toEqual(['eval/invalid-unit-arithmetic']);
    expect(await render(jess, '.jess', { unitMode: 'preserve' })).toEqual(await render(less, '.less', { unitMode: 'preserve' }));
    expect(await render(jess, '.jess', PINNED_COMPILE)).toEqual(await render(less, '.less', PINNED_COMPILE));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-converted-'));
    try {
      fs.writeFileSync(path.join(dir, 'part.less'), less);
      fs.writeFileSync(path.join(dir, 'entry.jess'), '@-import \'./part.less\';\n');
      const imported = await new Compiler({ compile: { plugins: [lessPlugin(), jessPlugin()] }, quiet: true })
        .renderToResult(path.join(dir, 'entry.jess'), { quiet: true });
      expect(imported.errors).toEqual([]);
      expect(imported.css.replace(/\s+/g, ' ').trim()).toBe((await render(less, '.less')).css);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
