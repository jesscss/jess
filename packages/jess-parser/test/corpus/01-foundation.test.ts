/**
 * Corpus 01 — Foundation: plain CSS that is valid Jess, parsed on the CSS base.
 * Establishes the clean baseline shapes (string selectors, keyword values,
 * `//` comments) every later Jess feature builds on.
 */
import { describe, it } from 'vitest';
import { expectAst } from './_util.js';

describe('corpus/foundation', () => {
  it('basic ruleset + declaration', () => {
    expectAst('.a { color: red; }', `
      (Rules
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Declaration
                    name: 'color'
                    value:
                      (Keyword [role=keyword] 'red')
                  )
                ]
            )
          ]
      )`);
  });

  it('selector list', () => {
    expectAst('.a, .b { color: red; }', `
      (Rules
        rules:
          [
            (Ruleset
              selector:
                ['.a', '.b']
              rules:
                [
                  (Declaration
                    name: 'color'
                    value:
                      (Keyword [role=keyword] 'red')
                  )
                ]
            )
          ]
      )`);
  });

  it('nesting with parent selector', () => {
    expectAst('.a { &:hover { color: red; } }', `
      (Rules
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Ruleset
                    selector:
                      (CompoundSelector
                        value:
                          [
                            '&'
                            (PseudoSelector
                              name: ':hover'
                            )
                          ]
                      )
                    rules:
                      [
                        (Declaration
                          name: 'color'
                          value:
                            (Keyword [role=keyword] 'red')
                        )
                      ]
                  )
                ]
            )
          ]
      )`);
  });

  it('// line comment is preserved as a standalone Comment', () => {
    expectAst('.a {\n  // hi\n  color: red;\n}', `
      (Rules
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Comment '// hi')
                  (Declaration
                    name: 'color'
                    value:
                      (Keyword [role=keyword] 'red')
                  )
                ]
            )
          ]
      )`);
  });

  it('space-separated value list', () => {
    expectAst('.a { margin: 1px solid red; }', `
      (Rules
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Declaration
                    name: 'margin'
                    value:
                      [
                        (Dimension
                          number: 1
                          unit: 'px'
                        )
                        (Keyword [role=keyword] 'solid')
                        (Keyword [role=keyword] 'red')
                      ]
                  )
                ]
            )
          ]
      )`);
  });
});
