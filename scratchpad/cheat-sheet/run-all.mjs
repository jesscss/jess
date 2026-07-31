// Run every cheat-sheet probe. Exits non-zero if the coverage gate fails or any
// probe throws — so this can be wired into a parseman floor-bump check.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const probes = [
  'coverage.mjs',
  'check-045.mjs',
  'probe-arity.mjs',
  'probe-empty-commit.mjs',
  'probe-zero-arity.mjs',
  'probe-balanced-expect.mjs',
  'probe-dispatch-cut.mjs',
  'probe-structural.mjs',
]

let failed = 0
for (const p of probes) {
  console.log(`\n${'#'.repeat(78)}\n# ${p}\n${'#'.repeat(78)}`)
  const r = spawnSync(process.execPath, [join(here, p)], { stdio: 'inherit' })
  if (r.status !== 0) { failed++; console.error(`\n!! ${p} exited ${r.status}`) }
}

console.log(`\n${'='.repeat(78)}`)
if (failed) { console.error(`${failed} probe(s) FAILED.`); process.exit(1) }
console.log('All probes ran clean. The cheat sheet matches the installed parseman.')
