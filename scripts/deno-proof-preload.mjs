import childProcess from 'node:child_process';
import fs from 'node:fs';
import Module, { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

const proofBase = process.env.JESS_DENO_PROOF_FILE;

const counters = {
  pid: process.pid,
  cwd: process.cwd(),
  argv: process.argv.slice(0, 5),
  pluginJsResolve: 0,
  pluginJsRequire: 0,
  denoSpawn: 0,
  denoSpawnSync: 0,
  denoExecFile: 0,
  denoExecFileSync: 0,
  brokerEnvSpawns: 0,
  commands: []
};

globalThis.__JESS_DENO_PROOF__ = counters;

const isPluginJsRequest = (request) =>
  request === '@jesscss/plugin-js' || String(request).startsWith('@jesscss/plugin-js/');

const commandLooksLikeDeno = (command) => {
  const value = String(command ?? '');
  const base = path.basename(value).toLowerCase();
  return base === 'deno' || base === 'deno.exe';
};

const noteCommand = (kind, command, args, options) => {
  const isDeno = commandLooksLikeDeno(command);
  const hasBrokerEnv = !!options?.env?.DENO_PERMISSION_BROKER_PATH;
  if (!isDeno && !hasBrokerEnv) {
    return;
  }
  if (kind === 'spawn') {
    counters.denoSpawn += isDeno ? 1 : 0;
  } else if (kind === 'spawnSync') {
    counters.denoSpawnSync += isDeno ? 1 : 0;
  } else if (kind === 'execFile') {
    counters.denoExecFile += isDeno ? 1 : 0;
  } else if (kind === 'execFileSync') {
    counters.denoExecFileSync += isDeno ? 1 : 0;
  }
  counters.brokerEnvSpawns += hasBrokerEnv ? 1 : 0;
  counters.commands.push({
    kind,
    command: String(command),
    args: Array.isArray(args) ? args.map(String).slice(0, 8) : [],
    hasBrokerEnv
  });
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (isPluginJsRequest(request)) {
    counters.pluginJsResolve++;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (isPluginJsRequest(request)) {
    counters.pluginJsRequire++;
  }
  return originalRequire.call(this, request);
};

const originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, args, options) {
  noteCommand('spawn', command, args, options);
  return originalSpawn.apply(this, arguments);
};

const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  noteCommand('spawnSync', command, args, options);
  return originalSpawnSync.apply(this, arguments);
};

const originalExecFile = childProcess.execFile;
childProcess.execFile = function(file, args, options, callback) {
  noteCommand('execFile', file, args, typeof options === 'object' ? options : undefined);
  return originalExecFile.apply(this, arguments);
};

const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = function(file, args, options) {
  noteCommand('execFileSync', file, args, options);
  return originalExecFileSync.apply(this, arguments);
};

syncBuiltinESMExports();

process.on('exit', () => {
  if (!proofBase) {
    return;
  }
  const outFile = `${proofBase}.${process.pid}.json`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(counters, null, 2)}\n`);
});
