import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AbstractPlugin, type ScriptSandboxRoute } from '../../plugin.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { createFnRegistry } from '../value-dispatch.js';
import { plugin } from '../at-rule.js';
import { quoted, styleImport, stylesheet } from '../nodes.js';
import { prepareStaticImports } from '../serialize.js';

/*
 * A render that reaches a `@plugin` the script sandbox runs moves into the
 * sandbox (Context.rerouteForPlugin). The move is made when planning meets the
 * `@plugin`, before the rest of the import graph is parsed here only to be
 * thrown away; the script is never loaded in this process.
 */
const evaluator = buildEvaluator(createFnRegistry());
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

const setup = (sandboxes: boolean, withRoute: boolean) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-plan-')));
  tempDirs.push(directory);
  const script = path.join(directory, 'plugin.js');
  fs.writeFileSync(script, 'module.exports = { install() {} };');
  const missing = path.join(directory, 'never-read.less');
  let reroutes = 0;
  const route: ScriptSandboxRoute = {
    reroute: () => {
      reroutes++;
      return new Promise<never>(() => undefined);
    }
  };
  const js = new ScriptPlugin(sandboxes);
  const context = new Context(withRoute ? { scriptSandbox: route } : {}, [js]);
  const document = stylesheet([
    plugin(quoted(`"${script}"`, script, '"', false)),
    styleImport('@import', quoted(`"${missing}"`, missing, '"', false), { mode: 'import' })
  ]);
  const planned = Promise.resolve(prepareStaticImports(document, { context, evaluator }))
    .then(() => 'planned', () => 'failed');
  const outcome = Promise.race([planned, new Promise<string>(resolve => setTimeout(() => resolve('moved'), 1_000))]);
  return { js, outcome, reroutes: () => reroutes };
};

describe('a planned @plugin the sandbox runs', () => {
  it('moves the render before the imports after it are read, and loads nothing here', async () => {
    const { js, outcome, reroutes } = setup(true, true);
    expect(await outcome).toBe('moved');
    expect(reroutes()).toBe(1);
    expect(js.loads).toBe(0);
  });

  it('stays in planning for a render with no route into the sandbox', async () => {
    const { outcome, reroutes } = setup(true, false);
    expect(await outcome).toBe('failed');
    expect(reroutes()).toBe(0);
  });

  it('stays in planning when the plugin that loads it does not sandbox scripts', async () => {
    const { outcome, reroutes } = setup(false, true);
    expect(await outcome).toBe('failed');
    expect(reroutes()).toBe(0);
  });
});
