/**
 * In-run comparators for the perf drift gate.
 *
 * WHY A COMPARATOR AT ALL
 * -----------------------
 * The gate enforces a RATIO — jess time divided by a reference parser measured
 * in the same process, on the same corpus, in the same round. Absolute
 * milliseconds are not portable: they encode the machine, its thermal state and
 * the node version, so a committed absolute floor produces false alarms on any
 * box that is not the one it was recorded on. A ratio cancels all of that, which
 * is what makes ONE committed baseline valid on a laptop and in CI.
 *
 * It is also the same axis as the standing project goal (Less alpha reaching
 * lessc 4.x parse performance), so the gate's number and the roadmap's number
 * are the same number.
 *
 * NO STRUCTURE ADJUSTMENT. EVER.
 * ------------------------------
 * PostCSS parses materially less structure than jess does. Per owner decision
 * (2026-07-30) the goal is to beat it anyway, and the comparison is deliberately
 * un-handicapped: do not add a structure-adjusted score, a normalisation, or a
 * per-node correction. Describe the structural difference in `caveat` so the
 * number is interpretable; never adjust the number by it.
 *
 * SEAM: this registry is consumed by `measure.mjs`. The PostCSS bar (exact
 * entry point, options and corpus) is owned by the comparator-bar work; the
 * shape below is the interface that work plugs into. Each entry must expose:
 *
 *   id        stable string used in baseline keys and trailers
 *   dialect   which gated corpus it is the reference for
 *   pkg       node package that must resolve for it to be usable
 *   load()    async, returns `(source: string) => unknown`
 *   caveat    honest description of what it does NOT do relative to jess
 *
 * `load()` must return a synchronous parse function. A comparator whose only
 * API is async cannot be timed in the same paired round as jess without the
 * event loop contaminating the pairing, and must be rejected rather than
 * approximated.
 */

export const COMPARATORS = {
  postcss: {
    id: 'postcss',
    dialect: 'css',
    pkg: 'postcss',
    caveat:
      'PostCSS parses declaration values and selectors as opaque strings; jess builds '
      + 'structured value and selector nodes. The gap is real work jess does and PostCSS '
      + 'does not, and is deliberately NOT adjusted for.',
    async load() {
      const { default: postcss } = await import('postcss');
      const parse = postcss.parse ?? (await import('postcss')).parse;
      return source => parse(source, { from: undefined });
    }
  },

  lessc: {
    id: 'lessc-4.x',
    dialect: 'less',
    pkg: 'less',
    caveat:
      'lessc parses to its own tree without jess trivia/provenance capture. Parse-only: '
      + 'no eval, no render.',
    async load() {
      const { default: less } = await import('less');
      if (typeof less.parse !== 'function') {
        throw new Error('less.parse unavailable');
      }

      /*
       * less.parse is callback-based but resolves synchronously for sources
       * with no @import, which the gate's corpora satisfy. "Usually
       * synchronous" is not a timing contract, so assert it every call: a
       * deferred callback would leave the event loop inside the timed region
       * and silently corrupt the pairing.
       */
      return (source) => {
        let settled = false;
        let failure = null;
        let tree = null;
        less.parse(source, { filename: 'gate.less' }, (error, root) => {
          settled = true;
          failure = error;
          tree = root;
        });
        if (!settled) {
          throw new Error('lessc comparator did not resolve synchronously; cannot be paired-timed');
        }
        if (failure) {
          throw failure;
        }
        return tree;
      };
    }
  },

  dartSass: {
    id: 'dart-sass',
    dialect: 'scss',
    pkg: 'sass',
    caveat:
      'dart-sass exposes no parse-only entry point; the closest synchronous API also '
      + 'evaluates. This comparator therefore measures MORE than jess parse does and its '
      + 'ratio is not comparable to the css/less ratios. Interpret per-case, never pooled.',
    async load() {
      const sass = await import('sass');
      const compile = sass.compileString ?? sass.default?.compileString;
      if (typeof compile !== 'function') {
        throw new Error('sass.compileString unavailable');
      }
      return source => compile(source, { silenceDeprecations: ['import'] });
    }
  }
};

/**
 * Probe a comparator without loading it. A missing comparator must degrade the
 * gate to UNRESOLVED, never to a pass and never to a failure: "the reference
 * parser is not installed" says nothing whatsoever about jess's performance.
 */
export async function probe(name) {
  const entry = COMPARATORS[name];
  if (!entry) {
    return { ok: false, reason: `unknown comparator '${name}'` };
  }
  let resolved;
  let version;
  try {
    resolved = import.meta.resolve(entry.pkg);
  } catch {
    return { ok: false, entry, reason: `comparator package '${entry.pkg}' does not resolve` };
  }
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    version = require(`${entry.pkg}/package.json`).version;
  } catch {
    version = 'unknown';
  }
  return { ok: true, entry, resolved, version };
}
