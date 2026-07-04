import { describe, test, expect } from 'vitest';
import { parseCssFn } from '../src/grammar.js';

describe('nested pseudo-selector parsing', () => {
  test('a:hover nested in rule block should parse without errors', () => {
    const { errors } = parseCssFn('.parent { a:hover { color: red; } }');
    expect(errors.length).toBe(0);
  });

  test('a:focus nested in rule block should parse without errors', () => {
    const { errors } = parseCssFn('.parent { a:focus { color: blue; } }');
    expect(errors.length).toBe(0);
  });

  test('div:first-child nested in rule block should parse without errors', () => {
    const { errors } = parseCssFn('.parent { div:first-child { color: green; } }');
    expect(errors.length).toBe(0);
  });

  test('multiple nested pseudo-selectors should parse', () => {
    const { errors } = parseCssFn(`
      .nav {
        a { color: grey; }
        a:hover { color: black; }
        span.disabled { color: lightgrey; }
      }
    `);
    expect(errors.length).toBe(0);
  });

  test('nested selector with pseudo followed by descendant should parse', () => {
    const { errors } = parseCssFn(`
      .parent {
        table {
          tr:last-child td {
            padding-bottom: 0;
          }
        }
      }
    `);
    expect(errors.length).toBe(0);
  });

  test('pseudo-selector should not be confused with property declaration', () => {
    const { errors } = parseCssFn('.parent { a:hover { color: red; } color: blue; }');
    expect(errors.length).toBe(0);
  });
});
