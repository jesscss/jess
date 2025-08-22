import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '../src';
import { invalidLess, invalidCSSOutput, notSameSerialized } from '@jesscss/shared';

const testData = path.dirname(require.resolve('@less/test-data'));

const lessParser = new Parser();
const parse = lessParser.parse;

describe.skip('can parse any rule (moved to individual files)', () => {
  test('qualified rule with interpolation', () => {
    const { errors } = parse(
      'qw@{ident} { foo: bar }',
      'main'
    );
    expect(errors.length).toBe(0);
  });

  test('anonymous mixins', () => {
    const { errors } = parse(
      '.(@v;@i) {}',
      'anonymousMixinDefinition'
    );
    expect(errors.length).toBe(0);
  });

  test('comparison', () => {
    const { errors } = parse(
      '@a = white',
      'comparison'
    );
    expect(errors.length).toBe(0);
  });

  test('assignment', () => {
    const { errors } = parse(
      '@a: 1px;',
      'stylesheet'
    );
    expect(errors.length).toBe(0);
  });

  test('assignment to mixin', () => {
    const { errors } = parse(
      `@ruleset: {
        color: black;
        background: white;
      }`,
      'stylesheet'
    );
    expect(errors.length).toBe(0);
  });

  test('when guard', () => {
    const { errors } = parse(
      'when(@a = white)',
      'guard'
    );
    if (errors.length) {
      // Help debug guard failures in CI output
      console.error('guard errors:', errors.map((e: any) => e.message ?? e));
    }
    expect(errors.length).toBe(0);
  });

  test('declaration', () => {
    const { errors } = parse(
      'color: green',
      'declaration'
    );
    expect(errors.length).toBe(0);
  });

  test('accessors', () => {
    const { errors } = parse(
      'color: @p[accessor]',
      'declaration'
    );
    expect(errors.length).toBe(0);
  });

  describe.skip('mayAsync roll-up', () => {
    test('pure sync tree has mayAsync=false everywhere', () => {
      const { tree, errors } = parse(
        '.a { color: red; width: 10px }',
        'stylesheet'
      );
      expect(errors.length).toBe(0);
      // Walk all nodes and assert mayAsync === false
      for (const node of (tree as any).nodes?.() ?? []) {
        // Use generator to traverse deep
      }
      // Fallback traversal that includes root
      const all: any[] = [];
      function collect(n: any) {
        all.push(n);
        if (!n || typeof n !== 'object') return;
        if (n.children) {
          for (const c of n.children(true)) {
            collect(c);
          }
        }
      }
      collect(tree as any);
      expect(all.every(n => n && typeof n === 'object' && 'mayAsync' in n ? n.mayAsync === false : true)).toBe(true);
    });

    test('variable reference marks subtree mayAsync=true', () => {
      const { tree, errors } = parse(
        '.a { color: @var }',
        'stylesheet'
      );
      expect(errors.length).toBe(0);
      // Find the Ruleset and Declaration nodes and ensure bubbling
      let anyTrue = false;
      function walk(n: any) {
        if (!n || typeof n !== 'object') return;
        if (n.mayAsync) anyTrue = true;
        if (n.children) {
          for (const c of n.children(true)) walk(c);
        }
      }
      walk(tree as any);
      expect(anyTrue).toBe(true);
    });

    test('deep child async bubbles to root', () => {
      const { tree, errors } = parse(
        `@a: 1;
         .x {
           .y() { z: @a; }
           .y();
         }`,
        'stylesheet'
      );
      expect(errors.length).toBe(0);
      let rootHasTrue = false;
      function walk(n: any) {
        if (!n || typeof n !== 'object') return;
        if (n.parent === undefined && n.mayAsync === true) rootHasTrue = true;
        if (n.children) {
          for (const c of n.children(true)) walk(c);
        }
      }
      walk(tree as any);
      expect(rootHasTrue).toBe(true);
    });
  });

  test('qualified rule', () => {
    const { errors } = parse(
      `.light when (lightness(@a) > 50%) {
          color: green;
      }`,
      'qualifiedRule'
    );
    expect(errors.length).toBe(0);
  });

  test('parses mixin args', () => {
    const { errors } = parse(
      '(@v)',
      'mixinArgs',
      { isDefinition: true }
    );
    expect(errors.length).toBe(0);
  });

  test('non-nested at-rule', () => {
    const { errors } = parse(
      '@namespace @ns "http://lesscss.org";',
      'nonNestedAtRule'
    );
    expect(errors.length).toBe(0);
  });

  test('mixin definition', () => {
    // let lexerResult = lessParser.lexer.tokenize(
    //   `.mixin_def_with_colors(@a: white, // in
    //           @b: 1px //put in @b - causes problems! --->
    //           ) // the
    //           when (@a = white) {
    //       .test-rule {
    //           color: @b;
    //       }
    //   }`
    // )
    // let lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.mixinDefinition()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   `.mixin-definition(@a: {}, @b: {default: works;}) {
    //     @a();
    //     @b();
    //   }`
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.mixinDefinition()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '.m(@x) when (default()) and (@x = 3) {default: @x}'
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.mixinDefinition()
    // expect(parser.errors.length).toBe(0)

    const { errors } = parse(
      '.m(@v) when (@v)        {two: when true}',
      'mixinOrQualifiedRule'
    );
    expect(errors.length).toBe(0);

    // lexerResult = lessParser.lexer.tokenize(
    //   '.mixin-args(@a: 1, 2, 3; @b: 3);'
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.stylesheet()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   `.mixin-definition(@a: {}; @b: {default: works;};) {
    //     @a();
    //     @b();
    //   }`
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.stylesheet()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '.b('
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testMixin()
    // expect(parser.errors.length).toBe(0)

    // lexerResult = lessParser.lexer.tokenize(
    //   '#mixin > .mixin ('
    // )
    // lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testMixin()
    // expect(parser.errors.length).toBe(0)
  });

  test('mixin call', () => {
    let { errors } = parse(
      '.mixin-with-guard-inside(0px)',
      'mixinOrQualifiedRule'
    );
    expect(errors.length).toBe(0);

    ({ errors } = parse(
      `.mixin;`,
      'main'
    ));
    expect(errors.length).toBe(0);

    ({ errors } = parse(
      `.wrap-mixin(@ruleset: {
        color: red;
      })`,
      'mixinOrQualifiedRule'
    ));

    expect(errors.length).toBe(0);

    ({ errors } = parse(
      '.mixin-takes-two(@a : d, e; @b : f)',
      'mixinOrQualifiedRule'
    ));

    expect(errors.length).toBe(0);

    ({ errors } = parse(
      '.mixin-call({direct: works;}; @b: {named: works;});',
      'stylesheet'
    ));
    expect(errors.length).toBe(0);

    ({ errors } = parse(
      `.mixout ('left') {
        // left: 1;
      }`,
      'mixinOrQualifiedRule'
    ));
    expect(errors.length).toBe(0);
  });

  it('variable declaration', () => {
    // let lexerResult =
    //   lessParser.lexer.tokenize(`@ruleset:`)
    // let lexedTokens = lexerResult.tokens
    // parser.input = lexedTokens
    // parser.testVariable()
    // expect(parser.errors.length).to.equal(0)

    const { errors } = parse(
      `@ruleset: {}
      @a: 1px;`,
      /** @todo - add `variableDeclaration` as sugar */
      'stylesheet'
    );
    expect(errors.length).toBe(0);
  });

  test('accessors', () => {
    const { errors } = parse(
      `@ns[@options][options]`,
      'varReference'
    );
    expect(errors.length).toBe(0);
  });
});

/** Sanity check - has the same output as the CSS parser */
// describe.only('Less CSS output - valid cases', () => {
//   glob.sync(path.join(testData, 'css/_main/calc.css'))
//     .map(value => path.relative(testData, value))
//     .filter(value => !invalidCSSOutput.includes(value))
//     .sort()
//     .forEach((file) => {
//       it(file, () => {
//         const contents = fs.readFileSync(path.join(testData, file), 'utf8');
//         const { tree, lexerResult, errors } = lessParser.parse(contents);
//         // Some Less outputs can contain minor parse notes; assert no hard errors
//         if (errors.length > 0) {
//           // Log details to debug regressions in a Vitest-compatible way
//           // Only log for the two files currently regressing to reduce noise
//           console.error('Parse errors for', file, errors.map(e => e.message));
//           const err = errors[0] as any;
//           const off = err?.token?.startOffset ?? 0;
//           const start = Math.max(0, off - 60);
//           const end = Math.min(contents.length, off + 60);
//           const excerpt = contents.slice(start, end).replace(/\n/g, '\\n');
//           console.error('Near offset', off, '... ', excerpt);
//         }
//         expect(lexerResult.errors.length).toBe(0);
//         expect(errors.length).toBe(0);
//         if (!(['test/css/custom-properties.css'].includes(file)) && !(notSameSerialized.includes(file))) {
//           // Print a short diff-friendly message instead of throwing if contents missing
//           expect(`${tree}`).toBe(contents);
//         }
//       });
//     });
// });

const skippedErrors = [
  /**
   * Not a parse error, but an eval + parse error,
   * which this test can't cover.
   */
  'errors/parse/import-subfolder2.less',
  'errors/parse/imports/import-subfolder2.less',
  'errors/parse/imports/subfolder/parse-error-curly-bracket.less',

  /**
   * Not sure why this color + comment should have been an error.
   * Looks like valid CSS to me, and this parser passes it.
   */
  'errors/parse/invalid-color-with-comment.less',

  /** This parser tolerates (12 (1 + 2)) because it's not necessarily invalid CSS */
  'errors/parse/parens-error-1.less',
  'errors/parse/parens-error-2.less',
  'errors/parse/parens-error-3.less'
];

// Skipped until we fix these flows
describe('should throw parsing errors', () => {
  const files = glob.sync(
    path.relative(process.cwd(), path.join(testData, 'errors/parse/**/*.less'))
  );
  files
    .sort()
    .map(value => path.relative(testData, value))
    .filter(file => !skippedErrors.includes(file))
    .forEach((file) => {
      it(`${file}`, () => {
        const result = fs.readFileSync(path.join(testData, file));
        const { lexerResult, errors } = lessParser.parse(result.toString());
        expect(lexerResult.errors.length).toBe(0);
        expect(errors.length).toBeGreaterThan(0);
      });
    });
});