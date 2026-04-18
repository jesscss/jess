import { ref, rules, decl, vardecl, spaced, any, quoted, expr, ruleset, mixin, call, compound, el, list, atrule, sel, co, interpolated, interpolatedSelector, INTERPOLATION_PLACEHOLDER, Rules as RulesClass } from '../index.js';
import { Context } from '../../context.js';
import * as Registries from '../util/registry-utils.js';
import { isNode } from '../util/is-node.js';
let context: Context;

describe('reference', () => {
  beforeEach(() => {
    context = new Context();
  });
  describe('serialization', () => {
    it('renders a variable reference through render()', () => {
      let node = ref({ key: 'foo' }, { type: 'variable' });
      expect(node.render()).toBe('$foo');
    });

    it('should serialize a variable reference', () => {
      let node = ref({ key: 'foo' }, { type: 'variable' });
      expect(`${node}`).toBe('$foo');
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
      expect(`${node}`).toBe('$ > foo');
    });

    it('should serialize a mixin-ruleset reference', () => {
      let node = ref({ key: 'foo' }, { type: 'mixin-ruleset' });
      expect(`${node}`).toBe('$ > *foo');
    });

    it('should serialize a number index', () => {
      let node = ref({ key: 0 }, { type: 'index' });
      expect(`${node}`).toBe('$[0]');
    });

    it('should serialize a string (variable) index', () => {
      let node = ref({ key: 'foo' }, { type: 'index' });
      expect(`${node}`).toBe('$[foo]');
    });

    it('should serialize a quoted (property) index', () => {
      let node = ref({ key: quoted('foo') }, { type: 'index' });
      expect(`${node}`).toBe('$["foo"]');
    });
  });

  describe('get from scope', () => {
    it('renders a resolved variable value through render(context)', async () => {
      const node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        })
      ]);
      const evald = await node.eval(context);
      context.root = evald as RulesClass;
      context.rulesContext = evald as RulesClass;

      const rendered = ref({ key: 'foo' }, { type: 'variable' }).render(context);

      expect(rendered).toBe('red');
    });

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

    it('should get a property from scope via quoted index', async () => {
      let node = rules([
        decl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: quoted('foo') }, { type: 'index' })
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

    it('should get a prop from scope below reference via quoted index', async () => {
      let node = rules([
        decl({
          name: any('bar'),
          value: ref({ key: quoted('foo') }, { type: 'index' })
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

    it('should resolve merged property lookups via quoted index inside a nested child scope', async () => {
      let node = rules([
        decl({
          name: any('background-color'),
          value: any('red')
        }, { assign: '+:' }),
        decl({
          name: any('background-color'),
          value: any('foo')
        }, { assign: '+:' }),
        rules([
          decl({
            name: any('background'),
            value: ref({ key: quoted('background-color') }, { type: 'index' })
          })
        ])
      ]);
      const child = node.value[2]!;
      child.parent = node;
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        background-color: red, foo;
        background: red, foo;
      `);
    });

    it('should treat keyword index as variable lookup', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      /** The var declaration will be removed when going to CSS */
      expect(`${evald}`).toBeString(`
        bar: red;
      `);
    });

    it('should find a VarDeclaration via declaration type when both types exist', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'declaration' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        foo: blue;
        bar: blue;
      `);
    });

    it('should find a Declaration via declaration type when both types exist', async () => {
      let node = rules([
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'declaration' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        foo: blue;
        bar: red;
      `);
    });

    it('should find a variable via keyword index (not a property)', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: 'foo' }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        foo: blue;
        bar: red;
      `);
    });

    it('should find a property via quoted index (not a variable)', async () => {
      let node = rules([
        vardecl({
          name: any('foo'),
          value: any('red')
        }),
        decl({
          name: any('foo'),
          value: any('blue')
        }),
        decl({
          name: any('bar'),
          value: ref({ key: quoted('foo') }, { type: 'index' })
        })
      ]);
      let evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        foo: blue;
        bar: blue;
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

    it('plain lexical misses do not fall back to DeclarationRegistry.find when no child scopes are searchable', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'missing') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          decl({
            name: any('bar'),
            value: ref({ key: 'missing' }, { type: 'variable' })
          })
        ]);
        await expect(async () => await node.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('plain lexical misses do not fall back when only later child rules could match', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'missing') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          decl({
            name: any('bar'),
            value: ref({ key: 'missing' }, { type: 'variable' })
          }),
          rules([
            vardecl({
              name: any('missing'),
              value: any('red')
            })
          ], {
            rulesVisibility: {
              VarDeclaration: 'public'
            }
          })
        ]);
        await expect(async () => await node.eval(new Context({ leakyRules: true }))).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('plain lexical misses ignore unresolved dynamic declaration names without declaration-registry fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'missing') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'missing' }, { type: 'variable' })
          })
        ]);
        await expect(async () => await node.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('same-scope unresolved dynamic names before a static winner do not force declaration-registry fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          vardecl({
            name: any('x'),
            value: any('blue')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);
        const evald = await node.eval(context);
        expect(`${evald}`).toBeString(`
          bar: blue;
        `);
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('same-scope unresolved dynamic names after a static winner do not force declaration-registry fallback', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: any('x'),
            value: any('blue')
          }),
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);
        const evald = await node.eval(context);
        expect(`${evald}`).toBeString(`
          bar: blue;
        `);
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('prunes stale pendingDynamicDecls entries when a dynamic name resolves after ScopeFrame creation', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        let node = rules([
          vardecl({
            name: any('suffix'),
            value: any('x')
          }),
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);

        // Force a pre-resolution frame snapshot so pendingDynamicDecls is populated first.
        node.getScopeFrame();

        node = await node.eval(context);
        expect(`${node}`).toBeString(`
          bar: red;
        `);
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('promotes pending dynamic declarations that have already become static before lookup', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);

        const frame = node.getScopeFrame();
        const dynamicDecl = node.at(0)!;
        dynamicDecl.set('name', any('x'));

        const resolved = await node.at(1)!.eval(context);
        expect(`${resolved}`).toBe('bar: red');
        expect(declarationHits).toHaveLength(0);
        expect(frame.pendingDynamicDecls).toHaveLength(0);
        expect(frame.declarationBucketsByName.get('x')?.at(-1)?.sourceNode).toBe(dynamicDecl);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('ignores still-dynamic pending names even when they would be synchronously computable', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: any('suffix'),
            value: any('x')
          }),
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [ref({ key: 'suffix' }, { type: 'variable' })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);

        const frame = node.getScopeFrame();
        context.rulesContext = node;
        await expect(async () => await node.at(2)!.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
        expect(frame.pendingDynamicDecls).toHaveLength(1);
      } finally {
        context.rulesContext = undefined;
        RulesClass.prototype.find = originalFind;
      }
    });

    it('rejects when pending dynamic names are still asynchronously unresolved', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'x') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          vardecl({
            name: interpolated({
              source: '%%',
              replacements: [call({ name: ref({ key: 'async-name' }, { type: 'function' }) })]
            }),
            value: any('red')
          }),
          decl({
            name: any('bar'),
            value: ref({ key: 'x' }, { type: 'variable' })
          })
        ]);
        node.getRegistry('function').add('async-name', async () => any('x'));

        const frame = node.getScopeFrame();
        context.rulesContext = node;
        await expect(async () => await node.at(1)!.eval(context)).rejects.toThrow();
        expect(declarationHits).toHaveLength(0);
        expect(frame.pendingDynamicDecls).toHaveLength(1);
      } finally {
        context.rulesContext = undefined;
        RulesClass.prototype.find = originalFind;
      }
    });
  });

  describe('nested references for mixin-ruleset lookups', () => {
    it('should resolve quoted index property access on mixin-returned rules', async () => {
      const node = rules([
        mixin({
          name: any('.mk-map'),
          rules: rules([
            decl({ name: 'text', value: any('white') }),
            decl({ name: 'background', value: any('black') })
          ])
        }),
        ruleset({
          selector: el('.output'),
          rules: rules([
            vardecl({
              name: 'p',
              value: call({
                name: ref({ key: '.mk-map' }, { type: 'mixin-ruleset' }),
                args: list([])
              })
            }),
            decl({
              name: 'color',
              value: ref({
                target: ref({ key: 'p' }, { type: 'variable' }),
                key: quoted('text')
              }, { type: 'index' })
            })
          ])
        })
      ]);
      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .output {
          color: white;
        }
      `);
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
              }, { type: 'declaration' })
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
              }, { type: 'declaration' })
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
              }, { type: 'declaration' })
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

    it('should prefer a compound-prefix ruleset when a longer string array can continue inside it', async () => {
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
                  key: ['#theme', '.dark', '.navbar', '.colors']
                }, { type: 'mixin-ruleset' })
              })
            }),
            decl({
              name: 'background',
              value: ref({
                target: ref({ key: 'colors' }, { type: 'variable' }),
                key: 'primary'
              }, { type: 'declaration' })
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

    it('fast-paths compound-prefix callable ruleset precedence without MixinRegistry.find', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
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
                    key: ['#theme', '.dark', '.navbar', '.colors']
                  }, { type: 'mixin-ruleset' })
                })
              }),
              decl({
                name: 'background',
                value: ref({
                  target: ref({ key: 'colors' }, { type: 'variable' }),
                  key: 'primary'
                }, { type: 'declaration' })
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
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('should resolve a mixin-ruleset call keyed by BasicSelector', async () => {
      const node = rules([
        mixin({
          name: any('.mixin-with-directives'),
          params: list([any('keyframeName', { role: 'property' })]),
          rules: rules([
            atrule({
              name: any('@keyframes'),
              prelude: ref({ key: 'keyframeName' }, { type: 'variable' }),
              rules: rules([
                decl({ name: 'property', value: any('value') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: el('.mixin-with-directives') }, { type: 'mixin-ruleset' }),
              args: list([any('some-name')])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(`${evald}`).toContain('@keyframes some-name');
    });

    it('should resolve a mixin-ruleset call keyed by a compound selector path array', async () => {
      const node = rules([
        ruleset({
          selector: compound([
            el('.b'),
            el('.bb'),
            el('.foo-xxx'),
            el('.yyy-foo'),
            el('#foo'),
            el('.foo'),
            el('.bbb')
          ]),
          rules: rules([
            decl({ name: 'b', value: any('1') })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        .b.bb.foo-xxx.yyy-foo#foo.foo.bbb {
          b: 1;
        }
        .out {
          b: 1;
        }
      `);
    });

    it('fast-paths exact callable ruleset array paths without MixinRegistry.find when no namespace start exists', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '.b') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          ruleset({
            selector: compound([
              el('.b'),
              el('.bb'),
              el('.foo-xxx'),
              el('.yyy-foo'),
              el('#foo'),
              el('.foo'),
              el('.bbb')
            ]),
            rules: rules([
              decl({ name: 'b', value: any('1') })
            ])
          }),
          ruleset({
            selector: el('.out'),
            rules: rules([
              call({
                name: ref({
                  key: ['.b', '.bb', '.foo-xxx', '.yyy-foo', '#foo', '.foo', '.bbb']
                }, { type: 'mixin-ruleset' })
              })
            ])
          })
        ]);

        const evald = await node.eval(context);
        expect(`${evald}`).toBeString(`
          .b.bb.foo-xxx.yyy-foo#foo.foo.bbb {
            b: 1;
          }
          .out {
            b: 1;
          }
        `);
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('should resolve a mixin-ruleset call keyed by a complex selector while ignoring namespace separators', async () => {
      const node = rules([
        ruleset({
          selector: sel([el('#foo-foo')]),
          rules: rules([
            ruleset({
              selector: sel([co('>'), compound([el('.bar'), el('.baz')])]),
              rules: rules([
                decl({ name: 'c', value: any('c') })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({
                key: sel([el('#foo-foo'), co('>'), compound([el('.bar'), el('.baz')])])
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      expect(`${evald}`).toBeString(`
        #foo-foo {
          > .bar.baz {
            c: c;
          }
        }
        .out {
          c: c;
        }
      `);
    });

    it('fast-paths complex selector callable ruleset paths without MixinRegistry.find under a ruleset namespace prefix', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#foo-foo') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          ruleset({
            selector: sel([el('#foo-foo')]),
            rules: rules([
              ruleset({
                selector: sel([co('>'), compound([el('.bar'), el('.baz')])]),
                rules: rules([
                  decl({ name: 'c', value: any('c') })
                ])
              })
            ])
          }),
          ruleset({
            selector: el('.out'),
            rules: rules([
              call({
                name: ref({
                  key: sel([el('#foo-foo'), co('>'), compound([el('.bar'), el('.baz')])])
                }, { type: 'mixin-ruleset' })
              })
            ])
          })
        ]);

        const evald = await node.eval(context);
        expect(`${evald}`).toBeString(`
          #foo-foo {
            > .bar.baz {
              c: c;
            }
          }
          .out {
            c: c;
          }
        `);
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('should resolve nested mixin-ruleset reference chains through nested mixins', async () => {
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
      // Because this is a nested reference chain, it should keep traversing the
      // nested mixin namespace and resolve primary: cyan.
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
              }, { type: 'declaration' })
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

    it('fast-paths pure nested no-arg mixin namespace array paths without MixinRegistry.find', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
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
                }, { type: 'declaration' })
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
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('does not fall back for unrelated rulesets that only share the first namespace segment', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
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
            selector: compound([el('#theme'), el('.warning')]),
            rules: rules([
              mixin({
                name: any('.palette'),
                rules: rules([
                  decl({ name: 'primary', value: any('orange') })
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
                }, { type: 'declaration' })
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
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('fast-paths terminal rulesets under pure nested no-arg mixin namespaces without MixinRegistry.find', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
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
                      ruleset({
                        selector: el('.colors'),
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
                }, { type: 'declaration' })
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
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('fast-paths compound-prefix precedence even when a competing namespace hop requires args', async () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          mixin({
            name: any('#theme'),
            rules: rules([
              mixin({
                name: any('.dark'),
                params: list([any('mode', { role: 'property' })]),
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
                    key: ['#theme', '.dark', '.navbar', '.colors']
                  }, { type: 'mixin-ruleset' })
                })
              }),
              decl({
                name: 'background',
                value: ref({
                  target: ref({ key: 'colors' }, { type: 'variable' }),
                  key: 'primary'
                }, { type: 'declaration' })
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
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('treats required-arg intermediate namespace hops as definite misses when no compound-prefix ruleset is involved', () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
        const node = rules([
          mixin({
            name: any('#theme'),
            rules: rules([
              mixin({
                name: any('.dark'),
                params: list([any('mode', { role: 'property' })]),
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
          })
        ]);

        context.root = node;
        context.rulesContext = node;

        const result = node.find('mixin', ['#theme', '.dark', '.navbar', '.colors'], undefined, {
          context
        });

        expect(result).toBeUndefined();
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });

    it('fast-paths definite namespace array-path misses without MixinRegistry.find', () => {
      const originalFind = Registries.MixinRegistry.prototype.find;
      const mixinRegistryHits: string[] = [];
      Registries.MixinRegistry.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [key] = args;
        if (Array.isArray(key) && key[0] === '#theme') {
          mixinRegistryHits.push(key.join(' '));
        }
        return originalFind.apply(this, args);
      };

      try {
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
          })
        ]);

        context.root = node;
        context.rulesContext = node;

        const result = node.find('mixin', ['#theme', '.dark', '.missing', '.colors'], undefined, {
          context
        });

        expect(result).toBeUndefined();
        expect(mixinRegistryHits).toHaveLength(0);
      } finally {
        Registries.MixinRegistry.prototype.find = originalFind;
      }
    });
  });
});
