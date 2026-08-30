/**
 * Local ESLint rules: LLM-quality REGRESSION PINS.
 *
 * These encode the V8-ARCHITECTURE anti-patterns (#2 byte re-derivation,
 * #3 full-tree walk in a hot path, #6 oversized/duplicated `choice`) plus the
 * deprecated `DetachedRuleset` AST-node-name pin, as described in the LLM
 * quality-enforcement design (§C).
 *
 * POLICY (deliberate): every rule here is wired as `warn` (advisory). They are
 * regression PINS, not merge gates. Promotion of any rule to `error`/blocking
 * requires a measured <5% false-positive bake on real PRs — several of these
 * are intentionally heuristic (see the per-rule limitation notes below) and
 * WILL surface some legitimate code. Warnings keep the signal without blocking
 * honest work.
 *
 * All scoping (which files a rule sees, and which are allowlisted) is done in
 * `eslint.config.mjs` via `files`/`ignores`, so the rules themselves stay pure
 * AST logic and are trivially unit-testable with `RuleTester`.
 */

/** Callee name looks like a byte-faithful serializer: `serialize*` or `*Canonical`. */
function isSerializerName(name) {
  return typeof name === 'string' && (/^serialize/.test(name) || /Canonical$/.test(name));
}

/** Last identifier of a call's callee (`serializeValue` or `node.serialize`). */
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

/*
 * ---------------------------------------------------------------------------
 * Rule 1 — no-serialize-rederivation  (V8-ARCH #2)
 * ---------------------------------------------------------------------------
 *
 * Flags byte-level scanning of a value produced by `serialize()`/`*Canonical()`:
 * re-deriving structure from emitted bytes instead of reading it off the node.
 *
 * LIMITATION (honest): SAME-FUNCTION taint only. It catches a direct
 * `serializeX(v).split(...)` and a local `const s = serializeX(v); s.match(...)`
 * within one function body. It does NOT follow a serialized value across a
 * function boundary or through a data structure — true interprocedural taint
 * needs a typed pass. Documented follow-up; do not treat a clean run as proof
 * there is no cross-function re-derivation.
 */

const SCAN_METHODS = new Set([
  'match', 'matchAll', 'includes', 'indexOf', 'lastIndexOf',
  'split', 'search', 'charAt', 'charCodeAt', 'codePointAt',
  'startsWith', 'endsWith'
]);

const noSerializeRederivation = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Do not re-derive structure by string-scanning a serialize()/Canonical() result (V8-ARCH #2). Same-function taint only.'
    },
    schema: [],
    messages: {
      rederive: 'Byte re-derivation: \'{{method}}\' is applied to a serialize()/Canonical() result. Read structure from the node, not from emitted bytes (V8-ARCH #2).'
    }
  },
  create(context) {
    // One tainted-name set per enclosing function (same-function honesty).
    const funcStack = [new Set()];
    const top = () => funcStack[funcStack.length - 1];

    function isTaintSource(node) {
      return node
        && node.type === 'CallExpression'
        && isSerializerName(calleeName(node.callee));
    }

    function isTainted(node) {
      if (isTaintSource(node)) {
        return true;
      }
      return node && node.type === 'Identifier' && top().has(node.name);
    }

    function enterFn() {
      funcStack.push(new Set());
    }
    function exitFn() {
      funcStack.pop();
    }

    return {
      FunctionDeclaration: enterFn,
      'FunctionDeclaration:exit': exitFn,
      FunctionExpression: enterFn,
      'FunctionExpression:exit': exitFn,
      ArrowFunctionExpression: enterFn,
      'ArrowFunctionExpression:exit': exitFn,

      VariableDeclarator(node) {
        if (node.init && isTaintSource(node.init) && node.id.type === 'Identifier') {
          top().add(node.id.name);
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
          return;
        }
        const method = callee.property.name;

        // `s.split(...)`, `s.match(...)`, ...
        if (SCAN_METHODS.has(method) && isTainted(callee.object)) {
          context.report({ node, messageId: 'rederive', data: { method } });
          return;
        }

        // `re.test(serializeX(v))` — RegExp scanning a serialized value.
        if (method === 'test' && node.arguments.some(isTainted)) {
          context.report({ node, messageId: 'rederive', data: { method: 'RegExp.test' } });
        }
      },

      // `serializeX(v)[i]` / `s[i]` — char-by-char iteration over emitted bytes.
      MemberExpression(node) {
        if (node.computed && isTainted(node.object)) {
          context.report({ node, messageId: 'rederive', data: { method: 'char-index' } });
        }
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * Rule 2 — no-full-tree-walk-hot-path  (V8-ARCH #3)
 * ---------------------------------------------------------------------------
 *
 * Best-effort flag of a self-recursive function that walks a full child
 * collection (`.rules`/`.children`/`.nodes`/`.value`/`.args`/`.body`/…) in an
 * eval/render hot path.
 *
 * PRECISION LIMITATION (honest): recursion over children is LEGITIMATE in
 * serialize/eval. This heuristic cannot distinguish a bounded, guarded descent
 * from an unbounded full-subtree scan, so it WILL fire on some legitimate code.
 * That is exactly why it ships as `warn` (report-only advisory) and is scoped
 * in eslint.config.mjs to a small allowlist of eval/render files — NOT the
 * whole tree. Promotion to `error` requires the measured <5%-FP bake.
 */

const CHILD_FIELDS = new Set([
  'rules', 'children', 'nodes', 'value', 'values', 'args',
  'arguments', 'body', 'elements', 'items', 'members', 'branches'
]);

const noFullTreeWalkHotPath = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Advisory: self-recursive full-subtree walk in an eval/render hot path (V8-ARCH #3). Heuristic — report only.'
    },
    schema: [],
    messages: {
      walk: 'Possible full-tree walk in a hot path: \'{{name}}\' recurses over a child collection (\'{{field}}\'). Confirm the descent is bounded / structure-directed, not a full-subtree scan (V8-ARCH #3, advisory).'
    }
  },
  create(context) {
    function fnName(node) {
      if (node.id && node.id.type === 'Identifier') {
        return node.id.name;
      }
      const parent = node.parent;
      if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
        return parent.id.name;
      }
      if (parent && parent.type === 'Property' && parent.key.type === 'Identifier') {
        return parent.key.name;
      }
      return undefined;
    }

    function check(node) {
      const name = fnName(node);
      if (!name) {
        return;
      }
      let recursesOverChild;
      const sourceCode = context.sourceCode;

      // Find a self-call that sits inside iteration over a child-collection member.
      function walk(n, iteratingField) {
        if (!n || typeof n.type !== 'string' || recursesOverChild) {
          return;
        }
        let childField = iteratingField;

        // Entering iteration over `X.<childField>`?
        if (n.type === 'ForOfStatement' && n.right.type === 'MemberExpression'
          && !n.right.computed && n.right.property.type === 'Identifier'
          && CHILD_FIELDS.has(n.right.property.name)) {
          childField = n.right.property.name;
        }
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression'
          && !n.callee.computed && n.callee.property.type === 'Identifier'
          && ['forEach', 'map', 'flatMap'].includes(n.callee.property.name)
          && n.callee.object.type === 'MemberExpression' && !n.callee.object.computed
          && n.callee.object.property.type === 'Identifier'
          && CHILD_FIELDS.has(n.callee.object.property.name)) {
          childField = n.callee.object.property.name;
        }

        // A self-call while iterating a child collection = the flagged shape.
        if (childField && n.type === 'CallExpression' && calleeName(n.callee) === name) {
          recursesOverChild = childField;
          return;
        }

        for (const key of sourceCode.visitorKeys[n.type] || Object.keys(n)) {
          const child = n[key];
          if (Array.isArray(child)) {
            for (const c of child) {
              if (c && typeof c.type === 'string') {
                walk(c, childField);
              }
            }
          } else if (child && typeof child.type === 'string') {
            walk(child, childField);
          }
        }
      }

      walk(node.body, undefined);
      if (recursesOverChild) {
        context.report({ node, messageId: 'walk', data: { name, field: recursesOverChild } });
      }
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * Rule 3 — no-oversized-choice  (V8-ARCH #6)
 * ---------------------------------------------------------------------------
 *
 * Regression pin for grammar `choice(...)` sprawl (the 20×7 duplication):
 * (a) any `choice(...)` with more than N arms (default 15), and
 * (b) two `choice(...)` calls in one file with the same large arm signature
 * (structurally-duplicated choice literals).
 */

const noOversizedChoice = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Flag oversized (>N arms) or duplicated large choice(...) calls (V8-ARCH #6).'
    },
    schema: [{
      type: 'object',
      properties: {
        maxArms: { type: 'integer', minimum: 2 },
        dupMinArms: { type: 'integer', minimum: 2 }
      },
      additionalProperties: false
    }],
    messages: {
      oversized: 'Oversized choice(): {{count}} arms (limit {{max}}). Split or factor shared prefixes (V8-ARCH #6).',
      duplicated: 'Duplicated large choice(): the same {{count}}-arm signature appears at line {{first}}. Extract it to a shared production (V8-ARCH #6).'
    }
  },
  create(context) {
    const opts = context.options[0] || {};
    const maxArms = opts.maxArms ?? 15;
    const dupMinArms = opts.dupMinArms ?? 5;
    const signatures = new Map(); // signature -> first line

    function armSignature(node) {
      // Identifier-arg names, sorted — a structural fingerprint of the choice.
      const names = node.arguments
        .map(a => (a.type === 'Identifier'
          ? a.name
          : (a.type === 'MemberExpression' && a.property.type === 'Identifier' ? a.property.name : null)));
      if (names.some(n => n === null)) {
        return undefined;
      }
      return [...names].sort().join(',');
    }

    return {
      CallExpression(node) {
        if (!(node.callee.type === 'Identifier' && node.callee.name === 'choice')) {
          return;
        }
        const count = node.arguments.length;
        if (count > maxArms) {
          context.report({ node, messageId: 'oversized', data: { count, max: maxArms } });
        }
        if (count >= dupMinArms) {
          const sig = armSignature(node);
          if (sig) {
            const first = signatures.get(sig);
            if (first !== undefined) {
              context.report({ node, messageId: 'duplicated', data: { count, first } });
            } else {
              signatures.set(sig, node.loc.start.line);
            }
          }
        }
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * Rule 4 — no-deprecated-detached-ruleset
 * ---------------------------------------------------------------------------
 *
 * Flags NEW usage of `DetachedRuleset` as an AST node type: a `type:
 * 'DetachedRuleset'` property (object or type literal) or a `=== 'DetachedRuleset'`
 * comparison. The plugin-transport (`serialize.ts` / `value-eval.ts`) and the
 * grammar/CST `DetachedRuleset` production are allowlisted in eslint.config.mjs
 * (via `ignores`) so this does not fire on those legitimate uses.
 */

const noDeprecatedDetachedRuleset = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Flag new DetachedRuleset AST-node-type usage (deprecated node name).'
    },
    schema: [],
    messages: {
      deprecated: '\'DetachedRuleset\' is a deprecated AST node type. Use the current node model; the plugin-transport / CST rule are the only allowlisted uses.'
    }
  },
  create(context) {
    function isTypeKey(key) {
      return key && ((key.type === 'Identifier' && key.name === 'type')
        || (key.type === 'Literal' && key.value === 'type'));
    }
    function report(node) {
      context.report({ node, messageId: 'deprecated' });
    }
    function isDetachedLiteral(node) {
      return node && node.type === 'Literal' && node.value === 'DetachedRuleset';
    }

    return {
      // `{ type: 'DetachedRuleset' }`
      Property(node) {
        if (isTypeKey(node.key) && isDetachedLiteral(node.value)) {
          report(node.value);
        }
      },

      // `type: 'DetachedRuleset'` in a TS type literal / interface
      TSPropertySignature(node) {
        if (isTypeKey(node.key) && node.typeAnnotation
          && node.typeAnnotation.typeAnnotation
          && node.typeAnnotation.typeAnnotation.type === 'TSLiteralType'
          && isDetachedLiteral(node.typeAnnotation.typeAnnotation.literal)) {
          report(node.typeAnnotation.typeAnnotation.literal);
        }
      },

      // `x.type === 'DetachedRuleset'`
      BinaryExpression(node) {
        if ((node.operator === '===' || node.operator === '!==' || node.operator === '==' || node.operator === '!=')
          && (isDetachedLiteral(node.left) || isDetachedLiteral(node.right))) {
          report(isDetachedLiteral(node.left) ? node.left : node.right);
        }
      }
    };
  }
};

export const rules = {
  'no-serialize-rederivation': noSerializeRederivation,
  'no-full-tree-walk-hot-path': noFullTreeWalkHotPath,
  'no-oversized-choice': noOversizedChoice,
  'no-deprecated-detached-ruleset': noDeprecatedDetachedRuleset
};

export default { rules };
