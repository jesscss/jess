import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const cases = [
  ['detached ruleset property value', '@a: { b: 1; }; .entry { value: @a; }', 'eval/ruleset-on-property'],
  ['called detached ruleset property value', '@a: { b: 1; }; .entry { value: @a(); }', 'eval/ruleset-on-property'],
  ['direct root property', 'prop: 1;', 'eval/property-in-root'],
  ['root mixin property output', '.m() { prop: 1; } .m();', 'eval/property-in-root'],
  ['default() in a CSS rule guard', 'entry when (default()) { color: red; }', 'eval/invalid-function'],
  ['ambiguous mixin default() guards', '.m(@x, 2) when (default()) {} .m(@x, 2) when (default()) {} .entry { .m(1, 2); }', 'eval/ambiguous-default'],
  ['default() ambiguity after a valid not(default()) call', `
    guard-default-func-conflict {
      .m(1) {}
      .m(@x) when not(default()) {}
      .m(@x) when (@x = 3) and (default()) {}
      .m(2);
      .m(3);
    }
  `, 'eval/ambiguous-default'],
  ['ambiguous not(default()) mixin guards', `
    guard-default-func-conflict {
      .m(1) {}
      .m(@x) when not(default()) {}
      .m(@x) when not(default()) {}
      .m(1);
      .m(2);
    }
  `, 'eval/ambiguous-default']
] as const;

describe('Less structural errors through the public AST route', () => {
  it.each(cases)('reports %s', async (_label, source, code) => {
    const compiler = new Compiler({ output: { collapseNesting: true } });
    await expect(compiler.renderString(source, {
      filePath: 'entry.less',
      extension: '.less'
    })).rejects.toMatchObject({ code });
  });

  it('allows the non-ambiguous not(default()) branch before the later conflicting call', async () => {
    const compiler = new Compiler({ output: { collapseNesting: true } });
    await expect(compiler.renderString(`
      guard-default-func-conflict {
        .m(1) {}
        .m(@x) when not(default()) {}
        .m(@x) when (@x = 3) and (default()) {}
        .m(2);
      }
    `, {
      filePath: 'entry.less',
      extension: '.less'
    })).resolves.toBe('');
  });
});
