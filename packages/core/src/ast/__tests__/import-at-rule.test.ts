import { describe, expect, it } from 'vitest';
import { any, importAtRule, interp, keyword, list, quoted, root, serialize, url, varDecl, varRef } from '../index.js';

describe('ImportAtRule', () => {
  it('writes a typed target and optional typed tail as one terminal statement', () => {
    const document = root([
      importAtRule('@import', quoted('"theme.css"', 'theme.css', '"', false), null, null, any('layer(theme) screen'))
    ]);

    expect(serialize(document)).toEqual({ css: '@import "theme.css" layer(theme) screen;\n' });
  });

  it('keeps a canonical opaque url target terminal', () => {
    expect(serialize(root([importAtRule('@import', url(any('theme.css')))]))).toEqual({
      css: '@import url(theme.css);\n'
    });
  });

  it('owns one target-to-tail separator and never strips tail bytes', () => {
    const document = root([
      importAtRule('@import', quoted('"theme.css"', 'theme.css', '"', false), null, null, any('  /* grammar-owned tail */ screen'))
    ]);

    expect(serialize(document)).toEqual({
      css: '@import "theme.css"   /* grammar-owned tail */ screen;\n'
    });
  });

  it('keeps directive syntax structured without making resolution part of the AST', () => {
    const document = root([
      varDecl('theme', keyword('night')),
      importAtRule(
        '@-export',
        url(interp([
          { lit: '"themes/' },
          { ref: varRef('theme'), unquote: true },
          { lit: '.less"' }
        ])),
        list([keyword('less'), keyword('reference')], [',']),
        keyword('tokens'),
        any('screen and (min-width: 40rem)')
      )
    ]);

    expect(serialize(document)).toEqual({
      css: '@-export (less, reference) url("themes/night.less") as tokens screen and (min-width: 40rem);\n'
    });
  });
});
