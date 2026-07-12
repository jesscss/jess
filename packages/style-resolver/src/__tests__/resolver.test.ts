import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  extractImports,
  expandLessImportCandidates,
  expandScssImportCandidates,
  resolveImport
} from '../index.js';

describe('@jesscss/style-resolver', () => {
  it('extracts Less @import with options', () => {
    const src = [
      '@import "import/import-once-test-c";',
      '@import (multiple) "import/import-test-f.less";'
    ].join('\n');
    const imports = extractImports(src, 'less');
    expect(imports.map(i => i.specifier)).toEqual([
      'import/import-once-test-c',
      'import/import-test-f.less'
    ]);
    expect(imports[1]?.options).toEqual(['multiple']);
  });

  it('matches Less candidate expansion (plugin parity)', () => {
    expect(expandLessImportCandidates('foo/bar')).toEqual(['foo/bar.less', 'foo/bar']);
    expect(expandLessImportCandidates('foo/bar.less')).toEqual(['foo/bar.less']);
  });

  it('matches SCSS candidate expansion (plugin parity)', () => {
    expect(expandScssImportCandidates('foo/bar')).toEqual([
      'foo/bar.scss',
      path.join('foo', '_bar.scss'),
      path.join('foo/bar', 'index.scss'),
      path.join('foo/bar', '_index.scss')
    ]);
    expect(expandScssImportCandidates('foo/bar.scss')).toEqual([
      'foo/bar.scss',
      path.join('foo', '_bar.scss')
    ]);
  });

  it('resolves via loadPaths for scss', () => {
    const fakeFs = {
      exists(p: string) {
        return p.endsWith(path.join('load', 'foo.scss'));
      }
    };
    const r = resolveImport(fakeFs, {
      lang: 'scss',
      fromFilePath: '/proj/a.scss',
      specifier: 'foo',
      config: { loadPaths: ['/proj/load'] }
    });
    expect(r?.filePath).toContain('foo.scss');
  });
});

