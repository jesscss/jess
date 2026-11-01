/**
 * Every parser ships each grammar twice: macro-lowered tables under
 * `lib/grammar/<variant>` and plain interpreter twins under
 * `lib/grammar/interpreter/<variant>`. A dialect composes onto css's compose
 * base from the matching build, so the two graphs must stay apart. A compiled
 * dialect reaches no css grammar module at runtime: its build reads css's
 * compose base from css-parser's `lib/grammar/base.js.parseman.json`,
 * beside the artifact, and the lowered dialect carries no import of it.
 *
 * Walks the modules Node actually loads for each built entry. Needs a build.
 */
import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { test } from 'node:test';
import { eagerGraph } from '../../tools/import-graph/measure.mjs';

const ROOT = join(import.meta.dirname, '../..');

/* Resolution happens from this package because it depends on every parser. */
const FROM = join(ROOT, 'packages/jess');

const VARIANTS = ['ast', 'ast/positions', 'cst', 'cst/positions'];
const DIALECTS = ['css', 'less', 'scss', 'jess'];

const graph = specifier => eagerGraph(specifier, FROM).files
  .map(file => file.slice(ROOT.length + 1).split('\\').join('/'));

const isInterpreterModule = file => file.includes('/lib/grammar/interpreter/');
const isCompiledModule = file => file.includes('/parseman/dist/table/')
  || file.startsWith('packages/parser-shared/lib/')
  || (/\/lib\/grammar\//.test(file) && !isInterpreterModule(file));

for (const dialect of DIALECTS) {
  const compiled = VARIANTS.map(variant => `@jesscss/${dialect}-parser/grammar/${variant}`);
  const interpreter = VARIANTS.map(variant => `@jesscss/${dialect}-parser/grammar/interpreter/${variant}`);
  if (dialect === 'css') {
    compiled.push('@jesscss/css-parser/grammar/base');
    interpreter.push('@jesscss/css-parser/grammar/interpreter/base');
  } else {
    compiled.push(
      `@jesscss/${dialect}-parser`,
      `@jesscss/${dialect}-parser/positions`,
      `@jesscss/${dialect}-parser/cst`,
      `@jesscss/${dialect}-parser/cst/positions`
    );
  }

  for (const specifier of compiled) {
    test(`${specifier} stays in the compiled graph`, () => {
      const files = graph(specifier);
      assert.deepEqual(files.filter(isInterpreterModule), [], 'reaches an interpreter module');
      if (dialect !== 'css') {
        const cssGrammar = files.filter(file => file.startsWith('packages/syntax/css/css-parser/lib/grammar/'));
        assert.deepEqual(cssGrammar, [], 'must not load a css grammar at runtime');
      }
    });
  }

  for (const specifier of interpreter) {
    test(`${specifier} stays in the interpreter graph`, () => {
      assert.deepEqual(graph(specifier).filter(isCompiledModule), [], 'reaches a macro-lowered module');
    });
  }
}
