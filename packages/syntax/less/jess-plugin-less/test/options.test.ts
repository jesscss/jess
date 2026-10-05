import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JessError, logger } from '@jesscss/core';
import lessPlugin, { type LessPluginOptions } from '../src/index.js';

/** Options as a config file or a JavaScript caller can write them, typos included. */
function untyped(opts: Record<string, unknown>): LessPluginOptions {
  return opts;
}

function dialectDefaults(opts: LessPluginOptions) {
  return lessPlugin(opts).safeParse!('entry.less', '.entry {}').dialectDefaults;
}

describe('Less plugin mode options', () => {
  it.each([
    ['moduleMode', 'modren', '\'auto\' or \'modern\''],
    ['unitMode', 'stict', '\'loose\', \'preserve\' or \'strict\''],
    ['mathMode', 'paren', '\'always\', \'parens-division\', \'parens\' or \'strict\''],
    ['math', 'alwys', '0, 1, 2, 3, \'always\', \'parens-division\', \'parens\', \'strict\' or \'strict-legacy\'']
  ])('rejects an unknown %s value instead of reading it as another mode', (option, value, allowed) => {
    let thrown: unknown;
    try {
      lessPlugin(untyped({ [option]: value }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JessError);
    expect(thrown).toMatchObject({
      code: 'plugin/invalid-option',
      phase: 'plugin',
      message: `The less option ${option} must be ${allowed}; got '${value}'`,
      fix: `Set ${option} to ${allowed}.`
    });
  });

  it('rejects a value of the wrong type', () => {
    expect(() => lessPlugin(untyped({ moduleMode: true }))).toThrow(
      'The less option moduleMode must be \'auto\' or \'modern\'; got true'
    );
  });

  it('accepts every documented value', () => {
    for (const moduleMode of ['auto', 'modern'] as const) {
      expect(() => lessPlugin({ moduleMode })).not.toThrow();
    }
    for (const unitMode of ['loose', 'preserve', 'strict'] as const) {
      expect(dialectDefaults({ unitMode })?.unitMode).toBe(unitMode);
    }
    for (const mathMode of ['always', 'parens-division', 'parens', 'strict'] as const) {
      expect(dialectDefaults({ mathMode })?.mathMode).toBe(mathMode);
    }
    expect(dialectDefaults({ math: 0 })?.mathMode).toBe('always');
    expect(dialectDefaults({ math: 'strict-legacy' })?.mathMode).toBe('parens');
  });
});

describe('Less plugin strictMath', () => {
  const warn = logger.warn;
  const warned: string[] = [];
  beforeEach(() => {
    warned.length = 0;
    logger.warn = (...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    };
  });
  afterEach(() => {
    logger.warn = warn;
  });

  it('true means parens math, and warns', () => {
    expect(dialectDefaults({ strictMath: true })?.mathMode).toBe('parens');
    expect(warned).toEqual(['strictMath is deprecated; use mathMode. strictMath: true now means mathMode: \'parens\'']);
  });

  it('false leaves the default, and warns', () => {
    expect(dialectDefaults({ strictMath: false })?.mathMode).toBe('parens-division');
    expect(warned).toEqual(['strictMath is deprecated; use mathMode. strictMath: false now means mathMode: \'parens-division\'']);
  });

  it('loses to an explicit mathMode or math, without a warning', () => {
    expect(dialectDefaults({ strictMath: true, mathMode: 'always' })?.mathMode).toBe('always');
    expect(dialectDefaults({ strictMath: true, math: 'always' })?.mathMode).toBe('always');
    expect(warned).toEqual([]);
  });
});
