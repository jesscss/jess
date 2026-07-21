import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

const invalidCalls = [
  ['invalid color text', 'color("NOT A COLOR")'],
  ['non-number percentage expression', 'percentage(16/17)'],
  ['invalid svg-gradient direction', 'svg-gradient(horizontal, black, white)'],
  ['invalid svg-gradient stop shape', 'svg-gradient(to bottom, black, orange, 45%, white)'],
  ['missing svg-gradient direction', 'svg-gradient(black, orange)'],
  ['invalid svg-gradient list direction', 'svg-gradient(horizontal, @colors)', '@colors: black, white;'],
  ['invalid svg-gradient list stop shape', 'svg-gradient(to bottom, @colors)', '@colors: black, orange, 45%, white;'],
  ['missing svg-gradient direction in list form', 'svg-gradient(black, @colors)', '@colors: orange;'],
  ['non-number unit expression', 'unit(80/16, rem)'],
] as const;

describe('Less built-in argument errors through the public AST route', () => {
  it.each(invalidCalls)('reports %s in functionMode:error', async (_label, call, declarations = '') => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { functionMode: 'error' },
    });
    await expect(compiler.renderString(`${declarations}\n.entry { value: ${call}; }`, {
      filePath: 'entry.less',
      extension: '.less',
    })).rejects.toMatchObject({ code: 'eval/invalid-function' });
  });
});
