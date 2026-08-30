import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('reference import in a namespace', () => {
  // This is intentionally a Compiler/Context reproduction, not a direct
  // serialize seam: Context.getTree is asynchronous for the nested `.css`
  // source even when `(less)` selects the Less parser.
  it('publishes the imported rule before the following namespace call dispatches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-reference-namespace-'));
    fs.writeFileSync(path.join(dir, 'simple-mixin.css'), '.mixin { was: included; }\n');
    const entry = path.join(dir, 'entry.less');
    fs.writeFileSync(entry, `
#Namespace {
  @import (less, reference) "simple-mixin.css";
}
#used-namespaced-mixin {
  #Namespace > .mixin();
  shall-see: another property above;
}
`);
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
    });

    const parsed = await compiler.createContext(entry).getTree(entry);
    expect(parsed.node?.type).toBe('Stylesheet');

    await expect(compiler.render(entry, {
      suppressWarnings: true,
      breakOnError: false
    })).resolves.toBe('#used-namespaced-mixin {\n  was: included;\n  shall-see: another property above;\n}\n');
  });

  it('keeps a reference-only exact extender out of a visible target header', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-reference-extend-'));
    fs.writeFileSync(path.join(dir, 'reference.less'), `
.unusedAndReference:extend(.theOnlySelector) {
  unused-and: reference;
}
`);
    const entry = path.join(dir, 'entry.less');
    fs.writeFileSync(entry, `
@import (reference) "reference.less";
.theOnlySelector { shall-have: one selector; }
`);
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin()] }
    });

    const parsed = await compiler.createContext(entry).getTree(entry);
    expect(parsed.node?.type).toBe('Stylesheet');

    await expect(compiler.render(entry, {
      suppressWarnings: true,
      breakOnError: false
    })).resolves.toBe('.theOnlySelector {\n  shall-have: one selector;\n}\n');
  });
});
