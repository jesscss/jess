import { mixin, rules, el, decl, any, condition, expr, ref, list, vardecl, Node, call, ruleset, rest, sel, co, compound, interpolated, interpolatedSelector, INTERPOLATION_PLACEHOLDER, amp } from '../index.js';
import { Context } from '../../context.js';

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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

      expect(css).toBeString(`
        .test {
          $color: blue;
          color: blue;
        }
      `);
    });

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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

      expect(css).toBeString(`
        .test1 {
          $color: red;
          color: red;
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
      const css = evald.toString();

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
      const css = evald.toString();

      expect(css).toBeString(`
        .test1 {
          color: red;
        }
        .test2 {
          color: blue;
        }
      `);
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
      const css = evald.toString();

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
          selector: sel([el('.do'), co(' '), el('.re'), co(' '), el('.mi'), co(' '), el('.fa')]),
          rules: rules([
            ruleset({
              selector: sel([el('.sol'), co(' '), el('.la')]),
              rules: rules([
                ruleset({
                  selector: sel([el('.si')]),
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
      const css = evald.toString({ context });
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
      const css = evald.toString();
      expect(css).toBeString(`
        .rule {
          background-color: cyan;
        }
      `);
    });

    it('should resolve mixin-ruleset lookups against interpolated selector names', async () => {
      const dynamicClass = interpolated({
        source: '.' + INTERPOLATION_PLACEHOLDER,
        replacements: [any('foo')]
      }, { role: 'ident' });
      const node = rules([
        ruleset({
          selector: interpolatedSelector(dynamicClass),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.foo' }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      context.root = node;

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .foo {
          color: red;
        }
        .out {
          color: red;
        }
      `);
    });

    it('should resolve nested mixin-ruleset lookups for local ampersand descendant keys', async () => {
      const root = rules([
        ruleset({
          selector: sel([el('.b'), co(' '), el('.bb')]),
          rules: rules([
            ruleset({
              selector: sel([
                compound([amp(), el('.foo-xxx')]),
                co(' '),
                compound([el('.yyy-foo'), el('#foo')])
              ]),
              rules: rules([
                ruleset({
                  selector: sel([amp(), co(' '), compound([el('.foo'), el('.bbb')])]),
                  rules: rules([
                    decl({ name: 'b', value: any('1') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-b'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .b .bb {
          &.foo-xxx .yyy-foo#foo {
            & .foo.bbb {
              b: 1;
            }
          }
        }
        mi-test-b {
          b: 1;
        }
      `);
    });

    it('preserves collapse output for complex parent ampersands and nested array-path ruleset mixin calls', async () => {
      const root = rules([
        ruleset({
          selector: sel([el('.b'), co(' '), el('.bb')]),
          rules: rules([
            ruleset({
              selector: sel([
                compound([amp(), el('.foo-xxx')]),
                co(' '),
                compound([el('.yyy-foo'), el('#foo')])
              ]),
              rules: rules([
                ruleset({
                  selector: sel([amp(), co(' '), compound([el('.foo'), el('.bbb')])]),
                  rules: rules([
                    decl({ name: 'b', value: any('1') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('#foo-foo'),
          rules: rules([
            ruleset({
              selector: sel([co('>'), el('.bar')]),
              rules: rules([
                ruleset({
                  selector: sel([el('.baz')]),
                  rules: rules([
                    decl({ name: 'c', value: any('c') })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-b'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-c'),
          rules: rules([
            ruleset({
              selector: sel([amp('-1')]),
              rules: rules([
                call({
                  name: ref({ key: '#foo-foo' }, { type: 'mixin-ruleset' })
                })
              ])
            }),
            ruleset({
              selector: sel([amp('-2')]),
              rules: rules([
                call({
                  name: ref({ key: ['#foo-foo', '.bar'] }, { type: 'mixin-ruleset' })
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('mi-test-c-3'),
          rules: rules([
            call({
              name: ref({ key: ['#foo-foo', '.bar', '.baz'] }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString({ collapseNesting: true });

      expect(css).toBeString(`
        .b .bb.foo-xxx .yyy-foo#foo .foo.bbb {
          b: 1;
        }
        #foo-foo > .bar .baz {
          c: c;
        }
        mi-test-b {
          b: 1;
        }
        mi-test-c-1 > .bar .baz {
          c: c;
        }
        mi-test-c-2 .baz {
          c: c;
        }
        mi-test-c-3 {
          c: c;
        }
      `);
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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

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
      const css = evald.toString();

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
