import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { invalidLess } from '@jesscss/shared';
import {
  findBalancedBlockEnd,
  findStatementEnd,
  findTopLevelBlockStart,
  skipSourceTrivia,
  type SourceScannerOptions
} from '@jesscss/parser';
import { parseLessAstStylesheet } from '../src/ast.js';
import { resolveLessTestDataRoot } from './test-data.js';

const testData = resolveLessTestDataRoot();
const scannerOptions: SourceScannerOptions = { lineComments: true };

type ScanFailure = {
  file: string;
  offset: number;
  reason: string;
};

type ScanStats = {
  blocks: number;
  statements: number;
};

function scanLessBoundaries(file: string, source: string): ScanStats | ScanFailure {
  let cursor = 0;
  let blocks = 0;
  let statements = 0;
  while (cursor < source.length) {
    cursor = skipSourceTrivia(source, cursor, source.length, scannerOptions);
    if (cursor >= source.length) {
      break;
    }

    const blockStart = findTopLevelBlockStart(source, cursor, source.length, scannerOptions);
    const statementEnd = findStatementEnd(
      source,
      cursor,
      blockStart === -1 ? source.length : blockStart,
      scannerOptions
    );
    if (statementEnd < (blockStart === -1 ? source.length : blockStart)) {
      statements++;
      cursor = statementEnd + 1;
      continue;
    }

    if (blockStart === -1) {
      break;
    }

    const blockEnd = findBalancedBlockEnd(source, blockStart, source.length, scannerOptions);
    if (blockEnd === -1) {
      return {
        file,
        offset: blockStart,
        reason: 'unclosed block'
      };
    }
    blocks++;
    cursor = blockEnd + 1;
  }
  return { blocks, statements };
}

describe('Less source scanner corpus gate', () => {
  const files = [
    ...glob.sync(path.join(testData, 'tests-unit/**/*.less')),
    ...glob.sync(path.join(testData, 'tests-config/**/*.less'))
  ]
    .map(file => path.relative(testData, file))
    .filter(file => !invalidLess.includes(file))
    .filter(file => !file.includes('-REMOVED'))
    .sort();

  test('walks valid Less test-data fixtures without losing block boundaries', () => {
    const failures: ScanFailure[] = [];
    let blocks = 0;
    let statements = 0;

    for (const file of files) {
      const source = fs.readFileSync(path.join(testData, file), 'utf8');
      const result = scanLessBoundaries(file, source);
      if ('reason' in result) {
        failures.push(result);
        continue;
      }
      blocks += result.blocks;
      statements += result.statements;
    }

    expect({
      files: files.length,
      blocks,
      statements,
      failures
    }).toEqual({
      files: 190,
      blocks: 1145,
      statements: 309,
      failures: []
    });
  });

  test('builds scanner-first AST results for valid Less test-data fixtures without structural errors', () => {
    let rules = 0;
    let warnings = 0;
    let errors = 0;
    const thrown: Array<{ file: string; message: string }> = [];

    for (const file of files) {
      const source = fs.readFileSync(path.join(testData, file), 'utf8');
      try {
        const result = parseLessAstStylesheet(file, source);
        rules += result.tree.rules.length;
        for (const diagnostic of result.diagnostics) {
          if (diagnostic.severity === 'error') {
            errors++;
          } else if (diagnostic.severity === 'warning') {
            warnings++;
          }
        }
      } catch (error) {
        thrown.push({
          file,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    expect({
      files: files.length,
      rules,
      warnings,
      errors,
      thrown
    }).toEqual({
      files: 190,
      rules: 1354,
      warnings: 113,
      errors: 0,
      thrown: []
    });
  });
});
