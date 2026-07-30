/**
 * RuleTester coverage for the hot-path antipattern pins.
 *
 * Every rule gets BOTH directions: it must fire on the shape it names, and it
 * must stay silent on the honest code adjacent to that shape. The `valid` cases
 * are the load-bearing half — a rule that fires on everything is not a gate,
 * and this is the file that proves each one discriminates.
 *
 * Run: `pnpm test:hot-path-rules`
 */
import test from 'node:test';
import '../typescript6-shim.mjs';

const { RuleTester } = await import('eslint');
const { default: tsParser } = await import('@typescript-eslint/parser');
const { rules } = await import('../hot-path-rules.mjs');

const js = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: 'module' } });
const ts = new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 2023, sourceType: 'module' } });

// --- no-speculative-allocation-predicate -------------------------------------
test('no-speculative-allocation-predicate: fires on allocate-to-test, silent on allocate-to-use', () => {
  js.run('no-speculative-allocation-predicate', rules['no-speculative-allocation-predicate'], {
    valid: [
      // The array is USED, not merely measured.
      'const kept = xs.filter(p); use(kept);',

      // Emptiness asked of something that already exists.
      'function f(xs) { if (xs.length === 0) { return; } }',
      'function f(runs) { if (!runs.length) { return; } }',

      // `.length` of an allocation compared against a real bound, not 0.
      'if (xs.filter(p).length === 3) { go(); }',

      // A Set/Map membership test is the FIX, not the defect.
      'function f(seen, key) { if (seen.has(key)) { return; } }',

      // Not configured as allocating, so not assumed to be.
      'if (commentsIn(run).length > 0) { emit(); }'
    ],
    invalid: [
      { code: 'if (xs.filter(p).length > 0) { emit(); }', errors: [{ messageId: 'speculative' }] },
      { code: 'if (xs.map(f).length === 0) { skip(); }', errors: [{ messageId: 'speculative' }] },
      { code: 'if (!Object.keys(map).length) { skip(); }', errors: [{ messageId: 'speculative' }] },
      { code: 'if (Array.from(set).length === 0) { skip(); }', errors: [{ messageId: 'speculative' }] },
      { code: 'if (s.split(",").includes(x)) { go(); }', errors: [{ messageId: 'speculative' }] },
      {
        // The motivating shape, once the helper is declared allocating.
        code: 'if (blockCommentsIn(trailing).length > 0) { emit(); }',
        options: [{ allocatingCallees: ['blockCommentsIn'] }],
        errors: [{ messageId: 'speculative' }]
      }
    ]
  });
});

// --- no-node-keyed-side-map --------------------------------------------------
test('no-node-keyed-side-map: fires on module-global weak side tables only', () => {
  ts.run('no-node-keyed-side-map', rules['no-node-keyed-side-map'], {
    valid: [
      // Function-local: a bounded cache, not a side table.
      'function f() { const seen = new WeakMap(); return seen; }',

      // Strong collections are off by default.
      'const table = new Map();',
      'const flags = new Set();',

      // Class fields are not module scope.
      'class C { private m = new WeakMap(); }'
    ],
    invalid: [
      { code: 'const spans = new WeakMap<object, Span>();', errors: [{ messageId: 'weak' }] },
      { code: 'const seen = new WeakSet();', errors: [{ messageId: 'weak' }] },
      {
        code: 'const table = new Map();',
        options: [{ includeStrongGlobals: true }],
        errors: [{ messageId: 'strong' }]
      }
    ]
  });
});

// --- no-rescan-in-loop -------------------------------------------------------
test('no-rescan-in-loop: fires on loop-invariant receivers, silent on loop-dependent ones', () => {
  js.run('no-rescan-in-loop', rules['no-rescan-in-loop'], {
    valid: [
      // No loop at all.
      'function f(xs, y) { return xs.indexOf(y); }',

      // The receiver is REBUILT each iteration — a different (allocation) smell.
      'for (const x of items) { const local = build(x); local.indexOf(y); }',

      // The receiver is MUTATED IN PLACE inside the loop, so it is not invariant.
      'const acc = []; for (const x of items) { if (acc.includes(x)) { skip(); } acc.push(x); }',

      // A Set lookup is the fix.
      'for (const x of items) { if (seen.has(x)) { skip(); } }',

      // A literal membership array is a constant, not a collection scan.
      'for (const x of items) { if (["a","b"].includes(x)) { go(); } }',

      // A non-iteration callback is a call frequency the rule declines to guess.
      'run(() => names.indexOf(key));'
    ],
    invalid: [
      {
        code: 'for (const x of items) { if (names.indexOf(x) >= 0) { go(); } }',
        errors: [{ messageId: 'rescan' }]
      },
      {
        code: 'for (let i = 0; i < n; i++) { const hit = runs.find(r => r.start === i); use(hit); }',
        errors: [{ messageId: 'rescan' }]
      },
      {
        // An iteration callback IS a loop.
        code: 'items.forEach(x => { if (names.includes(x)) { go(); } });',
        errors: [{ messageId: 'rescan' }]
      }
    ]
  });
});

// --- no-loop-invariant-accessor ----------------------------------------------
test('no-loop-invariant-accessor: fires on invariant zero-arg accessors, silent on stateful ones', () => {
  js.run('no-loop-invariant-accessor', rules['no-loop-invariant-accessor'], {
    valid: [
      // Already hoisted — the fix.
      'const runs = trivia.commentRuns(); for (const x of items) { use(runs); }',

      // Receiver depends on the loop variable.
      'for (const x of items) { use(x.children()); }',

      // Zero-arg but deliberately stateful.
      'for (const x of items) { use(it.next()); }',
      'for (const x of items) { use(Date.now()); }',
      'for (const x of items) { use(stack.pop()); }',

      // Takes arguments: the rule declines rather than guessing purity.
      'for (const x of items) { use(trivia.runsFor(0)); }',

      // Receiver is reassigned inside the loop.
      'let cursor = head; for (const x of items) { use(cursor.peek()); cursor = cursor.rest; }'
    ],
    invalid: [
      {
        code: 'for (const x of items) { use(trivia.commentRuns()); }',
        errors: [{ messageId: 'invariant' }]
      },
      {
        code: 'items.forEach(x => { use(doc.selectorAtoms()); });',
        errors: [{ messageId: 'invariant' }]
      }
    ]
  });
});

// --- no-source-text-rescan ---------------------------------------------------
test('no-source-text-rescan: fires on source-text scans, silent on structured reads', () => {
  js.run('no-source-text-rescan', rules['no-source-text-rescan'], {
    valid: [
      // Structure read off the node.
      'function f(node) { return node.span.start; }',

      // A scan of a non-source-named binding.
      'function f(name) { return name.indexOf("-"); }',

      // Length is not a structural scan.
      'function f(src) { return src.length; }',

      // Configurable: an empty name set disables it entirely.
      { code: 'function f(src) { return src.indexOf("/*"); }', options: [{ sourceNames: [] }] }
    ],
    invalid: [
      { code: 'function f(src) { return src.indexOf("/*"); }', errors: [{ messageId: 'rescan' }] },
      { code: 'function f(run) { return run.src.slice(a, b); }', errors: [{ messageId: 'rescan' }] },
      { code: 'function f(state) { return state.source.split("\\n"); }', errors: [{ messageId: 'rescan' }] },
      { code: 'function f(input) { return input.charCodeAt(i); }', errors: [{ messageId: 'rescan' }] }
    ]
  });
});
