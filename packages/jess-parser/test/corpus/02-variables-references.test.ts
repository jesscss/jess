/**
 * Corpus 02 — Variables & references.
 *
 *   $name: value;      → VarDeclaration (name has no `$`)
 *   $foo               → Reference (variable)
 *   $foo.bar           → Reference chain (declaration lookup)
 *   $foo[0] / $foo[-1] → Reference (index)
 *   $foo['k']          → Reference (property lookup, Quoted key)
 *   $foo?              → optional reference (fallbackValue)
 *   +: / ?:            → assignment ops on VarDeclaration
 */
import { describe, it } from 'vitest';
import { expectAst, expectAstContains } from './_util.js';

describe('corpus/variables', () => {
  it('variable declaration (keyword value)', () => {
    expectAst('$color: red;', `
      (Rules
        rules:
          [
            (VarDeclaration
              name: 'color'
              value:
                (Keyword [role=keyword] 'red')
            )
          ]
      )`);
  });

  it('variable declaration (dimension value)', () => {
    expectAstContains('$size: 16px;', `
      (VarDeclaration
        name: 'size'
        value:
          (Dimension
            number: 16
            unit: 'px'
          )
      )`);
  });

  it('merge-assign +:', () => {
    expectAstContains('$list +: 1, 2;', `
      (VarDeclaration
          assign: '+:'
        name: 'list'`, { showOptions: true });
  });

  it('conditional-assign ?:', () => {
    expectAstContains('$x ?: 1;', `
      (VarDeclaration
          assign: '?:'
        name: 'x'`, { showOptions: true });
  });

  it('variable declaration with !important', () => {
    expectAst('$c: red !important;', `
      (Rules
        rules:
          [
            (VarDeclaration
              name: 'c'
              value:
                (Keyword [role=keyword] 'red')
              important: '!important'
            )
          ]
      )`);
  });

  it('reference in value position', () => {
    expectAst('.a { color: $primary; }', `
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
                      (Reference
                        key: 'primary'
                      )
                  )
                ]
            )
          ]
      )`);
  });

  it('dot access (declaration lookup)', () => {
    expectAstContains('.a { color: $theme.primary; }', `
      (Declaration
        name: 'color'
        value:
          (Reference
            target:
              (Reference
                key: 'theme'
              )
            key: 'primary'
          )
      )`);
  });

  it('chained dot access', () => {
    expectAstContains('.a { color: $theme.colors.primary; }', `
      (Reference
        target:
          (Reference
            target:
              (Reference
                key: 'theme'
              )
            key: 'colors'
          )
        key: 'primary'
      )`);
  });

  it('index access', () => {
    expectAstContains('.a { color: $colors[0]; }', `
      (Reference
        target:
          (Reference
            key: 'colors'
          )
        key:
          (Num 0)
      )`);
  });

  it('negative index access', () => {
    expectAstContains('.a { color: $sizes[-1]; }', `
      (Reference
        target:
          (Reference
            key: 'sizes'
          )
        key:
          (Num -1)
      )`);
  });

  it('property lookup with quoted key', () => {
    expectAstContains('.a { color: $c[\'border-color\']; }', `
      (Reference
        target:
          (Reference
            key: 'c'
          )
        key:
          (Quoted
            value: 'border-color'
          )
      )`);
  });

  it('bracket bare ident is a variable lookup ($theme[foo] ≡ $foo on theme)', () => {
    expectAstContains('.a { color: $theme[foo]; }', `
      (Reference
        target:
          (Reference
            key: 'theme'
          )
        key: 'foo'
      )`);
  });

  it('bracket quoted key is a property lookup', () => {
    expectAstContains('.a { color: $theme[\'foo\']; }', `
      (Reference
        target:
          (Reference
            key: 'theme'
          )
        key:
          (Quoted
            value: 'foo'
          )
      )`);
  });

  it('dynamic key access ($base[$key] — the variable value is the key)', () => {
    expectAstContains('.a { color: $theme[$key]; }', `
      (Reference
        target:
          (Reference
            key: 'theme'
          )
        key:
          (Reference
            key: 'key'
          )
      )`);
  });

  it('accessor lookup TYPES: .foo=declaration, [foo]=variable, [\'foo\']=property, [0]/[$k]=index', () => {
    // The key FORM chooses the lookup type; all bracket forms render `[key]`.
    expectAstContains('.a { x: $t.foo; }', '(Reference\n    type: \'declaration\'', { showOptions: true });
    expectAstContains('.a { x: $t[foo]; }', '(Reference\n    type: \'variable\'\n  target:', { showOptions: true });
    expectAstContains('.a { x: $t[\'foo\']; }', '(Reference\n    type: \'property\'\n  target:', { showOptions: true });
    expectAstContains('.a { x: $t[0]; }', '(Reference\n    type: \'index\'', { showOptions: true });
    expectAstContains('.a { x: $t[$k]; }', '(Reference\n    type: \'index\'', { showOptions: true });
  });

  it('live binding ($!foo → readMode snapshot, renders $!foo)', () => {
    expectAstContains('.a { color: $!color; }', `
      (Reference
          type: 'variable'
          readMode: 'snapshot'
        key: 'color'
      )`, { showOptions: true });
  });

  it('optional reference (trailing ?)', () => {
    expectAstContains('.a { color: $maybe?; }', `
      (Reference
          type: 'variable'
          fallbackValue: true
        key: 'maybe'
      )`, { showOptions: true });
  });
});
