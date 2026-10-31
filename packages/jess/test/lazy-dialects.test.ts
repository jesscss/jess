import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/*
 * Run in a fresh process against the built package: which modules a process
 * loads is the behaviour under test, and Vitest's own module graph would hide it.
 */
function inFreshProcess<T>(body: string): T {
  const script = `
    import { registerHooks } from 'node:module';
    const parsers = new Set();
    registerHooks({ load(url, context, next) {
      const match = /\\/(css|less|scss|jess)-parser\\//.exec(url);
      if (match) parsers.add(match[1]);
      return next(url, context);
    } });
    const { Compiler } = await import('jess');
    ${body}
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: import.meta.dirname, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop()!) as T;
}

function render(source: string, extension: string): { css: string; parsers: string[] } {
  return inFreshProcess(`
    const css = await new Compiler().renderString(${JSON.stringify(source)}, { extension: ${JSON.stringify(extension)} });
    console.log(JSON.stringify({ css, parsers: [...parsers].sort() }));
  `);
}

describe('the jess compiler', () => {
  it('loads a dialect parser only when a document of that dialect is parsed', () => {
    const less = render('@c: red; .a { color: @c; }', '.less');
    expect(less.css).toBe('.a {\n  color: red;\n}\n');
    expect(less.parsers).not.toContain('scss');
    expect(less.parsers).not.toContain('jess');

    const scss = render('$c: red; .a { color: $c; }', '.scss');
    expect(scss.css).toBe('.a {\n  color: red;\n}\n');
    expect(scss.parsers).toContain('scss');
    expect(scss.parsers).not.toContain('jess');
  });

  it('names a deferred dialect plugin, before it loads, as the plugin it loads', () => {
    const { deferred, loadedBefore, real } = inFreshProcess<{ deferred: unknown; loadedBefore: string[]; real: unknown }>(`
      const plugins = new Compiler().createContext().plugins;
      const describe = plugin => ({ name: plugin.name, supportedExtensions: plugin.supportedExtensions });
      const deferred = ['jess', 'scss'].map(name => describe(plugins.find(plugin => plugin.name === name)));
      const loadedBefore = [...parsers];
      const real = [(await import('@jesscss/plugin-jess')).default(), (await import('@jesscss/plugin-scss')).default()].map(describe);
      console.log(JSON.stringify({ deferred, loadedBefore, real }));
    `);
    expect(loadedBefore).not.toContain('jess');
    expect(loadedBefore).not.toContain('scss');
    expect(deferred).toEqual(real);
  });
});
