import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AbstractPlugin, type ISafeParseResult, type ScriptSandboxRoute } from '../../plugin.js';
import { Context } from '../../context.js';
import { buildEvaluator } from '../evaluator.js';
import { createFnRegistry } from '../value-dispatch.js';
import { plugin } from '../at-rule.js';
import { keyword, list, quoted, styleImport, stylesheet, type Stylesheet } from '../nodes.js';
import { prepareStaticImports } from '../serialize.js';

/*
 * A render that reaches a `@plugin` the script sandbox runs moves into the
 * sandbox. When import planning places a document whose evaluation is certain
 * (a plain import on the top-level chain), a `@plugin` at its top level moves
 * the render then (`rerouteForPlacedPlugins`), before the rest of the import
 * graph is parsed here; the script is never loaded in this process. A document
 * evaluation may not reach is left to evaluation.
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

  async importPlugin(): Promise<unknown> {
    this.loads++;
    return {};
  }
}

/** Serves a prepared document per `.less` path, and records which it parsed. */
class SheetPlugin extends AbstractPlugin {
  name = 'sheet';
  supportedExtensions = ['.less'];
  readonly parsed: string[] = [];

  constructor(private readonly documents: ReadonlyMap<string, Stylesheet>) {
    super();
  }

  safeParse(filePath: string): ISafeParseResult {
    this.parsed.push(filePath);
    return { document: this.documents.get(filePath) ?? stylesheet([]), errors: [], warnings: [] };
  }
}

const path$ = (file: string) => quoted(`"${file}"`, file, '"', false);

const setup = (opts: { sandboxes: boolean; withRoute: boolean; reference: boolean }) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-plan-')));
  tempDirs.push(directory);
  const file = (name: string) => path.join(directory, name);
  fs.writeFileSync(file('plugin.js'), 'module.exports = { install() {} };');
  for (const name of ['lib.less', 'next.less']) {
    fs.writeFileSync(file(name), '');
  }
  const sheets = new SheetPlugin(new Map([
    [file('lib.less'), stylesheet([plugin(path$(file('plugin.js'))), styleImport('@import', path$(file('next.less')), { mode: 'import' })])]
  ]));
  let reroutes = 0;
  const route: ScriptSandboxRoute = {
    reroute: () => {
      reroutes++;
      return new Promise<never>(() => undefined);
    }
  };
  const js = new ScriptPlugin(opts.sandboxes);
  const context = new Context(opts.withRoute ? { scriptSandbox: route } : {}, [sheets, js]);
  const root = stylesheet([styleImport('@import', path$(file('lib.less')), {
    mode: 'import',
    ...opts.reference ? { options: list([keyword('reference')], ',') } : {}
  })]);
  const planned = Promise.resolve(prepareStaticImports(root, { context, evaluator })).then(() => 'planned', () => 'failed');
  const outcome = Promise.race([planned, new Promise<string>(resolve => setTimeout(() => resolve('moved'), 1_000))]);
  return { js, outcome, reroutes: () => reroutes, nextParsed: () => sheets.parsed.includes(file('next.less')) };
};

describe('a @plugin at the top of a placed import', () => {
  it('moves the render before the rest of the import graph is parsed, and loads nothing here', async () => {
    const { js, outcome, reroutes, nextParsed } = setup({ sandboxes: true, withRoute: true, reference: false });
    expect(await outcome).toBe('moved');
    expect(reroutes()).toBe(1);
    expect(js.loads).toBe(0);
    expect(nextParsed()).toBe(false);
  });

  it('is left to evaluation in a render with no route into the sandbox', async () => {
    const { outcome, reroutes, nextParsed } = setup({ sandboxes: true, withRoute: false, reference: false });
    expect(await outcome).toBe('planned');
    expect(reroutes()).toBe(0);
    expect(nextParsed()).toBe(true);
  });

  it('is left to evaluation in a reference import', async () => {
    const { outcome, reroutes } = setup({ sandboxes: true, withRoute: true, reference: true });
    expect(await outcome).toBe('planned');
    expect(reroutes()).toBe(0);
  });

  it('is left to evaluation when the plugin that loads it does not sandbox scripts', async () => {
    const { outcome, reroutes } = setup({ sandboxes: false, withRoute: true, reference: false });
    expect(await outcome).toBe('planned');
    expect(reroutes()).toBe(0);
  });
});
