import { describe, it, expect } from 'vitest';
import * as glob from 'glob';
import * as path from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { invalidLess } from '@jesscss/shared';
import { Compiler } from '../../src/index.js';
import { outputDiagnostics } from '../../src/diagnostics.js';
import { getTestCases } from '../test-utils.js';
import lessPlugin from '@jesscss/plugin-less';
import { type Rules } from '@jesscss/core';
import { syncLog } from '../../../core/src/tree/util/__tests__/debug-log.js';

const require = createRequire(import.meta.url);
const testData = path.dirname(require.resolve('@less/test-data'));

// #region agent log
const __agentRunId = process.env.DEBUG_RUN_ID || 'pre-fix';
const __agentDebugEnabled = process.env.DEBUG_EXTEND_BOOT === 'true';
let __agentLogCount = 0;
function agentLog(location: string, message: string, data: Record<string, unknown>) {
  if (!__agentDebugEnabled) { return; }
  if (__agentLogCount++ > 500) { return; }
  // IMPORTANT: keep data primitive-ish (no nodes/arrays) to avoid circular refs.
  syncLog({
    sessionId: 'debug-session',
    runId: __agentRunId,
    hypothesisId: 'H0',
    location,
    message,
    data,
    timestamp: Date.now()
  });
}
// #endregion

const baseCompiler = new Compiler({
  output: { collapseNesting: true }, // Default for most files
  compile: {
    plugins: [
      lessPlugin()
    ]
  }
});

// Files that should be tested in specialized test files
const additionalSkips = [
  'tests-unit/color-functions/colors.less', // Tested in colors.test.ts
  'tests-unit/nesting/nesting.less', // Tested in nesting.test.ts
  'tests-unit/variables/variable-advanced.less', // infinite loop
  'tests-unit/detached-rulesets/detached-rulesets.less' // TODO: Declaration before initialization (module load order)
];

// Set to a non-empty array to focus on specific fixtures while debugging.
const targetTests: string[] = [];

describe('Can render Less files to CSS', () => {
  // Get all .less files from tests-unit and tests-config directories
  const unitFiles: string[] = glob.sync(path.join(testData, 'tests-unit/**/*.less')).filter((f) => {
    const rel = path.relative(testData, f).replace(/\\/g, '/');
    // Run tests alphabetically up through the extend fixtures.
    // This intentionally stops before later fixtures that Jess doesn't yet fully parse/execute.
    const m = /^tests-unit\/([^/]+)\//.exec(rel);
    const segment = m?.[1] ?? '';
    return segment.localeCompare('extract-and-length') < 0;
  });
  const configFiles: string[] = [];
  const allFiles = [...unitFiles, ...configFiles];

  allFiles
    .map(value => path.relative(testData, value))
    .filter(value => !invalidLess.includes(value))
    .filter(value => !additionalSkips.includes(value)) // Skip files tested elsewhere
    .filter(value => targetTests.length === 0 || targetTests.includes(value)) // Target specific tests
    .sort()
    .forEach((file) => {
      const lessPath = path.join(testData, file);

      try {
        const testCases = getTestCases(lessPath);

        testCases.forEach((testCase, index) => {
          const testName = testCases.length > 1 ? `${file} [${index + 1}/${testCases.length}]` : file;
          const configSuffix = testCases.length > 1 ? ` (${path.basename(testCase.expectedFile)})` : '';

          it(`${testName}${configSuffix}`, async () => {
            const expectedCss = readFileSync(testCase.expectedFile, 'utf8');
            const __agentInteresting =
              testName.includes('tests-unit/extend-')
              || testName.includes('tests-unit/detached-rulesets/');

            // Merge test case config with base compiler config
            // Default: collapseNesting: true (from baseCompiler)
            // Override: testCase.config.output (from styles.config.ts) takes precedence
            const testCompiler = new Compiler({
              ...baseCompiler.opts,
              ...testCase.config,
              output: {
                ...baseCompiler.opts.output,
                ...(testCase.config.output || {})
              }
            });

            const context = testCompiler.createContext(lessPath, { outputFile: testCase.expectedFile });
            let node: Rules;
            try {
              // #region agent log
              if (__agentInteresting) {
                agentLog('all-less.test.ts:before-getTree', 'getTree-enter', {
                  file: testName,
                  lessPath,
                  expectedFile: testCase.expectedFile
                });
              }
              // #endregion
              ({ node } = await context.getTree(lessPath));
              // #region agent log
              if (__agentInteresting) {
                agentLog('all-less.test.ts:after-getTree', 'getTree-exit', {
                  file: testName
                });
              }
              // #endregion
            } catch (error: any) {
              // Output diagnostics if available
              if (context.errors.length > 0 || context.warnings.length > 0) {
                outputDiagnostics(context.errors, context.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
            try {
              // #region agent log
              if (__agentInteresting) {
                agentLog('all-less.test.ts:before-eval', 'eval-enter', {
                  file: testName,
                  collapseNestingFromCompiler: Boolean((testCompiler as any)?.opts?.output?.collapseNesting),
                  collapseNestingFromContext: Boolean((context as any)?.opts?.output?.collapseNesting),
                  collapseNestingFromContextRoot: Boolean((context as any)?.opts?.collapseNesting)
                });
              }
              // #endregion
              const evald = await node.eval(context);
              // #region agent log
              if (__agentInteresting) {
                agentLog('all-less.test.ts:after-eval', 'eval-exit', {
                  file: testName,
                  cssLen: typeof evald?.toString === 'function' ? evald.toString({ context }).length : null,
                  cssHead: typeof evald?.toString === 'function'
                    ? evald.toString({ context }).slice(0, 400)
                    : null,
                  expectedHead: expectedCss.slice(0, 400)
                });
              }
              // #endregion
              expect(evald.toString({ context })).toBe(expectedCss);
            } catch (error: any) {
              // Output diagnostics if available
              if (context.errors.length > 0 || context.warnings.length > 0) {
                outputDiagnostics(context.errors, context.warnings, {
                  suppressWarnings: false,
                  breakOnError: false
                });
              }
              throw error;
            }
          }, 5000); // 5 second timeout to catch infinite loops
        });
      } catch (error: any) {
        // If getTestCases throws (no files found), create a failing test
        it(`${file}`, () => {
          throw error;
        });
      }
    });

  // Same config as extend/extend.less fixture (collapseNesting: false) so this fails the same way as the full file test until extend is fixed
  it('extend.less: .aa,.cc nested block has .dd, .ee, .ff with no :is() materialization', async () => {
    const file = 'tests-unit/extend/extend.less';
    const lessPath = path.join(testData, file);
    const testCases = getTestCases(lessPath);
    const testCase = testCases.find(t => path.basename(t.expectedFile) === 'extend.css') ?? testCases[0];
    if (!testCase) return;
    const compiler = new Compiler({
      ...baseCompiler.opts,
      ...testCase.config,
      output: {
        ...baseCompiler.opts.output,
        ...(testCase.config.output || {})
      }
    });
    const context = compiler.createContext(lessPath, { outputFile: testCase.expectedFile });
    const { node } = await context.getTree(lessPath);
    const evald = await node.eval(context);
    const css = evald.toString({ context });
    expect(css).toContain('.dd,');
    expect(css).toContain('.ee,');
    expect(css).toContain('.ff {');
    expect(css).not.toMatch(/:is\(\.aa,\s*\.cc\s*\)\s+\.dd/);
  });
});