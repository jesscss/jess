import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(fileURLToPath(new URL('../bin/lessc.mjs', import.meta.url)));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn the `lessc` bin. `input`, when provided, is piped to stdin. */
function runLessc(args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [BIN, ...args], (err, stdout, stderr) => {
      const code = err && typeof err.code === 'number' ? err.code : 0;
      resolve({ code, stdout, stderr });
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

describe('lessc CLI (drop-in)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-lessc-cli-'));
  });

  afterEach(() => {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const write = (name: string, content: string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  };

  it('preserves nesting by default (v5 semantics)', async () => {
    const file = write('in.less', '.a {\n  color: red;\n  .b { width: 1px; }\n}\n');
    const { code, stdout } = await runLessc([file]);
    expect(code).toBe(0);
    // v5 default: nested output (the `.b` block stays inside `.a`).
    expect(stdout).toContain('.a {');
    expect(stdout).toContain('.b {');
    expect(stdout).not.toContain('.a .b');
  });

  it('flattens selectors with --collapse-nesting (Less 4.x style)', async () => {
    const file = write('in.less', '.a {\n  color: red;\n  .b { width: 1px; }\n}\n');
    const { code, stdout } = await runLessc(['--collapse-nesting', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('.a .b {');
  });

  it('reads from stdin when source is `-`', async () => {
    const { code, stdout } = await runLessc(['-'], '.a { .b { color: red; } }');
    expect(code).toBe(0);
    expect(stdout).toContain('color: red');
  });

  it('writes to a destination file when given', async () => {
    const file = write('in.less', '.a { color: red; }');
    const out = path.join(dir, 'out.css');
    const { code } = await runLessc([file, out]);
    expect(code).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toContain('color: red');
  });

  it('maps --modify-var to the engine', async () => {
    const file = write('mv.less', '@c: red; .a { color: @c; }');
    const { code, stdout } = await runLessc(['--modify-var=c=blue', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('color: blue');
  });

  it('maps --global-var to the engine', async () => {
    const file = write('gv.less', '.a { width: @w; }');
    const { code, stdout } = await runLessc(['--global-var=w=10px', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('width: 10px');
  });

  it('exits nonzero and prints an error on an unknown flag (no crash)', async () => {
    const file = write('in.less', '.a { color: red; }');
    const { code, stderr } = await runLessc(['--bogus', file]);
    expect(code).toBe(1);
    expect(stderr.toLowerCase()).toContain('unknown option');
  });

  it('exits nonzero on a missing input file', async () => {
    const { code, stderr } = await runLessc([path.join(dir, 'nope.less')]);
    expect(code).toBe(1);
    expect(stderr).toContain('ENOENT');
  });

  it('exits nonzero on a parse error', async () => {
    const file = write('bad.less', '.a { color: }\n .b {\n');
    const { code, stderr } = await runLessc([file]);
    expect(code).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it('lint (-l) produces no output and exits 0 on valid input', async () => {
    const file = write('in.less', '.a { color: red; }');
    const { code, stdout } = await runLessc(['-l', file]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('prints usage on -h and exits 0', async () => {
    const { code, stdout } = await runLessc(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('usage: lessc');
  });

  it('prints a version on -v and exits 0', async () => {
    const { code, stdout } = await runLessc(['-v']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/lessc \d+\./);
  });
});
