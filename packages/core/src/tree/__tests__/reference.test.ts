import { ref, rules, decl, vardecl, spaced, any, quoted, expr, ruleset, mixin, call, compound, el, attr, keyword } from '../index.js';
import { Context } from '../../context.js';
import { EvalSession } from '../../eval-session.js';
import * as Registries from '../util/registry-utils.js';
import { isNode } from '../util/is-node.js';
import { getSourceParent, setParent } from '../util/session-helpers.js';

let context: Context;

describe('reference', () => {
  beforeEach(() => {
    context = new Context();
  });
  describe('serialization', () => {
    it('should serialize a variable reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable' });
      expect(`${node}`).toBe('$foo');
    });

    it('should serialize a property reference', () => {
      let node = ref({ key: 'foo' }, { type: 'property' });
      expect(`${node}`).toBe('$[\'foo\']');
    });

    it('should serialize a declaration reference', () => {
      let node = ref({ key: 'foo' }, { type: 'declaration' });
      expect(`${node}`).toBe('$.foo');
    });

    it('should serialize an optional reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable', fallbackValue: true });
      expect(`${node}`).toBe('$foo?');
    });

    it('should serialize a mixin reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin' });
      expect(`${node}`).toBe('|foo');
    });

    it('should serialize a ruleset reference', () => {
      let node = ref({ key: 'foo' }, { type: 'ruleset' });
      expect(`${node}`).toBe('*(foo)');
    });

    it('should serialize a mixin-ruleset reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin-ruleset' });
      expect(`${node}`).toBe('*foo');
    });

    it('should serialize a number index', () => {
      let node = ref({ key: 0 }, { type: 'index' });
      expect(`${node}`).toBe('$[0]');
    });

    it('should serialize a string index', () => {
      let node = ref({ key: 'foo' }, { type: 'index' });
      expect(`${node}`).toBe('$[foo]');
    });

    it('should serialize a quoted index', () => {
      let node = ref({ key: 'foo' }, { type: 'index' });
      expect(`${node}`).toBe('$[foo]');
    });

    it('should serialize a selector index', () => {
      let node = ref({ key: quoted('foo') }, { type: 'index' });
      expect(`${node}`).toBe('$["foo"]');
    });
  });

  describe('get from scope', () => {
    it('should get a variable from scope', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        bar: red;
      `);
    });

    it('should get a property from scope', async () => {
      let node = rules([
        decl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'property' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        foo: red;
        bar: red;
      `);
    });

    it('should get a var from scope below reference', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        }),
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        bar: red;
      `);
    });

    it('should get a prop from scope below reference', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'property' })
        }),
        decl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        bar: red;
        foo: red;
      `);
    });

    it('should allow recursive referencing', async () => {
      /**
       * $foo: red;
       * $foo: $foo red;
       * bar: $foo;
       */
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        vardecl({
          name: any('foo'),
          value: spaced([expr(ref({ key: 'foo' }, { type: 'variable' })), any('red')])
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        bar: red red;
      `);
    });

    it('evaluates with a session-patched variable key', async () => {
      const lookup = ref({ key: 'foo' }, { type: 'variable' });
      const scope = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        vardecl({
          name: any('bar'),
          value: any('blue')
        }),
        decl({
          name: any('color'),
          value: lookup
        })
      ]);

      context.session = new EvalSession();
      context.session.setField(lookup, 'key', 'bar');
      const preEvald = await scope.preEval(context);
      context.root = preEvald;
      context.rulesContext = preEvald;

      const evald = await lookup.eval(context);
      expect(`${evald}`).toBe('blue');
      expect(lookup.key).toBe('foo');
    });

    it('evaluates with a session-patched target reference', async () => {
      const target = ref({ key: '.theme-a' }, { type: 'mixin-ruleset' });
      const lookup = ref({ target, key: 'primary' }, { type: 'property' });
      const scope = rules([
        ruleset({
          selector: el('.theme-a'),
          rules: rules([
            decl({ name: any('primary'), value: any('red') })
          ])
        }),
        ruleset({
          selector: el('.theme-b'),
          rules: rules([
            decl({ name: any('primary'), value: any('blue') })
          ])
        }),
        decl({
          name: any('color'),
          value: lookup
        })
      ]);

      context.session = new EvalSession();
      context.session.setField(
        lookup,
        'target',
        ref({ key: '.theme-b' }, { type: 'mixin-ruleset' })
      );
      const preEvald = await scope.preEval(context);
      context.root = preEvald;
      context.rulesContext = preEvald;

      const evald = await lookup.eval(context);
      expect(`${evald}`).toBe('blue');
      expect(lookup.target).toBe(target);
    });

    it('should resolve a variable reference with a keyword key inside an attribute selector', async () => {
      let node = rules([
        vardecl({
          name: any('attr-data'),
          value: quoted('test3')
        }),
        ruleset({
          selector: attr({ name: 'data', op: '=', value: ref({ key: keyword('attr-data') }, { type: 'index' }) }),
          rules: rules([
            decl({ name: 'color', value: any('red') })
          ])
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        [data="test3"] {
          color: red;
        }
      `);
    });

    it('uses the session parent chain to anchor linear variable resolution', async () => {
      const scope = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('mid'),
          value: any('keep')
        }),
        decl({
          name: any('host'),
          value: any('placeholder')
        }),
        vardecl({
          name: any('foo'),
          value: any('blue')
        })
      ]);

      context.session = new EvalSession();
      scope.value.forEach((child, index) => {
        child.index = index;
      });
      context.root = scope;
      context.rulesContext = scope;

      const hostDecl = scope.at(2);
      if (!hostDecl || !isNode(hostDecl)) {
        throw new Error('Expected host declaration at index 2');
      }

      const lookup = ref({ key: 'foo' }, { type: 'variable', resolution: 'linear' });
      setParent(lookup, hostDecl, context);

      const evald = await lookup.eval(context);

      expect(`${evald}`).toBe('red');
    });

    it('uses the session parent chain to anchor default variable resolution without rulesContext', async () => {
      const scope = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('host'),
          value: any('placeholder')
        })
      ]);

      context.session = new EvalSession();
      context.root = scope;

      const hostDecl = scope.at(1);
      if (!hostDecl || !isNode(hostDecl)) {
        throw new Error('Expected host declaration at index 1');
      }

      const lookup = ref({ key: 'foo' }, { type: 'variable' });
      setParent(lookup, hostDecl, context);

      const evald = await lookup.eval(context);

      expect(`${evald}`).toBe('red');
    });

    it('uses the session parent chain for mixin lookup without an explicit target', async () => {
      const outer = rules([
        mixin({
          name: any('feature'),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]);
      const inner = rules([
        call({ name: ref({ key: 'feature' }, { type: 'mixin' }) })
      ]);

      context.session = new EvalSession();
      context.root = outer;
      context.rulesContext = inner;
      setParent(inner, outer, context);

      const evald = await inner.at(0)!.eval(context);

      expect(`${evald}`).toContainString('color: red');
    });
  });

  describe('errors', () => {
    it('should throw if the variable is not defined', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'variable' })
        })
      ]);
      await expect(async () => await node.eval(context)).rejects.toThrow();
    });
  });

  describe('nested references for mixin-ruleset lookups', () => {
    it('keeps resolved ruleset sourceParent session-local', async () => {
      const colors = mixin({
        name: any('.colors'),
        rules: rules([
          decl({ name: 'primary', value: any('cyan') })
        ])
      });
      const theme = ruleset({
        selector: el('.theme'),
        rules: rules([colors])
      });
      const node = rules([theme]);
      const themeLookup = ref({ key: '.theme' }, { type: 'mixin-ruleset' });
      const lookup = ref({
        target: themeLookup,
        key: '.colors'
      }, { type: 'mixin-ruleset' });

      context.session = new EvalSession();
      const preEvald = await node.preEval(context);
      context.root = preEvald;
      context.rulesContext = preEvald;

      const resolved = await lookup.eval(context);

      expect(resolved.type).toBe('JsFunction');
      expect(getSourceParent(theme, context)).toBe(themeLookup);
      expect(theme.sourceParent).toBeUndefined();
    });

    it('should register and resolve escaped class selector via string key', async () => {
      const node = rules([
        ruleset({
          selector: el('.\\123'),
          rules: rules([
            decl({ name: 'a', value: any('ok') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.\\123' }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .\\123 {
          a: ok;
        }
        .out {
          a: ok;
        }
      `);
    });

    it('should register and resolve escaped id selector via selector key reference', async () => {
      const node = rules([
        ruleset({
          selector: el('#\\31a'),
          rules: rules([
            decl({ name: 'a', value: any('ok') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: el('#\\31a') }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        #\\31a {
          a: ok;
        }
        .out {
          a: ok;
        }
      `);
    });

    it('should register and resolve escaped compound path via array key reference', async () => {
      const node = rules([
        ruleset({
          selector: compound([el('.a'), el('.\\32b')]),
          rules: rules([
            decl({ name: 'a', value: any('ok') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: ['.a', '.\\32b']
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .a.\\32b {
          a: ok;
        }
        .out {
          a: ok;
        }
      `);
    });

    it('should resolve nested References: #theme → .dark → .navbar → .colors', async () => {
      // #theme {
      //   .dark {
      //     .navbar {
      //       .colors() {
      //         primary: red;
      //       }
      //     }
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      const node = rules([
        ruleset({
          selector: el('#theme'),
          rules: rules([
            ruleset({
              selector: el('.dark'),
              rules: rules([
                ruleset({
                  selector: el('.navbar'),
                  rules: rules([
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('red') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  target: ref({
                    target: ref({
                      target: ref({ key: '#theme' }, { type: 'mixin-ruleset' }),
                      key: '.dark'
                    }, { type: 'mixin-ruleset' }),
                    key: '.navbar'
                  }, { type: 'mixin-ruleset' }),
                  key: '.colors'
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'property' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should resolve compound selector as single Reference: #theme.dark.navbar.colors', async () => {
      // #theme.dark.navbar {
      //   .colors() {
      //     primary: red;
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      const node = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: compound([el('#theme'), el('.dark'), el('.navbar'), el('.colors')])
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'property' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should resolve string array as key: [\'#theme\', \'.dark\', \'.navbar\', \'.colors\']', async () => {
      // #theme.dark.navbar {
      //   .colors() {
      //     primary: red;
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      const node = rules([
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'property' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .output {
          background: red;
        }
      `);
    });

    it('should prefer compound ruleset over nested mixin lookup', async () => {
      // #theme {
      //   .dark {
      //     .navbar() {
      //       .colors() {
      //         primary: cyan;
      //       }
      //     }
      //   }
      // }
      // #theme.dark.navbar {
      //   .colors() {
      //     primary: red;
      //   }
      // }
      // .output {
      //   @colors: #theme.dark.navbar.colors();
      //   background: @colors[primary];
      // }
      // Should use the compound ruleset (#theme.dark.navbar) which has .colors() with primary: red
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
                    mixin({
                      name: any('.colors'),
                      rules: rules([
                        decl({ name: 'primary', value: any('cyan') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: compound([el('#theme'), el('.dark'), el('.navbar')]),
          rules: rules([
            mixin({
              name: any('.colors'),
              rules: rules([
                decl({ name: 'primary', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'colors',
              value: call({
                name: ref({
                  target: ref({
                    target: ref({
                      target: ref({ key: '#theme' }, { type: 'mixin-ruleset' }),
                      key: '.dark'
                    }, { type: 'mixin-ruleset' }),
                    key: '.navbar'
                  }, { type: 'mixin-ruleset' }),
                  key: '.colors'
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'property' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .output {
          background: cyan;
        }
      `);
    });
  });
});
