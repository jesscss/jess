import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Exact-match vite aliases that resolve every workspace package export — the
 * bare name and each subpath — to the source module its `lib` file is built
 * from. Used by `vitest.config.ts`, `vitest.sweep.config.ts` and the parseman
 * diagnostics loader, so tests and diagnostics run current source with no lib
 * rebuild and no stale-lib phantom results.
 *
 * Aliases, not a `"source"` export condition: that condition leaks to every
 * resolver, including non-TS-aware loaders (the `styles-config` config loader,
 * native `require`), which then choke on core's `.js` import specifiers. An
 * alias is vite-scoped, so those loaders keep resolving to built `lib`.
 *
 * Every export is derived from the package's `exports` map, not listed: a
 * subpath left on node resolution lands on built `lib` while the bare name
 * lands on `src` — a HALF-source graph, in which a source-side consumer runs a
 * stale lib module (and its lib copy of `@jesscss/core`, so `instanceof` across
 * the boundary is false). An export whose target is not `./lib/<file>.js`, or
 * whose `src/<file>.ts` does not exist, THROWS rather than falling back to lib.
 * The parsers' `grammar/interpreter/*` exports are the one twinless kind (the
 * interpreter build of `src/grammar/<variant>.ts`), so they stay on lib.
 *
 * Two loads no alias reaches, so they still read built `lib`:
 * - `parseman.vite()` fuses a grammar's `@jesscss/parser-shared` pieces from
 *   parser-shared's COMPILED output (its own resolver), so a parser-shared
 *   source change reaches the grammars only after that package is built.
 * - A plugin's provided modules (`#less`, `sass:*`) load through the plugin's
 *   own `require` (`ProvidedModules`).
 *
 * The scan RECURSES into grouping directories (`packages/syntax/less/…`): a
 * grouping directory has no `package.json`, so "descend until a package is
 * found" needs no hard-coded depth or list of group names. When the scan was
 * one level deep, the regrouped parsers silently stopped being aliased.
 *
 * @param {string} root repository root
 * @returns {{ find: RegExp, replacement: string }[]}
 */
export function workspaceSrcAliases(root) {
  /** @param {string} specifier @param {string} replacement */
  const exact = (specifier, replacement) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    replacement
  });

  /*
   * Kept on the css grammar module itself: `src/grammar/base.ts` is only the
   * re-export shell that gives the compose base its own lib entry. It comes
   * first because the first matching alias wins.
   */
  const alias = [
    exact('@jesscss/css-parser/grammar/base', resolve(root, 'packages/syntax/css/css-parser/src/grammar.ts'))
  ];

  /** @param {string} dir @param {number} depth */
  const visit = (dir, depth) => {
    // Cycle guard only, well above today's deepest package (depth 3).
    if (depth > 6) {
      return;
    }
    const pj = resolve(dir, 'package.json');
    if (existsSync(pj)) {
      /** @type {{ name?: string, exports?: Record<string, string | { import?: unknown }> }} */
      const pkg = JSON.parse(readFileSync(pj, 'utf8'));
      const name = pkg.name;
      if (!name) {
        return;
      }
      for (const [key, target] of Object.entries(pkg.exports ?? {})) {
        if (key.endsWith('.json')) {
          continue;
        }
        const entry = typeof target === 'string' ? target : target.import;
        const file = typeof entry === 'string' ? /^\.\/lib\/(.+)\.js$/.exec(entry)?.[1] : undefined;
        if (file === undefined) {
          throw new Error(
            `workspace-src-aliases: ${name}${key.slice(1)} has no "./lib/<file>.js" import target. `
            + 'Teach this scan the new export shape, or tests silently resolve it to built lib.'
          );
        }
        if (file.startsWith('grammar/interpreter/')) {
          continue;
        }
        const source = resolve(dir, 'src', `${file}.ts`);
        if (!existsSync(source)) {
          throw new Error(
            `workspace-src-aliases: ${name}${key.slice(1)} exports lib/${file}.js but ${source} does not exist. `
            + 'Point the export at its source module, or tests silently resolve it to built lib.'
          );
        }
        alias.push(exact(`${name}${key.slice(1)}`, source));
      }
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        visit(resolve(dir, entry.name), depth + 1);
      }
    }
  };

  visit(resolve(root, 'packages'), 0);
  return alias;
}
