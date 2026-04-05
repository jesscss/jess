import { describe, expect, it } from 'vitest';
import { Compiler } from '../../lib/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import { withExtendWorkCounters } from '../../../core/lib/index.js';

const benchmarkFile = process.env.JESS_EXTEND_COUNTERS_FILE;

function div(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(2));
}

describe.skipIf(!benchmarkFile)('benchmark extend counters', () => {
  it('prints extend and selector work totals for a real Less file', async () => {
    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [lessPlugin(), lessCompatPlugin()]
      }
    });

    const context = compiler.createContext(benchmarkFile!, {
      outputFile: `${benchmarkFile!}.out.css`,
      suppressWarnings: true,
      breakOnError: false
    });
    const { node } = await context.getTree(benchmarkFile!);

    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
    }

    const heapBeforeMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const started = performance.now();
    const { result, counters } = await withExtendWorkCounters(() => node.eval(context));
    const elapsedMs = Number((performance.now() - started).toFixed(2));
    const heapAfterMB = process.memoryUsage().heapUsed / 1024 / 1024;
    const heapDeltaMB = Number((heapAfterMB - heapBeforeMB).toFixed(2));

    const css = result.toString({ context });

    expect(css.length).toBeGreaterThan(0);

    const summary = {
      file: benchmarkFile,
      elapsedMs,
      heapDeltaMB,
      counters,
      derived: {
        recordedTargetMissingKeySetRate: div(
          counters.recordedExtendTargetsMissingKeySetLibrary,
          counters.recordedExtendInstructions
        ),
        recordedTargetAmpersandRate: div(
          counters.recordedExtendTargetsWithAmpersand,
          counters.recordedExtendInstructions
        ),
        recordedExtendWithMissingKeySetRate: div(
          counters.recordedExtendWithMissingKeySetLibrary,
          counters.recordedExtendInstructions
        ),
        parentAwareSelectorMatchRate: div(counters.selectorMatchCallsWithParent, counters.selectorMatchCalls),
        fastRejectEligibleRate: div(counters.selectorMatchFastRejectEligibleCalls, counters.selectorMatchCalls),
        missingFindKeySetLibraryRate: div(counters.selectorMatchCallsMissingFindKeySetLibrary, counters.selectorMatchCalls),
        missingTargetKeySetLibraryRate: div(counters.selectorMatchCallsMissingTargetKeySetLibrary, counters.selectorMatchCalls),
        instructionsPerRulesetVisit: div(counters.instructionsConsidered, counters.rulesetsVisited),
        routePlansPerInstruction: div(counters.routePlansBuilt, counters.instructionsConsidered),
        requirementsPerRoutePlan: div(counters.groupRequirementsBuilt, counters.routePlansBuilt),
        fastRejectRate: div(counters.fastRejectRejects, counters.fastRejectChecks),
        selectorCompositionsPerRulesetVisit: div(counters.selectorCompositionCalls, counters.rulesetsVisited),
        effectiveSelectorReadsPerRulesetVisit: div(counters.effectiveSelectorReads, counters.rulesetsVisited),
        rewritesPerPositiveMatch: div(counters.rewritesApplied, counters.positiveMatches),
        valueOfPerRoutePlan: div(counters.nodeValueOfCalls, counters.routePlansBuilt),
        clonesPerRewrite: div(counters.nodeClones, counters.rewritesApplied)
      }
    };

    console.log(JSON.stringify(summary, null, 2));
  }, 120_000);
});
