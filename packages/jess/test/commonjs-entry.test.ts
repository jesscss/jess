import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/*
 * Run in a fresh CommonJS process against the built package: `require('jess')`
 * loads every package's CommonJS build, which Vitest's module graph never does.
 */
function renderWithRequire(source: string, extension: string): string {
  const script = `
    const { Compiler } = require('jess');
    new Compiler().renderString(${JSON.stringify(source)}, { extension: ${JSON.stringify(extension)} })
      .then(css => console.log(JSON.stringify(css)), err => { console.error(err.message); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], { cwd: import.meta.dirname, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!) as string;
}

describe('the CommonJS jess entry', () => {
  it.each([
    ['.less', '@c: red; .a { color: @c; }'],
    ['.scss', '$c: red; .a { color: $c; }'],
    ['.jess', '$c: red; .a { color: $c; }'],
    ['.css', '.a { color: red; }']
  ])('renders a %s document', (extension, source) => {
    expect(renderWithRequire(source, extension)).toBe('.a {\n  color: red;\n}\n');
  });
});
