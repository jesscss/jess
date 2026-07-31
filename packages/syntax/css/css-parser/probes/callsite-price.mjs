/*
 * Price each candidate-C tier boundary in combinator call sites, using
 * Candidate B's measured ~3.6 KB/site artifact model.
 *
 * CAVEAT (Candidate A, measured): bytes are NOT linear in call sites. The same
 * call sites cost 13.69x more when sub-rules are referenced by const (inlined
 * transitively at every reference) than by name through the `g` proxy. These
 * figures therefore price each family AS THE INCUMBENT CURRENTLY WRITES IT --
 * an upper bound on what removing the family saves, not a prediction of what a
 * replacement costs.
 */
import { readFileSync } from 'node:fs';

const COMB = /\b(sequence|choice|literal|regex|word|keywords|many|oneOrMore|oneOrMoreSep|optional|not|peek|node|token|noTrivia|scanTo|balanced|dispatch|when|otherwise|routed|expect|field|label|ref|skip|gate|transform|withCtx|attempt|sepBy|leaf|trivia|matches|startsWith|endsWith|makeWord|makeWhen)\(/g;

const src = readFileSync(new URL('../src/grammar.ts', import.meta.url), 'utf8');
const lines = src.split('\n');

// Split the rules() factory body into consts at 2-space indent.
const consts = [];
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const m = /^ {2}const ([A-Za-z_][A-Za-z0-9_]*) =/.exec(lines[i]);
  if (m) {
    if (cur) {
      cur.end = i;
      consts.push(cur);
    }
    cur = { name: m[1], start: i, end: lines.length };
  }
}
if (cur) {
  consts.push(cur);
}

const sites = new Map();
for (const c of consts) {
  const body = lines.slice(c.start, c.end).join('\n');
  sites.set(c.name, (body.match(COMB) ?? []).length);
}

const FAMILIES = {
  'B0 dead code': ['OpaqueAtRuleBlock'],
  'B2 flat-prelude scanners': [
    'AtRulePreludeWhitespace', 'AtRulePreludeComma', 'AtRulePreludeGroup',
    'AtRulePreludeQuoted', 'atPreludeTextSegment', 'AtRulePreludeText',
    'AtRulePreludeSegments'
  ],
  'B3 query/supports/container': [
    'QueryValue', 'QueryBareFeature', 'QueryColonFeature', 'QueryComparisonFeature',
    'QueryRangeFeature', 'QueryFeature', 'QueryNonOnlyKeyword', 'queryFunctionOpen',
    'queryIdentOrFunction', 'queryFunctionTail', 'RoutedQueryFunction',
    'RoutedQueryNonOnlyKeyword', 'queryIdentOrFunctionTerm', 'QueryTerm',
    'QueryOnlyClause', 'QueryClause', 'QueryPrelude', 'containerName',
    'ContainerQueryClause', 'ContainerQueryPrelude', 'ContainerPrelude',
    'GeneralEnclosedRaw', 'GeneralEnclosedQuoted', 'GeneralEnclosedGroup',
    'GeneralEnclosedContent', 'GeneralEnclosed', 'QueryFunction',
    'SupportsInParens', 'SupportsCondition', 'SupportsPrelude'
  ],
  'B3-hot (stays: shape)': ['mediaTypeKeywordReserved', 'containerNameReserved'],
  'B4 varFallback (BLOCKED)': [
    'VarFallbackPunctuation', 'varFallbackBracketCrossParen', 'varFallbackBracketCrossBrace',
    'varFallbackBraceCrossParen', 'varFallbackBraceCrossBracket', 'varFallbackParenCrossBracket',
    'varFallbackParenCrossBrace', 'VarFallbackParen', 'VarFallbackBracket', 'VarFallbackBrace',
    'varFallbackComponent', 'VarFallbackTerm', 'VarFallbackEmpty', 'varFallbackComma',
    'VarFallbackItem', 'VarFallback'
  ],
  'B4a cross-guards only': [
    'varFallbackBracketCrossParen', 'varFallbackBracketCrossBrace',
    'varFallbackBraceCrossParen', 'varFallbackBraceCrossBracket',
    'varFallbackParenCrossBracket', 'varFallbackParenCrossBrace'
  ]
};

const total = [...sites.values()].reduce((a, b) => a + b, 0);
const BYTES_PER_SITE = 3341439 / 904;
console.log(`consts parsed: ${consts.length}   call sites in factory: ${total}`);
console.log(`model: ${BYTES_PER_SITE.toFixed(0)} B/site (incumbent 3,341,439 B / 904 sites)\n`);
console.log('family'.padEnd(30), 'consts'.padStart(7), 'sites'.padStart(7), 'pred. bytes'.padStart(13), 'of total'.padStart(9));
for (const [fam, names] of Object.entries(FAMILIES)) {
  let s = 0;
  let n = 0;
  const missing = [];
  for (const nm of names) {
    if (!sites.has(nm)) {
      missing.push(nm);
      continue;
    }
    s += sites.get(nm);
    n++;
  }
  const bytes = Math.round(s * BYTES_PER_SITE);
  console.log(
    fam.padEnd(30),
    String(n).padStart(7),
    String(s).padStart(7),
    bytes.toLocaleString().padStart(13),
    `${(100 * s / total).toFixed(1)}%`.padStart(9),
    missing.length ? `MISSING: ${missing.join(',')}` : ''
  );
}
