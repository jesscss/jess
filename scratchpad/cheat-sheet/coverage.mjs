// Mechanical export-coverage check for PARSEMAN-COMBINATOR-CHEAT-SHEET.md.
// Enumerates parseman's runtime public surface and diffs it against the sheet.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const SHEET = new URL('../../docs/architecture/parser/PARSEMAN-COMBINATOR-CHEAT-SHEET.md', import.meta.url)

const m = await import('parseman')
const exportNames = Object.keys(m).sort()
const sheet = readFileSync(SHEET, 'utf8')

// A name counts as "documented" only if it appears inside a backtick span.
const ticked = new Set([...sheet.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((x) => x[1]))
const documented = exportNames.filter((n) => ticked.has(n))
const undocumented = exportNames.filter((n) => !ticked.has(n))

// Phantom: names the sheet's Surface tables present as exports that are not exported.
const start = sheet.indexOf('## Grammar Surface')
const end = sheet.indexOf('## Anti-Patterns')
const tables = start >= 0 && end > start ? sheet.slice(start, end) : ''
const claimed = new Set([...tables.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((x) => x[1]))
const phantom = [...claimed].filter((n) => !exportNames.includes(n)).sort()

const pkgPath = require_.resolve('parseman').replace(/\/dist\/.*$/, '/package.json')
console.log('parseman version     :', JSON.parse(readFileSync(pkgPath, 'utf8')).version)
console.log('RUNTIME EXPORTS      :', exportNames.length)
console.log('DOCUMENTED (anywhere):', documented.length)
console.log('UNDOCUMENTED         :', undocumented.length)
console.log('\nUNDOCUMENTED LIST:\n ', undocumented.join(' '))
// Names the sheet deliberately mentions as NOT available on the pinned floor.
// Each must be described in the sheet as absent/0.46-only; they are not phantoms.
const DELIBERATELY_ABSENT = new Set([
  'guard', // removed upstream; the sheet says "use gate"
  'examinedNothing', 'fuseInterpreted', 'isInterpretedFuse',
  'analyzeChoiceInventory', 'profileWastedWork', 'choiceSiteKey', 'armLabel',
  'renderChoiceInventory', 'renderWastedWork', 'leftFactorPreview',
  'checkWastedWork', 'buildWastedWorkBaseline',
  'unconsumedFrom', // a RunResult field, not an export
])
const unexplained = phantom.filter((n) => !DELIBERATELY_ABSENT.has(n))

console.log('\nMentioned-but-absent, DELIBERATE (flagged in the sheet) [' +
  phantom.filter((n) => DELIBERATELY_ABSENT.has(n)).length + ']')
console.log('PHANTOM (named as available, but NOT exported) [' + unexplained.length + ']:\n ',
  unexplained.join(' ') || '(none)')

if (undocumented.length > 0 || unexplained.length > 0) {
  console.error('\nFAIL: the cheat sheet no longer covers the parseman surface.')
  process.exit(1)
}
console.log('\nOK: every runtime export is documented; no unexplained phantoms.')
