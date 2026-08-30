/**
 * The corpus the CSS render differential measures.
 *
 * ## Why this is not just "some CSS files"
 *
 * A differential that reports "nothing moved" because it never exercised the
 * construct under change is worse than no differential at all: it is a green
 * light with no measurement behind it. That failure is on the record here — at
 * `bb0b243f9`, removing `IdentBlock` from CSS's `Value` broke 7 of 10 bridge
 * fixtures while leaving BOTH Less byte-identity aggregates unmoved, because
 * neither aggregate contained the construct.
 *
 * So the corpus has two halves and they do different jobs:
 *
 *  - **`fixture`** — hand-built, one file per axis of the `calc()` precedence
 *    ladder (precedence, associativity, paren depth, nested calc, the §10
 *    function family, the sequence rung, unit mixing, every `CalcValue` arm,
 *    at-rule preludes, custom properties, sign/whitespace spellings, real-world
 *    shapes). These exist to make the instrument SENSITIVE. Breadth cannot
 *    substitute for them: a 400-file real-world corpus contains a few dozen
 *    `calc()` sites, all of the same two or three shapes.
 *  - **`repo`** and **`bootstrap`** — real stylesheets, to catch collateral
 *    movement anywhere else in the emitted-CSS surface. Breadth, not depth.
 *
 * ## Ids are stable, or the baseline is worthless
 *
 * Every id is relative and POSIX-separated. `bootstrap` deliberately does NOT
 * use its resolved path as an id: that path is a pnpm content-addressed
 * directory carrying the version and a peer-dependency hash, so the ids would
 * churn on every lockfile bump and read as a total regression. The version is
 * recorded in the report instead, where a bump is a LOUD mismatch rather than a
 * silent digest move.
 *
 * ## Nothing is skipped quietly
 *
 * A missing root, an unresolvable Bootstrap, an empty bucket — each throws.
 * A corpus that shrinks yields a smaller-but-plausible aggregate, which is
 * exactly how an instrument reports a confident wrong answer.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** `packages/syntax/css/css-parser/test/render-differential` -> repo root. */
export const REPO_ROOT = resolve(here, '../../../../../..');

const FIXTURE_DIR = join(here, 'fixtures');

/**
 * In-tree CSS, by directory. These are jess's own inputs and expected outputs,
 * so they are CSS the project has already committed to accepting and emitting.
 * Docs directories are deliberately absent: `packages/docs/**` is Docusaurus
 * site styling that nothing in the pipeline reads.
 */
const REPO_ROOTS = [
  'packages/syntax/css/css-parser/test/css',
  'packages/jess/test/files',
  'packages/jess/test/less/fixtures',
  'packages/fns/test/files',
  'packages/editor/vscode/test-fixtures'
];

/** Single in-tree files that are not worth a root of their own. */
const REPO_FILES = [
  'packages/jess/benchmark/benchmark.css',
  'packages/jess/test/less/test.css'
];

/**
 * Bootstrap's shipped CSS. Real-world, externally authored, and the source of
 * the `calc(1.375rem + 1.5vw)` shape that the calc grammar was built for.
 * Minified and RTL variants are excluded: they are the same stylesheet, so they
 * would triple the run time to re-measure constructs already covered.
 */
const BOOTSTRAP_FILES = [
  'bootstrap.css',
  'bootstrap-grid.css',
  'bootstrap-reboot.css',
  'bootstrap-utilities.css'
];

/**
 * Bootstrap is a devDependency of `packages/jess`, not of this package, so it
 * is resolved through that package's manifest. Under pnpm's strict layout there
 * is no other honest way to reach it from here, and vendoring 470 kB of
 * generated CSS into the repo to avoid one `createRequire` is a worse trade.
 */
function resolveBootstrap() {
  const req = createRequire(join(REPO_ROOT, 'packages/jess/package.json'));
  let manifestPath;
  try {
    manifestPath = req.resolve('bootstrap/package.json');
  } catch (cause) {
    throw new Error(
      'css render differential: cannot resolve `bootstrap` through packages/jess. '
      + 'Run `pnpm install` at the repo root. The bucket is NOT optional — dropping it '
      + 'would silently shrink the corpus and still print a verdict.',
      { cause }
    );
  }
  const root = dirname(manifestPath);
  const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
  return { dir: join(root, 'dist/css'), version };
}

const idOf = (base, full) => relative(base, full).split(sep).join('/');

function walkCss(dir, base, out) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkCss(full, base, out);
    } else if (name.toLowerCase().endsWith('.css')) {
      out.push({ id: idOf(base, full), path: full });
    }
  }
}

/**
 * @returns {{
 *   entries: Array<{ id: string, bucket: 'fixture' | 'repo' | 'bootstrap', path: string }>,
 *   buckets: Record<string, number>,
 *   bootstrapVersion: string
 * }}
 */
export function buildCorpus() {
  /** @type {Array<{ id: string, bucket: 'fixture' | 'repo' | 'bootstrap', path: string }>} */
  const entries = [];

  if (!existsSync(FIXTURE_DIR)) {
    throw new Error(`css render differential: fixtures missing at ${FIXTURE_DIR}`);
  }
  const fixtures = [];
  walkCss(FIXTURE_DIR, FIXTURE_DIR, fixtures);
  for (const f of fixtures) {
    entries.push({ id: `fixture/${f.id}`, bucket: 'fixture', path: f.path });
  }

  for (const root of REPO_ROOTS) {
    const dir = join(REPO_ROOT, root);
    if (!existsSync(dir)) {
      throw new Error(
        `css render differential: declared corpus root ${root} does not exist. `
        + 'Fix the path or delete the entry — a skipped root is a silently smaller corpus.'
      );
    }
    const found = [];
    walkCss(dir, REPO_ROOT, found);
    if (found.length === 0) {
      throw new Error(`css render differential: corpus root ${root} contributed no .css files`);
    }
    for (const f of found) {
      entries.push({ id: `repo/${f.id}`, bucket: 'repo', path: f.path });
    }
  }

  for (const file of REPO_FILES) {
    const full = join(REPO_ROOT, file);
    if (!existsSync(full)) {
      throw new Error(`css render differential: declared corpus file ${file} does not exist`);
    }
    entries.push({ id: `repo/${file}`, bucket: 'repo', path: full });
  }

  const bootstrap = resolveBootstrap();
  for (const name of BOOTSTRAP_FILES) {
    const full = join(bootstrap.dir, name);
    if (!existsSync(full)) {
      throw new Error(`css render differential: bootstrap ${name} missing at ${full}`);
    }
    entries.push({ id: `bootstrap/${name}`, bucket: 'bootstrap', path: full });
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`css render differential: duplicate corpus id ${entry.id}`);
    }
    seen.add(entry.id);
  }

  /** @type {Record<string, number>} */
  const buckets = {};
  for (const entry of entries) {
    buckets[entry.bucket] = (buckets[entry.bucket] ?? 0) + 1;
  }

  return { entries, buckets, bootstrapVersion: bootstrap.version };
}

/** Read one entry's source. Lazy: the digest only ever needs one at a time. */
export function readEntry(entry) {
  return readFileSync(entry.path, 'utf8');
}
