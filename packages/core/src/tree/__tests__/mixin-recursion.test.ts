import { mixin, rules, el, decl, any, ref, Node, call, ruleset, compound, Comment } from '..';
import { Context } from '../../context.js';
import { JessError } from '../../jess-error.js';

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

describe('Mixin Recursion Detection', () => {
  beforeEach(() => {
    context = new Context({
      collapseNesting: true
    });
    context.depth = 2;
  });

  describe('nested mixin calls that should succeed', () => {
    it('should be able to call a nested mixin', async () => {
      // .foo {
      //   .bar {
      //     color: red;
      //   }
      // }
      // .output {
      //   .foo.bar();
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([decl({ name: 'color', value: any('red') })])
          })
        ])
      });
      const outputRuleset = ruleset({
        selector: el('.output'),
        rules: rules([
          call({
            name: ref({
              key: compound([el('.foo'), el('.bar')])
            }, { type: 'mixin-ruleset' })
          })
        ])
      });
      const root = rules([fooRuleset, outputRuleset]);
      context.root = root;
      const evald = await root.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .foo .bar {
          color: red;
        }
        .output {
          color: red;
        }
      `);
    });

    it('should be able to match a compound selector', async () => {
      // .foo.bar {
      //   color: red;
      // }
      // .output {
      //   .foo.bar();
      // }
      const fooRuleset = ruleset({
        selector: compound([el('.foo'), el('.bar')]),
        rules: rules([decl({ name: 'color', value: any('red') })])
      });
      const outputRuleset = ruleset({
        selector: el('.output'),
        rules: rules([
          call({
            name: ref({
              key: compound([el('.foo'), el('.bar')])
            }, { type: 'mixin-ruleset' })
          })
        ])
      });
      const root = rules([fooRuleset, outputRuleset]);
      context.root = root;
      const evald = await root.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .foo.bar {
          color: red;
        }
        .output {
          color: red;
        }
      `);
    });

    it('should be able to call nested mixin from within container #1', async () => {
      // .container {
      //   .foo {
      //     .bar {
      //       color: blue;
      //     }
      //   }
      //   .foo.bar();
      // }
      const containerRuleset = ruleset({
        selector: el('.container'),
        rules: rules([
          ruleset({
            selector: el('.foo'),
            rules: rules([
              ruleset({
                selector: el('.bar'),
                rules: rules([decl({ name: 'color', value: any('blue') })])
              })
            ])
          }),
          call({
            name: ref({
              key: compound([el('.foo'), el('.bar')])
            }, { type: 'mixin-ruleset' })
          })
        ])
      });
      const root = rules([containerRuleset]);
      context.root = root;
      const evald = await root.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .container .foo .bar {
          color: blue;
        }
        .container {
          color: blue;
        }
      `);
    });

    it('should be able to call nested mixin from within container #2', async () => {
      // .container {
      //   .foo {
      //     .bar {
      //       color: blue;
      //     }
      //   }
      //   .container.foo.bar();
      // }
      const containerRuleset = ruleset({
        selector: el('.container'),
        rules: rules([
          ruleset({
            selector: el('.foo'),
            rules: rules([
              ruleset({
                selector: el('.bar'),
                rules: rules([decl({ name: 'color', value: any('blue') })])
              })
            ])
          }),
          call({
            name: ref({
              key: compound([el('.container'), el('.foo'), el('.bar')])
            }, { type: 'mixin-ruleset' })
          })
        ])
      });
      const root = rules([containerRuleset]);
      context.root = root;
      const evald = await root.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .container .foo .bar {
          color: blue;
        }
        .container {
          color: blue;
        }
      `);
    });

    it('should be able to call nested mixin from outside container', async () => {
      // .container {
      //   .foo {
      //     .bar {
      //       color: blue;
      //     }
      //   }
      // }
      // .container.foo();
      const containerRuleset = ruleset({
        selector: el('.container'),
        rules: rules([
          ruleset({
            selector: el('.foo'),
            rules: rules([
              ruleset({
                selector: el('.bar'),
                rules: rules([decl({ name: 'color', value: any('blue') })])
              })
            ])
          })
        ])
      });
      const outputRuleset = call({
        name: ref({
          key: compound([el('.container'), el('.foo')])
        }, { type: 'mixin-ruleset' })
      });
      const root = rules([containerRuleset, outputRuleset]);
      context.root = root;
      const evald = await root.eval(context);
      const css = evald.toString();
      expect(css).toBeString(`
        .container .foo .bar {
          color: blue;
        }
        .bar {
          color: blue;
        }
      `);
    });
  });

  describe('recursive mixin calls that should fail', () => {
    it.skip('should fail when calling .foo.bar() from within .foo .bar (would cause recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo.bar();
      //     color: red;
      //   }
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({
                name: ref({
                  key: ['.foo', '.bar']
                }, { type: 'mixin-ruleset' })
              }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling .foo() from within .foo .bar (would cause recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo();
      //     color: red;
      //   }
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when calling .clearfix() from within .clearfix (direct self-reference)', async () => {
      // .clearfix {
      //   .clearfix();
      // }
      const clearfixRuleset = ruleset({
        selector: el('.clearfix'),
        rules: rules([
          call({ name: ref({ key: '.clearfix' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const root = rules([clearfixRuleset]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when duplicate .foo .bar blocks both call .foo.bar() (would cause mutual recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo.bar();
      //     color: red;
      //   }
      // }
      // .foo {
      //   .bar {
      //     .foo.bar();
      //     color: red;
      //   }
      // }
      const fooRuleset1 = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo.bar' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const fooRuleset2 = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: '.foo.bar' }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset1, fooRuleset2]);
      context.root = root;

      await expectRejects(root.eval(context), ReferenceError, /No matching mixins/);
    });

    it('should fail when mixin A calls mixin B, and mixin B would call mixin A (mutual recursion)', async () => {
      // .a {
      //   .b();
      // }
      // .b {
      //   .a();
      // }
      const aRuleset = ruleset({
        selector: el('.a'),
        rules: rules([
          call({ name: ref({ key: '.b' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const bRuleset = ruleset({
        selector: el('.b'),
        rules: rules([
          call({ name: ref({ key: '.a' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const root = rules([aRuleset, bRuleset]);
      context.root = root;

      // When .a is called, it calls .b, which would call .a again - should fail
      const testRuleset = ruleset({
        selector: el('.test'),
        rules: rules([
          call({ name: ref({ key: '.a' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const rootWithCall = rules([aRuleset, bRuleset, testRuleset]);
      context.root = rootWithCall;

      await expectRejects(rootWithCall.eval(context), undefined, /No matching mixins/);
    });
  });

  describe('non-recursive mixin calls that should succeed', () => {
    it('should succeed when calling .foo.foo() from within .foo .bar if .foo .foo exists (no recursion)', async () => {
      // .foo {
      //   .bar {
      //     .foo.foo();
      //     color: red;
      //   }
      //   .foo {
      //     color: blue;
      //   }
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          ruleset({
            selector: el('.bar'),
            rules: rules([
              call({ name: ref({ key: ['.foo', '.foo'] }, { type: 'mixin-ruleset' }) }),
              decl({ name: 'color', value: any('red') })
            ])
          }),
          ruleset({
            selector: el('.foo'),
            rules: rules([
              decl({ name: 'color', value: any('blue') })
            ])
          })
        ])
      });

      const root = rules([fooRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.foo .bar');
      expect(css).toContain('color: red');
      expect(css).toContain('.foo .foo');
      expect(css).toContain('color: blue');
    });

    it('should succeed when calling a mixin from a different ruleset (no recursion)', async () => {
      // .foo {
      //   .bar();
      // }
      // .bar {
      //   color: blue;
      // }
      const fooRuleset = ruleset({
        selector: el('.foo'),
        rules: rules([
          call({ name: ref({ key: '.bar' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const barRuleset = ruleset({
        selector: el('.bar'),
        rules: rules([
          decl({ name: 'color', value: any('blue') })
        ])
      });

      const root = rules([fooRuleset, barRuleset]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      expect(css).toContain('.foo');
      expect(css).toContain('color: blue');
    });

    it('should succeed when multiple .clearfix rulesets call .clearfix() mixin (no recursion)', async () => {
      // .clearfix {
      //   zoom: 1;
      // }
      // .clearfix {
      //   .clearfix();
      // }
      // .clearfix {
      //   .clearfix();
      // }
      // .clearfix {
      //   .clearfix();
      // }
      // The first .clearfix ruleset is the mixin definition that can be called
      const clearfixMixin = ruleset({
        selector: el('.clearfix'),
        rules: rules([
          new Comment('// .clearfix', { lineComment: true })
        ])
      });

      // These rulesets call .clearfix() - they should find the first one, not themselves
      const clearfixRuleset1 = ruleset({
        selector: el('.clearfix'),
        rules: rules([
          call({ name: ref({ key: '.clearfix' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const clearfixRuleset2 = ruleset({
        selector: el('.clearfix'),
        rules: rules([
          call({ name: ref({ key: '.clearfix' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const clearfixRuleset3 = ruleset({
        selector: el('.clearfix'),
        rules: rules([
          call({ name: ref({ key: '.clearfix' }, { type: 'mixin-ruleset' }) })
        ])
      });

      const root = rules([clearfixMixin, clearfixRuleset1, clearfixRuleset2, clearfixRuleset3]);
      context.root = root;

      const evald = await root.eval(context);
      const css = evald.toString();

      // Each .clearfix ruleset should have called the first .clearfix() mixin
      expect(css).toBeString(``);
      // Should not throw recursion error
    });
  });
});
