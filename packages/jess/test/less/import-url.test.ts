import { describe, it, expect } from 'vitest';
import { JessCompiler } from '../../src';

describe('Import URL', () => {
  const compiler = new JessCompiler();

  it('should handle @import url("file.less")', async () => {
    const lessCode = `
      @import url("test.less");
      
      .test {
        color: red;
      }
    `;

    const css = await compiler.renderString(lessCode, {
      filePath: process.cwd() + '/test/less/import-url.test.less'
    });
    expect(css).toContain('.test');
    expect(css).toContain('color: red');
  });

  it('should handle @import url("file.css") as plain CSS import', async () => {
    const lessCode = `
      @import url("test.css");
      
      .test {
        color: red;
      }
    `;

    const css = await compiler.renderString(lessCode, {
      filePath: process.cwd() + '/test/less/import-url.test.less'
    });
    expect(css).toContain('@import url("test.css")');
    expect(css).toContain('.test');
    expect(css).toContain('color: red');
  });

  it('should handle @import url("http://example.com/file.less") as plain CSS import', async () => {
    const lessCode = `
      @import url("http://example.com/file.less");
      
      .test {
        color: red;
      }
    `;

    const css = await compiler.renderString(lessCode, {
      filePath: process.cwd() + '/test/less/import-url.test.less'
    });
    expect(css).toContain('@import url("http://example.com/file.less")');
    expect(css).toContain('.test');
    expect(css).toContain('color: red');
  });
});
