import { describe, expect, it } from 'vitest';
import { any, importAtRule, quoted, root, serialize } from '../index.js';

describe('ImportAtRule', () => {
  it('writes a typed target and optional typed tail as one terminal statement', () => {
    const document = root([
      importAtRule(quoted('"theme.css"', 'theme.css', '"', false), any('layer(theme) screen')),
    ]);

    expect(serialize(document)).toEqual({ css: '@import "theme.css" layer(theme) screen;\n' });
  });

  it('keeps a canonical opaque url target terminal', () => {
    expect(serialize(root([importAtRule(any('url(theme.css)'))]))).toEqual({
      css: '@import url(theme.css);\n',
    });
  });

  it('owns one target-to-tail separator and never strips tail bytes', () => {
    const document = root([
      importAtRule(quoted('"theme.css"', 'theme.css', '"', false), any('  /* grammar-owned tail */ screen')),
    ]);

    expect(serialize(document)).toEqual({
      css: '@import "theme.css"   /* grammar-owned tail */ screen;\n',
    });
  });
});
