import {
  rules, sel, el, spaced, any, sellist, ruleset, decl, atrule,
  vardecl, ref, mixin, call, list, op,
  num, dimension, amp,
  paren, seq, comment, nil, quoted, color, co, interpolated
} from '../index.js';
import { Context } from '../../context.js';
import { AtRule } from '../at-rule.js';
import { Rules } from '../rules.js';
import { Node } from '../node.js';
import { serializeTypes } from '../util/serialize-types.js';
import * as path from 'path';
import * as fs from 'fs';

let context: Context;

describe('AtRule', () => {
  beforeEach(() => {
    context = new Context();
  });

  it('keeps static leaf at-rules canonical in preEval', async () => {
    const node = atrule({
      name: any('@namespace', { role: 'atkeyword' }),
      prelude: seq([any('svg')])
    });

    const preEvald = await node.preEval(context);

    expect(preEvald).toBe(node);
  });

  it('keeps static at-rules canonical in preEval when child rules are already preEvaluated', async () => {
    const body = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    body.preEvaluated = true;
    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([any('screen', { role: 'keyword' })]),
      rules: body
    });

    const preEvald = await node.preEval(context);

    expect(preEvald).toBe(node);
  });

  it('keeps interpolated at-rule preEval wrappers self-owned instead of back-pointing to the canonical at-rule', async () => {
    const node = atrule({
      name: interpolated({
        source: '@media',
        replacements: []
      }),
      prelude: seq([any('screen', { role: 'keyword' })])
    });

    const preEvald = await node.preEval(context);

    expect(preEvald).not.toBe(node);
    expect(preEvald).toBeInstanceOf(AtRule);
    expect(preEvald.sourceNode).toBe(preEvald);
    if (!(preEvald instanceof AtRule)) {
      throw new Error('Expected AtRule result');
    }
    expect(preEvald.value.name.valueOf()).toBe('@media');
  });

  it('renders resolved at-rules through render(context)', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    expect(node.render(context)).toBeString(`
      @media print {
        color: red;
      }
    `);
  });

  it('resolves at-rules without touching render state', async () => {
    const root = rules([
      vardecl({
        name: 'mode',
        value: any('print')
      })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const node = atrule({
      name: any('@media', { role: 'atkeyword' }),
      prelude: seq([ref({ key: 'mode' }, { type: 'variable' })]),
      rules: rules([
        decl({ name: 'color', value: any('red') })
      ])
    });

    const resolved = await node.resolve(context);

    expect(resolved.toTrimmedString()).toBeString(`
      @media print {
        color: red;
      }
    `);
    expect(context.printState.writer).toBeUndefined();
  });

  describe('nested @media rules', () => {
    it('should handle nested @media rules inside rulesets', async () => {
      // Represents: .body { @media print { padding: 20px; } }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: rules([
                decl({ name: 'padding', value: dimension([20, 'px']) })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
          }
        }
      `);
    });

    /**
     * We need to hoist rulesets that have Less-style ampersands
     * that add to the inherited selector.
     */
    it('should collapse ampersands when we need to', async () => {
      // Represents:
      // .body {
      //   @media print {
      //     padding: 20px;
      //     &-1 {
      //       color: black;
      //     }
      //   }
      // }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: rules([
                decl({ name: 'padding', value: dimension([20, 'px']) }),
                ruleset({
                  selector: sel([amp('-1')]),
                  rules: rules([
                    decl({ name: 'color', value: any('black') })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
          }
        }
        @media print {
          .body-1 {
            color: black;
          }
        }
      `);
    });

    it('should collapse ampersands when we need to #2', async () => {
      // Represents:
      // .body {
      //   @media print {
      //     padding: 20px;
      //     &-1 {
      //       color: black;
      //     }
      //     background-color: white;
      //     &-2 {
      //       color: blue;
      //     }
      //   }
      // }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: rules([
                decl({ name: 'padding', value: dimension([20, 'px']) }),
                ruleset({
                  selector: sel([amp('-1')]),
                  rules: rules([
                    decl({ name: 'color', value: any('black') })
                  ])
                }),
                decl({ name: 'background-color', value: any('white') }),
                ruleset({
                  selector: sel([amp('-2')]),
                  rules: rules([
                    decl({ name: 'color', value: any('blue') })
                  ])
                }),
                ruleset({
                  selector: sel([amp('-3')]),
                  rules: rules([
                    decl({ name: 'color', value: any('red') })
                  ])
                })
              ])
            }),
            decl({ name: 'zoom', value: num(1) })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
          }
        }
        @media print {
          .body-1 {
            color: black;
          }
        }
        .body {
          @media print {
            background-color: white;
          }
        }
        @media print {
          .body-2 {
            color: blue;
          }
          .body-3 {
            color: red;
          }
        }
        .body {
          zoom: 1;
        }
      `);
    });

    it('should handle deeply nested @media rules', async () => {
      // Represents: .body { @media print { header { background-color: red; @media (orientation:landscape) { margin-left: 20px; } } } }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: rules([
                decl({ name: 'padding', value: dimension([20, 'px']) }),
                ruleset({
                  selector: sel([el('header')]),
                  rules: rules([
                    decl({ name: 'background-color', value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 }) }),
                    atrule({
                      name: any('@media', { role: 'atkeyword' }),
                      prelude: seq([paren(decl({
                        name: 'orientation',
                        value: any('landscape')
                      }))]),
                      rules: rules([
                        decl({ name: 'margin-left', value: dimension([20, 'px']) })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .body {
          @media print {
            padding: 20px;
            header {
              background-color: red;
              @media (orientation: landscape) {
                margin-left: 20px;
              }
            }
          }
        }
      `);
    });
  });

  describe('collapse nesting at-rule categories', () => {
    it('keeps nested @starting-style in place when collapseNesting is true', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        ruleset({
          selector: sel([el('[popover]:popover-open')]),
          rules: rules([
            decl({ name: 'opacity', value: num(1) }),
            atrule({
              name: any('@starting-style', { role: 'atkeyword' }),
              rules: rules([
                decl({ name: 'opacity', value: num(0) })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        [popover]:popover-open {
          opacity: 1;
          @starting-style {
            opacity: 0;
          }
        }
      `);
    });

    it('keeps leaf custom at-rules inside the current ruleset', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        ruleset({
          selector: sel([el('.box')]),
          rules: rules([
            atrule({
              name: any('@apply', { role: 'atkeyword' }),
              prelude: any('h-64 w-64')
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        .box {
          @apply h-64 w-64;
        }
      `);
    });

    it('does not compose root-only @keyframes children with parent selector context', async () => {
      context = new Context({ collapseNesting: true, bubbleRootAtRules: true });
      const node = rules([
        ruleset({
          selector: sel([el('.onTop')]),
          rules: rules([
            atrule({
              name: any('@keyframes', { role: 'atkeyword' }),
              prelude: quoted(any('textscale')),
              rules: rules([
                ruleset({
                  selector: sel([el('0%')]),
                  rules: rules([
                    decl({ name: 'font-size', value: dimension([1, 'em']) })
                  ])
                }),
                ruleset({
                  selector: sel([el('100%')]),
                  rules: rules([
                    decl({ name: 'font-size', value: dimension([2, 'em']) })
                  ])
                })
              ])
            }),
            decl({ name: 'animation', value: quoted(any('textscale')) })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        @keyframes "textscale" {
          0% {
            font-size: 1em;
          }
          100% {
            font-size: 2em;
          }
        }
        .onTop {
          animation: "textscale";
        }
      `);
    });

    it('treats generated hoisted ampersand wrappers as transparent inside nested wrapper at-rules', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        atrule({
          name: any('@supports', { role: 'atkeyword' }),
          prelude: paren(decl({ name: 'property', value: any('value') })),
          rules: rules([
            ruleset({
              selector: sel([el('.outOfMedia'), co(' '), amp()]),
              rules: rules([
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({ name: 'max-size', value: dimension([2, 'px']) })),
                  rules: rules([
                    atrule({
                      name: any('@supports', { role: 'atkeyword' }),
                      prelude: paren(decl({ name: 'whatever', value: any('something') })),
                      rules: rules([
                        decl({ name: 'property', value: any('value') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        @supports (property: value) {
          @media (max-size: 2px) {
            @supports (whatever: something) {
              .outOfMedia {
                property: value;
              }
            }
          }
        }
      `);
    });

    it('does not merge adjacent root-only at-rules with identical headers', async () => {
      const node = rules([
        atrule({
          name: any('@font-face', { role: 'atkeyword' }),
          rules: rules([
            decl({ name: 'font-family', value: quoted('One') })
          ])
        }),
        atrule({
          name: any('@font-face', { role: 'atkeyword' }),
          rules: rules([
            decl({ name: 'font-family', value: quoted('Two') })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        @font-face {
          font-family: "One";
        }
        @font-face {
          font-family: "Two";
        }
      `);
    });

    it('does not merge adjacent wrapper at-rules from distinct sibling branches', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        ruleset({
          selector: sel([el('.one')]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('screen', { role: 'keyword' })]),
              rules: rules([
                decl({ name: 'color', value: any('red') })
              ])
            })
          ])
        }),
        ruleset({
          selector: sel([el('.two')]),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('screen', { role: 'keyword' })]),
              rules: rules([
                decl({ name: 'color', value: any('blue') })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        @media screen {
          .one {
            color: red;
          }
        }
        @media screen {
          .two {
            color: blue;
          }
        }
      `);
    });

    it('does not merge identical wrapper stacks across at-rule and hoisted-ruleset sibling branches', async () => {
      context.opts.collapseNesting = true;
      const node = rules([
        atrule({
          name: any('@supports', { role: 'atkeyword' }),
          prelude: paren(decl({ name: 'property', value: any('value') })),
          rules: rules([
            ruleset({
              selector: sel([el('.outOfMedia'), co(' '), amp()]),
              rules: rules([
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({ name: 'max-size', value: dimension([2, 'px']) })),
                  rules: rules([
                    atrule({
                      name: any('@supports', { role: 'atkeyword' }),
                      prelude: paren(decl({ name: 'whatever', value: any('something') })),
                      rules: rules([
                        decl({ name: 'property', value: any('value') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: sel([el('.onTop'), co(' '), amp()]),
          rules: rules([
            atrule({
              name: any('@supports', { role: 'atkeyword' }),
              prelude: paren(decl({ name: 'property', value: any('value') })),
              rules: rules([
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: paren(decl({ name: 'max-size', value: dimension([2, 'px']) })),
                  rules: rules([
                    atrule({
                      name: any('@supports', { role: 'atkeyword' }),
                      prelude: paren(decl({ name: 'whatever', value: any('something') })),
                      rules: rules([
                        decl({ name: 'property', value: any('value') })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString({ context });

      expect(css).toBeString(`
        @supports (property: value) {
          @media (max-size: 2px) {
            @supports (whatever: something) {
              .outOfMedia {
                property: value;
              }
            }
          }
        }
        @supports (property: value) {
          @media (max-size: 2px) {
            @supports (whatever: something) {
              .onTop {
                property: value;
              }
            }
          }
        }
      `);
    });
  });

  describe('@media with mixins and parameters', () => {
    it('should handle mixin with nested @media using parameter', async () => {
      // Represents:
      // .mediaMixin(@fallback: 200px) {
      //   background: black;
      //   @media handheld {
      //     background: white;
      //     @media (max-width: @fallback) {
      //       background: red;
      //     }
      //   }
      // }
      // .a {
      //   .mediaMixin(100px);
      // }
      const mixinDef = mixin({
        name: any('.mediaMixin'),
        params: list([
          vardecl({ name: 'fallback', value: dimension([200, 'px']) }, { paramVar: true })
        ]),
        rules: rules([
          decl({ name: 'background', value: color({ node: 'black', format: 0, rgb: [0, 0, 0], alpha: 1 }) }),
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([any('handheld', { role: 'keyword' })]),
            rules: rules([
              decl({ name: 'background', value: color({ node: 'white', format: 0, rgb: [255, 255, 255], alpha: 1 }) }),
              atrule({
                name: any('@media', { role: 'atkeyword' }),
                prelude: seq([paren(decl({
                  name: 'max-width',
                  value: ref({ key: 'fallback' }, { type: 'variable' })
                }))]),
                rules: rules([
                  decl({ name: 'background', value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 }) })
                ])
              })
            ])
          })
        ])
      });

      const callSite = ruleset({
        selector: sel([el('.a')]),
        rules: rules([
          call({
            name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' }),
            args: list([dimension([100, 'px'])])
          })
        ])
      });

      const rootRules = rules([mixinDef, callSite]);
      context.root = rootRules;
      const evald = await rootRules.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .a {
          background: black;
          @media handheld {
            background: white;
            @media (max-width: 100px) {
              background: red;
            }
          }
        }
      `);
    });
  });

  describe('multiple @media rules', () => {
    it('should handle multiple @media rules at root level', async () => {
      // Represents: @media print { ... } @media screen { ... }
      const node = rules([
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('print', { role: 'keyword' })]),
          rules: rules([
            ruleset({
              selector: sel([el('.class')]),
              rules: rules([
                decl({ name: 'color', value: color({ node: 'blue', format: 0, rgb: [0, 0, 255], alpha: 1 }) })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('screen', { role: 'keyword' })]),
          rules: rules([
            vardecl({ name: any('base', { role: 'ident' }), value: num(8) }),
            ruleset({
              selector: sel([el('.body')]),
              rules: rules([
                decl({ name: 'max-width', value: op([ref('base', { type: 'variable' }), '*', num(60)]) })
              ])
            })
          ])
        })
      ]);

      context.root = node;
      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        @media print {
          .class {
            color: blue;
          }
        }
        @media screen {
          .body {
            max-width: 480;
          }
        }
      `);
    });
  });

  describe('@media with variables in prelude', () => {
    it('should handle @media with variable references in prelude', async () => {
      // Represents: @all: ~"all"; @tv: ~"(tv)"; @media @all and @tv { ... }
      const node = rules([
        vardecl({ name: any('all', { role: 'ident' }), value: quoted(any('all', { role: 'any' }), { escaped: true }) }),
        vardecl({ name: any('tv', { role: 'ident' }), value: quoted(any('(tv)', { role: 'any' }), { escaped: true }) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([ref('all', { type: 'variable' }), any('and', { role: 'keyword' }), ref('tv', { type: 'variable' })]),
          rules: rules([
            ruleset({
              selector: sel([el('.all-and-tv-variables')]),
              rules: rules([
                decl({ name: 'var', value: spaced([any('all-and-tv')]) })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        @media all and (tv) {
          .all-and-tv-variables {
            var: all-and-tv;
          }
        }
      `);
    });
  });

  describe('@media with expressions in prelude', () => {
    it('should handle @media with expressions in prelude', async () => {
      // Represents: @some-var: 60px; @media screen and (min-width: (@some-var + 1)) { ... }
      const node = rules([
        vardecl({ name: any('some-var', { role: 'ident' }), value: dimension([60, 'px']) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('screen', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            paren(decl({
              name: 'min-width',
              value: op([ref('some-var', { type: 'variable' }), '+', num(1)])
            }))
          ]),
          rules: rules([
            ruleset({
              selector: sel([el('.selector')]),
              rules: rules([
                decl({ name: 'foo', value: spaced([any('bar')]) })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        @media screen and (min-width: 61px) {
          .selector {
            foo: bar;
          }
        }
      `);
    });
  });

  describe('@media with multiple conditions', () => {
    it('should handle @media with comma-separated conditions', async () => {
      // Represents: @media screen and (color), projection and (color) { ... }
      const node = rules([
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              any('screen', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              paren(any('color', { role: 'keyword' }))
            ]),
            seq([
              any('projection', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              paren(any('color', { role: 'keyword' }))
            ])
          ]),
          rules: rules([
            ruleset({
              selector: sel([el('.selector')]),
              rules: rules([
                decl({ name: 'color', value: color({ node: '#eee', format: 0 }) })
              ])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        @media screen and (color), projection and (color) {
          .selector {
            color: #eee;
          }
        }
      `);
    });
  });

  describe('nested @media in mixin calls', () => {
    it('should handle mixin call with nested @media', async () => {
      // Represents:
      // .nav-justified() {
      //   @media (min-width: 480px) {
      //     > li {
      //       display: table-cell;
      //     }
      //   }
      // }
      // .menu {
      //   @media (min-width: 768px) {
      //     .nav-justified();
      //   }
      // }
      const navJustifiedMixin = mixin({
        name: any('.nav-justified'),
        rules: rules([
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([paren(decl({
              name: 'min-width',
              value: dimension([480, 'px'])
            }))]),
            rules: rules([
              ruleset({
                selector: sel([el('> li')]),
                rules: rules([
                  decl({ name: 'display', value: spaced([any('table-cell')]) })
                ])
              })
            ])
          })
        ])
      });

      const callSite = ruleset({
        selector: sel([el('.menu')]),
        rules: rules([
          atrule({
            name: any('@media', { role: 'atkeyword' }),
            prelude: seq([paren(decl({
              name: 'min-width',
              value: dimension([768, 'px'])
            }))]),
            rules: rules([
              call({
                name: ref({ key: '.nav-justified' }, { type: 'mixin-ruleset' })
              })
            ])
          })
        ])
      });

      const rootRules = rules([navJustifiedMixin, callSite]);
      context.root = rootRules;
      const evald = await rootRules.eval(context);
      const css = evald.toString();

      expect(css).toBeString(`
        .menu {
          @media (min-width: 768px) {
            @media (min-width: 480px) {
              > li {
                display: table-cell;
              }
            }
          }
        }
      `);
    });
  });

  describe('serialization test for media.less AST', () => {
    it('should serialize the exact AST structure from media.less.s-expr.txt', async () => {
      context.opts.collapseNesting = true;
      // Build the AST exactly as represented in media.less.s-expr.txt
      const node = rules([
        comment('// For now, variables can\'t be declared…', { lineComment: true }),
        vardecl({ name: any('var', { role: 'ident' }), value: num(42) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('print', { role: 'keyword' })]),
          rules: rules([
            ruleset({
              selector: el('.class'),
              rules: rules([
                decl({
                  name: 'color',
                  value: color({ node: 'blue', format: 0, rgb: [0, 0, 255], alpha: 1 })
                }),
                ruleset({
                  selector: el('.sub'),
                  rules: rules([
                    decl({
                      name: 'width',
                      value: ref({ key: 'var' }, { type: 'variable' })
                    })
                  ])
                })
              ])
            }),
            ruleset({
              selector: sellist([
                el('.top'),
                sel([
                  el('header'),
                  co('>'),
                  el('h1')
                ])
              ]),
              rules: rules([
                decl({
                  name: 'color',
                  value: paren(op([
                    color({ node: '#222', format: 0 }),
                    '*',
                    num(2)
                  ]))
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('screen', { role: 'keyword' })]),
          rules: rules([
            vardecl({ name: any('base', { role: 'ident' }), value: num(8) }),
            ruleset({
              selector: el('.body'),
              rules: rules([
                decl({
                  name: 'max-width',
                  value: paren(op([
                    ref({ key: 'base' }, { type: 'variable' }),
                    '*',
                    num(60)
                  ]))
                })
              ])
            })
          ])
        }),
        vardecl({ name: any('ratio_large', { role: 'ident' }), value: num(16) }),
        vardecl({ name: any('ratio_small', { role: 'ident' }), value: num(9) }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('all', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            seq([
              paren(decl({
                name: 'device-aspect-ratio',
                value: quoted(interpolated({
                  source: '%% / %%',
                  replacements: [
                    ref({ key: 'ratio_large' }, { type: 'variable' }),
                    ref({ key: 'ratio_small' }, { type: 'variable' })
                  ]
                }, { role: 'ident' }), { escaped: true })
              }))
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('.body'),
              rules: rules([
                decl({
                  name: 'max-width',
                  value: dimension([800, 'px'])
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('all', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            seq([
              paren(decl({
                name: 'orientation',
                value: any('portrait')
              }))
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('aside'),
              rules: rules([
                decl({
                  name: 'float',
                  value: any('none')
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              any('handheld', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(decl({
                  name: 'min-width',
                  value: ref({ key: 'var' }, { type: 'variable' })
                }))
              ])
            ]),
            seq([
              any('screen', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(decl({
                  name: 'min-width',
                  value: dimension([20, 'em'])
                }))
              ])
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('.body'),
              rules: rules([
                decl({
                  name: 'max-width',
                  value: dimension([480, 'px'])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.body'),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('print', { role: 'keyword' })]),
              rules: rules([
                decl({
                  name: 'padding',
                  value: dimension([20, 'px'])
                }),
                ruleset({
                  selector: el('header'),
                  rules: rules([
                    decl({
                      name: 'background-color',
                      value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                    })
                  ])
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'orientation',
                      value: any('landscape')
                    }))
                  ]),
                  rules: rules([
                    decl({
                      name: 'margin-left',
                      value: dimension([20, 'px'])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('screen', { role: 'keyword' })]),
          rules: rules([
            ruleset({
              selector: el('.sidebar'),
              rules: rules([
                decl({
                  name: 'width',
                  value: dimension([300, 'px'])
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'orientation',
                      value: any('landscape')
                    }))
                  ]),
                  rules: rules([
                    decl({
                      name: 'width',
                      value: dimension([500, 'px'])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('a', { role: 'keyword' })]),
          rules: rules([
            ruleset({
              selector: el('.first'),
              rules: rules([
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(any('b', { role: 'keyword' }))
                  ]),
                  rules: rules([
                    ruleset({
                      selector: el('.second'),
                      rules: rules([
                        ruleset({
                          selector: el('.third'),
                          rules: rules([
                            decl({
                              name: 'width',
                              value: dimension([300, 'px'])
                            }),
                            atrule({
                              name: any('@media', { role: 'atkeyword' }),
                              prelude: seq([
                                paren(any('c', { role: 'keyword' }))
                              ]),
                              rules: rules([
                                decl({
                                  name: 'width',
                                  value: dimension([500, 'px'])
                                })
                              ])
                            })
                          ])
                        }),
                        ruleset({
                          selector: el('.fourth'),
                          rules: rules([
                            decl({
                              name: 'width',
                              value: num(3)
                            })
                          ])
                        })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.body'),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: list([
                seq([any('a', { role: 'keyword' })]),
                seq([
                  paren(any('b', { role: 'keyword' })),
                  any('and', { role: 'keyword' }),
                  paren(any('c', { role: 'keyword' }))
                ])
              ]),
              rules: rules([
                decl({
                  name: 'width',
                  value: dimension([95, '%'])
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: list([
                    seq([paren(any('x', { role: 'keyword' }))]),
                    seq([paren(any('y', { role: 'keyword' }))])
                  ]),
                  rules: rules([
                    decl({
                      name: 'width',
                      value: dimension([100, '%'])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        mixin({
          name: any('.mediaMixin'),
          params: list([
            vardecl({
              name: any('fallback', { role: 'property' }),
              value: dimension([200, 'px'])
            })
          ]),
          rules: rules([
            decl({
              name: 'background',
              value: color({ node: 'black', format: 0, rgb: [0, 0, 0], alpha: 1 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([any('handheld', { role: 'keyword' })]),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'white', format: 0, rgb: [255, 255, 255], alpha: 1 })
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'max-width',
                      value: ref({ key: 'fallback' }, { type: 'variable' })
                    }))
                  ]),
                  rules: rules([
                    decl({
                      name: 'background',
                      value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.a'),
          rules: rules([
            call({
              name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' }),
              args: list([
                dimension([100, 'px'])
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.b'),
          rules: rules([
            call({
              name: ref({ key: '.mediaMixin' }, { type: 'mixin-ruleset' })
            })
          ])
        }),
        vardecl({
          name: any('smartphone', { role: 'ident' }),
          value: quoted(any('only screen and (max-width: 200px)', { role: 'any' }), { escaped: true })
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            ref({ key: 'smartphone' }, { type: 'variable' })
          ]),
          rules: rules([
            ruleset({
              selector: el('.body'),
              rules: rules([
                decl({
                  name: 'width',
                  value: dimension([480, 'px'])
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([any('print', { role: 'keyword' })]),
          rules: rules([
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el(':left')]),
              rules: rules([
                decl({
                  name: 'margin',
                  value: dimension([0.5, 'cm'])
                })
              ])
            }),
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el(':right')]),
              rules: rules([
                decl({
                  name: 'margin',
                  value: dimension([0.5, 'cm'])
                })
              ])
            }),
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el('Test:first')]),
              rules: rules([
                decl({
                  name: 'margin',
                  value: dimension([1, 'cm'])
                })
              ])
            }),
            atrule({
              name: any('@page', { role: 'atkeyword' }),
              prelude: list([el(':first')]),
              rules: rules([
                decl({
                  name: 'margin',
                  value: dimension([0.5, 'cm'])
                }),
                decl({
                  name: 'size',
                  value: seq([
                    dimension([8.5, 'in']),
                    dimension([11, 'in'])
                  ])
                }),
                atrule({
                  name: any('@top-left', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@top-left-corner', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@top-center', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@top-right', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@top-right-corner', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@bottom-left', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@bottom-left-corner', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@bottom-center', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@bottom-right', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@bottom-right-corner', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@left-top', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@left-middle', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@left-bottom', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@right-top', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                }),
                atrule({
                  name: any('@right-middle', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'content',
                      value: seq([
                        quoted(any('Page ', { role: 'any' })),
                        call({
                          name: any('counter', { role: 'ident' }),
                          args: list([
                            any('page')
                          ])
                        })
                      ])
                    })
                  ])
                }),
                atrule({
                  name: any('@right-bottom', { role: 'atkeyword' }),
                  rules: rules([
                    decl({
                      name: 'margin',
                      value: dimension([1, 'cm'])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              paren(decl({
                name: '-webkit-min-device-pixel-ratio',
                value: num(2)
              }))
            ]),
            seq([
              paren(decl({
                name: 'min--moz-device-pixel-ratio',
                value: num(2)
              }))
            ]),
            seq([
              paren(decl({
                name: '-o-min-device-pixel-ratio',
                value: quoted(any('2/1', { role: 'any' }))
              }))
            ]),
            seq([
              paren(decl({
                name: 'min-resolution',
                value: dimension([2, 'dppx'])
              }))
            ]),
            seq([
              paren(decl({
                name: 'min-resolution',
                value: dimension([128, 'dpcm'])
              }))
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('.b'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        mixin({
          name: any('.bg'),
          rules: rules([
            decl({
              name: 'background',
              value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'max-width',
                  value: dimension([500, 'px'])
                }))
              ]),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.body'),
          rules: rules([
            call({
              name: ref({ key: '.bg' }, { type: 'mixin-ruleset' })
            })
          ])
        }),
        vardecl({
          name: any('bpMedium', { role: 'ident' }),
          value: dimension([1000, 'px'])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(decl({
              name: 'max-width',
              value: ref({ key: 'bpMedium' }, { type: 'variable' })
            }))
          ]),
          rules: rules([
            ruleset({
              selector: el('.body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'red', format: 0, rgb: [255, 0, 0], alpha: 1 })
                }),
                atrule({
                  name: any('@media', { role: 'atkeyword' }),
                  prelude: seq([
                    paren(decl({
                      name: 'max-width',
                      value: dimension([500, 'px'])
                    }))
                  ]),
                  rules: rules([
                    decl({
                      name: 'background',
                      value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                    })
                  ])
                }),
                decl({
                  name: 'background',
                  value: color({ node: 'blue', format: 0, rgb: [0, 0, 255], alpha: 1 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(decl({
              name: 'max-width',
              value: dimension([1200, 'px'])
            }))
          ]),
          rules: rules([
            comment('/* a comment */'),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'max-width',
                  value: dimension([900, 'px'])
                }))
              ]),
              rules: rules([
                ruleset({
                  selector: el('.body'),
                  rules: rules([
                    decl({
                      name: 'font-size',
                      value: dimension([11, 'px'])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.nav-justified'),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'min-width',
                  value: dimension([480, 'px'])
                }))
              ]),
              rules: rules([
                ruleset({
                  selector: el('.nav-justified'),
                  rules: rules([
                    ruleset({
                      selector: sel([
                        el('.nav-justified'),
                        co('>'),
                        el('li')
                      ]),
                      rules: rules([
                        decl({
                          name: 'display',
                          value: any('table-cell')
                        })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.menu'),
          rules: rules([
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(decl({
                  name: 'min-width',
                  value: dimension([768, 'px'])
                }))
              ]),
              rules: rules([
                ruleset({
                  selector: el('.menu'),
                  rules: rules([
                    atrule({
                      name: any('@media', { role: 'atkeyword' }),
                      prelude: seq([
                        paren(decl({
                          name: 'min-width',
                          value: dimension([480, 'px'])
                        }))
                      ]),
                      rules: rules([
                        ruleset({
                          selector: el('.menu'),
                          rules: rules([
                            ruleset({
                              selector: sel([
                                el('.menu'),
                                co('>'),
                                el('li')
                              ]),
                              rules: rules([
                                decl({
                                  name: 'display',
                                  value: any('table-cell')
                                })
                              ])
                            })
                          ])
                        })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        vardecl({
          name: any('all', { role: 'ident' }),
          value: quoted(any('all', { role: 'any' }))
        }),
        vardecl({
          name: any('tv', { role: 'ident' }),
          value: quoted(any('(tv)', { role: 'any' }))
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('all', { role: 'any' }),
            any('and', { role: 'keyword' }),
            any('(tv)', { role: 'any' })
          ]),
          rules: rules([
            ruleset({
              selector: el('.all-and-tv-variables'),
              rules: rules([
                decl({
                  name: 'var',
                  value: any('all-and-tv')
                })
              ])
            })
          ])
        }),
        vardecl({
          name: any('some-var', { role: 'ident' }),
          value: dimension([60, 'px'])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('screen', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            paren(decl({
              name: 'min-width',
              value: dimension([61, 'px'])
            }))
          ]),
          rules: rules([
            ruleset({
              selector: el('.selector'),
              rules: rules([
                decl({
                  name: 'foo',
                  value: any('bar')
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([
              any('screen', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(any('color', { role: 'keyword' }))
              ])
            ]),
            seq([
              any('projection', { role: 'keyword' }),
              any('and', { role: 'keyword' }),
              seq([
                paren(any('color', { role: 'keyword' }))
              ])
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('.selector'),
              rules: rules([
                decl({
                  name: 'color',
                  value: color({ node: '#eee', format: 0 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('not', { role: 'keyword' }),
            paren(seq([
              any('width', { role: 'ident' }),
              any('<=', { role: 'keyword' }),
              dimension([-100, 'px'])
            ]))
          ]),
          rules: rules([
            ruleset({
              selector: el('body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(seq([
              any('height', { role: 'ident' }),
              any('>', { role: 'keyword' }),
              dimension([-100, 'px'])
            ]))
          ]),
          rules: rules([
            ruleset({
              selector: el('body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('not', { role: 'keyword' }),
            paren(decl({
              name: 'resolution',
              value: dimension([-300, 'dpi'])
            }))
          ]),
          rules: rules([
            ruleset({
              selector: el('body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(decl({
              name: 'min-orientation',
              value: any('portrait')
            }))
          ]),
          rules: rules([
            ruleset({
              selector: el('body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            any('print', { role: 'keyword' }),
            any('and', { role: 'keyword' }),
            seq([
              paren(decl({
                name: 'min-resolution',
                value: dimension([118, 'dpcm'])
              }))
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: seq([
            paren(seq([
              dimension([200, 'px']),
              any('<=', { role: 'keyword' }),
              any('width', { role: 'ident' }),
              any('<=', { role: 'keyword' }),
              dimension([500, 'px'])
            ]))
          ]),
          rules: rules([
            ruleset({
              selector: el('.test-range-syntax'),
              rules: rules([
                decl({
                  name: 'padding',
                  value: num(0)
                })
              ])
            })
          ])
        }),
        ruleset({
          selector: el('.selector'),
          rules: rules([
            decl({
              name: 'color',
              value: color({ node: '#eee', format: 0 })
            }),
            atrule({
              name: any('@media', { role: 'atkeyword' }),
              prelude: seq([
                paren(seq([
                  dimension([200, 'px']),
                  any('<=', { role: 'keyword' }),
                  any('width', { role: 'ident' }),
                  any('<=', { role: 'keyword' }),
                  dimension([500, 'px'])
                ]))
              ]),
              rules: rules([
                ruleset({
                  selector: el('.selector'),
                  rules: rules([
                    ruleset({
                      selector: sel([
                        el('.selector'),
                        co(' '),
                        el('.test-range-syntax')
                      ]),
                      rules: rules([
                        decl({
                          name: 'padding',
                          value: num(0)
                        })
                      ])
                    })
                  ])
                })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: list([
            seq([any('print', { role: 'keyword' })]),
            seq([
              paren(decl({
                name: 'max-width',
                value: dimension([992, 'px'])
              }))
            ])
          ]),
          rules: rules([
            ruleset({
              selector: el('body'),
              rules: rules([
                decl({
                  name: 'background',
                  value: color({ node: 'green', format: 0, rgb: [0, 128, 0], alpha: 1 })
                })
              ])
            })
          ])
        })
      ]);

      /** This represents already eval'd nodes */
      const evald = await node.eval(context);
      const serialized = evald.toString({ context });

      // The serialized output should match the structure
      expect(serialized).toBeString(`
        @media print {
          .class {
            color: blue;
          }
          .class .sub {
            width: 42;
          }
          .top,
          header > h1 {
            color: #444444;
          }
        }
        @media screen {
          .body {
            max-width: 480;
          }
        }
        @media all and (device-aspect-ratio: 16 / 9) {
          .body {
            max-width: 800px;
          }
        }
        @media all and (orientation: portrait) {
          aside {
            float: none;
          }
        }
        @media handheld and (min-width: 42), screen and (min-width: 20em) {
          .body {
            max-width: 480px;
          }
        }
        @media print {
          .body {
            padding: 20px;
          }
          .body header {
            background-color: red;
          }
          @media (orientation: landscape) {
            .body {
              margin-left: 20px;
            }
          }
        }
        @media screen {
          .sidebar {
            width: 300px;
          }
          @media (orientation: landscape) {
            .sidebar {
              width: 500px;
            }
          }
        }
        @media a {
          @media (b) {
            .first .second .third {
              width: 300px;
            }
            @media (c) {
              .first .second .third {
                width: 500px;
              }
            }
            .first .second .fourth {
              width: 3;
            }
          }
        }
        @media a, (b) and (c) {
          .body {
            width: 95%;
          }
          @media (x), (y) {
            .body {
              width: 100%;
            }
          }
        }
        .a {
          background: black;
        }
        @media handheld {
          .a {
            background: white;
          }
          @media (max-width: 100px) {
            .a {
              background: red;
            }
          }
        }
        .b {
          background: black;
        }
        @media handheld {
          .b {
            background: white;
          }
          @media (max-width: 200px) {
            .b {
              background: red;
            }
          }
        }
        @media only screen and (max-width: 200px) {
          .body {
            width: 480px;
          }
        }
        @media print {
          @page :left {
            margin: 0.5cm;
          }
          @page :right {
            margin: 0.5cm;
          }
          @page Test:first {
            margin: 1cm;
          }
          @page :first {
            margin: 0.5cm;
            size: 8.5in 11in;
            @top-left {
              margin: 1cm;
            }
            @top-left-corner {
              margin: 1cm;
            }
            @top-center {
              margin: 1cm;
            }
            @top-right {
              margin: 1cm;
            }
            @top-right-corner {
              margin: 1cm;
            }
            @bottom-left {
              margin: 1cm;
            }
            @bottom-left-corner {
              margin: 1cm;
            }
            @bottom-center {
              margin: 1cm;
            }
            @bottom-right {
              margin: 1cm;
            }
            @bottom-right-corner {
              margin: 1cm;
            }
            @left-top {
              margin: 1cm;
            }
            @left-middle {
              margin: 1cm;
            }
            @left-bottom {
              margin: 1cm;
            }
            @right-top {
              margin: 1cm;
            }
            @right-middle {
              content: "Page " counter(page);
            }
            @right-bottom {
              margin: 1cm;
            }
          }
        }
        @media (-webkit-min-device-pixel-ratio: 2), (min--moz-device-pixel-ratio: 2), (-o-min-device-pixel-ratio: "2/1"), (min-resolution: 2dppx), (min-resolution: 128dpcm) {
          .b {
            background: red;
          }
        }
        .body {
          background: red;
        }
        @media (max-width: 500px) {
          .body {
            background: green;
          }
        }
        @media (max-width: 1000px) {
          .body {
            background: red;
          }
          @media (max-width: 500px) {
            .body {
              background: green;
            }
          }
          .body {
            background: blue;
          }
        }
        @media (max-width: 1200px) {
          /* a comment */
          @media (max-width: 900px) {
            .body {
              font-size: 11px;
            }
          }
        }
        @media (min-width: 480px) {
          .nav-justified .nav-justified .nav-justified > li {
            display: table-cell;
          }
        }
        @media (min-width: 768px) {
          @media (min-width: 480px) {
            .menu .menu .menu .menu > li {
              display: table-cell;
            }
          }
        }
        @media all and (tv) {
          .all-and-tv-variables {
            var: all-and-tv;
          }
        }
        @media screen and (min-width: 61px) {
          .selector {
            foo: bar;
          }
        }
        @media screen and (color), projection and (color) {
          .selector {
            color: #eee;
          }
        }
        @media not (width <= -100px) {
          body {
            background: green;
          }
        }
        @media (height > -100px) {
          body {
            background: green;
          }
        }
        @media not (resolution: -300dpi) {
          body {
            background: green;
          }
        }
        @media (min-orientation: portrait) {
          body {
            background: green;
          }
        }
        @media print and (min-resolution: 118dpcm) {
          body {
            background: green;
          }
        }
        @media (200px <= width <= 500px) {
          .test-range-syntax {
            padding: 0;
          }
        }
        .selector {
          color: #eee;
        }
        @media (200px <= width <= 500px) {
          .selector .selector .selector .test-range-syntax {
            padding: 0;
          }
        }
        @media print, (max-width: 992px) {
          body {
            background: green;
          }
        }
      `);
    });
  });
});
