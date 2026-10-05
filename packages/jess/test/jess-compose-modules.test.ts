/**
 * `.jess` `@-compose` modules: a namespace's members are the module's bindings
 * as its activation holds them after configuration and evaluation (spec R6
 * §E.1, ledger A8) — through `$ns.name`, a `$for` over the namespace, and
 * `as *` alike.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function render(entry: string, module: string): Promise<string> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-compose-'));
  tempDirs.push(directory);
  fs.writeFileSync(path.join(directory, 'm.jess'), module, 'utf8');
  fs.writeFileSync(path.join(directory, 'entry.jess'), entry, 'utf8');
  const compiler = new Compiler();
  try {
    return await compiler.render(path.join(directory, 'entry.jess'));
  } finally {
    compiler.dispose();
  }
}

describe('.jess @-compose namespace members', () => {
  const MODULE = '$a?: 1;\n$b: 2;\n$b := 3;\n$c: 4;\n$c: 5;\n';
  const LOOP = '$for ($v, $k of $m) { .k-${k} { v: $v; } }\n';

  it('a $for over a namespace iterates each member once, as the activation binds it', async () => {
    await expect(render(`@-compose "./m.jess" with { $a: 9; }\n${LOOP}`, MODULE)).resolves.toBe(
      '.k-a {\n  v: 9;\n}\n.k-b {\n  v: 3;\n}\n.k-c {\n  v: 5;\n}\n'
    );
  });

  it('a namespace read of a live-written member is the final binding after the module runs', async () => {
    await expect(render('@-compose "./m.jess";\n.a { x: $m.x; }\n', '$x: 1;\n.m { a: $x; }\n$x := 2;\n'))
      .resolves.toBe('.m {\n  a: 1;\n}\n.a {\n  x: 2;\n}\n');
  });

  it('`as *` members resolve in the module activation, live ones included', async () => {
    const module = '$x?: blue;\n$y: red;\n$^z: green;\n';
    await expect(render('@-compose "./m.jess" as *;\n.a { x: $x; y: $y; z: $^z; }\n', module))
      .resolves.toBe('.a {\n  x: blue;\n  y: red;\n  z: green;\n}\n');
    await expect(render('@-compose "./m.jess" as * with { $x: gold; }\n.a { x: $x; }\n', module))
      .resolves.toBe('.a {\n  x: gold;\n}\n');
  });

  it('an `as *` read of a live-written member is the final binding, as through a namespace', async () => {
    await expect(render('@-compose "./m.jess" as *;\n.a { x: $x; }\n', '$x: 1;\n.m { a: $x; }\n$x := 2;\n'))
      .resolves.toBe('.m {\n  a: 1;\n}\n.a {\n  x: 2;\n}\n');
  });
});
