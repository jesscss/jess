import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bin = path.resolve(fileURLToPath(new URL('../bin/cli.mjs', import.meta.url)));

/** The start of every ANSI style and OSC-8 hyperlink sequence. */
const ESC = '\u001B';

/*
 * The CLI's color default reads NO_COLOR and whether its streams are
 * terminals; the spawned CLI's streams are pipes, and NO_COLOR is cleared so
 * the runner's environment cannot decide a color assertion.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.VSCODE_INSPECTOR_OPTIONS;
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  return env;
}

function run(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], {
      cwd: options.cwd,
      env: { ...cliEnv(), ...options.env }
    }, (error, stdout, stderr) => {
      resolve({
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr
      });
    });
  });
}

async function inTempDir(fn: (directory: string) => Promise<void>): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-safety-'));
  try {
    await fn(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe('jess CLI', () => {
  it('keeps the distinct jess command and help contract', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: jess <input> [output]');
    for (const documented of ['-o, --out <dir>', '--allow-remote-imports <hosts>', '--color, --no-color', '--version', 'Exit status:']) {
      expect(result.stdout).toContain(documented);
    }
  });

  it('renders a .jess file to the requested output', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-'));
    try {
      const input = path.join(directory, 'entry.jess');
      const output = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '.entry { color: red; }');

      const result = await run([input, output]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Compiled');
      expect(fs.readFileSync(output, 'utf8')).toContain('color: red');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps short, long, and inline output-directory options around input positionals', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-options-'));
    try {
      const input = path.join(directory, 'entry.jess');
      fs.writeFileSync(input, '.entry { color: red; }');

      const shortOut = path.join(directory, 'short');
      fs.mkdirSync(shortOut);
      const shortResult = await run(['-o', shortOut, input]);
      expect(shortResult.code).toBe(0);
      expect(fs.readFileSync(path.join(shortOut, 'entry.css'), 'utf8')).toContain('color: red');

      const longOut = path.join(directory, 'long');
      fs.mkdirSync(longOut);
      const longResult = await run([`--out=${longOut}`, input]);
      expect(longResult.code).toBe(0);
      expect(fs.readFileSync(path.join(longOut, 'entry.css'), 'utf8')).toContain('color: red');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  /*
   * No request is made in these cases: an off-list `.less` URL is refused at
   * the plugin's claim, and an extensionless one off the list stays CSS.
   */
  it('adds the remote-import allow list with --allow-remote-imports', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-remote-'));
    try {
      const input = path.join(directory, 'entry.less');
      const output = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n@import "https://evil.example/theme.less";\n');

      const without = await run([input, '--no-color']);
      expect(without.code).toBe(0);
      expect(fs.readFileSync(output, 'utf8')).toBe(
        '@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n@import "https://evil.example/theme.less";\n'
      );

      const allowed = await run([input, '--allow-remote-imports', 'cdn.example.com,fonts.example.com', '--no-color']);
      expect(allowed.code).toBe(1);
      expect(allowed.stderr.split('import/load-failed')).toHaveLength(2);

      // The diagnostic frame wraps its message at 80 columns when stderr is a pipe.
      expect(allowed.stderr).toMatch(/evil\.example is not on the remote-\s*import allow list/u);

      fs.writeFileSync(input, '@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n');
      const extensionless = await run([input, '--allow-remote-imports=cdn.example.com', '--no-color']);
      expect(extensionless.code).toBe(0);
      expect(fs.readFileSync(output, 'utf8')).toBe('@import url("https://fonts.googleapis.com/css?family=Open+Sans");\n');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [['cdn.example.com,*'], 'allow entry "*" is not a host'],
    [['cdn.example.com', '8.8.8.8'], 'allow entry "8.8.8.8" is an IP address']
  ])('rejects the allow list %j before compiling', async (lists, message) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-remote-allow-'));
    try {
      const input = path.join(directory, 'entry.less');
      fs.writeFileSync(input, '.entry { color: red; }');

      const result = await run([input, ...lists.flatMap(hosts => ['--allow-remote-imports', hosts])]);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(message);
      expect(fs.existsSync(path.join(directory, 'entry.css'))).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('surfaces lint diagnostics through the jess lint command', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-lint-'));
    try {
      const input = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '.entry { colr: red; width: 0px; }');

      const result = await run(['lint', input]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('property-no-unknown');
      expect(result.stdout).toContain('length-zero-no-unit');
      expect(result.stdout).toContain('0 error(s), 2 warning(s)');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('supports jess lint json output', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-lint-json-'));
    try {
      const input = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '.entry { colr: red; }');

      const result = await run(['lint', input, '--format', 'json']);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');

      const json = JSON.parse(result.stdout) as {
        results: Array<{
          diagnostics: Array<{ code: string; ruleName?: string; severity: string }>;
        }>;
        warningCount: number;
        errorCount: number;
      };
      expect(json.warningCount).toBe(1);
      expect(json.errorCount).toBe(0);
      expect(json.results[0]?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'lint/unknown-property',
          ruleName: 'property-no-unknown',
          severity: 'warning'
        })
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('surfaces recommended vendor-prefix diagnostics through jess lint', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-lint-vendor-prefix-'));
    try {
      const input = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '.entry { -webkit-transform: rotate(0); }');

      const result = await run(['lint', input, '--format', 'json']);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      const json = JSON.parse(result.stdout) as {
        results: Array<{
          diagnostics: Array<{ code: string; ruleName?: string; severity: string }>;
        }>;
        warningCount: number;
        errorCount: number;
      };
      expect(json.warningCount).toBe(1);
      expect(json.errorCount).toBe(0);
      expect(json.results[0]?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'lint/vendor-prefix',
          ruleName: 'vendor-prefix',
          severity: 'warning'
        })
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('honors lint exit policy flags', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-lint-policy-'));
    try {
      const input = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '.entry { colr: red; width: 0px; }');

      const maxWarnings = await run(['lint', input, '--max-warnings', '0']);
      expect(maxWarnings.code).toBe(1);
      expect(maxWarnings.stderr).toBe('');
      expect(maxWarnings.stdout).toContain('0 error(s), 2 warning(s)');

      const quiet = await run(['lint', input, '--quiet']);
      expect(quiet.code).toBe(0);
      expect(quiet.stderr).toBe('');
      expect(quiet.stdout).not.toContain('property-no-unknown');
      expect(quiet.stdout).not.toContain('length-zero-no-unit');
      expect(quiet.stdout).toContain('0 error(s), 2 warning(s)');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prints lint findings as compact line diagnostics without color', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-cli-lint-lines-'));
    try {
      const input = path.join(directory, 'entry.css');
      fs.writeFileSync(input, '.entry {\n  colr: red;\n  width: 0px;\n}\n');

      const result = await run(['lint', input, '--no-color']);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(input);
      expect(result.stdout).toContain('2:3');
      expect(result.stdout).toContain('3:10');
      expect(result.stdout).toContain('property-no-unknown');
      expect(result.stdout).toContain('length-zero-no-unit');
      expect(result.stdout).not.toContain('\u001B');
      expect(result.stdout).not.toContain('colr: red;');
      expect(result.stdout).not.toContain('width: 0px;');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prints the package version with --version', async () => {
    const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const result = await run(['--version']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${version}\n`);
  });

  it('prints the usage to stderr and exits 2 when no input is given', async () => {
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: jess <input> [output]');
  });

  it.each(['.less', '.scss', '.sass', '.jess', '.LESS'])(
    'refuses to write CSS over a second stylesheet argument (%s)',
    async extension => inTempDir(async (directory) => {
      const second = `b${extension}`;
      fs.writeFileSync(path.join(directory, 'a.less'), '.a { color: red; }');
      fs.writeFileSync(path.join(directory, second), '.b { color: blue; }');

      const result = await run(['a.less', second], { cwd: directory });
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`jess: refusing to write CSS to ${second}: ${extension} is a stylesheet source extension\n`);
      expect(result.stderr).toContain('run jess once per file');
      expect(fs.readFileSync(path.join(directory, second), 'utf8')).toBe('.b { color: blue; }');
      expect(fs.readdirSync(directory).sort()).toEqual(['a.less', second]);
    })
  );

  it('refuses more arguments than an input and an output', async () => inTempDir(async (directory) => {
    const files = ['a.less', 'b.less', 'c.less'].map(name => path.join(directory, name));
    for (const file of files) {
      fs.writeFileSync(file, '.x { color: red; }');
    }

    const result = await run(files);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('expected an input file and at most one output file, but got 3 arguments');
    expect(result.stderr).toContain('run jess once per file');
    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).toBe('.x { color: red; }');
    }
    expect(fs.readdirSync(directory).sort()).toEqual(['a.less', 'b.less', 'c.less']);
  }));

  it('refuses to write over the input by its own path or through a hard link', async () => inTempDir(async (directory) => {
    const input = path.join(directory, 'entry.css');
    fs.writeFileSync(input, '.entry { color: red; }');
    fs.linkSync(input, path.join(directory, 'linked.css'));

    for (const args of [[input], [input, input], [input, path.join(directory, 'linked.css')]]) {
      const result = await run(args);
      expect(result.code).toBe(2);
      expect(result.stderr).toBe(`jess: refusing to write CSS over the input file ${input}\n`);
    }
    expect(fs.readFileSync(input, 'utf8')).toBe('.entry { color: red; }');
  }));

  it('refuses to write over the input through a case variant of its name', async ({ skip }) => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'Mixed.less'), '.m { color: red; }');
    fs.writeFileSync(path.join(directory, 'Entry.css'), '.e { color: red; }');
    if (!fs.existsSync(path.join(directory, 'ENTRY.CSS'))) {
      skip('the temp directory is on a case-sensitive file system');
    }

    const css = await run(['Entry.css', 'ENTRY.CSS'], { cwd: directory });
    expect(css.code).toBe(2);
    expect(css.stderr).toBe('jess: refusing to write CSS over the input file Entry.css\n');
    expect(fs.readFileSync(path.join(directory, 'Entry.css'), 'utf8')).toBe('.e { color: red; }');

    const less = await run(['Mixed.less', 'mixed.LESS'], { cwd: directory });
    expect(less.code).toBe(2);
    expect(less.stderr).toBe('jess: refusing to write CSS over the input file Mixed.less\n');
    expect(fs.readFileSync(path.join(directory, 'Mixed.less'), 'utf8')).toBe('.m { color: red; }');
  }));

  it.skipIf(process.platform === 'win32')('refuses an output that is a symlink to a stylesheet', async () => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'a.less'), '.a { color: red; }');
    fs.writeFileSync(path.join(directory, 'b.less'), '.b { color: blue; }');
    fs.symlinkSync('b.less', path.join(directory, 'out.css'));

    const result = await run(['a.less', 'out.css'], { cwd: directory });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('refusing to write CSS to out.css: it links to the stylesheet');
    expect(fs.readFileSync(path.join(directory, 'b.less'), 'utf8')).toBe('.b { color: blue; }');
  }));

  it('reports an input it cannot read in one line', async () => inTempDir(async (directory) => {
    fs.mkdirSync(path.join(directory, 'folder.less'));

    const missing = await run(['missing.less'], { cwd: directory });
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toBe('jess: cannot read missing.less: no such file or directory\n');

    const folder = await run(['folder.less'], { cwd: directory });
    expect(folder.code).toBe(1);
    expect(folder.stderr).toBe('jess: cannot read folder.less: it is a directory\n');
  }));

  it('reports an output it cannot write in one line', async () => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'entry.less'), '.entry { color: red; }');

    const result = await run(['entry.less', '-o', 'missing'], { cwd: directory });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`jess: cannot write ${path.join('missing', 'entry.css')}: no such file or directory\n`);
  }));

  /*
   * A parse error is both recorded and thrown; an undefined variable is only
   * thrown. Each is printed once, as a diagnostic, and the stylesheet source
   * appears only in the frame's own excerpt, never as a dumped error object.
   */
  it.each([
    ['a parse error', '.a {\n  color: red;\n', 'parse/syntax-error', 'Missing closing brace.', ':3:1'],
    ['an undefined variable', '.a {\n  color: @missing;\n}\n', 'resolve/name-not-found', 'Name not found', ':2:10']
  ])('prints %s once, as a diagnostic', async (_name, source, code, message, location) => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'entry.less'), source);

    const result = await run(['entry.less'], { cwd: directory });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.split(code)).toHaveLength(2);
    expect(result.stderr.split(message)).toHaveLength(2);
    expect(result.stderr).toContain(`entry.less${location}`);
    expect(result.stderr).not.toContain('JessError');
    expect(result.stderr).not.toContain('source:');
    expect(fs.existsSync(path.join(directory, 'entry.css'))).toBe(false);
  }));

  it('prints an exception that is not a stylesheet diagnostic once, in one line', async () => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'entry.less'), '.entry { color: red; }');
    fs.writeFileSync(path.join(directory, 'styles.config.mjs'), 'export default { compile: { plugins: [\'jess-cli-test-no-such-plugin\'] } };\n');

    const result = await run(['entry.less'], { cwd: directory });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^jess: .*jess-cli-test-no-such-plugin.*\n$/u);
  }));

  it('writes warnings to stderr and keeps stdout to the compile report', async () => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'entry.less'), '.b { width: 1px + 3em; }\n');

    const result = await run(['entry.less'], { cwd: directory });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('eval/unexpressible-unit');
    expect(result.stdout).toMatch(/^Compiled entry\.less → .*entry\.css \(\d+\.\d+s\)\n$/u);
    expect(fs.existsSync(path.join(directory, 'entry.css'))).toBe(true);
  }));

  it('writes no color or hyperlinks to a pipe unless --color asks for them', async () => inTempDir(async (directory) => {
    fs.writeFileSync(path.join(directory, 'entry.less'), '.a {\n  color: red;\n');
    fs.writeFileSync(path.join(directory, 'lint.css'), '.entry { colr: red; }');

    const piped = await run(['entry.less'], { cwd: directory });
    expect(piped.stderr).toContain('parse/syntax-error');
    expect(piped.stderr).not.toContain(ESC);

    const forced = await run(['entry.less', '--color'], { cwd: directory, env: { NO_COLOR: '1' } });
    expect(forced.stderr).toContain(ESC);

    const lint = await run(['lint', 'lint.css'], { cwd: directory });
    expect(lint.stdout).toContain('property-no-unknown');
    expect(lint.stdout).not.toContain(ESC);
  }));
});
