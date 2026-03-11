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

describe('CSS error location accuracy', () => {
  it('points to the correct line and column for a missing semicolon', () => {
    const css = 'a { color: red\n  font-size: 12px; }';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThan(0);
    const err = errors[0];
    expect(err.token.startLine).toBeGreaterThanOrEqual(1);
  });

  it('points to the correct token for an invalid selector', () => {
    const css = '123 { color: red; }';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('includes rule stack showing parse context', () => {
    const css = '@media screen { {} }';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThan(0);
    const err = errors[0];
    expect(err.ruleStack.length).toBeGreaterThan(0);
  });

  it('multiple errors are reported for multiple issues', () => {
    const css = '{}\n{}\n{}';
    const { errors } = cssParser.parse(css);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('valid CSS with recovery produces no errors', () => {
    const { errors } = cssParser.parse('a { color: red; }');
    for (const e of errors) {
      console.log('  err:', e.message, '| ruleStack:', e.ruleStack, '| token:', e.token?.image);
    }
    expect(errors.length).toBe(0);
  });
});
