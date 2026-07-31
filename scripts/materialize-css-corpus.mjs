/**
 * Materialize the external CSS parse corpus into one flat manifest.
 *
 * Why this exists: jess's hand-written CSS fixtures encode whatever the last
 * fixture author happened to think of. A grammar that rejected EVERY percentage
 * keyframe selector passed the whole suite, because the suite had four
 * `@keyframes` *error* fixtures and not one accepting case. A corpus sourced
 * from outside the repo cannot have that blind spot, because nobody here chose
 * its contents.
 *
 * The corpus is PARSE-ONLY. Every entry is a complete stylesheet plus a verdict
 * of `accept` or `reject`. Foreign ASTs are never translated — jess's own
 * byte-identity oracle owns tree shape. Upstream trees are used, at most, as
 * evidence that the upstream parser reached a verdict at all.
 *
 * Output (gitignored):
 *   .cache/css-corpus/manifest.json
 *
 * Sources are pinned by the lockfile (dev dependencies) or vendored with their
 * licence; see `test/css-corpus/README.md`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.cache', 'css-corpus');

/**
 * Every source declares the number of entries it is expected to yield.
 *
 * This is the whole point of the file. The `@less/test-data` symlink is
 * location-relative and silently resolves to a SHORTER corpus under a git
 * worktree — one measurement run this week reported a verdict over 196 of 714
 * entries and looked completely normal doing it. A corpus that can shrink
 * without saying so is not an instrument. If a source moves, is not installed,
 * or upstream changes its case count, this file fails loudly and the numbers
 * are never printed.
 *
 * Bump a count here ONLY together with the dependency range that changed it.
 */
export const EXPECTED_ENTRIES = {
  csstree: 816,
  wpt: 17421,
  'real-world': 8
};

function fail(message) {
  throw new Error(`[css-corpus] ${message}`);
}

function resolveDependencyDir(pkg) {
  try {
    return path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    return fs.existsSync(path.join(root, 'node_modules', pkg))
      ? path.join(root, 'node_modules', pkg)
      : undefined;
  }
}

/* ------------------------------------------------------------------ csstree */

/**
 * csstree's `fixtures/ast` cases are organised by the grammar production they
 * were written against, so most of them are FRAGMENTS. A fragment is wrapped
 * into the smallest complete stylesheet that puts it back in its own context.
 *
 * Wrapping is not a translation of csstree's expectations — it is the inverse
 * of the `startRule` csstree would have used. A `value` case parsed as a
 * declaration value is the same recognition question either way.
 */
const CSSTREE_WRAP = {
  stylesheet: source => source,
  rule: source => source,
  atrule: source => source,
  block: source => `a${source}`,
  declaration: source => `a{${source}}`,
  declarationList: source => `a{${source}}`,
  selector: source => `${source}{color:red}`,
  selectorList: source => `${source}{color:red}`,
  mediaQuery: source => `@media ${source}{a{color:red}}`,
  value: source => `a{color:${source}}`
};

/**
 * `atrulePrelude` has no single enclosing at-rule — the same prelude text is
 * valid after `@media` and meaningless after `@font-face`, so there is no
 * wrapper that preserves the case's meaning. Two cases; dropped rather than
 * guessed at.
 */
const CSSTREE_SKIP_CONTEXTS = new Set(['atrulePrelude']);

function walkJson(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkJson(full));
    } else if (entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Cases nest in named groups, and the same leaf name recurs under different
 * groups (`"basic"` appears in several). The id therefore carries the whole
 * group path — a bare leaf name collides, and a colliding id silently drops
 * entries from any map keyed on it.
 */
function collectCsstreeCases(node, into, prefix = '') {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value === null || typeof value !== 'object') {
      continue;
    }
    const name = prefix === '' ? key : `${prefix}/${key}`;
    if ('source' in value || 'error' in value || '_error' in value) {
      into.push([name, value]);
    } else {
      collectCsstreeCases(value, into, name);
    }
  }
}

function loadCsstree() {
  const dir = resolveDependencyDir('css-tree');
  if (dir === undefined) {
    fail('css-tree is not installed. Run `pnpm install` at the workspace root.');
  }
  const fixtures = path.join(dir, 'fixtures', 'ast');
  if (!fs.existsSync(fixtures)) {
    fail(
      `css-tree is installed but carries no fixtures at ${fixtures}. The registry `
      + 'tarball ships `lib` only — the dependency must resolve to the GitHub '
      + 'source (`github:csstree/csstree#v3.2.1`).'
    );
  }

  const entries = [];
  const skipped = { context: 0, tolerant: 0 };

  for (const file of walkJson(fixtures)) {
    const relative = path.relative(fixtures, file).split(path.sep).join('/');
    const context = relative.split('/')[0];

    if (CSSTREE_SKIP_CONTEXTS.has(context)) {
      const cases = [];
      collectCsstreeCases(JSON.parse(fs.readFileSync(file, 'utf8')), cases);
      skipped.context += cases.length;
      continue;
    }

    const wrap = CSSTREE_WRAP[context];
    if (wrap === undefined) {
      fail(`csstree fixture context "${context}" (${relative}) has no stylesheet wrapper.`);
    }

    /*
     * `tolerant.json` is csstree's error-RECOVERY suite: `boom! {color:red}`
     * does not throw, it parses the prelude into a `Raw` node. csstree not
     * throwing is therefore not a claim that the input is valid CSS, and
     * reading it as one would pin jess to csstree's recovery policy. Recorded
     * as `tolerant` and excluded from both oracles.
     */
    const isTolerant = /(^|\/)tolerant\.json$/.test(relative);

    const cases = [];
    collectCsstreeCases(JSON.parse(fs.readFileSync(file, 'utf8')), cases);

    for (const [name, testCase] of cases) {
      if (isTolerant) {
        skipped.tolerant++;
        continue;
      }
      const rejects = 'error' in testCase || '_error' in testCase;

      /*
       * Recovery is NOT confined to `tolerant.json`. 90 of csstree's 694
       * non-tolerant accepting cases carry a `Raw` node in their expected AST —
       * `a{foo: boom!;}`, `a{ foo }`, `@media (foo:1`, `a{color:foo( 123` —
       * which is csstree recording that it swallowed unparseable bytes, not
       * that the input is well-formed CSS. Importing those as `accept` would
       * make jess's recognition gap look 90 entries worse than it is AND would
       * pressure the grammar toward recovering the same way. The expected AST
       * is used here purely as evidence of the upstream VERDICT; no tree shape
       * crosses over.
       */
      if (!rejects && JSON.stringify(testCase.ast ?? {}).includes('"Raw"')) {
        skipped.recovered = (skipped.recovered ?? 0) + 1;
        continue;
      }
      const source = testCase.source;
      if (typeof source !== 'string') {
        /* csstree records a handful of reject cases by expectation only. */
        continue;
      }
      entries.push({
        id: `csstree:${relative}:${name}`,
        source: wrap(source),
        raw: source,
        expect: rejects ? 'reject' : 'accept',
        context,
        source_name: 'csstree',
        origin: `csstree:fixtures/ast/${relative}#${name}`
      });
    }
  }

  return { entries, skipped };
}

/*
 * postcss-parser-tests is deliberately NOT a source here. It was evaluated and
 * turns out to be already adopted: 24 of its 30 cases sit verbatim in
 * `packages/syntax/css/css-parser/test/css/`, which is where jess's CSS fixture
 * set came from — and why it is thin. postcss is also a TOLERANT parser, so
 * "postcss did not throw" is not an accept verdict; jess deliberately files
 * three of those same cases under `test/css/errors/`. Importing it would add
 * ~6 new inputs and 3 conflicting expectations. See test/css-corpus/README.md.
 */

/* -------------------------------------------------------- WPT (vendored JSON) */

function loadWpt() {
  const file = path.join(root, 'test', 'css-corpus', 'wpt-accept.json');
  if (!fs.existsSync(file)) {
    fail(`vendored WPT vectors missing at ${file}`);
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = doc.vectors.map(vector => ({
    id: `wpt:${vector.id}`,
    source: vector.source,
    expect: 'accept',
    context: vector.kind,
    source_name: 'wpt',
    origin: vector.origin
  }));
  return { entries, skipped: {}, provenance: { commit: doc.commit, license: doc.license } };
}

/* ------------------------------------------------------- real-world stylesheets */

/**
 * Breadth and adversarial size. A hand-written fixture is, by construction, as
 * long as somebody felt like typing; bootstrap's dist bundle is 280 KB of CSS
 * that real sites ship. These are `accept` by definition — they are published,
 * browser-consumed stylesheets.
 */
const REAL_WORLD = [
  ['normalize.css', 'normalize.css/normalize.css'],
  ['bootstrap', 'bootstrap/dist/css/bootstrap.css'],
  ['bootstrap-min', 'bootstrap/dist/css/bootstrap.min.css'],
  ['bootstrap-rtl', 'bootstrap/dist/css/bootstrap.rtl.css'],
  ['bootstrap-grid', 'bootstrap/dist/css/bootstrap-grid.css'],
  ['bootstrap-reboot', 'bootstrap/dist/css/bootstrap-reboot.css'],
  ['bootstrap-utilities', 'bootstrap/dist/css/bootstrap-utilities.css'],
  ['bootstrap-utilities-rtl', 'bootstrap/dist/css/bootstrap-utilities.rtl.css']
];

function loadRealWorld() {
  const entries = [];
  for (const [name, relative] of REAL_WORLD) {
    const [pkg, ...rest] = relative.split('/');
    const dir = resolveDependencyDir(pkg);
    if (dir === undefined) {
      fail(`${pkg} is not installed. Run \`pnpm install\` at the workspace root.`);
    }
    const file = path.join(dir, ...rest);
    if (!fs.existsSync(file)) {
      fail(`real-world stylesheet missing at ${file}`);
    }
    entries.push({
      id: `real-world:${name}`,
      source: fs.readFileSync(file, 'utf8'),
      expect: 'accept',
      context: 'stylesheet',
      source_name: 'real-world',
      origin: `npm:${relative}`
    });
  }
  return { entries, skipped: {} };
}

/* ------------------------------------------------------------------- assembly */

export function buildManifest() {
  const loaders = {
    csstree: loadCsstree,
    wpt: loadWpt,
    'real-world': loadRealWorld
  };

  const entries = [];
  const sources = {};
  for (const [name, load] of Object.entries(loaders)) {
    const result = load();
    const expected = EXPECTED_ENTRIES[name];
    if (result.entries.length !== expected) {
      fail(
        `source "${name}" yielded ${result.entries.length} entries, expected ${expected}. `
        + 'Either the dependency is not the pinned version, or it resolved to a '
        + 'different checkout. Refusing to build a corpus of unknown size — fix the '
        + 'resolution or update EXPECTED_ENTRIES together with the dependency range.'
      );
    }
    sources[name] = {
      entries: result.entries.length,
      skipped: result.skipped,
      ...(result.provenance ?? {})
    };
    entries.push(...result.entries);
  }

  const ids = new Set(entries.map(entry => entry.id));
  if (ids.size !== entries.length) {
    fail(`corpus ids are not unique: ${entries.length} entries, ${ids.size} distinct ids`);
  }

  return {
    total: entries.length,
    accept: entries.filter(entry => entry.expect === 'accept').length,
    reject: entries.filter(entry => entry.expect === 'reject').length,
    sources,
    entries
  };
}

function main() {
  const manifest = buildManifest();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));

  /*
   * A check that prints nothing when it passes cannot be told apart from one
   * that never ran. Always print the counts.
   */
  console.log(`[css-corpus] manifest written: ${manifest.total} entries (${manifest.accept} accept, ${manifest.reject} reject)`);
  for (const [name, info] of Object.entries(manifest.sources)) {
    console.log(`[css-corpus]   ${name}: ${info.entries}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
