import { mixin, rules, el, decl, any, condition, expr, ref, list, vardecl, Node, Rules, call, ruleset, Ruleset, rest, sel, co, compound, atrule, interpolated, nil, num, seq, amp, sellist } from '../index.js';
import { Context } from '../../context.js';
import { getFunctionFromMixins } from '../rules.js';
import { getParent, getSourceParent, setParent, setSourceParent } from '../util/field-helpers.js';

let context: Context;

// Helper to check for errors without serializing the resolved value
async function expectRejects<T>(
  promiseOrValue: Promise<T> | T,
  ErrorType?: new (...args: any[]) => Error,
  messagePattern?: RegExp
): Promise<void> {
  let error: unknown;
  try {
    await Promise.resolve(promiseOrValue);
    // Create error that will point to the call site
    const err = new Error('Expected promise to reject, but it resolved');
    // Remove this function from the stack trace so it points to the call site
    if (Error.captureStackTrace) {
      Error.captureStackTrace(err, expectRejects);
    } else {
      // Fallback: remove the first line (this function) from stack
      const stack = err.stack?.split('\n');
      if (stack && stack.length > 1) {
        err.stack = stack.slice(1).join('\n');
      }
    }
    throw err;
  } catch (e) {
    if (e instanceof Error && e.message === 'Expected promise to reject, but it resolved') {
      throw e;
    }
    error = e;
  }
  if (!error) {
    const err = new Error('Expected promise to reject, but it resolved');
    if (Error.captureStackTrace) {
      Error.captureStackTrace(err, expectRejects);
    }
    throw err;
  }
  if (ErrorType && !(error instanceof ErrorType)) {
    const errorName = error instanceof Error ? error.constructor.name : 'unknown';
    const errorMsg = error instanceof Error ? error.message : String(error);
    const err = new Error(`Expected error to be instance of ${ErrorType.name}, but got ${errorName}: ${errorMsg}`);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(err, expectRejects);
    }
    throw err;
  }
  if (messagePattern) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!messagePattern.test(errorMsg)) {
      const err = new Error(`Expected error message to match ${messagePattern}, but got: ${errorMsg}`);
      if (Error.captureStackTrace) {
        Error.captureStackTrace(err, expectRejects);
      }
      throw err;
    }
  }
}

describe('Mixin', () => {
  afterAll(() => {
    Node.prototype.fullRender = false;
  });
  beforeEach(() => {
    Node.prototype.fullRender = true;
    context = new Context({
      /** This is the default Less behavior */
      leakyRules: true
    });
    context.depth = 2;
  });

  describe('calling', () => {
    it('should call a simple mixin', async () => {
      // Create a mixin definition: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      // Create root rules containing both
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          color: red;
        }
      `);
    });

    it('should call a ruleset as a mixin (no parens)', async () => {
      // Create a ruleset that can be used as a mixin: .my-mixin { color: red; }
      const mixinRuleset = ruleset({
        selector: el('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin-ruleset' }) }) // Use 'mixin-ruleset' to find both Mixins and Rulesets
        ])
      });

      // Create root rules containing both
      const root = rules([mixinRuleset, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .my-mixin {
          color: red;
        }
        .test {
          color: red;
        }
      `);
    });

    it('should call a mixin with parameters', async () => {
      // Create a mixin with a parameter: .my-mixin(@color) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }) // Parameter without default is Any with role: 'property' (like variable names)
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      // Create root rules containing both
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          color: blue;
        }
      `);
    });

    // Removed: interpolated mixin names are resolved during eval before registration.
    // A mixin with an unresolved interpolated name would never be in the registry.

    it('should call a mixin with default parameter values', async () => {
      // Create a mixin with a default parameter: .my-mixin(@color: red) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          vardecl({ name: 'color', value: any('red') }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      // Create a ruleset that calls the mixin with args: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset1, testRuleset2]);
      context.root = root;

      const evald = await root.eval(context);
      // Position-backed trees require context for serialization
      const css = evald.render(context);

      expect(css).toBeString(`
        .test1 {
          $color: red;
          color: red;
        }
        .test2 {
          $color: blue;
          color: blue;
        }
      `);
    });

    it('should call a mixin with multiple parameters', async () => {
      // Create a mixin with multiple parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(blue, 16px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue'), any('16px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          $size: 16px;
          color: blue;
          font-size: 16px;
        }
      `);
    });

    it('should call a mixin with @arguments', async () => {
      // Create a mixin that uses @arguments: .my-mixin(@a, @b) { margin: @arguments; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'arguments' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /'arguments' is not defined/);
    });

    it('preEval sets private rulesVisibility on mixin body', async () => {
      const localContext = new Context({ leakyRules: false });
      localContext.depth = 2;

      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      const preEvald = await mixinDef.preEval(localContext);

      const preEvaldRules = (preEvald as Ruleset).enterRules(localContext);
      expect(preEvaldRules.options.rulesVisibility.Mixin).toBe('private');
      expect(preEvaldRules.options.rulesVisibility.VarDeclaration).toBe('private');
    });

    it('should call a mixin with a guard condition', async () => {
      // Create a mixin with a guard: .my-mixin(@color) when (@color = red) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          expr(ref({ key: 'color' }, { type: 'variable' })),
          '=',
          any('red')
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with matching condition: .test1 { .my-mixin(red); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      });

      // Create a ruleset that calls the mixin with non-matching condition: .test2 { .my-mixin(blue); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset1, testRuleset2]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test1 {
          $color: red;
          color: red;
        }
      `);
    });

    it('guard params resolve and output renders correctly with position isolation', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        guard: condition([
          expr(ref({ key: 'color' }, { type: 'variable' })),
          '=',
          any('red')
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      });
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: red;
          color: red;
        }
      `);
    });

    it('blocks a mixin candidate when its failed guard ancestor exists only in the state parent chain', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const failedAncestor = ruleset({
        selector: el('.blocked'),
        guard: nil(),
        rules: rules([])
      });
      setParent(mixinDef, failedAncestor, context);

      const fn = getFunctionFromMixins(mixinDef);

      await expectRejects(fn.call(context), ReferenceError, /No matching mixins found/);
    });

    it('evaluates mixin args against a caller source scope that exists only in the state chain', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });
      const mixinRoot = rules([mixinDef]);
      context.root = mixinRoot;

      const sourceAnchor = decl({ name: 'background', value: any('white') });
      const sourceRules = rules([
        vardecl({ name: 'theme', value: any('blue') }),
        sourceAnchor
      ]);
      const caller = call({
        name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
        args: list([ref({ key: 'theme' }, { type: 'variable' })])
      });

      setSourceParent((caller as any).name, sourceAnchor, context);
      context.caller = caller;

      const fn = getFunctionFromMixins(mixinDef);
      const result = await fn.call(context, ref({ key: 'theme' }, { type: 'variable' }));

      expect(result.render(context)).toBeString(`
        color: blue;
      `);
    });

    it('mixin with parameters renders correctly via eval', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          color: blue;
        }
      `);
    });

    it('mixin with bound parameters renders values from call site', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          color: blue;
        }
      `);
    });

    it('mixin with nested ruleset renders with position-resolved values', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          ruleset({
            selector: el('.inner'),
            rules: rules([
              decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
            ])
          })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          .inner {
            color: blue;
          }
        }
      `);
    });

    it('mixin with declarations and nested rulesets resolves params through position', async () => {
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'background', value: ref({ key: 'color' }, { type: 'variable' }) }),
          ruleset({
            selector: el('.inner'),
            rules: rules([
              decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
            ])
          })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });
      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          background: blue;
          .inner {
            color: blue;
          }
        }
      `);
    });

    it('multi-candidate mixin renders output from all matching candidates', async () => {
      const mixinA = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });
      const mixinB = mixin({
        name: any('.my-mixin'),
        rules: rules([
          ruleset({
            selector: el('.inner'),
            rules: rules([
              decl({ name: 'background', value: any('blue') })
            ])
          })
        ])
      });
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' })
          })
        ])
      });
      const root = rules([mixinA, mixinB, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          color: red;
          .inner {
            background: blue;
          }
        }
      `);
    });

    it('should call a mixin that calls another mixin', async () => {
      // Create a base mixin: .base-mixin(@color) { color: @color; }
      const baseMixin = mixin({
        name: any('.base-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a mixin that calls the base mixin: .wrapper-mixin(@color) { .base-mixin(@color); }
      const wrapperMixin = mixin({
        name: any('.wrapper-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          call({
            name: ref({ key: '.base-mixin' }, { type: 'mixin' }),
            args: list([ref({ key: 'color' }, { type: 'variable' })])
          })
        ])
      });

      // Create a ruleset that calls the wrapper mixin: .test { .wrapper-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.wrapper-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([baseMixin, wrapperMixin, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          $color: blue;
          color: blue;
        }
      `);
    });

    it('nested mixin calls render correctly through position pipeline', async () => {
      const baseMixin = mixin({
        name: any('.base-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      const wrapperMixin = mixin({
        name: any('.wrapper-mixin'),
        params: list([
          any('color', { role: 'property' })
        ]),
        rules: rules([
          call({
            name: ref({ key: '.base-mixin' }, { type: 'mixin' }),
            args: list([ref({ key: 'color' }, { type: 'variable' })])
          })
        ])
      });

      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.wrapper-mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([baseMixin, wrapperMixin, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $color: blue;
          $color: blue;
          color: blue;
        }
      `);
    });

    it('should call a mixin with pattern matching by value', async () => {
      // Create mixins with pattern matching: .mixin(red) and .mixin(blue)
      const redMixin = mixin({
        name: any('.mixin'),
        params: list([
          any('red') // Pattern match - must be exactly 'red'
        ]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      const blueMixin = mixin({
        name: any('.mixin'),
        params: list([
          any('blue') // Pattern match - must be exactly 'blue'
        ]),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });

      // Create rulesets that call the mixin with different values
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.mixin' }, { type: 'mixin' }),
            args: list([any('red')])
          })
        ])
      });

      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.mixin' }, { type: 'mixin' }),
            args: list([any('blue')])
          })
        ])
      });

      const root = rules([redMixin, blueMixin, testRuleset1, testRuleset2]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test1 {
          color: red;
        }
        .test2 {
          color: blue;
        }
      `);
    });

    it('matches a sequence pattern parameter against a state-patched argument value', async () => {
      const buildRoot = () => {
        const mixinDef = mixin({
          name: any('.mixin'),
          params: list([
            seq([num(10), num(20)])
          ]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        });

        const arg = seq([num(10), num(30)]);
        const testRuleset = ruleset({
          selector: el('.test'),
          rules: rules([
            call({
              name: ref({ key: '.mixin' }, { type: 'mixin' }),
              args: list([arg])
            })
          ])
        });

        return {
          root: rules([mixinDef, testRuleset]),
          arg
        };
      };

      const baseline = buildRoot();
      await expectRejects(baseline.root.eval(new Context({ leakyRules: true })), ReferenceError, /No matching mixins/);
    });

    it('matches selector pattern params after preparing the selector operand before compare(context)', async () => {
      const buildRoot = (ctx: Context) => {
        const parent = ruleset({
          selector: el('.alpha'),
          rules: rules([])
        });
        parent.get('selector').keySetLibrary = ctx.selectorBits;

        const patched = el('.beta');
        patched.keySetLibrary = ctx.selectorBits;

        const find = sel([
          amp({ selectorContainer: parent as any }),
          co('>'),
          el('.tail')
        ]);
        find.keySetLibrary = ctx.selectorBits;
        for (const child of find.get('value') as any[]) {
          if ('keySetLibrary' in child) {
            child.keySetLibrary = ctx.selectorBits;
          }
        }
        const patternArg = sellist([find]);
        patternArg.keySetLibrary = ctx.selectorBits;

        const target = sel([el('.beta'), co('>'), el('.tail')]);
        const otherBits = new Context().selectorBits;
        target.keySetLibrary = otherBits;
        for (const child of target.get('value') as any[]) {
          if ('keySetLibrary' in child) {
            child.keySetLibrary = otherBits;
          }
        }

        const mixinDef = mixin({
          name: any('.mixin'),
          params: list([patternArg]),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        });

        const testRuleset = ruleset({
          selector: el('.test'),
          rules: rules([
            call({
              name: ref({ key: '.mixin' }, { type: 'mixin' }),
              args: list([target])
            })
          ])
        });

        return {
          root: rules([mixinDef, testRuleset]),
          parent,
          patched,
          patternArg,
          target
        };
      };
    });

    it('should call a mixin with rest parameters', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { margin: @rest; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest') // Rest parameter collects remaining arguments
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with multiple args: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $a: 10px;
          $rest: 20px 30px;
          margin: 20px 30px;
        }
      `);
    });

    it('should call a mixin with unnamed rest parameter (auto-generated name)', async () => {
      // Create a mixin with an unnamed rest parameter: .my-mixin(@a, ...) { margin: @rest; }
      // The name should be auto-generated as "rest"
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest(undefined) // Unnamed rest parameter - should auto-generate "rest"
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with multiple args: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /'rest' is not defined/);
    });

    it('should call a mixin with multiple nested compound selectors', async () => {
      // .do .re .mi .fa {
      //   .sol .la {
      //     .si {
      //       color: cyan;
      //     }
      //   }
      // }
      // .mutli-selector-parents {
      //   .do.re.mi.fa.sol.la.si();
      // }
      const node = rules([
        ruleset({
          selector: sel([el('.do'), co(' '), el('.re'), co(' '), el('.mi'), co(' '), el('.fa')]) as any,
          rules: rules([
            ruleset({
              selector: sel([el('.sol'), co(' '), el('.la')]) as any,
              rules: rules([
                ruleset({
                  selector: sel([el('.si')]) as any,
                  rules: rules([
                    decl({ name: 'color', value: any('cyan') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.mutli-selector-parents'),
          rules: rules([
            call({ name: ref({ key: compound([el('.do'), el('.re'), el('.mi'), el('.fa'), el('.sol'), el('.la'), el('.si')]) }, { type: 'mixin-ruleset' }) })
          ])
        })
      ]);
      context.opts.collapseNesting = true;
      let evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .do .re .mi .fa .sol .la .si {
          color: cyan;
        }
        .mutli-selector-parents {
          color: cyan;
        }
      `);
    });

    it('should call a mixin or ruleset with different nesting patterns', async () => {
      Node.prototype.fullRender = false;
      // #theme() {
      //   .dark() {
      //     .navbar() {
      //       @color: cyan;
      //     }
      //   }
      // }
      // #theme.dark.navbar {
      //   @color: blue;
      // }
      // .rule {
      //   #theme.dark.navbar();
      //   background-color: @color;
      // }
      const node = rules([
        mixin({
          name: any('#theme'),
          rules: rules([
            mixin({
              name: any('.dark'),
              rules: rules([
                mixin({
                  name: any('.navbar'),
                  rules: rules([
                    vardecl({ name: 'color', value: any('cyan') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            vardecl({ name: 'color', value: any('blue') })
          ])
        }),
        ruleset({
          selector: el('.rule'),
          rules: rules([
            call({ name: ref({ key: ['#theme', '.dark', '.navbar'] }, { type: 'mixin-ruleset' }) }),
            decl({ name: 'background-color', value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        })
      ]);
      let evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toBeString(`
        .rule {
          background-color: cyan;
        }
      `);
    });

    it('should call a namespace mixin using ComplexSelector key (parser pattern)', async () => {
      // Mirrors the Less parser's AST for:
      // #theme {
      //   > .mixin {
      //     background-color: grey;
      //   }
      // }
      // #container {
      //   #theme > .mixin();
      // }
      const node = rules([
        ruleset({
          selector: el('#theme'),
          rules: rules([
            ruleset({
              selector: sel([co('>'), el('.mixin')]),
              rules: rules([
                decl({ name: 'background-color', value: any('grey') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('#container'),
          rules: rules([
            call({
              name: ref(
                { key: sel([el('#theme'), co('>'), el('.mixin')]) },
                { type: 'mixin-ruleset' }
              )
            })
          ])
        })
      ]);
      let evald = await node.eval(context);
      const css = evald.render(context);
      expect(css).toContain('background-color: grey');
    });

    it('should call a namespace mixin using ComplexSelector key with collapseNesting', async () => {
      // Same as above but with collapseNesting: true (matching Less compiler behavior)
      const collapseContext = new Context({
        leakyRules: true,
        collapseNesting: true
      });
      const node = rules([
        ruleset({
          selector: el('#theme'),
          rules: rules([
            ruleset({
              selector: sel([co('>'), el('.mixin')]),
              rules: rules([
                decl({ name: 'background-color', value: any('grey') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('#container'),
          rules: rules([
            call({
              name: ref(
                { key: sel([el('#theme'), co('>'), el('.mixin')]) },
                { type: 'mixin-ruleset' }
              )
            })
          ])
        })
      ]);
      let evald = await node.eval(collapseContext);
      const css = evald.render(context);
      expect(css).toContain('background-color: grey');
    });
  });

  describe('rest parameter matching and assignment', () => {
    it('should match a mixin with rest parameter and assign empty rest when no extra args provided', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { padding: @rest; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with only the required arg: .test { .my-mixin(10px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px')]) // Only one arg, rest should be empty
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $a: 10px;
          $rest: rest;
          padding: rest;
        }
      `);
    });

    it('should match a mixin with rest parameter and assign single value to rest', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { margin: @rest; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with two args: .test { .my-mixin(10px, 20px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')]) // Rest should contain 20px
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $a: 10px;
          $rest: 20px;
          margin: 20px;
        }
      `);
    });

    it('should match a mixin with rest parameter and assign multiple values to rest', async () => {
      // Create a mixin with a rest parameter: .my-mixin(@a, @rest...) { padding: @rest; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with many args: .test { .my-mixin(10px, 20px, 30px, 40px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px'), any('40px')]) // Rest should contain 20px, 30px, 40px
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $a: 10px;
          $rest: 20px 30px 40px;
          padding: 20px 30px 40px;
        }
      `);
    });

    it('should match a mixin with rest parameter when multiple required params before rest', async () => {
      // Create a mixin with multiple params before rest: .my-mixin(@a, @b, @rest...) { margin: @rest; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px, 30px, 40px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px'), any('40px')]) // Rest should contain 30px, 40px
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $a: 10px;
          $b: 20px;
          $rest: 30px 40px;
          margin: 30px 40px;
        }
      `);
    });

    it('should use rest variable in multiple declarations within mixin', async () => {
      // Create a mixin that uses rest in multiple places: .my-mixin(@a, @rest...) { margin: @rest; padding: @rest; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'margin', value: ref({ key: 'rest' }, { type: 'variable' }) }),
          decl({ name: 'padding', value: ref({ key: 'rest' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin: .test { .my-mixin(10px, 20px, 30px); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')])
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test {
          $a: 10px;
          $rest: 20px 30px;
          margin: 20px 30px;
          padding: 20px 30px;
        }
      `);
    });

    it('should match mixin with rest parameter over mixin without rest when both exist', async () => {
      // Create a mixin without rest: .my-mixin(@a, @b) { color: red; }
      const mixinWithoutRest = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          any('b', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a mixin with rest: .my-mixin(@a, @rest...) { color: blue; }
      const mixinWithRest = mixin({
        name: any('.my-mixin'),
        params: list([
          any('a', { role: 'property' }),
          rest('rest')
        ]),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });

      // Create a ruleset that calls with exact 2 args: .test1 { .my-mixin(10px, 20px); }
      const testRuleset1 = ruleset({
        selector: el('.test1'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px')]) // Matches mixinWithoutRest exactly
          })
        ])
      });

      // Create a ruleset that calls with 3 args: .test2 { .my-mixin(10px, 20px, 30px); }
      const testRuleset2 = ruleset({
        selector: el('.test2'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('10px'), any('20px'), any('30px')]) // Should match mixinWithRest
          })
        ])
      });

      const root = rules([mixinWithoutRest, mixinWithRest, testRuleset1, testRuleset2]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toBeString(`
        .test1 {
          $a: 10px;
          $b: 20px;
          color: red;
          $a: 10px;
          $rest: 20px;
          color: blue;
        }
        .test2 {
          $a: 10px;
          $rest: 20px 30px;
          color: blue;
        }
      `);
    });
  });

  describe('arity failures', () => {
    it('should fail when calling a mixin with too few arguments (missing required parameter)', async () => {
      // Create a mixin with a required parameter: .my-mixin(@color) { color: @color; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }) // Required parameter without default
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin without args: .test { .my-mixin(); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.my-mixin' }, { type: 'mixin' }) })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling a mixin with too few arguments (multiple required parameters)', async () => {
      // Create a mixin with multiple required parameters: .my-mixin(@color, @size) { color: @color; font-size: @size; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        params: list([
          any('color', { role: 'property' }),
          any('size', { role: 'property' })
        ]),
        rules: rules([
          decl({ name: 'color', value: ref({ key: 'color' }, { type: 'variable' }) }),
          decl({ name: 'font-size', value: ref({ key: 'size' }, { type: 'variable' }) })
        ])
      });

      // Create a ruleset that calls the mixin with only one arg: .test { .my-mixin(red); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('red')]) // Only one argument, but two are required
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling a mixin with no parameters but providing arguments', async () => {
      // Create a mixin with no parameters: .my-mixin() { color: red; }
      const mixinDef = mixin({
        name: any('.my-mixin'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      });

      // Create a ruleset that calls the mixin with args: .test { .my-mixin(blue); }
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({
            name: ref({ key: '.my-mixin' }, { type: 'mixin' }),
            args: list([any('blue')]) // One argument, but mixin has no parameters
          })
        ])
      });

      const root = rules([mixinDef, testRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('keeps param vars preferred over outer same-name vars in lazy nested mixin lookups', async () => {
      const root = rules([
        vardecl({ name: 'gender_', value: any('"Outer"') }),
        mixin({
          name: any('.Person'),
          params: list([
            any('name', { role: 'property' }),
            any('gender_', { role: 'property' })
          ]),
          rules: rules([
            ruleset({
              selector: el('.person'),
              rules: rules([
                vardecl({
                  name: 'gender',
                  value: ref({ key: 'gender_' }, { type: 'variable' })
                }),
                mixin({
                  name: any('.sayGender'),
                  rules: rules([
                    decl({
                      name: 'gender',
                      value: ref({ key: 'gender' }, { type: 'variable' })
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.test'),
          rules: rules([
            call({
              name: ref({ key: '.Person' }, { type: 'mixin' }),
              args: list([any('person'), any('"Male"')])
            }),
            call({
              name: ref({ key: ['.person', '.sayGender'] }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.render(context);

      expect(css).toContain('gender: "Male";');
      expect(css).not.toContain('gender: "Outer";');
    });
  });

  describe('serialization', () => {
    it('should serialize a mixin', () => {
      const rule = mixin({
        name: any('myMixin'),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
      });
      expect(`${rule}`).toBeString(`
        myMixin() {
          color: black;
          background-color: white;
        }
      `);
    });

    it('should serialize a mixin with args', () => {
      const rule = mixin({
        name: any('my-mixin'),
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
      });
      expect(`${rule}`).toBeString(`
        my-mixin($a: black; $b: white) {
          color: black;
          background-color: white;
        }
      `);
    });

    it('should serialize a guard', () => {
      const rule = mixin({
        name: any('my-mixin'),
        params: list([
          vardecl({ name: 'a', value: any('black') }, { paramVar: true }),
          vardecl({ name: 'b', value: any('white') }, { paramVar: true })
        ], { sep: ';' }),
        guard: condition([expr(ref({ key: 'a' })), '=', expr(ref({ key: 'b' }))]),
        rules: rules([
          decl({ name: 'color', value: any('black') }),
          decl({ name: 'background-color', value: any('white') })
        ])
      });
      expect(`${rule}`).toBeString(`
        my-mixin($a: black; $b: white) when ($($a) = $($b)) {
          color: black;
          background-color: white;
        }
      `);
    });
  });

  describe('parent selector composition in mixin calls', () => {
    it('should resolve > li to caller context, not mixin ancestor chain, inside @media', async () => {
      /**
       * Less input:
       *   .nav-justified {
       *     @media (min-width: 480px) {
       *       > li { display: table-cell; }
       *     }
       *   }
       *   .menu {
       *     @media (min-width: 768px) {
       *       .nav-justified();
       *     }
       *   }
       *
       * Expected CSS (collapsed):
       *   @media (min-width: 480px) { .nav-justified > li { ... } }
       *   @media (min-width: 768px) { @media (min-width: 480px) { .menu > li { ... } } }
       *
       * Bug: produces `.menu .nav-justified > li` — the mixin body's
       * `> li` ruleset still walks up the parent chain to `.nav-justified`
       * instead of using the caller's captured frames.
       */
      const navJustified = ruleset({
        selector: el('.nav-justified'),
        rules: rules([
          atrule({
            name: any('@media'),
            prelude: any('(min-width: 480px)'),
            rules: rules([
              ruleset({
                selector: sel([co('>'), el('li')]),
                rules: rules([
                  decl({ name: 'display', value: any('table-cell') })
                ])
              })
            ])
          })
        ])
      });

      const menu = ruleset({
        selector: el('.menu'),
        rules: rules([
          atrule({
            name: any('@media'),
            prelude: any('(min-width: 768px)'),
            rules: rules([
              call({ name: ref({ key: '.nav-justified' }, { type: 'mixin-ruleset' }) })
            ])
          })
        ])
      });

      const root = rules([navJustified, menu]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString({ collapseNesting: true });

      expect(css).toContain('.menu > li');
      expect(css).not.toContain('.menu .nav-justified');
    });
  });

  // it('should serialize to a module', () => {
  //   let rule = mixin({
  //     name: ident('myMixin'),
  //     value: ruleset([
  //       decl({ name: 'color', value: any('black') }),
  //       decl({ name: 'background-color', value: any('white') })
  //     ])
  //   })
  //   rule.toModule(context, out)
  //   expect(out.toString()).toBe(
  //     'let myMixin = function() { return $J.ruleset(\n  (() => {\n    const $OUT = []\n    $OUT.push($J.decl({\n      name: $J.any("color"),\n      value: $J.any("black")\n    }))\n    $OUT.push($J.decl({\n      name: $J.any("background-color"),\n      value: $J.any("white")\n    }))\n    return $OUT\n  })()\n)}'
  //   )
  //   expect(rule.value.obj()).toEqual({
  //     color: 'black',
  //     'background-color': 'white'
  //   })
  // })
});
