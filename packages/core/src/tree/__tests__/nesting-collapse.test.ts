import {
  rules, ruleset, decl, sel, el, spaced, any, compound, sellist,
  atRule, media, supports, keyframes, importRule
} from '..';
import { Context } from '../../context';

describe('CSS Nesting Collapse', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context({ collapseNesting: true });
  });

  describe('Basic Ruleset Collapsing', () => {
    it('should collapse simple nested rulesets', async () => {
      const tree = rules([
        ruleset({
          selector: el('.foo'),
          rules: rules([
            decl({ name: 'color', value: el('red') }),
            ruleset({
              selector: el('.bar'),
              rules: rules([
                decl({ name: 'background', value: el('black') })
              ])
            }),
            decl({ name: 'color', value: el('blue') })
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .foo {
          color: red;
        }
        .foo .bar {
          background: black;
        }
        .foo {
          color: blue;
        }
      `);
    });

    it('should handle multiple levels of nesting', async () => {
      const tree = rules([
        ruleset({
          selector: el('.container'),
          rules: rules([
            decl({ name: 'padding', value: el('20px') }),
            ruleset({
              selector: el('.header'),
              rules: rules([
                decl({ name: 'font-size', value: el('24px') }),
                ruleset({
                  selector: el('.title'),
                  rules: rules([
                    decl({ name: 'color', value: el('blue') })
                  ])
                })
              ])
            }),
            ruleset({
              selector: el('.content'),
              rules: rules([
                decl({ name: 'margin', value: el('10px') })
              ])
            })
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .container {
          padding: 20px;
        }
        .container .header {
          font-size: 24px;
        }
        .container .header .title {
          color: blue;
        }
        .container .content {
          margin: 10px;
        }
      `);
    });

    it('should handle complex selectors with combinators', async () => {
      const tree = rules([
        ruleset({
          selector: compound([el('.nav'), el('>'), el('.item')]),
          rules: rules([
            decl({ name: 'display', value: el('inline-block') }),
            ruleset({
              selector: el('.submenu'),
              rules: rules([
                decl({ name: 'position', value: el('absolute') }),
                ruleset({
                  selector: el('&:hover'),
                  rules: rules([
                    decl({ name: 'opacity', value: el('1') })
                  ])
                })
              ])
            })
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .nav > .item {
          display: inline-block;
        }
        .nav > .item .submenu {
          position: absolute;
        }
        .nav > .item .submenu:hover {
          opacity: 1;
        }
      `);
    });
  });

  describe('At-Rule Bubbling and Combining', () => {
    it('should bubble and combine @media rules', async () => {
      const tree = rules([
        ruleset({
          selector: el('.sidebar'),
          rules: rules([
            decl({ name: 'width', value: el('300px') }),
            media('(max-width: 768px)', rules([
              decl({ name: 'width', value: el('100%') }),
              ruleset({
                selector: el('.widget'),
                rules: rules([
                  decl({ name: 'margin', value: el('10px') })
                ])
              })
            ])
          ])
        }),
        ruleset({
          selector: el('.main'),
          rules: rules([
            decl({ name: 'flex', value: el('1') }),
            media('(max-width: 768px)', rules([
              decl({ name: 'order', value: el('2') })
            ])
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .sidebar {
          width: 300px;
        }
        .main {
          flex: 1;
        }
        @media (max-width: 768px) {
          .sidebar {
            width: 100%;
          }
          .sidebar .widget {
            margin: 10px;
          }
          .main {
            order: 2;
          }
        }
      `);
    });

    it('should handle nested @supports rules', async () => {
      const tree = rules([
        ruleset({
          selector: el('.card'),
          rules: rules([
            decl({ name: 'border-radius', value: el('8px') }),
            supports('(display: grid)', rules([
              decl({ name: 'display', value: el('grid') }),
              ruleset({
                selector: el('.card-header'),
                rules: rules([
                  decl({ name: 'grid-area', value: el('header') })
                ])
              })
            ])
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .card {
          border-radius: 8px;
        }
        @supports (display: grid) {
          .card {
            display: grid;
          }
          .card .card-header {
            grid-area: header;
          }
        }
      `);
    });

    it('should handle mixed at-rules with nested rulesets', async () => {
      const tree = rules([
        ruleset({
          selector: el('.component'),
          rules: rules([
            decl({ name: 'position', value: el('relative') }),
            media('(min-width: 1024px)', rules([
              decl({ name: 'display', value: el('flex') }),
              ruleset({
                selector: el('.sidebar'),
                rules: rules([
                  decl({ name: 'width', value: el('250px') }),
                  supports('(backdrop-filter: blur(10px))', rules([
                    decl({ name: 'backdrop-filter', value: el('blur(10px)') })
                  ])
                ])
              })
            ])
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .component {
          position: relative;
        }
        @media (min-width: 1024px) {
          .component {
            display: flex;
          }
          .component .sidebar {
            width: 250px;
          }
          @supports (backdrop-filter: blur(10px)) {
            .component .sidebar {
              backdrop-filter: blur(10px);
            }
          }
        }
      `);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle rulesets with mixed content and nesting', async () => {
      const tree = rules([
        ruleset({
          selector: el('.form'),
          rules: rules([
            decl({ name: 'max-width', value: el('600px') }),
            ruleset({
              selector: el('.field'),
              rules: rules([
                decl({ name: 'margin-bottom', value: el('20px') }),
                ruleset({
                  selector: el('&.required'),
                  rules: rules([
                    decl({ name: 'border-color', value: el('red') })
                  ])
                })
              ])
            }),
            decl({ name: 'padding', value: el('20px') }),
            media('(max-width: 480px)', rules([
              decl({ name: 'max-width', value: el('100%') }),
              ruleset({
                selector: el('.field'),
                rules: rules([
                  decl({ name: 'margin-bottom', value: el('15px') })
                ])
              })
            ])
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .form {
          max-width: 600px;
        }
        .form .field {
          margin-bottom: 20px;
        }
        .form .field.required {
          border-color: red;
        }
        .form {
          padding: 20px;
        }
        @media (max-width: 480px) {
          .form {
            max-width: 100%;
          }
          .form .field {
            margin-bottom: 15px;
          }
        }
      `);
    });

    it('should handle deeply nested rulesets with at-rules', async () => {
      const tree = rules([
        ruleset({
          selector: el('.page'),
          rules: rules([
            decl({ name: 'background', value: el('white') }),
            ruleset({
              selector: el('.content'),
              rules: rules([
                decl({ name: 'padding', value: el('20px') }),
                media('(min-width: 768px)', rules([
                  decl({ name: 'padding', value: el('40px') }),
                  ruleset({
                    selector: el('.sidebar'),
                    rules: rules([
                      decl({ name: 'float', value: el('right') }),
                      ruleset({
                        selector: el('.widget'),
                        rules: rules([
                          decl({ name: 'margin-bottom', value: el('20px') }),
                          supports('(display: flex)', rules([
                            decl({ name: 'display', value: el('flex') }),
                            decl({ name: 'flex-direction', value: el('column') })
                          ])
                        ])
                      })
                    ])
                  ])
                ])
              ])
            })
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .page {
          background: white;
        }
        .page .content {
          padding: 20px;
        }
        @media (min-width: 768px) {
          .page .content {
            padding: 40px;
          }
          .page .content .sidebar {
            float: right;
          }
          .page .content .sidebar .widget {
            margin-bottom: 20px;
          }
          @supports (display: flex) {
            .page .content .sidebar .widget {
              display: flex;
              flex-direction: column;
            }
          }
        }
      `);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty nested rulesets', async () => {
      const tree = rules([
        ruleset({
          selector: el('.empty'),
          rules: rules([
            decl({ name: 'color', value: el('red') }),
            ruleset({
              selector: el('.nested'),
              rules: rules([])
            })
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .empty {
          color: red;
        }
      `);
    });

    it('should handle rulesets with only nested content', async () => {
      const tree = rules([
        ruleset({
          selector: el('.parent'),
          rules: rules([
            ruleset({
              selector: el('.child'),
              rules: rules([
                decl({ name: 'color', value: el('blue') })
              ])
            })
          ])
        })
      ]);

      const evald = await tree.eval(context);
      expect(`${evald}`).toBeString(`
        .parent .child {
          color: blue;
        }
      `);
    });
  });
});
