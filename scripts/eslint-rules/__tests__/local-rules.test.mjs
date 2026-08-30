import test from 'node:test';
import Module, { createRequire } from 'node:module';

/*
 * The workspace pins a pre-release `typescript` and remaps it to
 * `@typescript/typescript6` (see eslint.config.mjs). @typescript-eslint's parser
 * resolves `typescript`, so apply the same remap here before importing it.
 */
const require = createRequire(import.meta.url);
const typescript6ApiPath = require.resolve('@typescript/typescript6');
const typescript6Api = require('@typescript/typescript6');
typescript6Api.Extension ??= {
  Cjs: '.cjs', Cts: '.cts', Js: '.js', Jsx: '.jsx',
  Mjs: '.mjs', Mts: '.mts', Ts: '.ts', Tsx: '.tsx'
};
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'typescript') {
    return typescript6ApiPath;
  }
  if (request.startsWith('typescript/lib/')) {
    return require.resolve(`@typescript/typescript6/${request.slice('typescript/'.length)}`);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { RuleTester } = await import('eslint');
const { default: tsParser } = await import('@typescript-eslint/parser');
const { rules } = await import('../index.mjs');

// Plain-JS RuleTester (default espree parser).
const jsTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' }
});

// TS RuleTester for rules that inspect TS-only nodes (TSPropertySignature).
const tsTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2023, sourceType: 'module' }
});

/*
 * RuleTester throws on the first failing case; wrapping each in node:test gives
 * per-rule fires-on-bad / silent-on-good reporting.
 */

// --- Rule 1: no-serialize-rederivation (V8-ARCH #2) ---------------------------
test('no-serialize-rederivation: FIRES on byte re-derivation, SILENT on legit', () => {
  jsTester.run('no-serialize-rederivation', rules['no-serialize-rederivation'], {
    valid: [
      // Reads structure off the node, not off emitted bytes.
      { code: 'function f(c){ return c.head.name; }' },

      // Serialized value returned/used verbatim — not scanned.
      { code: 'function f(v){ return serializeValue(v); }' },
      { code: 'function f(v){ const s = serializeValue(v); return s.length; }' },

      // Scan on a NON-serialized value is fine.
      { code: 'function f(raw){ return raw.split(","); }' },

      // Taint does not cross a function boundary (same-function limitation).
      { code: 'function f(v){ const s = serializeValue(v); return g(s); } function g(s){ return s.split(","); }' }
    ],
    invalid: [
      // Direct: incident shape — split a canonical string back into parts.
      {
        code: 'function f(c){ return complexCanonical(c).split(" "); }',
        errors: [{ messageId: 'rederive' }]
      },

      // Via same-function local var.
      {
        code: 'function f(v){ const s = serializeValue(v); return s.match(/-?\\d+/); }',
        errors: [{ messageId: 'rederive' }]
      },

      // RegExp.test over a serialized value.
      {
        code: 'function f(v, re){ return re.test(serializeValue(v)); }',
        errors: [{ messageId: 'rederive' }]
      },

      // Char-by-char iteration over emitted bytes.
      {
        code: 'function f(c){ const s = compoundCanonical(c); return s[0]; }',
        errors: [{ messageId: 'rederive' }]
      }
    ]
  });
});

// --- Rule 2: no-full-tree-walk-hot-path (V8-ARCH #3) --------------------------
test('no-full-tree-walk-hot-path: FIRES on recursive child-walk, SILENT on legit', () => {
  jsTester.run('no-full-tree-walk-hot-path', rules['no-full-tree-walk-hot-path'], {
    valid: [
      // Non-recursive: reads one field.
      { code: 'function render(node){ return node.value; }' },

      // Recursive but NOT over a child collection (bounded pointer chase).
      { code: 'function up(node){ return node.parent ? up(node.parent) : node; }' },

      // Iterates a child collection but does not recurse into it.
      { code: 'function count(node){ let n = 0; for (const r of node.rules) { n++; } return n; }' }
    ],
    invalid: [
      // for-of over `.rules` with a self-call = full-subtree descent.
      {
        code: 'function walk(node){ for (const r of node.rules) { walk(r); } }',
        errors: [{ messageId: 'walk' }]
      },

      // `.children.forEach` self-recursion.
      {
        code: 'function visit(node){ node.children.forEach((c) => visit(c)); }',
        errors: [{ messageId: 'walk' }]
      }
    ]
  });
});

// --- Rule 3: no-oversized-choice (V8-ARCH #6) --------------------------------
test('no-oversized-choice: FIRES on oversized/duplicated, SILENT on small/unique', () => {
  const arms = (n, prefix = 'a') => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(', ');
  jsTester.run('no-oversized-choice', rules['no-oversized-choice'], {
    valid: [
      // Small choice — under the arm limit and unique.
      { code: `const x = choice(${arms(4)});`, options: [{ maxArms: 15, dupMinArms: 5 }] },

      // Not `choice` at all.
      { code: `const x = sequence(${arms(20)});`, options: [{ maxArms: 15 }] }
    ],
    invalid: [
      // > N arms.
      {
        code: `const x = choice(${arms(16)});`,
        options: [{ maxArms: 15, dupMinArms: 5 }],
        errors: [{ messageId: 'oversized' }]
      },

      // Two identical large choice literals in one file → the second is flagged.
      {
        code: `const a = choice(${arms(6)});\nconst b = choice(${arms(6)});`,
        options: [{ maxArms: 15, dupMinArms: 5 }],
        errors: [{ messageId: 'duplicated' }]
      }
    ]
  });
});

// --- Rule 4: no-deprecated-detached-ruleset ----------------------------------
test('no-deprecated-detached-ruleset: FIRES on new node-type use, SILENT on legit', () => {
  tsTester.run('no-deprecated-detached-ruleset', rules['no-deprecated-detached-ruleset'], {
    valid: [
      // A different node type.
      { code: 'const n = { type: \'Ruleset\', rules: [] };' },

      // The identifier as a grammar production name (CST rule) — not a type tag.
      { code: 'const DetachedRuleset = node(sequence(a, b));' },

      // Using the string in a non-`type` context (e.g. a comment-like label).
      { code: 'const label = \'DetachedRuleset\';' }
    ],
    invalid: [
      // New AST node object with the deprecated type tag.
      {
        code: 'const n = { type: \'DetachedRuleset\', rules: [] };',
        errors: [{ messageId: 'deprecated' }]
      },

      // Pattern-matching on the deprecated type.
      {
        code: 'function f(node){ return node.type === \'DetachedRuleset\'; }',
        errors: [{ messageId: 'deprecated' }]
      },

      // TS interface property fixing the deprecated tag.
      {
        code: 'interface X { type: \'DetachedRuleset\'; }',
        errors: [{ messageId: 'deprecated' }]
      }
    ]
  });
});
