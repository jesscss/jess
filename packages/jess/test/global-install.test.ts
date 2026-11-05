import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/*
 * `npm install -g` leaves no `package.json` above the installed packages, and
 * Deno looks for one above the engine script. These tests run the CLIs from
 * such a tree, copied from the built workspace, and read what a `@plugin`
 * script gets there (`docs/design/DENO-SANDBOX-COMPILE.md` §5). `less` lives in
 * its own repository, so `fixtures/global-install/less` stands in for it with
 * the same compiler and imports.
 */
const JESS = fileURLToPath(new URL('..', import.meta.url));
const LESS = fileURLToPath(new URL('./fixtures/global-install/less', import.meta.url));

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jess-global-install-')));
const prefix = path.join(root, 'lib');
const globals = path.join(prefix, 'node_modules');
const home = path.join(root, 'home');
const denoDir = path.join(root, 'deno-dir');

const LESSC = path.join(globals, 'less/lessc.mjs');
const JESS_CLI = path.join(globals, 'jess/bin/cli.mjs');
const OUTPUT = path.join(root, 'output.css');

interface Manifest {
  name: string;
  files?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifestOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;

const dependencyNames = (dir: string) => {
  const { dependencies, optionalDependencies } = manifestOf(dir);
  return Object.keys({ ...dependencies, ...optionalDependencies });
};

/** What a workspace package publishes, or all of a package from the registry. */
const copyPackage = (from: string, to: string) => {
  const { files } = manifestOf(from);
  const published = from.includes(`${path.sep}node_modules${path.sep}`) || files === undefined
    ? undefined
    : new Set(['package.json', ...files.map(file => file.split('/')[0])]);
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => {
      const top = path.relative(from, source).split(path.sep)[0]!;
      return top === '' || (top !== 'node_modules' && (published === undefined || published.has(top)));
    }
  });
};

/**
 * Copies packages, and what they depend on, under `to`'s `node_modules`.
 * ponytail: flat under that one `node_modules`, first version found wins; nest further if two versions ever matter.
 */
const installDependencies = (names: string[], from: string, to: string) => {
  for (const name of names) {
    const target = path.join(to, 'node_modules', name);
    const found = createRequire(path.join(from, 'package.json')).resolve.paths(name)
      ?.map(parent => path.join(parent, name))
      .find(candidate => fs.existsSync(candidate));
    if (found === undefined || fs.existsSync(target)) {
      continue;
    }
    const real = fs.realpathSync(found);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (name === 'deno') {
      /* A program the host runs, not a module the engine reads, and over 100 MB. */
      fs.symlinkSync(real, target);
      continue;
    }
    copyPackage(real, target);
    installDependencies(dependencyNames(real), real, to);
  }
};

const install = (from: string, to: string) => {
  const real = fs.realpathSync(from);
  copyPackage(real, to);
  installDependencies(dependencyNames(real), real, to);
};

/* The stand-in gets its manifest here: every `package.json` under `packages/` is a workspace package. */
const installLess = (to: string) => {
  fs.cpSync(LESS, to, { recursive: true });
  fs.writeFileSync(path.join(to, 'package.json'), '{"name":"less","type":"module"}');
  installDependencies(['@jesscss/compiler', '@jesscss/plugin-less', '@jesscss/plugin-less-compat', '@jesscss/plugin-node-modules'], fs.realpathSync(JESS), to);
};

const requests: string[] = [];
let registry: http.Server;
let origin: string;

/** One real package, so a route to the registry does download it instead of stopping at a 404. */
const startRegistry = async () => {
  const tree = path.join(root, 'registry');
  fs.mkdirSync(path.join(tree, 'package'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'package/package.json'), '{"name":"jess-probe","version":"1.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(tree, 'package/index.js'), 'module.exports = 42;');
  const tarball = path.join(tree, 'probe.tgz');
  execFileSync('tar', ['czf', tarball, '-C', tree, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const bytes = fs.readFileSync(tarball);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

  registry = http.createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.url === '/jess-probe') {
      response.end(`{"name":"jess-probe","dist-tags":{"latest":"1.0.0"},"versions":{"1.0.0":{"name":"jess-probe","version":"1.0.0","dist":{"tarball":"${origin}/probe.tgz","integrity":"${integrity}"}}}}`);
    } else if (request.url === '/probe.tgz') {
      response.end(bytes);
    } else {
      response.statusCode = request.url === '/page' ? 200 : 404;
      response.end();
    }
  });
  await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(registry.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  install(JESS, path.join(globals, 'jess'));
  installLess(path.join(globals, 'less'));
  install(fs.realpathSync(path.join(JESS, 'node_modules/@jesscss/plugin-js')), path.join(globals, '@jesscss/plugin-js'));
  fs.mkdirSync(home);
  await startRegistry();
}, 180_000);

afterAll(async () => {
  await new Promise(resolve => registry.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

let projects = 0;
const written: string[] = [];

afterEach(() => {
  for (const file of written.splice(0)) {
    fs.rmSync(file);
  }
  requests.length = 0;
  fs.rmSync(denoDir, { recursive: true, force: true });
});

type Config = readonly (readonly [file: string, text: string])[];
const PACKAGE: Config[number] = ['package.json', '{}'];
const DENO_AUTO: Config[number] = ['deno.json', '{"nodeModulesDir":"auto"}'];
const PACKAGE_LISTING_IT: Config[number] = ['package.json', '{"dependencies":{"jess-probe":"1.0.0"}}'];

/** A config above the install: where Deno looks, the same as a project's own config above a local install. */
const placeConfig = (config: Config) => {
  for (const [file, text] of config) {
    fs.writeFileSync(path.join(prefix, file), text);
    written.push(path.join(prefix, file));
  }
};

/* The two ways a stylesheet reaches a script: a Less `@plugin` runs in its own context, and `@use` imports an ES module through Deno's loader. */
const SCRIPTS = {
  plugin: (dir: string, result: string) => {
    fs.writeFileSync(path.join(dir, 'plugin.js'), `module.exports = { install(less, manager, functions) { functions.add('result', ${result}); } };`);
    return '@plugin "./plugin";\n.a { b: result(); }\n';
  },
  use: (dir: string, result: string) => {
    fs.writeFileSync(path.join(dir, 'script.js'), `export const result = ${result};`);
    return '@use "./script.js";\n.a { b: @script.result(); }\n';
  }
};
type ScriptKind = keyof typeof SCRIPTS;

const projectWith = (kind: ScriptKind, result: string) => {
  const dir = path.join(root, 'projects', String(projects++));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'entry.less'), SCRIPTS[kind](dir, result));
  return dir;
};

const render = (cli: string, cwd: string) => new Promise<{ code: number; css: string; said: string }>((resolve) => {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, DENO_DIR: denoDir, NPM_CONFIG_REGISTRY: `${origin}/` };
  delete env.NODE_OPTIONS;
  fs.rmSync(OUTPUT, { force: true });
  execFile(process.execPath, [cli, 'entry.less', OUTPUT], { cwd, env }, (error, _stdout, said) => {
    resolve({
      code: typeof error?.code === 'number' ? error.code : 0,
      css: fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '',
      said
    });
  });
});

const printed = (css: string) => /b: (.*);/u.exec(css)?.[1];

/** Awaits every attempt, so the answer is what happened and not what had happened so far. */
const PROBES = `async () => {
  const attempt = async (act) => {
    try {
      return String(await act());
    } catch (error) {
      return error.name;
    }
  };
  const here = Deno.cwd();
  const results = [
    await attempt(() => Deno.readTextFileSync(here + '/entry.less').length > 0),
    await attempt(() => Deno.readTextFileSync('/etc/hosts')),
    await attempt(() => Deno.writeTextFileSync(here + '/written.txt', 'x')),
    await attempt(() => Deno.env.get('HOME')),
    await attempt(() => new Deno.Command('/bin/echo').outputSync().code),
    await attempt(() => Deno.dlopen('/no/such/library', {})),
    await attempt(() => fetch(globalThis.REGISTRY_PAGE).then(response => response.status))
  ];
  for (const name of ['write', 'env', 'net', 'run', 'ffi', 'sys']) {
    results.push(Deno.permissions.querySync({ name }).state);
  }
  results.push(Deno.permissions.querySync({ name: 'read', path: '/etc/hosts' }).state);
  results.push(Deno.permissions.querySync({ name: 'import', host: 'esm.sh' }).state);
  return results.join(' ');
}`;

const REFUSED = [
  'true', 'NotFound', 'NotCapable', 'NotCapable', 'NotCapable', 'NotCapable', 'NotCapable',
  'prompt', 'prompt', 'prompt', 'prompt', 'prompt', 'prompt', 'denied', 'prompt'
].join(' ');

describe('a script is held to the same permissions wherever the packages are installed', () => {
  const cases: [string, string, Config, ScriptKind][] = [];
  for (const kind of ['plugin', 'use'] as const) {
    for (const [name, cli] of [['lessc', LESSC], ['jess', JESS_CLI]] as const) {
      cases.push(
        [`@${kind} script, ${name} from a global install`, cli, [], kind],
        [`@${kind} script, ${name} from a local install with a package.json above it`, cli, [PACKAGE], kind]
      );
    }
    cases.push([`@${kind} script, jess from a pnpm workspace`, path.join(JESS, 'bin/cli.mjs'), [], kind]);
  }

  it.each(cases)('%s', async (_name, cli, config, kind) => {
    placeConfig(config);
    const dir = projectWith(kind, PROBES.replace('globalThis.REGISTRY_PAGE', `'${origin}/page'`));

    const { code, css, said } = await render(cli, dir);

    expect(code, said).toBe(0);
    expect(printed(css)).toBe(REFUSED);
    expect(requests).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'written.txt'))).toBe(false);
  }, 60_000);
});

describe('a script\'s npm: import', () => {
  const DYNAMIC = `async () => {
    try {
      return 'loaded ' + (await import('npm:jess-probe@1.0.0')).default;
    } catch (error) {
      return 'refused ' + error.name;
    }
  }`;

  /* `nodeModulesDir: "auto"` has Deno manage npm packages itself, unless the engine says otherwise. */
  const CONFIGS: [string, Config][] = [
    ['no config', []],
    ['a deno.json', [['deno.json', '{}']]],
    ['a deno.json asking for node_modules', [DENO_AUTO]],
    ['that and a package.json', [DENO_AUTO, PACKAGE]],
    ['that and a package.json that lists the package', [DENO_AUTO, PACKAGE_LISTING_IT]]
  ];

  const withNothingFetched = async (config: Config, dir: string) => {
    placeConfig(config);
    const tree = () => [prefix, globals, dir].flatMap(folder => fs.readdirSync(folder).map(name => path.join(folder, name)));
    const before = tree();

    const result = await render(JESS_CLI, dir);

    expect(requests).toEqual([]);
    expect(fs.readdirSync(path.join(denoDir, 'npm'))).toEqual([]);
    expect(tree()).toEqual(before);
    return result;
  };

  it.each(CONFIGS)('from @use is refused and fetches nothing, with %s above the install', async (_name, config) => {
    const { code, css, said } = await withNothingFetched(config, projectWith('use', DYNAMIC));
    expect(code, said).toBe(0);
    expect(printed(css)).toBe('refused TypeError');
  }, 60_000);

  it.each(CONFIGS)('from @plugin is refused and fetches nothing, with %s above the install', async (_name, config) => {
    const { code, css, said } = await withNothingFetched(config, projectWith('plugin', DYNAMIC));
    expect(code, said).toBe(0);
    expect(printed(css)).toBe('refused TypeError');
  }, 60_000);

  it.each(CONFIGS)('at the top of a module fails the render and fetches nothing, with %s above the install', async (_name, config) => {
    const dir = projectWith('use', '() => 1');
    fs.writeFileSync(path.join(dir, 'script.js'), `import probe from 'npm:jess-probe@1.0.0';\nexport const result = () => probe;`);
    const { code, said } = await withNothingFetched(config, dir);
    expect(code).not.toBe(0);
    expect(said).toMatch(/Could not find .*jess-probe/u);
  }, 60_000);
});
