/**
 * Compare error output between Chevrotain (CssActionsParser) and
 * the new recursive-descent parser (CssRecursiveParser via CssParser wrapper).
 *
 * Run with:
 *   cd packages/css-parser && npx vitest run compare-errors.ts
 */

import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from 'chevrotain';
import { cssLexer } from '../src/cssTokens.js';
import { CssActionsParser } from '../src/cssActionsParser.js';
import { CssParser } from '../src/cssParser.js';

// ── Set up both parsers ──────────────────────────────────────────────

const { lexer: lexerDef, T } = cssLexer;
const chevLexer = new Lexer(lexerDef, {
  ensureOptimizations: true,
  skipValidations: false
});
const chevParser = new CssActionsParser(lexerDef, T as any, {
  recoveryEnabled: true,
  legacyMode: true
});

const rdParser = new CssParser({ legacyMode: true, recoveryEnabled: true } as any);

// ── Test cases ───────────────────────────────────────────────────────

interface TestCase {
  name: string;
  css: string;
}

const testCases: TestCase[] = [];

const inlineCases: TestCase[] = [
  { name: 'missing-semicolon', css: 'a { color: red\n  font-size: 12px; }' },
  { name: 'invalid-selector-123', css: '123 { color: red; }' },
  { name: 'empty-block-in-media', css: '@media screen { {} }' },
  { name: 'multiple-empty-blocks', css: '{}\n{}\n{}' },
  { name: 'valid-css (expect 0 errors)', css: 'a { color: red; }' }
];
testCases.push(...inlineCases);

const errDir = path.join(__dirname, 'css/errors');
const cssFiles = fs.readdirSync(errDir)
  .filter(f => f.endsWith('.css'))
  .sort();

for (const file of cssFiles) {
  testCases.push({
    name: `fixture/${file}`,
    css: fs.readFileSync(path.join(errDir, file), 'utf-8')
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

interface ErrorInfo {
  line?: number;
  col?: number;
  offset?: number;
  message: string;
  ruleStack: string[];
}

interface ParseResult {
  errorCount: number;
  errors: ErrorInfo[];
}

function parseChevrotain(css: string): ParseResult {
  const lexResult = chevLexer.tokenize(css);
  chevParser.input = lexResult.tokens as any;
  try {
    (chevParser as any).stylesheet();
  } catch {
    // ignore — errors are on the parser
  }
  const errors = chevParser.errors.map((e: any) => ({
    line: e.token?.startLine as number | undefined,
    col: e.token?.startColumn as number | undefined,
    offset: e.token?.startOffset as number | undefined,
    message: e.message as string,
    ruleStack: (e.context?.ruleStack ?? []) as string[]
  }));
  return { errorCount: chevParser.errors.length, errors };
}

function parseRecursive(css: string): ParseResult {
  const { errors } = rdParser.parse(css);
  const mapped = errors.map((e: any) => ({
    line: e.token?.startLine as number | undefined,
    col: e.token?.startColumn as number | undefined,
    offset: e.token?.startOffset as number | undefined,
    message: e.message as string,
    ruleStack: (e.ruleStack ?? []) as string[]
  }));
  return { errorCount: errors.length, errors: mapped };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max - 3) + '...';
}

// ── Run comparison ───────────────────────────────────────────────────

describe('Error comparison: Chevrotain vs Recursive-Descent', () => {
  it('prints comparison table', () => {
    const lines: string[] = [];
    const log = (s: string) => {
      lines.push(s);
    };

    log('='.repeat(120));
    log('CSS ERROR COMPARISON: Chevrotain vs Recursive-Descent');
    log('='.repeat(120));

    for (const tc of testCases) {
      const chev = parseChevrotain(tc.css);
      const rd = parseRecursive(tc.css);

      log('');
      log(`--- ${tc.name} ---`);
      log(`  Input: ${JSON.stringify(truncate(tc.css, 60))}`);
      log(`  Error count: Chevrotain=${chev.errorCount}  Recursive=${rd.errorCount}`);

      const maxErrors = Math.max(chev.errors.length, rd.errors.length);
      for (let i = 0; i < maxErrors; i++) {
        const ce = chev.errors[i];
        const re = rd.errors[i];

        log(`  Error #${i + 1}:`);
        if (ce) {
          log(`    [Chev] line=${ce.line} col=${ce.col} offset=${ce.offset}`);
          log(`           msg=${truncate(ce.message, 100)}`);
          log(`           ruleStack=${JSON.stringify(ce.ruleStack)}`);
        } else {
          log(`    [Chev] (none)`);
        }
        if (re) {
          log(`    [RD]   line=${re.line} col=${re.col} offset=${re.offset}`);
          log(`           msg=${truncate(re.message, 100)}`);
          log(`           ruleStack=${JSON.stringify(re.ruleStack)}`);
        } else {
          log(`    [RD]   (none)`);
        }

        if (ce && re) {
          const locMatch = ce.line === re.line && ce.col === re.col && ce.offset === re.offset;
          log(`    Location match: ${locMatch ? 'YES' : 'NO'}`);
        }
      }
    }

    log('');
    log('='.repeat(120));
    log('Done.');

    // Print all at once for clean output
    console.log('\n' + lines.join('\n'));
  });
});
