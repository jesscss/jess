/**
 * Side-effect module: point every `require('typescript')` at
 * `@typescript/typescript6`.
 *
 * This repo builds against the TypeScript 6 API package rather than the
 * `typescript` package, but `typescript-eslint` resolves `typescript` by name.
 * Without this redirect, loading the parser fails outright with
 * ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * The same shim is inlined at the top of `eslint.config.mjs`. It lives here as
 * a module so `eslint.absolute.config.mjs` can install it too, and it MUST be
 * imported (statically) before `typescript-eslint` is loaded.
 */
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const typescript6ApiPath = require.resolve('@typescript/typescript6');
const typescript6Api = require('@typescript/typescript6');
const originalResolveFilename = Module._resolveFilename;

typescript6Api.Extension ??= {
  Cjs: '.cjs',
  Cts: '.cts',
  Js: '.js',
  Jsx: '.jsx',
  Mjs: '.mjs',
  Mts: '.mts',
  Ts: '.ts',
  Tsx: '.tsx'
};

Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === 'typescript') {
    return typescript6ApiPath;
  }
  if (request.startsWith('typescript/lib/')) {
    return require.resolve(`@typescript/typescript6/${request.slice('typescript/'.length)}`);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
