#!/usr/bin/env node
/*
 * Native checker for `capability.json` beside it (COD `javascript-library`
 * profile): `node capabilities/jess-function-bindings/check.mjs <mode> <contract>`
 * from the repository root. Exit 0 = pass, 1 = an assertion rejected the
 * implementation, 2 = the evidence could not be observed.
 *
 * WHAT IT OBSERVES. Every suite under `packages/jess/test` that calls
 * `emitJess` runs under vitest against the BUILT packages, with
 * `observe.setup.ts` recording the `functions` value each call receives. That
 * value is what the conversion actually used, so the checks compare values, not
 * a consumer's pass label. The corpus sweep of the equivalence harness
 * (`equivalence: …` tests) is filtered out: it shares the module-level value the
 * observed tests read, and costs a minute per run.
 *
 *   behavior   the declared consumers are exactly the suites that pass a
 *              `functions` value; their suites pass; every value a consumer
 *              passes for a dialect is the same one, with the contract's `from`
 *              and its required call → export pairs.
 *   ownership  behavior, then the OWNER's rule in each plugin is probed — a
 *              suffix on its module specifier and an extra name — and the
 *              plugins are rebuilt: every consumer's value must now carry both.
 *              A local copy (or a copy beside an unused owner import) keeps its
 *              own value and fails.
 *   changes    a contract-only change (a required pair the owner does not
 *              produce) and an implementation-only change (the owner drops a
 *              required pair) must each fail behavior.
 *
 * The observation reads the BUILT packages, so a source newer than its build is
 * unresolved (exit 2), not judged. A probe rebuilds the owner packages and then
 * restores their `lib/` from a snapshot, declarations included.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const root = process.cwd();
const here = 'capabilities/jess-function-bindings';

/* Independent of capability.json: deleting a consumer row must not delete its observation. */
const CONSUMERS = {
  'less-equivalence': { file: 'packages/jess/test/jess/less-jess-equivalence.test.ts', dialect: 'less' },
  'less-stored-slash-math': { file: 'packages/jess/test/less/stored-slash-math.test.ts', dialect: 'less' },
  'sass-list-map-functions': { file: 'packages/jess/test/scss/sass-list-map-functions.test.ts', dialect: 'sass' },
  'sass-selector-parse': { file: 'packages/jess/test/scss/sass-selector-parse.test.ts', dialect: 'sass' }
};
const OWNERS = {
  less: { pkg: 'packages/syntax/less/jess-plugin-less', file: 'packages/syntax/less/jess-plugin-less/src/jess-functions.ts', rule: '{ from: LESS_MODULE, names: lessExportNames() }' },
  sass: { pkg: 'packages/syntax/scss/jess-plugin-scss', file: 'packages/syntax/scss/jess-plugin-scss/src/jess-functions.ts', rule: '{ from: SASS_MODULE, names: sassExportNames() }' }
};

/** Built packages the observation reads: the owners and the registry they import. */
const BUILT = ['packages/fns', ...Object.values(OWNERS).map(o => o.pkg)];
const PROBE = ['cod-probe', 'codProbe'];
const PROBE_SUFFIX = '?cod-probe';

class Unresolved extends Error {}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    throw new Unresolved(String(result.error));
  }
  return result;
}

/** Every package's `lib/index.js` is newer than all of its `src/` files. */
function assertBuildsFresh() {
  for (const pkg of BUILT) {
    const lib = join(root, pkg, 'lib/index.js');
    if (!existsSync(lib)) {
      throw new Unresolved(`${pkg} is not built; run the build first`);
    }
    const built = statSync(lib).mtimeMs;
    const stale = readdirSync(join(root, pkg, 'src'), { recursive: true })
      .find(file => statSync(join(root, pkg, 'src', file)).mtimeMs > built);
    if (stale !== undefined) {
      throw new Unresolved(`${pkg}/src/${stale} is newer than its build; rebuild before checking`);
    }
  }
}

/** Rebuild the owner packages' JS (types are not part of the observation). */
function buildOwners() {
  for (const { pkg } of Object.values(OWNERS)) {
    const result = run(process.execPath, [join(root, 'node_modules/tsdown/dist/run.mjs'), '--tsconfig', 'tsconfig.build.json', '--no-dts'], join(root, pkg));
    if (result.status !== 0) {
      throw new Unresolved(`rebuilding ${pkg} failed:\n${result.stdout}${result.stderr}`);
    }
  }
}

/** Replace the owner rule in every plugin (exactly once each), rebuild, run `body`, restore sources and builds. */
function withOwnerRule(rewrite, body) {
  const originals = Object.values(OWNERS).map(({ file, rule }) => {
    const source = readFileSync(join(root, file), 'utf8');
    if (source.split(rule).length !== 2) {
      throw new Unresolved(`${file}: owner rule \`${rule}\` not found exactly once; requalify the probe`);
    }
    return { file, source, rule, stat: statSync(join(root, file)) };
  });
  const snapshot = mkdtempSync(join(tmpdir(), 'cod-jess-functions-lib-'));
  for (const { pkg } of Object.values(OWNERS)) {
    cpSync(join(root, pkg, 'lib'), join(snapshot, pkg), { recursive: true, preserveTimestamps: true });
  }
  try {
    for (const { file, source, rule } of originals) {
      writeFileSync(join(root, file), source.replace(rule, rewrite(rule)));
    }
    buildOwners();
    return body();
  } finally {
    // The restored source keeps its timestamp, so the restored build stays fresh against it.
    for (const { file, source, stat } of originals) {
      writeFileSync(join(root, file), source);
      utimesSync(join(root, file), stat.atime, stat.mtime);
    }
    for (const { pkg } of Object.values(OWNERS)) {
      rmSync(join(root, pkg, 'lib'), { recursive: true, force: true });
      cpSync(join(snapshot, pkg), join(root, pkg, 'lib'), { recursive: true, preserveTimestamps: true });
    }
    rmSync(snapshot, { recursive: true, force: true });
  }
}

/**
 * file (repo-relative) → every non-empty `functions` value its suite passed to
 * `emitJess`. Under a probe the suites may fail (a probed specifier does not
 * load); the values they passed are what is judged.
 */
function observe({ probed = false } = {}) {
  const tests = run('git', ['ls-files', '*.test.ts'], root).stdout.split('\n').filter(Boolean)
    .filter(file => readFileSync(join(root, file), 'utf8').includes('emitJess('));
  const outside = tests.filter(file => !file.startsWith('packages/jess/test/') && /\bfunctions\b/u.test(readFileSync(join(root, file), 'utf8')));
  if (outside.length > 0) {
    throw new Unresolved(`suites outside packages/jess/test may pass \`functions\` to emitJess and are not observed: ${outside.join(', ')}`);
  }
  const suites = tests.filter(file => file.startsWith('packages/jess/test/'));
  const dir = mkdtempSync(join(tmpdir(), 'cod-jess-functions-'));
  const out = join(dir, 'observed.jsonl');
  try {
    const result = spawnSync(process.execPath, [
      join(root, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', join(root, here, 'vitest.config.ts'),
      '-t', '^(?!equivalence)',
      ...suites.map(file => relative('packages/jess', file))
    ], { cwd: join(root, 'packages/jess'), encoding: 'utf8', env: { ...process.env, COD_JESS_FUNCTIONS_OUT: out }, maxBuffer: 64 * 1024 * 1024 });
    if (result.error) {
      throw new Unresolved(String(result.error));
    }
    if (!probed && result.status !== 0) {
      throw new Unresolved(`consumer suites failed:\n${result.stdout.slice(-4000)}${result.stderr.slice(-2000)}`);
    }
    if (!existsSync(out)) {
      throw new Unresolved('no emitJess call was observed: the observation hook did not load');
    }
    const observed = new Map();
    for (const line of readFileSync(out, 'utf8').trim().split('\n')) {
      const { file, functions } = JSON.parse(line);
      if (functions) {
        const key = relative(root, file);
        observed.set(key, [...(observed.get(key) ?? []), functions]);
      }
    }
    return observed;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The behavior assertions over one observation, against one contract's requirements. */
function judge(observed, contract) {
  assert.deepEqual(
    Object.fromEntries(contract.consumers.map(c => [c.id, c.entrypoint])),
    Object.fromEntries(Object.entries(CONSUMERS).map(([id, c]) => [id, c.file])),
    'capability.json consumers differ from the checker inventory'
  );
  const undeclared = [...observed.keys()].filter(file => !Object.values(CONSUMERS).some(c => c.file === file));
  assert.deepEqual(undeclared, [], 'suites pass a `functions` projection without being a declared consumer');
  const byDialect = {};
  for (const [id, { file, dialect }] of Object.entries(CONSUMERS)) {
    const values = observed.get(file);
    if (values === undefined) {
      throw new Unresolved(`${id}: ${file} passed no \`functions\` value to emitJess`);
    }
    for (const value of values) {
      byDialect[dialect] ??= value;
      assert.deepEqual(value, byDialect[dialect], `${id}: a ${dialect} projection differs from another consumer's`);
    }
  }
  for (const [dialect, { from, names }] of Object.entries(contract.requirements)) {
    const value = byDialect[dialect];
    assert.ok(value, `no consumer observed for ${dialect}`);
    assert.equal(value.from, from, `${dialect}: module specifier`);
    const actual = new Map(value.names);
    for (const [call, exported] of names) {
      assert.equal(actual.get(call), exported, `${dialect}: \`${call}()\` must import \`${exported}\``);
    }
  }
  return byDialect;
}

const readContract = path => JSON.parse(readFileSync(path, 'utf8'));

function ownership(contract) {
  judge(observe(), contract);
  const probe = rule => rule
    .replace(/from: (\w+)/, `from: $1 + ${JSON.stringify(PROBE_SUFFIX)}`)
    .replace(/names: (\w+)\(\)/, `names: new Map([...$1(), ${JSON.stringify(PROBE)}])`);
  const probed = withOwnerRule(probe, () => observe({ probed: true }));
  const followed = (dialect, value) => value.from === contract.requirements[dialect].from + PROBE_SUFFIX
    && value.names.some(([call, exported]) => call === PROBE[0] && exported === PROBE[1]);
  const stale = Object.entries(CONSUMERS)
    .filter(([, { file, dialect }]) => {
      const values = probed.get(file) ?? [];
      return values.length === 0 || !values.every(value => followed(dialect, value));
    })
    .map(([id]) => id);
  assert.deepEqual(stale, [], 'consumers that did not follow a change to the owner');
}

function changes(contractPath) {
  const contract = readContract(contractPath);
  const observed = observe();
  judge(observed, contract);

  const changedContract = structuredClone(contract);
  changedContract.requirements.less.names[0] = [changedContract.requirements.less.names[0][0], 'codChangedExport'];
  assert.throws(() => judge(observed, changedContract), assert.AssertionError, 'a contract-only change was accepted');

  const [dropped] = contract.requirements.less.names[0];
  const drop = rule => rule.replace(/names: (\w+)\(\)/, `names: new Map([...$1()].filter(([call]) => call !== ${JSON.stringify(dropped)}))`);
  withOwnerRule(drop, () => {
    const dropped = observe({ probed: true });
    assert.throws(() => judge(dropped, contract), assert.AssertionError, 'an implementation-only change was accepted');
  });
}

try {
  const [mode, contractPath = join(here, 'capability.json')] = process.argv.slice(2);

  // The delivery path: the verify script exists and CI runs it.
  assert.equal(readContract(join(root, 'package.json')).scripts['verify:capabilities'], 'node scripts/cod.mjs verify-catalog . capabilities --allow-execution');
  assert.match(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), /^\s+run: pnpm run verify:capabilities$/m, 'CI does not run verify:capabilities');
  assertBuildsFresh();
  if (mode === 'behavior') {
    judge(observe(), readContract(contractPath));
  } else if (mode === 'ownership') {
    ownership(readContract(contractPath));
  } else if (mode === 'changes') {
    changes(contractPath);
  } else {
    throw new Unresolved(`unknown mode: ${mode}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error instanceof assert.AssertionError ? 1 : 2;
}
