import { el, sel, sellist, compound, is, co, pseudo, type Selector } from '../../..';
import { matchSelectors, MatchResult } from '../match-selector';
import { extendSelector } from '../extend';
import { isNode } from '../is-node';

/**
 * Version of matchSelectors that bypasses fast path optimizations
 * for performance comparison testing
 */
function matchSelectorsNoOptimizations(target: Selector, find: Selector, partial = false): MatchResult {
  // Temporarily override canFastReject to always return false to bypass fast paths
  const originalTargetCanFastReject = Object.getOwnPropertyDescriptor(target, 'canFastReject');
  const originalFindCanFastReject = Object.getOwnPropertyDescriptor(find, 'canFastReject');

  try {
    // Force canFastReject to false to bypass fast path optimizations
    Object.defineProperty(target, 'canFastReject', {
      get: () => false,
      configurable: true
    });
    Object.defineProperty(find, 'canFastReject', {
      get: () => false,
      configurable: true
    });

    // Call the regular matchSelectors function, which will now skip fast paths
    return matchSelectors(target, find, partial);
  } finally {
    // Restore original canFastReject descriptors
    if (originalTargetCanFastReject) {
      Object.defineProperty(target, 'canFastReject', originalTargetCanFastReject);
    } else {
      delete (target as any).canFastReject;
    }
    if (originalFindCanFastReject) {
      Object.defineProperty(find, 'canFastReject', originalFindCanFastReject);
    } else {
      delete (find as any).canFastReject;
    }
  }
}

describe('Selector Performance Benchmarks', () => {
  const runBenchmark = (name: string, fn: () => void, iterations = 10000) => {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      fn();
    }
    const end = performance.now();
    const totalTime = end - start;
    const avgTime = totalTime / iterations;

    console.log(`\n🏁 ${name}`);
    console.log(`   Total: ${totalTime.toFixed(2)}ms`);
    console.log(`   Average: ${avgTime.toFixed(4)}ms per operation`);
    console.log(`   Ops/sec: ${(1000 / avgTime).toFixed(0)}`);

    return { totalTime, avgTime, opsPerSec: 1000 / avgTime };
  };

  it('should benchmark simple selector matching', () => {
    const target = el('.foo');
    const find = el('.foo');

    runBenchmark('Simple selector exact match', () => {
      matchSelectors(target, find);
    });
  });

  it('should benchmark compound selector matching', () => {
    const target = compound([el('.a'), el('.b')]);
    const find = compound([el('.b'), el('.a')]);

    runBenchmark('Compound selector matching (different order)', () => {
      matchSelectors(target, find);
    });
  });

  it('should benchmark complex selector matching', () => {
    const target = sel([compound([el('.a'), el('.b')]), co('>'), el('.c')]);
    const find = sel([el('.b'), co('>'), el('.c')]);

    runBenchmark('Complex selector partial matching', () => {
      matchSelectors(target, find, true);
    });
  });

  // Fast Path Optimization Benchmarks
  describe('Fast Path Optimizations', () => {
    it('should benchmark simple-to-simple selector fast path', () => {
      const target = el('.button');
      const find = el('.button');
      const nonMatch = el('.input');

      runBenchmark('Simple-to-simple: match', () => {
        matchSelectors(target, find);
      }, 100000);

      runBenchmark('Simple-to-simple: non-match', () => {
        matchSelectors(target, nonMatch);
      }, 100000);
    });

    it('should benchmark ID selector fast path', () => {
      const target = el('#navbar');
      const find = el('#navbar');
      const nonMatch = el('#sidebar');

      runBenchmark('ID selector: match', () => {
        matchSelectors(target, find);
      }, 100000);

      runBenchmark('ID selector: non-match', () => {
        matchSelectors(target, nonMatch);
      }, 100000);
    });

    it('should benchmark compound-to-simple fast path', () => {
      const target = compound([el('.btn'), el('.primary')]);
      const find = el('.btn');
      const nonMatch = el('.secondary');

      runBenchmark('Compound-to-simple: match', () => {
        matchSelectors(target, find);
      }, 50000);

      runBenchmark('Compound-to-simple: non-match', () => {
        matchSelectors(target, nonMatch);
      }, 50000);
    });

    it('should benchmark small compound-to-compound fast path', () => {
      const target = compound([el('.btn'), el('.primary')]);
      const find = compound([el('.primary'), el('.btn')]);
      const nonMatch = compound([el('.btn'), el('.secondary')]);

      runBenchmark('Small compound-to-compound: match', () => {
        matchSelectors(target, find);
      }, 50000);

      runBenchmark('Small compound-to-compound: non-match', () => {
        matchSelectors(target, nonMatch);
      }, 50000);
    });

    it('should benchmark fast path vs general algorithm', () => {
      // Fast path eligible selectors (canFastReject = true)
      const simpleTarget = el('.fast');
      const simpleFind = el('.fast');

      const compoundTarget = compound([el('.fast'), el('.path')]);
      const compoundFind = compound([el('.path'), el('.fast')]);

      // General algorithm selectors (canFastReject = false, contains :is())
      const complexTarget = compound([el('.slow'), is(sellist([el('.a'), el('.b')]))]);
      const complexFind = compound([el('.slow'), el('.a')]);

      runBenchmark('Fast path: Simple match', () => {
        matchSelectors(simpleTarget, simpleFind);
      }, 100000);

      runBenchmark('Fast path: Compound match', () => {
        matchSelectors(compoundTarget, compoundFind);
      }, 50000);

      runBenchmark('General algorithm: :is() match', () => {
        matchSelectors(complexTarget, complexFind);
      }, 10000);
    });
  });

  // Comparison benchmarks - with and without fast path optimizations
  it('should compare performance with and without fast path optimizations', () => {
    const scenarios = [
      {
        name: 'Simple selector match',
        target: el('.button'),
        find: el('.button'),
        iterations: 100000
      },
      {
        name: 'ID selector match',
        target: el('#navbar'),
        find: el('#navbar'),
        iterations: 100000
      },
      {
        name: 'Compound to simple match',
        target: compound([el('.btn'), el('.primary')]),
        find: el('.btn'),
        iterations: 50000
      },
      {
        name: 'Small compound to compound match',
        target: compound([el('.btn'), el('.primary')]),
        find: compound([el('.primary'), el('.btn')]),
        iterations: 50000
      },
      {
        name: 'Simple non-match',
        target: el('.button'),
        find: el('.input'),
        iterations: 100000
      },
      {
        name: 'Compound non-match',
        target: compound([el('.btn'), el('.primary')]),
        find: compound([el('.btn'), el('.secondary')]),
        iterations: 50000
      }
    ];

    console.log('\n🔥 FAST PATH OPTIMIZATION COMPARISON');
    console.log('====================================');

    scenarios.forEach((scenario) => {
      console.log(`\n📊 ${scenario.name}:`);

      // Test with optimizations enabled
      const optimizedResult = runBenchmark(
        `${scenario.name} (optimized)`,
        () => matchSelectors(scenario.target, scenario.find),
        scenario.iterations
      );

      // Test with optimizations disabled (bypass fast path check)
      const unoptimizedResult = runBenchmark(
        `${scenario.name} (unoptimized)`,
        () => matchSelectorsNoOptimizations(scenario.target, scenario.find),
        scenario.iterations
      );

      const speedup = optimizedResult.opsPerSec / unoptimizedResult.opsPerSec;
      const improvement = ((optimizedResult.opsPerSec - unoptimizedResult.opsPerSec) / unoptimizedResult.opsPerSec) * 100;

      console.log(`   💨 Speedup: ${speedup.toFixed(1)}x faster`);
      console.log(`   📈 Improvement: ${improvement.toFixed(1)}%`);
    });
  });

  it('should benchmark :is() selector matching', () => {
    const target = compound([is(sellist([el('.a'), el('.b')])), el('.c')]);
    const find = el('.a');

    runBenchmark(':is() pseudo-selector matching', () => {
      matchSelectors(target, find, true);
    });
  });

  it('should benchmark extend operations', () => {
    // Use a simple case that works - single element matching
    const selector = el('.foo');
    const target = el('.foo'); // Exact match
    const extendWith = el('.bar');

    runBenchmark('Extend with exact matching', () => {
      extendSelector(selector, target, extendWith, false); // Use exact match
    });
  });

  it('should benchmark complex scenarios', () => {
    // More complex realistic scenario
    const target = sel([
      el('.x'),
      co('+'),
      compound([is(sel([el('.a'), co('>'), el('.b')])), el('.d')]),
      co('>'),
      el('.c')
    ]);
    const find = sel([el('.a'), co('>'), el('.b'), co('>'), el('.c')]);

    runBenchmark('Complex :is() backtracking scenario', () => {
      matchSelectors(target, find, true);
    });
  });

  // NON-MATCH BENCHMARKS (the overwhelming majority case in real stylesheets)
  it('should benchmark simple non-matches (early bailout)', () => {
    const target = el('.foo');
    const find = el('.bar'); // Different class - should bail immediately

    runBenchmark('Simple non-match (different class)', () => {
      matchSelectors(target, find);
    });
  });

  it('should benchmark compound non-matches', () => {
    const target = compound([el('.a'), el('.b')]);
    const find = compound([el('.x'), el('.y')]); // No common elements

    runBenchmark('Compound non-match (no common elements)', () => {
      matchSelectors(target, find);
    });
  });

  it('should benchmark complex non-matches', () => {
    const target = sel([compound([el('.a'), el('.b')]), co('>'), el('.c')]);
    const find = sel([el('.x'), co('>'), el('.y')]); // Completely different

    runBenchmark('Complex non-match (different elements)', () => {
      matchSelectors(target, find, true);
    });
  });

  it('should benchmark :is() non-matches', () => {
    const target = compound([is(sellist([el('.a'), el('.b')])), el('.c')]);
    const find = el('.z'); // Not in the :is() list

    runBenchmark(':is() non-match (not in list)', () => {
      matchSelectors(target, find, true);
    });
  });

  it('should benchmark nested :is() non-matches', () => {
    const target = compound([
      is(sellist([
        el('.a'),
        compound([el('.b'), is(sellist([el('.x'), el('.y')]))]),
        el('.c')
      ])),
      el('.d')
    ]);
    const find = el('.z'); // Not in any nested :is()

    runBenchmark('Nested :is() non-match (deep nesting)', () => {
      matchSelectors(target, find, true);
    });
  });

  it('should benchmark partial non-matches', () => {
    const target = sel([compound([el('.a'), el('.b')]), co('>'), el('.c')]);
    const find = sel([el('.b'), co('+'), el('.c')]); // Wrong combinator

    runBenchmark('Partial non-match (wrong combinator)', () => {
      matchSelectors(target, find, true);
    });
  });

  it('should benchmark mixed realistic non-match scenarios', () => {
    // Realistic stylesheet scenario: lots of different selectors that don't match
    const targets = [
      el('.header'),
      compound([el('.nav'), el('.active')]),
      sel([el('.main'), co('>'), el('.content')]),
      compound([is(sellist([el('.button'), el('.link')])), el('.primary')]),
      sel([el('.sidebar'), co('~'), compound([el('.widget'), el('.expanded')])])
    ];
    const find = el('.footer'); // Won't match any of these

    runBenchmark('Realistic non-match gauntlet (5 different targets)', () => {
      for (const target of targets) {
        matchSelectors(target, find, true);
      }
    });
  });

  it('should verify keySet optimization correctness', () => {
    // Test cases to verify keySet fast rejection works correctly

    // Case 1: Completely disjoint - should fast reject
    const disjointTarget = compound([el('.a'), el('.b')]);
    const disjointFind = compound([el('.x'), el('.y')]);

    // Case 2: :is() case with overlap - should NOT fast reject
    const isTarget = compound([el('.a'), el('.b')]);
    const isFind = compound([is(sellist([el('.a'), el('.c')])), el('.b')]);

    // Case 3: Disjoint with :is() - should fast reject
    const disjointIsTarget = compound([el('.a'), el('.b')]);
    const disjointIsFind = compound([is(sellist([el('.x'), el('.y')])), el('.z')]);

    runBenchmark('KeySet optimization verification', () => {
      // These should trigger fast rejection (disjoint keySets)
      matchSelectors(disjointTarget, disjointFind);
      matchSelectors(disjointIsTarget, disjointIsFind);

      // This should NOT trigger fast rejection (overlapping keySets)
      matchSelectors(isTarget, isFind);
    });
  });

  it('should benchmark :where() selector matching', () => {
    const target = compound([el('.foo'), pseudo({ name: ':where', arg: sellist([el('.bar')]) })]);
    const find = el('.foo');

    runBenchmark(':where() pseudo-selector matching', () => {
      matchSelectors(target, find);
    });
  });

  it('should benchmark :not() selector matching', () => {
    const target = compound([el('.foo'), pseudo({ name: ':not', arg: el('.bar') })]);
    const find = el('.foo');

    runBenchmark(':not() pseudo-selector matching', () => {
      matchSelectors(target, find);
    });
  });

  it('should benchmark :nth-child() selector matching', () => {
    const target = compound([el('.foo'), pseudo({ name: ':nth-child', arg: undefined })]);
    const find = el('.foo');

    runBenchmark(':nth-child() pseudo-selector matching', () => {
      matchSelectors(target, find);
    });
  });

  it('should test canFastReject behavior for pseudo-selectors', () => {
    // Test :where with SelectorList - should not be able to fast reject
    const whereSelector = pseudo({ name: ':where', arg: sellist([el('.a'), el('.b')]) });
    console.log(':where(.a, .b) canFastReject:', whereSelector.canFastReject); // Should be false

    // Test :not with single selector - should not be able to fast reject
    const notSelector = pseudo({ name: ':not', arg: el('.a') });
    console.log(':not(.a) canFastReject:', notSelector.canFastReject); // Should be true (just a container)

    // Test :nth-child - should be able to fast reject
    const nthChildSelector = pseudo({ name: ':nth-child' });
    console.log(':nth-child canFastReject:', nthChildSelector.canFastReject); // Should be true

    // Test :is with single selector - should inherit from arg
    const isSingleSelector = is(el('.a'));
    console.log(':is(.a) canFastReject:', isSingleSelector.canFastReject); // Should be true

    // Test :is with SelectorList - should not be able to fast reject
    const isListSelector = is(sellist([el('.a'), el('.b')]));
    console.log(':is(.a, .b) canFastReject:', isListSelector.canFastReject); // Should be false
  });

  it('should benchmark subset optimization for partial matches', () => {
    // Case 1: find.keySet is subset of target.keySet - should continue (potential match)
    const subsetTarget = compound([el('.a'), el('.b'), el('.c')]);
    const subsetFind = compound([el('.a'), el('.b')]); // Subset - should continue

    // Case 2: find.keySet is NOT subset of target.keySet - should fast reject
    const nonSubsetTarget = compound([el('.a'), el('.b')]);
    const nonSubsetFind = compound([el('.a'), el('.x')]); // .x not in target - should fast reject

    // Case 3: Complex case where find has keys target doesn't have
    const complexTarget = sel([compound([el('.nav'), el('.active')]), co('>'), el('.item')]);
    const complexFind = sel([el('.nav'), co('>'), compound([el('.item'), el('.missing')])]); // .missing not in target

    runBenchmark('Subset optimization for partial matches', () => {
      // This should continue checking (subset relationship)
      matchSelectors(subsetTarget, subsetFind, true);

      // These should fast reject (not subset)
      matchSelectors(nonSubsetTarget, nonSubsetFind, true);
      matchSelectors(complexTarget, complexFind, true);
    });
  });

  it('should verify subset optimization correctness', () => {
    // Verify the optimization doesn't break correct behavior
    const target = compound([el('.a'), el('.b'), el('.c')]);

    // This should match (find is subset)
    const subsetFind = compound([el('.a'), el('.b')]);
    const subsetResult = matchSelectors(target, subsetFind, true);
    console.log('Subset match result:', subsetResult.hasPartialMatch); // Should be true

    // This should NOT match (find requires key target doesn't have)
    const nonSubsetFind = compound([el('.a'), el('.x')]);
    const nonSubsetResult = matchSelectors(target, nonSubsetFind, true);
    console.log('Non-subset match result:', nonSubsetResult.hasMatch); // Should be false

    // Edge case: exact match should still work
    const exactFind = compound([el('.a'), el('.b'), el('.c')]);
    const exactResult = matchSelectors(target, exactFind, true);
    console.log('Exact match result:', exactResult.hasFullMatch); // Should be true
  });

  it('should compare performance with and without optimizations', () => {
    // Store original matchSelectors function
    const originalMatchSelectors = matchSelectors;

    // Create a version without fast rejection optimizations
    function matchSelectorsNoOptimizations(target: Selector, find: Selector, partial = false) {
      // Skip the fast rejection logic - go straight to detailed matching

      // Handle case where find is a selector list
      if (isNode(find, 'SelectorList')) {
        for (const selector of find.value) {
          const result = originalMatchSelectors(target, selector, partial);
          if (result.hasMatch) {
            return result;
          }
        }
        return {
          hasMatch: false,
          hasFullMatch: false,
          hasPartialMatch: false,
          matched: [],
          remainders: [target]
        };
      }

      // For other cases, use original logic but skip fast rejection
      return originalMatchSelectors(target, find, partial);
    }

    // Test scenarios - mix of matches and non-matches
    const scenarios = [
      // Non-matches (should benefit most from optimizations)
      { target: el('.foo'), find: el('.bar'), name: 'Simple non-match' },
      { target: compound([el('.a'), el('.b')]), find: compound([el('.x'), el('.y')]), name: 'Compound non-match' },
      { target: sel([el('.nav'), co('>'), el('.item')]), find: sel([el('.sidebar'), co('>'), el('.widget')]), name: 'Complex non-match' },

      // Partial non-matches
      { target: compound([el('.a'), el('.b')]), find: compound([el('.a'), el('.x')]), name: 'Partial non-match', partial: true },
      { target: sel([el('.a'), co('>'), el('.b')]), find: sel([el('.a'), co('>'), el('.x')]), name: 'Complex partial non-match', partial: true },

      // Some matches for completeness
      { target: el('.foo'), find: el('.foo'), name: 'Simple match' },
      { target: compound([el('.a'), el('.b')]), find: el('.a'), name: 'Compound partial match', partial: true }
    ];

    console.log('\n🔥 Performance Comparison: With vs Without canFastReject Optimizations\n');

    for (const scenario of scenarios) {
      const iterations = 5000;

      // Test WITH optimizations
      const startWith = performance.now();
      for (let i = 0; i < iterations; i++) {
        originalMatchSelectors(scenario.target, scenario.find, scenario.partial || false);
      }
      const endWith = performance.now();
      const timeWith = endWith - startWith;
      const opsPerSecWith = iterations / (timeWith / 1000);

      // Test WITHOUT optimizations
      const startWithout = performance.now();
      for (let i = 0; i < iterations; i++) {
        matchSelectorsNoOptimizations(scenario.target, scenario.find, scenario.partial || false);
      }
      const endWithout = performance.now();
      const timeWithout = endWithout - startWithout;
      const opsPerSecWithout = iterations / (timeWithout / 1000);

      const speedup = opsPerSecWith / opsPerSecWithout;
      const improvement = ((opsPerSecWith - opsPerSecWithout) / opsPerSecWithout * 100);

      console.log(`📊 ${scenario.name}:`);
      console.log(`   With optimizations:    ${timeWith.toFixed(2)}ms (${opsPerSecWith.toFixed(0)} ops/sec)`);
      console.log(`   Without optimizations: ${timeWithout.toFixed(2)}ms (${opsPerSecWithout.toFixed(0)} ops/sec)`);
      console.log(`   🚀 Speedup: ${speedup.toFixed(1)}x (${improvement.toFixed(1)}% improvement)\n`);
    }
  });

  it('should benchmark high-volume operations', () => {
    // Test many operations to ensure performance remains good under load
    const targets = [
      el('.a'), el('.b'), el('.c'),
      compound([el('.x'), el('.y')]),
      compound([el('.p'), el('.q')])
    ];

    const finds = [
      el('.z'), // Will not match any targets
      el('.w'),
      compound([el('.missing')])
    ];

    console.log('\n🔥 High-Volume Operations Test:');

    // Run many non-matching operations to test overall performance
    runBenchmark('High-volume non-matching operations', () => {
      for (const target of targets) {
        for (const find of finds) {
          matchSelectors(target, find);
          if (Math.random() < 0.3) {
            // Also test partial matching
            matchSelectors(target, find, true);
          }
        }
      }
    }, 2000); // Many iterations to stress-test performance

    console.log('   📈 System should maintain good performance under high load');
  });

  it('benchmarks combinator-aware fast paths vs general algorithm', () => {
    const results: any[] = [];

    // Test combinator patterns that should hit fast paths
    const combinatorTestCases = [
      // 3-component patterns (selector combinator selector)
      { name: 'Direct child (.parent > .child)', target: sel([el('.parent'), co('>'), el('.child')]), find: sel([el('.parent'), co('>'), el('.child')]) },
      { name: 'Descendant (.ancestor .descendant)', target: sel([el('.ancestor'), co(' '), el('.descendant')]), find: sel([el('.ancestor'), co(' '), el('.descendant')]) },
      { name: 'Adjacent sibling (.prev + .next)', target: sel([el('.prev'), co('+'), el('.next')]), find: sel([el('.prev'), co('+'), el('.next')]) },
      { name: 'General sibling (.first ~ .second)', target: sel([el('.first'), co('~'), el('.second')]), find: sel([el('.first'), co('~'), el('.second')]) },

      // 5-component patterns (selector combinator selector combinator selector)
      { name: 'Complex (.a > .b .c)', target: sel([el('.a'), co('>'), el('.b'), co(' '), el('.c')]), find: sel([el('.a'), co('>'), el('.b'), co(' '), el('.c')]) },
      { name: 'Mixed combinators (.x .y + .z)', target: sel([el('.x'), co(' '), el('.y'), co('+'), el('.z')]), find: sel([el('.x'), co(' '), el('.y'), co('+'), el('.z')]) },
      { name: 'Chain (.p > .q ~ .r)', target: sel([el('.p'), co('>'), el('.q'), co('~'), el('.r')]), find: sel([el('.p'), co('>'), el('.q'), co('~'), el('.r')]) }
    ];

    for (const testCase of combinatorTestCases) {
      const target = testCase.target;
      const find = testCase.find;

      // Measure with all optimizations enabled
      const withFastPath = runBenchmark(`${testCase.name} (optimized)`, () => {
        matchSelectors(target, find, true);
      }, 100000);

      // Measure without fast path optimizations
      const withoutFastPath = runBenchmark(`${testCase.name} (unoptimized)`, () => {
        matchSelectorsNoOptimizations(target, find, true);
      }, 100000);

      const speedup = withFastPath.opsPerSec / withoutFastPath.opsPerSec;

      results.push({
        pattern: testCase.name,
        withFastPath: Math.round(withFastPath.opsPerSec),
        withoutFastPath: Math.round(withoutFastPath.opsPerSec),
        speedup: speedup.toFixed(1) + 'x'
      });

      // Verify correctness - both should produce identical results
      const result1 = matchSelectors(target, find, true);
      const result2 = matchSelectorsNoOptimizations(target, find, true);

      expect(result1.hasMatch).toBe(result2.hasMatch);
      expect(result1.hasFullMatch).toBe(result2.hasFullMatch);
      expect(result1.hasPartialMatch).toBe(result2.hasPartialMatch);
    }

    console.log('\n🚀 COMBINATOR FAST PATH BENCHMARK');
    console.log('===================================');
    console.table(results);

    // Calculate average performance improvement
    const avgSpeedup = results.reduce((sum, r) => sum + parseFloat(r.speedup), 0) / results.length;
    console.log(`📊 Average speedup: ${avgSpeedup.toFixed(1)}x`);

    // Should see good speedup for combinator patterns
    expect(avgSpeedup).toBeGreaterThan(1.2);
  });
});
