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
 *   ownership  behavior, then a probe entry is added to the OWNER's rule in
 *              each plugin and the plugins are rebuilt: every consumer's value
 *              must now carry the probe. A local copy (or a copy beside an
 *              unused owner import) keeps its own map and fails.
 *   changes    a contract-only change (a required pair the owner does not
 *              produce) and an implementation-only change (the owner drops a
 *              required pair) must each fail behavior.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  less: { pkg: 'packages/syntax/less/jess-plugin-less', file: 'packages/syntax/less/jess-plugin-less/src/jess-functions.ts', rule: 'names: lessExportNames()' },
  sass: { pkg: 'packages/syntax/scss/jess-plugin-scss', file: 'packages/syntax/scss/jess-plugin-scss/src/jess-functions.ts', rule: 'names: sassExportNames()' }
};
const PROBE = ['cod-probe', 'codProbe'];

class Unresolved extends Error {}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    throw new Unresolved(String(result.error));
  }
  return result;
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

/** Replace the owner rule in every plugin (exactly once each), run `body`, restore. */
function withOwnerRule(rewrite, body) {
  const originals = Object.values(OWNERS).map(({ file, rule }) => {
    const source = readFileSync(join(root, file), 'utf8');
    if (source.split(rule).length !== 2) {
      throw new Unresolved(`${file}: owner rule \`${rule}\` not found exactly once; requalify the probe`);
    }
    return { file, source, rule };
  });
  try {
    for (const { file, source, rule } of originals) {
      writeFileSync(join(root, file), source.replace(rule, rewrite(rule)));
    }
    buildOwners();
    return body();
  } finally {
    for (const { file, source } of originals) {
      writeFileSync(join(root, file), source);
    }
    buildOwners();
  }
}

/** file (repo-relative) → every non-empty `functions` value its suite passed to `emitJess`. */
function observe() {
  const suites = run('git', ['ls-files', 'packages/jess/test'], root).stdout.split('\n')
    .filter(file => file.endsWith('.test.ts') && readFileSync(join(root, file), 'utf8').includes('emitJess('));
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
    assert.equal(result.status, 0, `consumer suites failed:\n${result.stdout.slice(-4000)}${result.stderr.slice(-2000)}`);
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
  const probe = rule => rule.replace(/names: (\w+)\(\)/, `names: new Map([...$1(), ${JSON.stringify(PROBE)}])`);
  const probed = withOwnerRule(probe, observe);
  const stale = Object.entries(CONSUMERS)
    .filter(([, { file }]) => !(probed.get(file) ?? []).every(value => value.names.some(([call, exported]) => call === PROBE[0] && exported === PROBE[1])))
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
    assert.throws(() => judge(observe(), contract), assert.AssertionError, 'an implementation-only change was accepted');
  });
}

try {
  const [mode, contractPath = join(here, 'capability.json')] = process.argv.slice(2);

  // The delivery path: the verify script exists and CI runs it.
  assert.equal(readContract(join(root, 'package.json')).scripts['verify:capabilities'], 'node scripts/cod.mjs verify-catalog . capabilities --allow-execution');
  assert.match(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'), /^\s+run: pnpm run verify:capabilities$/m, 'CI does not run verify:capabilities');
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
