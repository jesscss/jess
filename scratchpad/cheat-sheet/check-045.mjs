// Which of the names the sheet mentions actually exist in the PINNED 0.45?
const m = await import('parseman')
const names = [
  'analyzeChoiceInventory', 'profileWastedWork', 'choiceSiteKey', 'armLabel',
  'renderChoiceInventory', 'renderWastedWork', 'leftFactorPreview',
  'checkWastedWork', 'buildWastedWorkBaseline', 'examinedNothing',
  'fuseInterpreted', 'isInterpretedFuse', 'diagnoseGrammar', 'formatGrammarDiagnosis',
  'guard', 'gate',
]
for (const n of names) {
  console.log(`  ${n.padEnd(28)} ${n in m ? 'PRESENT in 0.45' : '-- ABSENT from 0.45 --'}`)
}
