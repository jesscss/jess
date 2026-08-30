/*
 * Eager-import-graph measurement.
 *
 * Node's ESM loader does not tree-shake: importing a module executes every
 * module reachable through its static import edges. This records exactly the
 * files Node loads for a given specifier and sums their byte size. The number
 * is deterministic and immune to machine load, so it is the primary evidence
 * for entry-point weight; CPU time is corroboration only.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Files Node eagerly loads for `specifier`, and their total byte size. */
export function eagerGraph(specifier, cwd) {
  const dir = mkdtempSync(join(tmpdir(), 'jess-import-graph-'));
  const out = join(dir, 'urls.txt');
  writeFileSync(out, '');
  const result = spawnSync(
    process.execPath,
    [
      '--import', pathToFileURL(join(here, 'register.mjs')).href,
      '--input-type=module',
      '-e', `await import(${JSON.stringify(specifier)});`
    ],
    { cwd, env: { ...process.env, JESS_IMPORT_GRAPH_OUT: out }, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`import failed for ${specifier}:\n${result.stderr}`);
  }
  const files = [...new Set(readFileSync(out, 'utf8').split('\n').filter(Boolean))]
    .map(url => fileURLToPath(url))
    .filter(file => !file.startsWith(here))
    .sort();
  let bytes = 0;
  for (const file of files) {
    bytes += statSync(file).size;
  }
  return { files, bytes };
}

/** Median CPU time (user+system, ms) to cold-import `specifier`. */
export function coldImportCpuMs(specifier, cwd, runs = 7) {
  const source = `const before = process.cpuUsage();\n`
    + `await import(${JSON.stringify(specifier)});\n`
    + `const after = process.cpuUsage(before);\n`
    + `process.stdout.write(String((after.user + after.system) / 1000));\n`;
  const samples = [];
  for (let index = 0; index < runs; index++) {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', source],
      { cwd, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      throw new Error(`import failed for ${specifier}:\n${result.stderr}`);
    }
    samples.push(Number(result.stdout));
  }
  samples.sort((a, b) => a - b);
  const median = samples[(samples.length - 1) >> 1];
  const deviations = samples.map(sample => Math.abs(sample - median)).sort((a, b) => a - b);
  const mad = deviations[(deviations.length - 1) >> 1];
  return { median, madPercent: median === 0 ? 0 : (mad / median) * 100, samples };
}
