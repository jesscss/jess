/*
 * Run under `deno run --no-prompt --allow-read=<root> --ignore-read <this> <outside>`.
 * `<outside>` is a folder the read flags do not cover. Prints one JSON line:
 * what Deno lets code outside the read set be loaded and read by.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const outside = Deno.args[0];
const require = createRequire(import.meta.url);
const attempt = async (run) => {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: err?.name ?? 'Error' };
  }
};
const result = {
  requireUnderNodeModules: await attempt(() => require(`${outside}/node_modules/pkg/data.json`).secret),
  importUnderNodeModules: await attempt(async () => (await import(`file://${outside}/node_modules/pkg/index.mjs`)).secret),
  readUnderNodeModules: await attempt(() => fs.readFileSync(`${outside}/node_modules/pkg/data.json`, 'utf8')),
  requireElsewhere: await attempt(() => require(`${outside}/plain/data.json`).secret),
  importElsewhere: await attempt(async () => (await import(`file://${outside}/plain/index.mjs`)).secret)
};
console.log(JSON.stringify(result));
