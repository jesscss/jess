import {
  rules, sel, el, spaced, any, sellist, ruleset, decl, atrule,
  vardecl, ref, mixin, call, list, op,
  num
} from '..';
import { Context } from '../../context';

let context: Context;

describe('AtRule', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('nested @media rules', () => {
    it('should handle nested @media rules inside rulesets', async () => {
      // Represents: .body { @media print { padding: 20px; } }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: rules([
            atrule({
              name: any('@media'),
              prelude: any('print'),
              rules: rules([
                decl({ name: 'padding', value: spaced([any('20px')]) })
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

    it('should handle deeply nested @media rules', async () => {
      // Represents: .body { @media print { header { background-color: red; @media (orientation:landscape) { margin-left: 20px; } } } }
      const node = rules([
        ruleset({
          selector: sel([el('.body')]),
          rules: rules([
            atrule({
              name: any('@media'),
              prelude: any('print'),
              rules: rules([
                decl({ name: 'padding', value: spaced([any('20px')]) }),
                ruleset({
                  selector: sel([el('header')]),
                  rules: rules([
                    decl({ name: 'background-color', value: spaced([any('red')]) }),
                    atrule({
                      name: any('@media'),
                      prelude: any('(orientation:landscape)'),
                      rules: rules([
                        decl({ name: 'margin-left', value: spaced([any('20px')]) })
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
              @media (orientation:landscape) {
                margin-left: 20px;
              }
            }
          }
        }
      `);
    });
  });

  describe('@media with mixins and parameters', () => {
    it('should handle mixin with nested @media using parameter', async () => {
      // Represents: .mediaMixin(@fallback: 200px) { @media handheld { @media (max-width: @fallback) { background: red; } } }
      const mixinDef = mixin({
        name: any('.mediaMixin'),
        params: list([
          vardecl({ name: 'fallback', value: spaced([any('200px')]) })
        ]),
        rules: rules([
          decl({ name: 'background', value: spaced([any('black')]) }),
          atrule({
            name: any('@media'),
            prelude: any('handheld'),
            rules: rules([
              decl({ name: 'background', value: spaced([any('white')]) }),
              atrule({
                name: any('@media'),
                prelude: spaced([any('(max-width: '), ref({ key: 'fallback' }, { type: 'variable' }), any(')')]),
                rules: rules([
                  decl({ name: 'background', value: spaced([any('red')]) })
                ])
              })
            ])
          })
        ])
      });

      const callSite = rules([
        ruleset({
          selector: sel([el('.a')]),
          rules: rules([
            call({
              name: ref({ key: '.mediaMixin' }, { type: 'mixin' }),
              args: list([any('100px')])
            })
          ])
        })
      ]);

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
          name: any('@media'),
          prelude: any('print'),
          rules: rules([
            ruleset({
              selector: sel([el('.class')]),
              rules: rules([
                decl({ name: 'color', value: spaced([any('blue')]) })
              ])
            })
          ])
        }),
        atrule({
          name: any('@media'),
          prelude: any('screen'),
          rules: rules([
            vardecl({ name: 'base', value: num(8) }),
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
            max-width: ( 8  * 60);
          }
        }
      `);
    });
  });

  describe('@media with variables in prelude', () => {
    it('should handle @media with variable references in prelude', async () => {
      // Represents: @all: ~"all"; @tv: ~"(tv)"; @media @all and @tv { ... }
      const node = rules([
        vardecl({ name: any('all'), value: any('"all"') }),
        vardecl({ name: any('tv'), value: any('"(tv)"') }),
        atrule({
          name: any('@media'),
          prelude: spaced([ref('all', { type: 'variable' }), any(' and '), ref('tv', { type: 'variable' })]),
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
        @all: "all";
        @tv: "(tv)";
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
        vardecl({ name: any('some-var'), value: spaced([any('60px')]) }),
        atrule({
          name: any('@media'),
          prelude: spaced([any('screen and (min-width: '), spaced([any('('), ref('some-var', { type: 'variable' }), any(' + 1)')]), any(')')]),
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
        @some-var: 60px;
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
          name: any('@media'),
          prelude: any('screen and (color), projection and (color)'),
          rules: rules([
            ruleset({
              selector: sel([el('.selector')]),
              rules: rules([
                decl({ name: 'color', value: spaced([any('#eee')]) })
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
      // Represents: .menu { @media (min-width: 768px) { .nav-justified(); } }
      const navJustifiedMixin = mixin({
        name: any('.nav-justified'),
        rules: rules([
          atrule({
            name: any('@media'),
            prelude: any('(min-width: 480px)'),
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

      const callSite = rules([
        navJustifiedMixin,
        ruleset({
          selector: sel([el('.menu')]),
          rules: rules([
            atrule({
              name: any('@media'),
              prelude: any('(min-width: 768px)'),
              rules: rules([
                call({
                  name: ref({ key: '.nav-justified' }, { type: 'mixin' })
                })
              ])
            })
          ])
        })
      ]);

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
});
