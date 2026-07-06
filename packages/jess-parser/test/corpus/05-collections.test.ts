/**
 * Corpus 05 — Collections, lists, maps.
 *
 *   $x: a, b, c;                 → List (comma-separated)
 *   $x: { primary: #06c; … }     → Collection of key/value Declarations
 *   nested `{ … }`               → Collection whose entry value is a Collection
 *   `_key`                       → private key (parse-transparent; eval honours it)
 *
 * A Collection is a brace block of arbitrary key/value pairs (a Rules subclass
 * holding Declarations). It appears only in value position — a VarDeclaration RHS
 * or a nested entry — never as a top-level statement (that stays a Ruleset).
 */
import { describe, it } from 'vitest';
import { expectAstContains } from './_util.js';

describe('corpus/collections', () => {
  it('comma list → List', () => {
    expectAstContains('$x: a, b, c;', `
      (List
        value:
          [
            (Keyword [role=keyword] 'a')
            (Keyword [role=keyword] 'b')
            (Keyword [role=keyword] 'c')
          ]
      )`);
  });

  it('flat map → Collection of Declarations', () => {
    expectAstContains('$colors: { primary: #06c; secondary: #e00; }', `
      (Collection
        rules:
          [
            (Declaration
              name: 'primary'
              value:
                (Color
                  node: '#06c'
                )
            )
            (Declaration
              name: 'secondary'
              value:
                (Color
                  node: '#e00'
                )
            )
          ]
      )`);
  });

  it('nested collection → Collection whose entry value is a Collection', () => {
    expectAstContains('$colors: { primary: #06c; tertiary: { light: #06c; dark: #e00; } }', `
      (Declaration
        name: 'tertiary'
        value:
          (Collection
            rules:
              [
                (Declaration
                  name: 'light'
                  value:
                    (Color
                      node: '#06c'
                    )
                )
                (Declaration
                  name: 'dark'
                  value:
                    (Color
                      node: '#e00'
                    )
                )
              ]
          )
      )`);
  });

  it('private `_key` is an ordinary entry name', () => {
    expectAstContains('$x: { _private: 1; pub: 2; }', `
      (Declaration
        name: '_private'
        value:
          (Num 1)
      )`);
  });

  it('last entry may omit its trailing `;`', () => {
    expectAstContains('$x: { a: 1; b: 2 }', `
      (Declaration
        name: 'b'
        value:
          (Num 2)
      )`);
  });
});
