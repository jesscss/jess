/**
 * HOT-PATH ANTIPATTERN PINS — the class that byte-identity gates cannot see.
 *
 * Correctness gates and byte-identity gates both compare OUTPUT. Every defect
 * in this class emits byte-identical output while being quadratic, allocating
 * per call, or re-deriving a fact the parser already owned. Green tests are
 * therefore not evidence of absence, in exactly the way `docs/architecture/
 * parser/GRAMMAR-REVIEW-STANDARD.md` already says "tests pass" is not a valid
 * grammar-review result. These rules are the equivalent for core hot paths.
 *
 * They map onto `docs/perf/V8-ARCHITECTURE.md`:
 *
 *   no-speculative-allocation-predicate -> invariant 5 (allocation discipline)
 *   no-node-keyed-side-map              -> invariant 1 / 5 (shape + allocation)
 *   no-rescan-in-loop                   -> invariant 4 / R3 (complexity class)
 *   no-loop-invariant-accessor          -> invariant 4 / 10 (construct once, read)
 *   no-source-text-rescan               -> invariant 2 / 10 (byte re-derivation)
 *
 * POLICY (deliberate, same as `index.mjs`): every rule here is ADVISORY. They
 * are wired only in `eslint.hotpath.config.mjs` — a separate pass that the
 * default `pnpm lint` does not run — and every one of them is `warn` there.
 * Nothing in this file is on a merge gate. Promotion is the owner's call and
 * has a written checklist in `docs/perf/HOT-PATH-ANTIPATTERN-GATE.md`.
 *
 * HONESTY NOTE, up front, because a gate that overstates its coverage is worse
 * than no gate: these rules are INTRAPROCEDURAL. The motivating incident —
 * a helper that rescans a whole collection from index 0 and is called once per
 * emitted statement by a caller in another function — has its outer loop and
 * its inner scan in DIFFERENT functions, and no single-file AST rule can see
 * that. `no-rescan-in-loop` catches the same shape only when both halves are
 * in one function body. The cross-function case is a documented reviewer
 * obligation, not a covered one. See the same doc, "What this does not catch".
 */

/* ------------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------------ */

/** Last identifier of a callee: `f` / `a.b.f` -> `f`. Computed access -> undefined. */
function calleeName(callee) {
  if (!callee) {
    return undefined;
  }
  if (callee.type === 'Identifier') {
    return callee.name;
  }
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return undefined;
}

/** `Array.from(x)` / `Object.keys(x)` — the namespaced allocating builtins. */
function namespacedCallee(node) {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.computed) {
    return undefined;
  }
  if (callee.object.type !== 'Identifier' || callee.property.type !== 'Identifier') {
    return undefined;
  }
  return `${callee.object.name}.${callee.property.name}`;
}

/**
 * Array methods that iterate the WHOLE receiver to answer one question. `.has`
 * and `.get` are deliberately absent: on a Set/Map they are the O(1) answer,
 * which is the fix, not the defect.
 */
const FULL_SCAN_METHODS = new Set([
  'indexOf', 'lastIndexOf', 'includes',
  'find', 'findIndex', 'findLast', 'findLastIndex',
  'some', 'every', 'filter'
]);

/** Callbacks that ARE a loop, for the purposes of "inside a loop". */
const ITERATION_CALLBACKS = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'reduce', 'reduceRight']);

const LOOP_STATEMENTS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

/**
 * Nearest enclosing loop, or `undefined`.
 *
 * Stops at a function boundary, EXCEPT when that function is the callback of an
 * iteration method (`xs.forEach(x => …)`), which is itself a loop. Anything
 * else — a helper defined inline, a promise continuation — is a call frequency
 * this rule cannot reason about, so it declines rather than guesses.
 */
function enclosingLoop(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (LOOP_STATEMENTS.has(current.type)) {
      return current;
    }
    if (current.type === 'FunctionExpression' || current.type === 'ArrowFunctionExpression') {
      const parent = current.parent;
      const isIterationCallback = parent
        && parent.type === 'CallExpression'
        && parent.arguments[0] === current
        && ITERATION_CALLBACKS.has(calleeName(parent.callee));
      if (isIterationCallback) {
        return current;
      }
      return undefined;
    }
    if (current.type === 'FunctionDeclaration' || current.type === 'Program') {
      return undefined;
    }
  }
  return undefined;
}

function within(outer, inner) {
  return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

/** Every identifier in `node` that is read as a value (not a property name / key). */
function readIdentifiers(node, sourceCode, out = []) {
  if (!node || typeof node.type !== 'string') {
    return out;
  }
  if (node.type === 'Identifier') {
    out.push(node);
    return out;
  }
  for (const key of sourceCode.visitorKeys[node.type] || []) {
    // A non-computed `.prop` and a non-computed object key are not value reads.
    if (node.type === 'MemberExpression' && key === 'property' && !node.computed) {
      continue;
    }
    if ((node.type === 'Property' || node.type === 'PropertyDefinition') && key === 'key' && !node.computed) {
      continue;
    }
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        readIdentifiers(c, sourceCode, out);
      }
    } else {
      readIdentifiers(child, sourceCode, out);
    }
  }
  return out;
}

function resolveVariable(identifier, sourceCode) {
  let scope = sourceCode.getScope(identifier);
  while (scope) {
    const found = scope.variables.find(v => v.name === identifier.name);
    if (found) {
      return found;
    }
    scope = scope.upper;
  }
  return undefined;
}

/**
 * In-place mutators. `acc.push(x)` changes what `acc` CONTAINS without ever
 * writing the `acc` binding, so scope analysis alone reports it as invariant.
 * Missing this would fire on every accumulate-then-check loop — the single
 * biggest false-positive source these rules have.
 */
const MUTATING_METHODS = new Set([
  'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin',
  'add', 'delete', 'set', 'clear'
]);

/** Is this identifier the receiver of an in-place mutation, `x.push(…)`? */
function isMutatedHere(identifier) {
  const member = identifier.parent;
  if (!member || member.type !== 'MemberExpression' || member.object !== identifier || member.computed) {
    return false;
  }
  const call = member.parent;
  return call
    && call.type === 'CallExpression'
    && call.callee === member
    && member.property.type === 'Identifier'
    && MUTATING_METHODS.has(member.property.name);
}

/**
 * Is `expression` guaranteed to be the same across iterations of `loop`?
 *
 * Conservative in the direction that MATTERS: anything declared inside the
 * loop, written inside the loop, or MUTATED IN PLACE inside the loop is
 * loop-dependent. An unresolvable name (import, ambient global) is treated as
 * invariant — those are module bindings.
 *
 * Returns false as soon as one identifier is loop-dependent.
 */
function isLoopInvariant(expression, loop, sourceCode) {
  for (const identifier of readIdentifiers(expression, sourceCode)) {
    const variable = resolveVariable(identifier, sourceCode);
    if (!variable) {
      continue;
    }
    for (const def of variable.defs) {
      if (def.node && def.node.range && within(loop, def.node)) {
        return false;
      }
    }
    for (const reference of variable.references) {
      const used = reference.identifier;
      if (!within(loop, used)) {
        continue;
      }
      if (reference.isWrite() || isMutatedHere(used)) {
        return false;
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------------------ *
 * Rule 1 — no-speculative-allocation-predicate            (V8-ARCH 5)
 * ------------------------------------------------------------------------ *
 *
 * Building an array/string/object and then asking it only whether it is empty.
 * The allocation is pure waste: the predicate is answerable with a short-circuit
 * scan, or by a flag the producer already knows.
 *
 *   blockCommentsIn(run).length > 0     // allocates a string[] to ask "any?"
 *   Object.keys(map).length === 0       // allocates a key array to ask "empty?"
 *   xs.filter(p).length                 // allocates to count, then only tests
 *
 * PRECISION: this is the most mechanical of the five, and the default set is
 * deliberately restricted to expressions that are allocating BY CONSTRUCTION.
 * Project helpers that allocate (the `blockCommentsIn` shape) are not
 * syntactically visible, so they are opt-in via the `allocatingCallees` option
 * rather than guessed from a naming heuristic.
 */

const BUILTIN_ALLOCATING_METHODS = new Set([
  'map', 'filter', 'flatMap', 'concat', 'split', 'slice', 'splice', 'flat', 'toSorted', 'toReversed'
]);

const BUILTIN_ALLOCATING_NAMESPACED = new Set([
  'Array.from', 'Array.of', 'Object.keys', 'Object.values', 'Object.entries', 'Object.getOwnPropertyNames'
]);

const noSpeculativeAllocationPredicate = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Do not allocate an array/string/object only to test its emptiness or membership (V8-ARCH 5).'
    },
    schema: [{
      type: 'object',
      properties: {
        allocatingCallees: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    }],
    messages: {
      speculative: 'Speculative allocation: `{{producer}}` builds a fresh value that is only tested with `{{predicate}}`. Answer the predicate without materializing — short-circuit, or carry the flag from the producer (V8-ARCH 5).'
    }
  },
  create(context) {
    const named = new Set((context.options[0] || {}).allocatingCallees || []);

    function producerLabel(node) {
      if (node.type === 'ArrayExpression') {
        return 'array literal';
      }
      if (node.type === 'CallExpression') {
        return `${calleeName(node.callee)}(…)`;
      }
      return 'allocation';
    }

    function isAllocating(node) {
      if (!node) {
        return false;
      }

      // `[...xs]` — a copy made to be measured.
      if (node.type === 'ArrayExpression') {
        return node.elements.length > 0;
      }
      if (node.type !== 'CallExpression') {
        return false;
      }
      const namespaced = namespacedCallee(node);
      if (namespaced && BUILTIN_ALLOCATING_NAMESPACED.has(namespaced)) {
        return true;
      }
      const name = calleeName(node.callee);
      if (name !== undefined && named.has(name)) {
        return true;
      }

      // A method call on a receiver: `xs.filter(p)`, `s.split(',')`.
      return node.callee.type === 'MemberExpression'
        && !node.callee.computed
        && name !== undefined
        && BUILTIN_ALLOCATING_METHODS.has(name);
    }

    function report(producer, predicate) {
      context.report({
        node: producer,
        messageId: 'speculative',
        data: { producer: producerLabel(producer), predicate }
      });
    }

    return {
      // `<alloc>.length` — in a comparison, a negation, or a raw boolean test.
      MemberExpression(node) {
        if (node.computed || node.property.type !== 'Identifier' || node.property.name !== 'length') {
          return;
        }
        if (!isAllocating(node.object)) {
          return;
        }
        const parent = node.parent;
        if (parent.type === 'BinaryExpression' && ['>', '<', '>=', '<=', '===', '!==', '==', '!='].includes(parent.operator)) {
          const other = parent.left === node ? parent.right : parent.left;
          if (other.type === 'Literal' && other.value === 0) {
            report(node.object, `.length ${parent.operator} 0`);
          }
          return;
        }
        if (parent.type === 'UnaryExpression' && parent.operator === '!') {
          report(node.object, '!….length');
          return;
        }
        if (
          (parent.type === 'IfStatement' && parent.test === node)
          || (parent.type === 'ConditionalExpression' && parent.test === node)
          || (parent.type === 'WhileStatement' && parent.test === node)
          || (parent.type === 'LogicalExpression')
        ) {
          report(node.object, '.length as a boolean');
        }
      },

      // `<alloc>.includes(x)` / `<alloc>.indexOf(x) !== -1` / `<alloc>.some(p)`
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
          return;
        }
        const method = callee.property.name;
        if (!['includes', 'indexOf', 'some', 'find'].includes(method)) {
          return;
        }
        if (isAllocating(callee.object)) {
          report(callee.object, `.${method}(…)`);
        }
      }
    };
  }
};

/* ------------------------------------------------------------------------ *
 * Rule 2 — no-node-keyed-side-map                        (V8-ARCH 1 / 5)
 * ------------------------------------------------------------------------ *
 *
 * A module-global `WeakMap`/`WeakSet` keyed by AST nodes is per-node bookkeeping
 * pushed outside the node. V8 backs a WeakMap with an `EphemeronHashTable`,
 * which the marker must iterate to a fixed point; the weak semantics buy nothing
 * when the keys die with the document anyway. An index-addressed flat array or
 * a bitset serves the same purpose without the marking cost or the per-entry
 * wrapper object.
 *
 * PRECISION: fires only on a MODULE-SCOPE `new WeakMap()` / `new WeakSet()`,
 * which is the side-table shape. A function-local weak map is a cache with a
 * bounded lifetime and is not flagged.
 */

const noNodeKeyedSideMap = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Module-global WeakMap/WeakSet used as a per-node side table (V8-ARCH 1/5).'
    },
    schema: [{
      type: 'object',
      properties: {
        includeStrongGlobals: { type: 'boolean' }
      },
      additionalProperties: false
    }],
    messages: {
      weak: 'Module-global `{{ctor}}` side table: per-node bookkeeping outside the node. V8 backs this with an EphemeronHashTable the marker iterates to a fixed point, and the weak semantics buy nothing when keys die with the document. Prefer an index-addressed flat array/bitset, or a field on the node (V8-ARCH 1/5).',
      strong: 'Module-global `{{ctor}}` keyed by objects: per-node bookkeeping that also leaks for the process lifetime. Prefer an index-addressed flat array/bitset (V8-ARCH 1/5).'
    }
  },
  create(context) {
    const includeStrong = (context.options[0] || {}).includeStrongGlobals === true;

    function isModuleScope(node) {
      for (let current = node.parent; current; current = current.parent) {
        if (current.type === 'Program') {
          return true;
        }
        if (
          current.type === 'FunctionDeclaration'
          || current.type === 'FunctionExpression'
          || current.type === 'ArrowFunctionExpression'
          || current.type === 'ClassBody'
        ) {
          return false;
        }
      }
      return false;
    }

    return {
      NewExpression(node) {
        if (node.callee.type !== 'Identifier') {
          return;
        }
        const ctor = node.callee.name;
        const weak = ctor === 'WeakMap' || ctor === 'WeakSet';
        const strong = ctor === 'Map' || ctor === 'Set';
        if (!weak && !(includeStrong && strong)) {
          return;
        }
        if (!isModuleScope(node)) {
          return;
        }
        context.report({ node, messageId: weak ? 'weak' : 'strong', data: { ctor } });
      }
    };
  }
};

/* ------------------------------------------------------------------------ *
 * Rule 3 — no-rescan-in-loop                             (V8-ARCH 4 / R3)
 * ------------------------------------------------------------------------ *
 *
 * A whole-collection scan whose RECEIVER does not change across the loop:
 * every iteration walks the same array from index 0. That is O(outer x inner)
 * where a precomputed Map/Set lookup, a monotonic cursor over source-ordered
 * data, or a binary search is O(outer) or O(outer log inner).
 *
 * This is R3 in the regression catalogue (extend `.includes()` O(n*m)) stated
 * as a syntactic shape.
 *
 * PRECISION LIMITATION (honest): a loop-invariant receiver does NOT prove the
 * scan is unnecessary — a two-element constant array scanned in a loop is
 * harmless, and a scan whose PREDICATE depends on the loop variable is exactly
 * what a lookup table would replace but is not automatically wrong. The rule
 * therefore reports; it does not adjudicate. That is why it is `warn`-only and
 * inventoried by name rather than blocking.
 *
 * COVERAGE LIMITATION (honest): intraprocedural only. The motivating incident
 * had its outer loop in the caller and its inner rescan in a helper, in a
 * different function. This rule cannot see that. See the header.
 */

const noRescanInLoop = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Advisory: whole-collection scan over a loop-invariant receiver inside a loop (V8-ARCH 4, R3).'
    },
    schema: [{
      type: 'object',
      properties: {
        minReceiverDepth: { type: 'integer', minimum: 0 }
      },
      additionalProperties: false
    }],
    messages: {
      rescan: 'Rescan from zero: `.{{method}}()` walks `{{receiver}}` — unchanged across this loop — on every iteration, so the cost is O(iterations x collection). Hoist a Set/Map, keep a monotonic cursor over source-ordered data, or binary-search (V8-ARCH 4, R3).'
    }
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
          return;
        }
        const method = callee.property.name;
        if (!FULL_SCAN_METHODS.has(method)) {
          return;
        }
        const loop = enclosingLoop(node);
        if (!loop) {
          return;
        }

        // A scan of the thing being iterated is a different (self-referential) smell.
        if (!isLoopInvariant(callee.object, loop, sourceCode)) {
          return;
        }

        /*
         * A string receiver is character search, not a collection scan, and is
         * handled by `no-source-text-rescan` with its own message. Only a
         * literal string is syntactically provable here.
         */
        if (callee.object.type === 'Literal' && typeof callee.object.value === 'string') {
          return;
        }

        // An inline array/set literal receiver is a constant membership test.
        if (callee.object.type === 'ArrayExpression') {
          return;
        }
        context.report({
          node,
          messageId: 'rescan',
          data: { method, receiver: sourceCode.getText(callee.object).slice(0, 60) }
        });
      }
    };
  }
};

/* ------------------------------------------------------------------------ *
 * Rule 4 — no-loop-invariant-accessor                    (V8-ARCH 4 / 10)
 * ------------------------------------------------------------------------ *
 *
 * A zero-argument accessor called inside a loop where nothing it reads changes
 * across the loop. If it returns a fresh array (the `trivia.commentRuns()`
 * shape) this is also an allocation per iteration; if it is a getter, it is a
 * megamorphic call per iteration. Either way the answer was constructible once
 * — invariant 10, "source-derived facts are constructed once, then read".
 *
 * PRECISION: restricted to ZERO-argument calls, minus an explicit denylist of
 * zero-arg mutators/iterators (`next`, `pop`, `shift`, …) and non-deterministic
 * builtins (`Date.now`, `Math.random`), which are called in a loop on purpose.
 * It still cannot prove the callee is side-effect-free, so it is advisory.
 */

const IMPURE_ZERO_ARG = new Set([
  'next', 'pop', 'shift', 'clear', 'reverse', 'sort', 'flush', 'reset', 'close', 'dispose',
  'now', 'random', 'read', 'write', 'tick', 'advance', 'consume', 'take', 'poll', 'release',
  'then', 'catch', 'finally', 'return', 'throw', 'push', 'toString', 'valueOf'
]);

const noLoopInvariantAccessor = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Advisory: zero-argument accessor re-invoked each iteration with a loop-invariant receiver (V8-ARCH 4/10).'
    },
    schema: [],
    messages: {
      invariant: 'Loop-invariant accessor: `{{receiver}}.{{method}}()` takes no arguments and reads nothing that changes in this loop, yet is re-invoked every iteration. Hoist it above the loop (V8-ARCH 10 — construct once, then read).'
    }
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node) {
        if (node.arguments.length !== 0) {
          return;
        }
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
          return;
        }
        const method = callee.property.name;
        if (IMPURE_ZERO_ARG.has(method)) {
          return;
        }
        const loop = enclosingLoop(node);
        if (!loop) {
          return;
        }
        if (!isLoopInvariant(callee, loop, sourceCode)) {
          return;
        }
        context.report({
          node,
          messageId: 'invariant',
          data: { receiver: sourceCode.getText(callee.object).slice(0, 40), method }
        });
      }
    };
  }
};

/* ------------------------------------------------------------------------ *
 * Rule 5 — no-source-text-rescan                         (V8-ARCH 2 / 10)
 * ------------------------------------------------------------------------ *
 *
 * Core scanning raw SOURCE TEXT to recover structure the parser already owned.
 * This is the P0 keystone ("the parser is the sole source of structure; core
 * never re-derives structure from bytes") stated as a lint, and it is an
 * ARCHITECTURAL defect, not merely a slow one: the fact exists upstream, and a
 * second derivation can disagree with the first.
 *
 * The existing `local/no-serialize-rederivation` covers values that came out of
 * `serialize*()`/`*Canonical()`. This covers the other direction: values that
 * came IN as source text, identified by binding name.
 *
 * PRECISION: name-based, so it is exactly as good as the repo's naming. It
 * fires on a receiver whose final name is one of the source-text names below.
 * It cannot see a source string passed under a different name, and it cannot
 * tell a genuine source string from a same-named unrelated field.
 */

const SOURCE_TEXT_NAMES = new Set(['src', 'source', 'sourceText', 'text', 'input', 'raw', 'rawText', 'contents', 'css', 'code']);

const SOURCE_SCAN_METHODS = new Set([
  'indexOf', 'lastIndexOf', 'slice', 'substring', 'substr',
  'match', 'matchAll', 'split', 'search', 'charAt', 'charCodeAt', 'codePointAt'
]);

const noSourceTextRescan = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Do not re-derive structure by scanning raw source text in core (V8-ARCH 2/10; P0 keystone).'
    },
    schema: [{
      type: 'object',
      properties: {
        sourceNames: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    }],
    messages: {
      rescan: 'Byte re-derivation: `.{{method}}()` scans `{{receiver}}`, raw source text. The parser owns this structure — read it off the node instead of rediscovering it from bytes (V8-ARCH 2/10; P0 keystone).'
    }
  },
  create(context) {
    const configured = (context.options[0] || {}).sourceNames;
    const names = configured ? new Set(configured) : SOURCE_TEXT_NAMES;
    const sourceCode = context.sourceCode;

    function receiverName(node) {
      if (node.type === 'Identifier') {
        return node.name;
      }
      if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
        return node.property.name;
      }
      return undefined;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
          return;
        }
        const method = callee.property.name;
        if (!SOURCE_SCAN_METHODS.has(method)) {
          return;
        }
        const receiver = receiverName(callee.object);
        if (receiver === undefined || !names.has(receiver)) {
          return;
        }
        context.report({
          node,
          messageId: 'rescan',
          data: { method, receiver: sourceCode.getText(callee.object).slice(0, 40) }
        });
      }
    };
  }
};

export const rules = {
  'no-speculative-allocation-predicate': noSpeculativeAllocationPredicate,
  'no-node-keyed-side-map': noNodeKeyedSideMap,
  'no-rescan-in-loop': noRescanInLoop,
  'no-loop-invariant-accessor': noLoopInvariantAccessor,
  'no-source-text-rescan': noSourceTextRescan
};

export default { rules };
