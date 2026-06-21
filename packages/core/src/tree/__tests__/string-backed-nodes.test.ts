import { describe, expect, test } from 'vitest';
import { Context } from '../../context.js';
import {
  N,
  Declaration,
  any,
  atrule,
  atrulestatement,
  decl,
  ref,
  rules,
  ruleset,
  vardecl
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { serializeTypes } from '../util/serialize-types.js';

describe('string-backed scanner-first proof nodes', () => {
  test('renders string-backed core declarations without allocating value wrappers', () => {
    const declaration = decl({
      name: 'color',
      value: ['blue']
    });

    expect(declaration).toBeInstanceOf(Declaration);
    expect(declaration.toTrimmedString()).toBe('color: blue');
    expect(declaration.name).toBe('color');
    expect(declaration.value).toEqual(['blue']);
    expect(serializeTypes(declaration)).toBeString(`
      (Declaration
        name: 'color'
        value:
          ['blue']
      )
    `);
  });

  test('writes string-backed core declaration render output without allocating value wrappers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const declaration = decl({
      name: 'width',
      value: ['calc(', '100%', ' - ', '1px', ')'],
      important: true
    });

    expect(declaration.render(context, buffer)).toBe('width: calc(100% - 1px) !important');
    expect(buffer.segments).toEqual(['width: calc(100% - 1px) !important']);
  });

  test('writes multiline string-backed core declaration values on continuation lines', () => {
    const declaration = decl({
      name: 'grid-template-areas',
      value: ['"header header header"\n    "content . sidebar"\n    "footer footer footer"']
    });

    expect(declaration.toTrimmedString()).toBe([
      'grid-template-areas:',
      '  "header header header"',
      '  "content . sidebar"',
      '  "footer footer footer"'
    ].join('\n'));
  });

  test('parents explicit declaration node segments without value wrapper allocation', () => {
    const segment = any('100%');
    const declaration = decl({
      name: 'width',
      value: ['calc(', segment, ' - 1px)']
    });

    expect(segment.parent).toBe(declaration);
    expect(declaration.value).toEqual(['calc(', segment, ' - 1px)']);
    expect(declaration.toTrimmedString()).toBe('width: calc(100% - 1px)');
    expect(serializeTypes(declaration)).toBeString(`
      (Declaration
        name: 'width'
        value:
          ['calc(', Any, ' - 1px)']
      )
    `);
  });

  test('materializes explicit declaration node segments when semantic registration asks', () => {
    const context = new Context();
    const segment = any('100%');
    const declaration = decl({
      name: 'width',
      value: [segment]
    });

    void declaration.prepareRegistration(context);
    expect(declaration.value).toBe(segment);
    expect(declaration.value.parent).toBe(declaration);
  });

  test('materializes mixed declaration segments into a reachable value container', () => {
    const context = new Context();
    const segment = any('100%');
    const declaration = decl({
      name: 'width',
      value: ['calc(', segment, ' - 1px)']
    });

    void declaration.prepareRegistration(context);
    expect(isNode(declaration.value, N.Sequence)).toBe(true);
    expect(segment.parent).toBe(declaration.value);
    expect(serializeTypes(declaration)).toContain('(Sequence');
  });

  test('renders string-backed core declarations through existing rule containers', () => {
    const rootDeclaration = decl({
      name: 'color',
      value: ['blue']
    });
    const childDeclaration = decl({
      name: 'color',
      value: ['blue']
    });
    const root = rules([rootDeclaration]);
    const childRuleset = ruleset({
      selector: '.a',
      rules: [childDeclaration]
    });

    expect(root.toTrimmedString()).toBe('color: blue;');
    expect(childRuleset.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
  });

  test('renders string-selector core rulesets without selector child nodes', () => {
    const node = ruleset({
      selector: '.a',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('.a {\n  color: blue;\n}\n');
    expect(node.selector).toBe('.a');
    expect(serializeTypes(node)).toBeString(`
      (Ruleset
        selector: '.a'
        rules:
          [
            (Declaration
              name: 'color'
              value:
                ['blue']
            )
          ]
      )
    `);
  });

  test('materializes string core ruleset selectors only when semantic registration asks', () => {
    const context = new Context();
    const node = ruleset({
      selector: '.a',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.selector).toBe('.a');
    void node.prepareRegistration(context);
    expect(node.selector).toBeDefined();
    const selector = node.selector;
    expect(isNode(selector, N.CompoundSelector)).toBe(true);
    if (!selector || !isNode(selector, N.CompoundSelector)) {
      throw new Error('Expected string selector to remain a CompoundSelector.');
    }
    expect(selector.eval(context)).toBe(selector);
    expect(selector.resolve(context)).toBe(selector);
    expect(selector.value).toEqual(['.a']);
    const types = serializeTypes(node);
    expect(types).toContain('(CompoundSelector');
    expect(types).toContain('[\'.a\']');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('rawSelector');
  });

  test('stores cheap compound ruleset selectors as selector containers with string leaves', () => {
    const context = new Context();
    const classCompound = ruleset({
      selector: '.a.b',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    const elementCompound = ruleset({
      selector: 'button.primary',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(classCompound.toTrimmedString()).toBe('.a.b {\n  color: blue;\n}\n');
    expect(classCompound.selector).toBeDefined();
    expect(serializeTypes(classCompound)).toContain('(CompoundSelector');
    void classCompound.prepareRegistration(context);
    expect(classCompound.selector).toBeDefined();
    const classTypes = serializeTypes(classCompound);
    expect(classTypes).toContain('(CompoundSelector');
    if (!classCompound.selector || !isNode(classCompound.selector, N.CompoundSelector)) {
      throw new Error('Expected class compound string selector to materialize as a CompoundSelector.');
    }
    expect(classCompound.selector.value).toEqual(['.a', '.b']);
    expect(classTypes).not.toContain('(BasicSelector');
    expect(classTypes).not.toContain('rawSelector');

    expect(elementCompound.toTrimmedString()).toBe('button.primary {\n  color: blue;\n}\n');
    expect(elementCompound.selector).toBeDefined();
    void elementCompound.prepareRegistration(context);
    const elementTypes = serializeTypes(elementCompound);
    expect(elementTypes).toContain('(CompoundSelector');
    if (!elementCompound.selector || !isNode(elementCompound.selector, N.CompoundSelector)) {
      throw new Error('Expected element compound string selector to materialize as a CompoundSelector.');
    }
    expect(elementCompound.selector.value).toEqual(['button', '.primary']);
    expect(elementTypes).not.toContain('(BasicSelector');
  });

  test('stores selector lists as selector containers with string leaves', () => {
    const context = new Context();
    const node = ruleset({
      selector: ' .a, button.primary ',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('.a,\nbutton.primary {\n  color: blue;\n}\n');
    expect(node.selector).toBeDefined();
    expect(serializeTypes(node)).toContain('(SelectorList');
    void node.prepareRegistration(context);
    expect(node.selector).toBeDefined();
    const selector = node.selector;
    if (!selector || !isNode(selector, N.SelectorList)) {
      throw new Error('Expected string selector list materialization to create a SelectorList.');
    }
    expect(selector.parent).toBe(node);
    expect(selector.value[0]!.parent).toBe(selector);
    expect(selector.value[1]!.parent).toBe(selector);
    if (!isNode(selector.value[1], N.CompoundSelector)) {
      throw new Error('Expected second selector list branch to materialize as a CompoundSelector.');
    }
    expect(selector.value[1].value).toEqual(['button', '.primary']);
    const types = serializeTypes(node);
    expect(types).toContain('(SelectorList');
    expect(types).toContain('[\'.a\']');
    expect(types).toContain('(CompoundSelector');
    expect(types).toContain('[\'button\', \'.primary\']');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('rawSelector');
  });

  test('stores cheap complex selectors as selector containers with string leaves', () => {
    const context = new Context();
    const node = ruleset({
      selector: '.a > button.primary',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('.a > button.primary {\n  color: blue;\n}\n');
    expect(node.selector).toBeDefined();
    expect(serializeTypes(node)).toContain('(ComplexSelector');
    void node.prepareRegistration(context);
    const selector = node.selector;
    if (!selector || !isNode(selector, N.ComplexSelector)) {
      throw new Error('Expected string complex selector materialization to create a ComplexSelector.');
    }
    expect(selector.parent).toBe(node);
    expect(selector.value[0]!.parent).toBe(selector);
    expect(selector.value[1]!.parent).toBe(selector);
    expect(selector.value[2]!.parent).toBe(selector);
    const types = serializeTypes(node);
    expect(types).toContain('(ComplexSelector');
    expect(types).toContain('(Combinator \'>\')');
    expect(types).toContain('[\'.a\']');
    expect(types).toContain('(CompoundSelector');
    expect(types).toContain('[\'button\', \'.primary\']');
    expect(types).not.toContain('(BasicSelector');
    expect(types).not.toContain('rawSelector');
  });

  test('stores selector lists with complex branches as selector containers with string leaves', () => {
    const context = new Context();
    const node = ruleset({
      selector: '.a > .b, .c + .d',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('.a > .b,\n.c + .d {\n  color: blue;\n}\n');
    expect(node.selector).toBeDefined();
    void node.prepareRegistration(context);
    const selector = node.selector;
    if (!selector || !isNode(selector, N.SelectorList)) {
      throw new Error('Expected string selector list materialization to create a SelectorList.');
    }
    expect(selector.value[0]!.parent).toBe(selector);
    expect(selector.value[1]!.parent).toBe(selector);
    expect(isNode(selector.value[0], N.ComplexSelector)).toBe(true);
    const types = serializeTypes(node);
    expect(types).toContain('(SelectorList');
    expect(types).toContain('(ComplexSelector');
    expect(types).toContain('(Combinator \'>\')');
    expect(types).toContain('(Combinator \'+\')');
    expect(types).not.toContain('rawSelector');
  });

  test('materializes string ampersand pseudo selectors only when semantic registration asks', () => {
    const context = new Context();
    const node = ruleset({
      selector: '&:focus',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('&:focus {\n  color: blue;\n}\n');
    expect(node.selector).toBe('&:focus');
    expect(serializeTypes(node)).toContain('selector: \'&:focus\'');
    void node.prepareRegistration(context);
    const selector = node.selector;
    expect(selector).toBeDefined();
    expect(isNode(selector, N.CompoundSelector)).toBe(true);
    if (!selector || !isNode(selector, N.CompoundSelector)) {
      return;
    }
    expect(selector.parent).toBe(node);
    expect(selector.value[0]!.parent).toBe(selector);
    expect(selector.value[1]!.parent).toBe(selector);
    const types = serializeTypes(node);
    expect(types).toContain('(CompoundSelector');
    expect(types).toContain('(Ampersand');
    expect(types).toContain('(PseudoSelector');
    expect(types).toContain('name: \':focus\'');
    expect(types).not.toContain('rawSelector');
  });

  test('materializes string pseudo selector atoms as string components only when semantic registration asks', () => {
    const context = new Context();
    for (const rawSelector of [':root', '.a:hover', '[data-kind]']) {
      const node = ruleset({
        selector: rawSelector,
        rules: [
          decl({
            name: 'color',
            value: ['blue']
          })
        ]
      });

      expect(node.toTrimmedString()).toBe(`${rawSelector} {\n  color: blue;\n}\n`);
      if (rawSelector === '.a:hover') {
        expect(isNode(node.selector, N.CompoundSelector)).toBe(true);
        expect(serializeTypes(node)).toContain('[\'.a\', \':hover\']');
      } else {
        expect(node.selector).toBe(rawSelector);
        expect(serializeTypes(node)).toContain(`selector: '${rawSelector}'`);
      }
      void node.prepareRegistration(context);
      const selector = node.selector;
      expect(selector).toBeDefined();
      expect(isNode(selector, N.CompoundSelector)).toBe(true);
      if (!selector || !isNode(selector, N.CompoundSelector)) {
        throw new Error(`Expected ${rawSelector} to materialize as a compound selector.`);
      }
      expect(selector.eval(context)).toBe(selector);
      expect(selector.resolve(context)).toBe(selector);
      expect(selector.value).toEqual(
        rawSelector === '.a:hover'
          ? ['.a', ':hover']
          : [rawSelector]
      );
      const types = serializeTypes(node);
      expect(types).toContain('(CompoundSelector');
      expect(types).not.toContain('(PseudoSelector');
      expect(types).not.toContain('(AttributeSelector');
      expect(types).not.toContain('(BasicSelector');
      expect(types).not.toContain('rawSelector');
    }
  });

  test('rejects string-backed core ruleset selectors outside the proven cheap subset', () => {
    expect(() => ruleset({
      selector: ':hover(1)',
      rules: []
    })).toThrow('Ruleset selector is outside the scanner-native selector subset.');
    expect(() => ruleset({
      selector: '&:focus, .b',
      rules: []
    })).toThrow('Ruleset selector is outside the scanner-native selector subset.');
    expect(() => ruleset({
      selector: '.a &:focus',
      rules: []
    })).toThrow('Ruleset selector is outside the scanner-native selector subset.');
  });

  test('renders string-backed core at-rules without name or prelude child nodes', () => {
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        ruleset({
          selector: '.a',
          rules: [
            decl({
              name: 'color',
              value: ['blue']
            })
          ]
        })
      ]
    });

    expect(node.toTrimmedString()).toBe('@media screen {\n  .a {\n    color: blue;\n  }\n}\n');
    expect(node.name).toBe('@media');
    expect(node.prelude).toBe('screen');
    expect(serializeTypes(node)).toBeString(`
      (AtRule
        name: '@media'
        prelude: 'screen'
        rules:
          [
            (Ruleset
              selector: '.a'
              rules:
                [
                  (Declaration
                    name: 'color'
                    value:
                      ['blue']
                  )
                ]
            )
          ]
      )
    `);
  });

  test('prepares string-backed rulesets under string-backed at-rule parents without materializing the header', () => {
    const context = new Context();
    const child = ruleset({
      selector: '.a',
      rules: [
        decl({
          name: 'color',
          value: ['blue']
        })
      ]
    });
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [child]
    });

    expect(node.name).toBe('@media');
    expect(() => child.prepareRegistration(context)).not.toThrow();
    expect(node.name).toBe('@media');
  });

  test('materializes string-backed core at-rule headers only when semantic registration asks', () => {
    const context = new Context();
    const node = atrule({
      name: '@media',
      prelude: 'screen',
      rules: [
        ruleset({
          selector: '.a',
          rules: []
        })
      ]
    });

    expect(node.name).toBe('@media');
    expect(node.prelude).toBe('screen');
    void node.prepareRegistration(context);
    expect(node.name).toBeDefined();
    expect(node.prelude).toBeDefined();
    const types = serializeTypes(node);
    expect(types).toContain('(Any [role=atkeyword] \'@media\')');
    expect(types).toContain('prelude:\n    (Any \'screen\')');
  });

  test('renders string-backed core at-rule statements without name or prelude child nodes', () => {
    const context = new Context();
    const node = atrulestatement({
      name: '@charset',
      prelude: '"UTF-8"'
    });

    expect(node.toTrimmedString()).toBe('@charset "UTF-8";');
    expect(node.name).toBe('@charset');
    expect(node.prelude).toBe('"UTF-8"');
    expect(serializeTypes(node).trim()).toBe(`(AtRuleStatement
  name: '@charset'
  prelude: '"UTF-8"'
)`);

    void rules([node]).prepareRegistration(context);
    expect(node.name).toBe('@charset');
    expect(node.prelude).toBe('"UTF-8"');
  });

  test('evaluates node preludes on string-name core at-rule statements', async () => {
    const context = new Context();
    const node = atrulestatement({
      name: '@import',
      prelude: ref({ key: 'target' }, { type: 'variable' })
    });
    const root = rules([
      vardecl({ name: 'target', value: any('"theme.css"') }),
      node
    ]);
    const evald = await root.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    await expect(Promise.resolve(node.render(context))).resolves.toBe('@import "theme.css";');
  });

  test('renders string-backed core import statements without name or prelude child nodes', () => {
    const node = atrulestatement({
      name: '@import',
      prelude: '"theme.css" screen'
    });

    expect(node.toTrimmedString()).toBe('@import "theme.css" screen;');
    expect(node.name).toBe('@import');
    expect(node.prelude).toBe('"theme.css" screen');
    expect(serializeTypes(node).trim()).toBe(`(AtRuleStatement
  name: '@import'
  prelude: '"theme.css" screen'
)`);
  });

  test('materializes string-backed core declarations only when semantic registration asks', () => {
    const context = new Context();
    const declaration = decl({
      name: 'color',
      value: ['blue']
    });

    expect(declaration.name).toBe('color');
    expect(declaration.value).toEqual(['blue']);
    void declaration.prepareRegistration(context);
    expect(declaration.name).toBeDefined();
    expect(declaration.value).toBeDefined();
    expect(declaration.name.parent).toBe(declaration);
    expect(declaration.value.parent).toBe(declaration);
    expect(declaration.toTrimmedString()).toBe('color: blue');
    expect(serializeTypes(declaration)).toContain('(Any [role=property] \'color\')');
  });
});
