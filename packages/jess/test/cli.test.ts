import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bin = path.resolve(fileURLToPath(new URL('../bin/cli.mjs', import.meta.url)));

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.VSCODE_INSPECTOR_OPTIONS;
  return env;
}

function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], { env: cliEnv() }, (error, stdout, stderr) => {
      resolve({
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout,
        stderr
      });
    });
  });
}

describe('jess CLI', () => {
  it('keeps the distinct jess command and help contract', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: jess <input> [output]');
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
});
