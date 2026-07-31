/**
 * The tournament corpus.
 *
 * REUSED, NOT REINVENTED. The directory walk, the relative-id rule, the
 * realpath de-duplication and the missing-root reporting all come from
 * `packages/syntax/less/less-parser/test/identity-oracle/corpus.mjs`, which
 * already got two subtle things right that are easy to lose:
 *
 *   - ids are RELATIVE to the repo root, so two worktrees can agree;
 *   - a missing root is REPORTED, never silently dropped, because a corpus
 *     that quietly shrank yields a smaller and greener gate.
 *
 * This module contributes the css-specific ROOTS and the well-formed/malformed
 * split. It deliberately does not re-implement the walk.
 */
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCorpus } from '../../../packages/syntax/less/less-parser/test/identity-oracle/corpus.mjs';

/**
 * Every css input the repo has, grouped by provenance.
 *
 * `errors` is called out separately because malformed input is where a
 * loose-vs-tight rewrite diverges and where the corpus is thinnest — the
 * scoreboard reports its size on its own so that a candidate cannot pass by
 * being good only at well-formed css.
 */
export const CSS_ROOTS = Object.freeze([
  // In-repo hand-written vectors. `test/css/errors` is INCLUDED here even
  // though the parse-bench cases exclude it (`find -maxdepth 1`): malformed
  // input is the thinnest and most discriminating part of the corpus.
  'packages/syntax/css/css-parser/test/css',
  'packages/syntax/less/less-parser/test',
  'packages/syntax/scss/scss-parser/test',
  'packages/syntax/jess/jess-parser/test',
  'packages/jess/test',
  'packages/fns/test/files',
  'packages/editor/vscode/test-fixtures',
  'packages/core/src/ast/__tests__',
  'packages/editor/language-service/test',

  // Real-world css at size. `benchmark.css` is 123 KB and is the fixture the
  // PostCSS bar uses.
  'packages/jess/benchmark',

  // Hand-written site css — small, but genuinely authored rather than
  // generated, which is a different distribution from the rest.
  'packages/docs/docs-jess/src',
  'packages/docs/docs-less/src',
  'docs/architecture',

  /*
   * Bootstrap 5.3.8 dist, 16 files. Taken from node_modules rather than the
   * `/tmp/postcss-benchmark/cache/bootstrap.css` the PostCSS bar pins,
   * because /tmp does not survive a reboot and a corpus root that vanishes
   * silently shrinks the gate. This one is pinned by the lockfile.
   */
  'node_modules/.pnpm/bootstrap@5.3.8_@popperjs+core@2.11.8/node_modules/bootstrap/dist/css',

  /*
   * The all-less corpus's CSS subset: 207 files / ~1.17 MB, the single
   * largest body of css here. NOT pinned by this repo — it is a `link:` to a
   * sibling less.js checkout — so its SHA is reported on every board.
   */
  'node_modules/@less/test-data/data',
  'node_modules/@less/test-data/tests-unit',
  'node_modules/@less/test-data/tests-config',
  'node_modules/@less/test-data/tests-error'
]);

/** Roots whose entries are EXPECTED to be malformed. Used for the split only. */
const ERROR_MARKERS = ['/errors/', '/tests-error/', '-error', 'invalid'];

export function isMalformed(id) {
  return ERROR_MARKERS.some(m => id.includes(m));
}

/**
 * Load the css corpus.
 *
 * Only `.css` is admitted. `.less`/`.scss` inputs are NOT css and a css
 * grammar is entitled to reject them; including them would make the gate hash
 * error messages instead of trees for a third of the corpus.
 */
export function loadCssCorpus(repo, { maxBytes = 4_000_000 } = {}) {
  const present = CSS_ROOTS.filter(r => {
    try {
      return statSync(resolve(repo, r)).isDirectory();
    } catch {
      return false;
    }
  });

  const corpus = loadCorpus({
    base: repo,
    roots: present,
    extensions: ['.css'],
    maxBytes,
    allowMissingRoots: true
  });

  const missing = CSS_ROOTS.filter(r => !present.includes(r));
  return { ...corpus, declaredMissing: missing };
}
