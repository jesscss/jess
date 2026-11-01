/**
 * `Compiler.convertToJess` points each converted import at the file the render
 * loaded. `.jess` imports name that file — no extension inference — so a Less
 * `@compose "b.less"` and an extension-less `@import "c"` both name the
 * converted sibling, and the `.jess` renders the CSS the `.less` does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';

describe('Compiler.convertToJess', () => {
  let dir = '';
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names the loaded file for a compose and an extension-less import', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.less'), '@compose "b.less";\n@import "c";\n.a { w: 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.less'), '@b: red;\n.b { x: 1; }\n');
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'c.less'), '@import "lib/d";\n.c { y: 2; }\n');
    fs.writeFileSync(path.join(dir, 'lib/d.less'), '.d { z: 3; }\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(errors).toEqual([]);
      const printed = files.map(file => [path.relative(fs.realpathSync(dir), fs.realpathSync(file.source)), 'jess' in file ? file.jess : file.gaps]);
      expect(printed).toEqual([
        ['a.less', '@-compose "./b.jess";\n@-import "./c.jess";\n.a {\n  w: 1;\n}\n'],
        ['b.less', '$b: red;\n.b {\n  x: 1;\n}\n'],
        ['c.less', '@-import "./lib/d.jess";\n.c {\n  y: 2;\n}\n'],
        ['lib/d.less', '.d {\n  z: 3;\n}\n']
      ]);
      for (const file of files) {
        fs.writeFileSync(file.jessPath, 'jess' in file ? file.jess : '');
      }
      expect(await compiler.render(path.join(dir, 'a.jess'))).toBe(await compiler.render(path.join(dir, 'a.less')));
    } finally {
      compiler.dispose();
    }
  });
});
