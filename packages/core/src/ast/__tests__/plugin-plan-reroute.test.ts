import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AbstractPlugin, type ISafeParseResult, type ScriptSandboxRoute } from '../../plugin.js';
import { Context } from '../../context.js';
import { plugin } from '../at-rule.js';
import { quoted, styleImport, stylesheet } from '../nodes.js';

/*
 * A render that reaches a `@plugin` the script sandbox runs moves into the
 * sandbox (`rerouteForPlannedPlugins`). The move is made when the document
 * holding the `@plugin` is parsed, before the rest of the import graph is
 * parsed here only to be thrown away; the script is never loaded in this
 * process.
 */
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

class ScriptPlugin extends AbstractPlugin {
  name = 'js';
  supportedExtensions = ['.js'];
  loads = 0;

  constructor(readonly sandboxesScripts: boolean) {
    super();
  }

  override async importPlugin(): Promise<unknown> {
    this.loads++;
    return {};
  }
}

/** Parses every `.less` file as `@plugin "<script>"; @import "<next>";`. */
class SheetPlugin extends AbstractPlugin {
  name = 'sheet';
  supportedExtensions = ['.less'];

  constructor(private readonly script: string, private readonly next: string) {
    super();
  }

  override safeParse(): ISafeParseResult {
    return {
      document: stylesheet([
        plugin(quoted(`"${this.script}"`, this.script, '"', false)),
        styleImport('@import', quoted(`"${this.next}"`, this.next, '"', false), { mode: 'import' })
      ]),
      errors: [],
      warnings: []
    };
  }
}

const setup = (sandboxes: boolean, withRoute: boolean) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-plan-')));
  tempDirs.push(directory);
  const script = path.join(directory, 'plugin.js');
  fs.writeFileSync(script, 'module.exports = { install() {} };');
  const entry = path.join(directory, 'main.less');
  fs.writeFileSync(entry, '');
  let reroutes = 0;
  const route: ScriptSandboxRoute = {
    reroute: () => {
      reroutes++;
      return new Promise<never>(() => undefined);
    }
  };
  const js = new ScriptPlugin(sandboxes);
  const context = new Context(withRoute ? { scriptSandbox: route } : {}, [new SheetPlugin(script, path.join(directory, 'next.less')), js]);
  const parsed = context.getTree(entry).then(() => 'parsed', () => 'failed');
  const outcome = Promise.race([parsed, new Promise<string>(resolve => setTimeout(() => resolve('moved'), 1_000))]);
  return { js, outcome, reroutes: () => reroutes };
};

describe('a parsed @plugin the sandbox runs', () => {
  it('moves the render before the rest of the import graph is parsed, and loads nothing here', async () => {
    const { js, outcome, reroutes } = setup(true, true);
    expect(await outcome).toBe('moved');
    expect(reroutes()).toBe(1);
    expect(js.loads).toBe(0);
  });

  it('is left to evaluation in a render with no route into the sandbox', async () => {
    const { outcome, reroutes } = setup(true, false);
    expect(await outcome).toBe('parsed');
    expect(reroutes()).toBe(0);
  });

  it('is left to evaluation when the plugin that loads it does not sandbox scripts', async () => {
    const { outcome, reroutes } = setup(false, true);
    expect(await outcome).toBe('parsed');
    expect(reroutes()).toBe(0);
  });
});
