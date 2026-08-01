/**
 * The one definition of "this grammar fell back to the interpreter".
 *
 * WHY THIS FILE EXISTS. The fallback hazard is that parseman's macro plugin,
 * when it cannot compile a declaration, does not fail: it leaves the source
 * text alone, strips `with { type: 'macro' }` off the import, and emits a build
 * warning. The artifact is then SMALLER — measured 209 B vs 2,464 B on the
 * minimal canary pair in `scripts/__tests__/parseman-fallback-detector.test.mjs`,
 * a 91.5% "win" that is a pure correctness regression. A bytes-first review
 * banks that as a result. This repo has been burned by exactly that.
 *
 * The rule used to exist in four differently-spelled copies — a prose grep in
 * GRAMMAR-SIZE-FACTS §2.7, an `_rp[N].parse(` count and a compose-warning regex
 * in check-macro-buildable.mjs, and a `DEGRADE_PATTERNS` list in
 * verify-compose-integrity.mjs — and two of the four were checking nothing (§4d).
 * It lives here now, once, and both gates import it.
 *
 * THE TWO SIGNALS, and why there are two.
 *
 *   (1) BUILD LOG — `FALLBACK_LOG_PATTERNS` / `scanBuildLog`. Primary, and the
 *       only signal that is independent of how parseman lowers a grammar. Every
 *       fallback the plugin takes is announced, and every announcement carries
 *       the same suffix, `running via the interpreter` (parseman `src/plugin/
 *       index.ts` `warn()` — verified present in the installed 0.46.0 dist).
 *       A lowering change cannot silence it without parseman deciding to stop
 *       reporting its own fallbacks.
 *
 *   (2) ARTIFACT — `artifactFallbacks`. A second, independent net, because the
 *       log is only available in build mode and CI runs the artifact scan with
 *       `--no-build` against an already-built workspace. It keys on the runtime
 *       IMPORT SHAPE, not on the mere substring `parseman`: see below.
 *
 * WHY NOT `grep -l 'from "parseman"' lib/grammar/*.js`. That was the recorded
 * detector, and on today's codegen lowering it is correct — a fully compiled
 * module has its parseman import REMOVED entirely (`imp.fullyResolved`), a
 * fallback keeps it. But it reads the presence of the module specifier as the
 * fault, and that is about to invert itself: parseman's G5 work lowers a
 * grammar to a DATA TABLE read by one shared driver, and a HEALTHY table
 * artifact therefore imports `tableRules` from `parseman/table`. Read as
 * guidance, the old detector then points backwards.
 *
 * The old detector is also already narrower than the hazard: it globs
 * `lib/grammar/`, and it had to, because widening it to all of `lib/` reds every
 * healthy build — `cst-host.js` and `chunks/parse-with.js` import `run` and
 * friends legitimately. Keying on the imported NAME instead of the file path
 * lets this scan cover every emitted module, which is where the compiled
 * grammar actually lands: css-parser emits no `lib/grammar/` directory at all.
 *
 * What is actually true of a fallback under BOTH lowerings is that the artifact
 * still CALLS parseman's macro vocabulary — `rules`, `sequence`, `choice`,
 * `literal`, ... — because the fallback IS the author's untouched combinator
 * source. A healthy codegen artifact imports nothing from parseman; a healthy
 * table artifact imports only a driver. So the invariant is:
 *
 *     a built module may import a parseman RUNTIME DRIVER; it may never import
 *     a parseman COMBINATOR.
 *
 * which is stated as an allowlist of drivers rather than a denylist of the ~40
 * combinators, so a combinator parseman adds tomorrow is caught by default.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Build-output signatures that mean a grammar degraded to the interpreter.
 *
 * The first pattern is the universal one and is what actually carries the gate:
 * parseman routes every fallback warning through a single `warn()` that appends
 * `(running via the interpreter; ...)`. The two `compose`-specific patterns
 * below it are narrower and older — `composeLeaf()`'s "isn't a build-resolvable"
 * notably does NOT carry "falling back to runtime" — and are kept because
 * parseman's own `src/compiler/degradation.ts` names jess's gate as the reason
 * those exact strings are preserved. Dropping them would release parseman from
 * a contract it is deliberately holding.
 */
export const FALLBACK_LOG_PATTERNS = [
  /running via the interpreter/i,
  /falling back to runtime/i,
  /isn't a build-resolvable/i,
  /compose:\s*rule\s+"[^"]*"\s+references missing rule/i
];

/** Lines in `text` that match a fallback signature. */
export function scanBuildLog(text) {
  const hits = [];
  for (const line of text.split('\n')) {
    if (FALLBACK_LOG_PATTERNS.some(pattern => pattern.test(line))) {
      hits.push(line.trim());
    }
  }
  return hits;
}

/**
 * Names a built artifact may legitimately import from parseman at runtime.
 *
 * These are DRIVERS — they consume a compiled artifact, they are not grammar
 * vocabulary. Every entry needs a reason, because every addition widens the
 * gate; an entry added to make a red build green is the failure mode this list
 * is shaped to make visible.
 *
 * The first five are the COMPLETE set the five parser packages import today,
 * read off the built artifacts rather than guessed:
 *
 *   run, cstBuildHost, parseDoc  — `css-parser/lib/cst-host.js:2`
 *   run, buildLineIndex, offsetToLineCol
 *                                — `<css|less|scss|jess>-parser/lib/chunks/parse-with.js`
 *
 * Every one takes an already-compiled grammar and drives it. None can express a
 * rule, which is the property that matters: a name added here can only be wrong
 * if that name is grammar vocabulary.
 *
 *   tableRules — the G5 table driver. See TABLE_DRIVER_SPECIFIER: a healthy
 *                table-lowered artifact imports this and nothing else, but that
 *                lowering is not wired into parseman's macro yet, so reaching it
 *                is itself a reportable event.
 */
export const RUNTIME_DRIVERS = new Set([
  'run',
  'cstBuildHost',
  'parseDoc',
  'buildLineIndex',
  'offsetToLineCol',
  'tableRules'
]);

/**
 * The module specifier a table-lowered artifact imports its driver from.
 *
 * parseman 0.46.0/0.47.0 do not wire this: `src/table/` is a tested prototype,
 * `package.json` `exports` has no `./table` entry, and nothing in the macro,
 * `compile()` or `compose()` reaches it. So this cannot appear in an artifact
 * today, and if it does, the lowering landed and the artifact half of this
 * detector has to be re-derived against the emitted shape before it can be
 * trusted. That is a loud failure on purpose — see `artifactFallbacks`.
 */
export const TABLE_DRIVER_SPECIFIER = 'parseman/table';

const espree = (() => {
  /*
   * espree comes from the workspace's eslint install rather than a direct
   * dependency: it is already present and already the version eslint parses
   * this repo with. Same sourcing as check-macro-buildable.mjs.
   */
  const eslintEntry = require.resolve('eslint');
  return require(require.resolve('espree', { paths: [eslintEntry] }));
})();

function isParsemanSpecifier(specifier) {
  return specifier === 'parseman' || specifier.startsWith('parseman/');
}

/**
 * Findings for one built ESM module.
 *
 * Each finding is `{ kind, line, detail }`, where `kind` is:
 *   'combinator'    — a parseman macro binding survived into the artifact. This
 *                     IS the fallback: the declaration was left as source.
 *   'table-lowering'— a `parseman/table` driver import appeared, meaning the G5
 *                     lowering landed. Not a fallback, but this detector's
 *                     artifact half has not been verified against that shape,
 *                     so it must not report a clean bill of health.
 *
 * A parse failure is itself a finding rather than a skip: a module this gate
 * cannot read is a module it cannot clear.
 */
export function artifactFallbacks(code) {
  let ast;
  try {
    ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', loc: true });
  } catch (error) {
    return [{ kind: 'unparsable', line: 0, detail: error.message }];
  }

  const findings = [];
  for (const statement of ast.body) {
    if (statement.type !== 'ImportDeclaration' || !isParsemanSpecifier(statement.source.value)) {
      continue;
    }
    const specifier = statement.source.value;
    const line = statement.loc.start.line;

    if (specifier === TABLE_DRIVER_SPECIFIER) {
      findings.push({
        kind: 'table-lowering',
        line,
        detail: `imports from '${specifier}' — parseman's table lowering has landed; `
          + 'RUNTIME_DRIVERS and this scan must be re-derived against the emitted table shape '
          + 'before this gate can clear a table artifact'
      });
      continue;
    }

    for (const imported of statement.specifiers) {
      /*
       * `import * as pm` and `import pm` defeat name-level reasoning: any
       * combinator is reachable through the namespace. Neither has a legitimate
       * use in a built grammar module, so both are findings outright.
       */
      if (imported.type !== 'ImportSpecifier') {
        findings.push({
          kind: 'combinator',
          line,
          detail: `namespace/default import from '${specifier}' — the whole macro vocabulary is reachable through it`
        });
        continue;
      }
      const name = imported.imported.name ?? imported.imported.value;
      if (RUNTIME_DRIVERS.has(name)) {
        continue;
      }
      findings.push({
        kind: 'combinator',
        line,
        detail: `imports '${name}' from '${specifier}' — a macro combinator, not a runtime driver: `
          + 'this declaration was left as source for the interpreter'
      });
    }
  }
  return findings;
}
