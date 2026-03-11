import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CssParser } from '../src/index.js';

const cssParser = new CssParser({ legacyMode: true, recoveryEnabled: true } as any);

const errDir = path.join(__dirname, 'css', 'errors');

describe('CSS error parsing', () => {
  const cssFiles = fs.readdirSync(errDir)
    .filter(f => f.endsWith('.css'))
    .sort();

  for (const file of cssFiles) {
    const name = file.replace('.css', '');
    const css = fs.readFileSync(path.join(errDir, file), 'utf-8');

    it(`${name}: produces at least one error`, () => {
      const { errors } = cssParser.parse(css);
      expect(errors.length).toBeGreaterThan(0);
    });

    it(`${name}: error has location info`, () => {
      const { errors } = cssParser.parse(css);
      expect(errors.length).toBeGreaterThan(0);
      const err = errors[0];
      expect(err.token).toBeDefined();
      expect(err.token.startLine).toBeGreaterThan(0);
      expect(err.token.startColumn).toBeDefined();
      expect(typeof err.token.startOffset).toBe('number');
    });

    it(`${name}: error has rule stack context`, () => {
      const { errors } = cssParser.parse(css);
      expect(errors.length).toBeGreaterThan(0);
      const err = errors[0];
      expect(err.ruleStack).toBeDefined();
      expect(err.ruleStack.length).toBeGreaterThan(0);
    });
  }
});

describe('CSS error location regression', () => {
  it('missing semicolon: error at correct line/col', () => {
    const css = 'a { color: red\n  font-size: 12px; }';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0];
    expect(err.token.startLine).toBe(2);
    expect(err.token.startColumn).toBe(12);
    expect(err.token.startOffset).toBe(26);
    expect(err.ruleStack).toContain('qualifiedRule');
  });

  it('invalid selector (123): error at start', () => {
    const css = '123 { color: red; }';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0];
    expect(err.token.startLine).toBe(1);
    expect(err.token.startColumn).toBe(1);
    expect(err.token.startOffset).toBe(0);
    expect(err.ruleStack).toContain('qualifiedRule');
  });

  it('empty block in @media: error inside media block', () => {
    const css = '@media screen { {} }';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0];
    expect(err.token.startLine).toBe(1);
    expect(err.token.startColumn).toBe(17);
    expect(err.token.startOffset).toBe(16);
    expect(err.ruleStack).toContain('mediaAtRule');
  });

  it('multiple empty blocks: reports errors at each block', () => {
    const css = '{}\n{}\n{}';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0].token.startLine).toBe(1);
    expect(errors[0].token.startOffset).toBe(0);
    // Subsequent errors on subsequent lines
    if (errors.length >= 2) {
      expect(errors[1].token.startLine).toBeGreaterThanOrEqual(2);
    }
  });

  it('no selector (bare {}): error at opening brace', () => {
    const css = '{}\n';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0];
    expect(err.token.startLine).toBe(1);
    expect(err.token.startColumn).toBe(1);
    expect(err.token.startOffset).toBe(0);
  });

  it('root declaration: error at property name', () => {
    const css = 'one: 1;';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0];
    expect(err.token.startLine).toBe(1);
    expect(err.token.startOffset).toBeLessThanOrEqual(5);
  });

  it('atrule missing semicolon: error at end of at-rule', () => {
    // @media screen {@content}
    const css = '/** Invalid inner at-rule */\n@media screen {@content}\n';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const err = errors[0];
    expect(err.token.startLine).toBe(2);
    expect(err.token.startColumn).toBe(24);
    expect(err.token.startOffset).toBe(52);
  });

  it('valid CSS produces no errors', () => {
    const { errors } = cssParser.parse('a { color: red; }');
    expect(errors.length).toBe(0);
  });

  it('valid multi-rule CSS produces no errors', () => {
    const { errors } = cssParser.parse('a { color: red; }\nb { font-size: 12px; }');
    expect(errors.length).toBe(0);
  });

  it('valid @media produces no errors', () => {
    const { errors } = cssParser.parse('@media screen { a { color: red; } }');
    expect(errors.length).toBe(0);
  });

  it('valid nested CSS produces no errors', () => {
    const { errors } = cssParser.parse('a { color: red; b { font-size: 12px; } }');
    expect(errors.length).toBe(0);
  });
});
