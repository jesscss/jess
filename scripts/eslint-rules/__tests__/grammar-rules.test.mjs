import test from 'node:test';
import Module, { createRequire } from 'node:module';

/*
 * The workspace pins a pre-release `typescript` and remaps it to
 * `@typescript/typescript6` (see eslint.config.mjs). Apply the same remap here
 * before importing anything that resolves `typescript`.
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
const { rules } = await import('../grammar-rules.mjs');

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' }
});

/*
 * This file is deliberately pure ASCII. Fixtures that need a non-ASCII code
 * point build it from its numeric value, because the rule under test exists
 * precisely BECAUSE a raw character and its escape look identical on screen --
 * a fixture typed literally could be silently normalised by an editor or a
 * tool and turn the test vacuous without anyone noticing.
 */
const BACKSLASH = String.fromCharCode(0x5C);
const RAW_FFFF = String.fromCharCode(0xFFFF);
const ESCAPED_FFFF = `${BACKSLASH}uFFFF`;

/*
 * Built rather than typed so this file cannot accidentally contain a real
 * block-comment terminator inside its own fixtures.
 */
const BLOCK_OPEN = `${String.fromCharCode(0x2F)}${String.fromCharCode(0x2A)}`;
const BLOCK_CLOSE = `${String.fromCharCode(0x2A)}${String.fromCharCode(0x2F)}`;

test('no-line-comments: flags `//`, exempts directives, converts runs to one block', () => {
  tester.run('no-line-comments', rules['no-line-comments'], {
    valid: [
      '/* a block comment */\nconst a = 1;',
      '/**\n * Doc.\n */\nconst a = 1;',
      '// eslint-disable-next-line no-console\nconsole.log(1);',
      '// @ts-expect-error deliberate\nconst a = 1;',
      '// eslint-disable-next-line no-console\n// @ts-expect-error deliberate\nconst a = 1;'
    ],
    invalid: [
      {
        code: 'const a = 1;\n// lone note\nconst b = 2;',
        output: 'const a = 1;\n/* lone note */\nconst b = 2;',
        errors: 1
      },
      {
        code: 'const a = 1;\n// first line\n// second line\nconst b = 2;',
        output: 'const a = 1;\n/*\n * first line\n * second line\n */\nconst b = 2;',
        errors: 1
      },
      {
        code: 'function f() {\n  // indented note\n  return 1;\n}',
        output: 'function f() {\n  /* indented note */\n  return 1;\n}',
        errors: 1
      },

      /*
       * REGRESSION: a comment quoting a CSS value that embeds a comment used to
       * be wrapped blindly, which closed the block early and turned the rest of
       * the prose into syntax. Real occurrence: packages/core/src/tree/any.ts.
       * The terminator must come out escaped, and the result must still parse.
       */
      {
        code: `const a = 1;\n// emits e('/${BLOCK_OPEN} x ${BLOCK_CLOSE}')\n// and nothing else.\nconst b = 2;`,
        output: `const a = 1;\n/*\n * emits e('/${BLOCK_OPEN} x *${BACKSLASH}/')\n * and nothing else.\n */\nconst b = 2;`,
        errors: 1
      }
    ]
  });
});

test('no-multiline-line-comments: only runs of two or more, never singles or directives', () => {
  tester.run('no-multiline-line-comments', rules['no-multiline-line-comments'], {
    valid: [
      'const a = 1;\n// a single standalone comment\nconst b = 2;',
      'const a = 1; // trailing comment',
      '// eslint-disable-next-line no-console\n// eslint-disable-next-line no-undef\nconsole.log(1);',
      '// @ts-expect-error one\n// @ts-expect-error two\nconst a = 1;',
      'const a = 1;\n// separated one\n\n// separated two\nconst b = 2;'
    ],
    invalid: [
      {
        code: 'const a = 1;\n// prose that\n// spans lines\nconst b = 2;',
        output: 'const a = 1;\n/*\n * prose that\n * spans lines\n */\nconst b = 2;',
        errors: 1
      }
    ]
  });
});

test('no-literal-non-ascii-in-regex: escapes raw code points, preserves the pattern', () => {
  tester.run('no-literal-non-ascii-in-regex', rules['no-literal-non-ascii-in-regex'], {
    valid: [
      `const r = /[_a-zA-Z-${ESCAPED_FFFF}]/;`,
      'const r = /[a-z]/i;',

      /* Non-ASCII outside a regex literal is none of this rule's business. */
      `const s = '${RAW_FFFF}';`
    ],
    invalid: [
      {
        code: `const r = /[_a-zA-Z-${RAW_FFFF}]/;`,
        output: `const r = /[_a-zA-Z-${ESCAPED_FFFF}]/;`,
        errors: 1
      },
      {
        code: `const r = /a${RAW_FFFF}b/u;`,
        output: `const r = /a${ESCAPED_FFFF}b/u;`,
        errors: 1
      }
    ]
  });
});

test('no-hand-rolled-keyword-regex: flags word + boundary lookahead, not real patterns', () => {
  tester.run('no-hand-rolled-keyword-regex', rules['no-hand-rolled-keyword-regex'], {
    valid: [
      'const r = regex(/[a-z]+/);',
      `const r = regex(/-?[_a-zA-Z][-${BACKSLASH}w]*/);`,
      `const r = regex(/${BACKSLASH}d+(?![-${BACKSLASH}w])/);`,
      /*
       * A sign disambiguator, not a keyword: the body has no letter, so
       * `keywords()` is not the fix. This was the only false positive in the
       * 70-site measurement over the five parser packages.
       */
      'const r = regex(/-(?![0-9.])/);'
    ],
    invalid: [
      { code: `const r = regex(/not(?![-${BACKSLASH}w])/i);`, errors: 1 },
      { code: `const r = regex(/(?:and|or|not)(?![-${BACKSLASH}w])/i);`, errors: 1 },
      { code: 'const r = regex(/when(?![-a-zA-Z0-9])/);', errors: 1 }
    ]
  });
});

test('no-regex-outside-combinator: regex only as a `regex()` argument', () => {
  tester.run('no-regex-outside-combinator', rules['no-regex-outside-combinator'], {
    valid: [
      'const r = regex(/[a-z]/);',
      'const r = label(\'x\', regex(/[a-z]/));'
    ],
    invalid: [
      { code: 'const r = /[a-z]/;', errors: 1 },
      { code: 'const ok = \'abc\'.replace(/a/, \'b\');', errors: 1 },
      { code: 'const r = new RegExp(source);', errors: 1 },
      { code: 'const r = literal(/[a-z]/);', errors: 1 }
    ]
  });
});

test('no-macro-hazards: factories, spreads, and constructed patterns', () => {
  tester.run('no-macro-hazards', rules['no-macro-hazards'], {
    valid: [
      'const Rule = choice(a, b, c);',
      'const Rule = sequence(regex(/a/), literal(\';\'));',
      'const reduce = (parts) => parts.join(\'\');',
      'function helper(x) { return x + 1; }'
    ],
    invalid: [
      { code: 'const make = (arm) => choice(arm, other);', errors: 1 },
      { code: 'function make(arm) { return sequence(arm, tail); }', errors: 1 },
      { code: 'const Rule = choice(...arms);', errors: 1 },
      { code: 'const Rule = regex(source);', errors: 1 },
      { code: 'const Rule = regex(`${a}b`);', errors: 1 }
    ]
  });
});
