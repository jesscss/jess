/**
 * Local ESLint rules for GRAMMAR sources (the four dialect parsers plus the
 * shared recognition surface).
 *
 * Unlike the regression pins in `index.mjs`, these are wired as `error`: each
 * one encodes either a documented parseman authoring constraint or a
 * reviewability requirement the owner has stated directly. Scoping lives in
 * `eslint.config.mjs`; the rules themselves are pure AST logic so they can be
 * unit-tested with `RuleTester`.
 */

/**
 * Comment text that ESLint, TypeScript, a bundler, or a coverage tool reads as
 * a DIRECTIVE. These must stay `//` line comments: their meaning is positional
 * (`@ts-expect-error` applies to the very next line) and several are simply not
 * recognised in block form. Merging two adjacent directives into one block
 * comment silently disables both, so any run containing one is left alone.
 */
const DIRECTIVE_COMMENT = /^\s*(?:eslint\b|eslint-|globals?\b|exported\b|jshint\b|jslint\b|istanbul\b|c8\b|v8\s+ignore\b|node:coverage\b|prettier-ignore\b|@ts-|@vite-|@rollup-|webpack[A-Z]|#__|type-coverage:)/;

/** A comment is "own-line" when no code token precedes it on its line. */
function isOwnLine(sourceCode, comment) {
  const before = sourceCode.getTokenBefore(comment, { includeComments: false });
  return !before || before.loc.end.line < comment.loc.start.line;
}

/** Indentation string of the line the comment starts on. */
function indentOf(sourceCode, comment) {
  const line = sourceCode.lines[comment.loc.start.line - 1] ?? '';
  return /^[ \t]*/.exec(line)[0];
}

/**
 * Group line comments into RUNS: maximal sets of own-line `//` comments on
 * strictly consecutive lines at the same indentation. A run is the unit that
 * gets rewritten, because rewriting members individually would produce a stack
 * of one-line block comments rather than one prose block.
 */
function lineCommentRuns(sourceCode) {
  const runs = [];
  let current = null;
  for (const comment of sourceCode.getAllComments()) {
    if (comment.type !== 'Line' || !isOwnLine(sourceCode, comment)) {
      current = null;
      continue;
    }
    const indent = indentOf(sourceCode, comment);
    const previous = current?.[current.length - 1];
    if (
      current
      && previous.loc.end.line + 1 === comment.loc.start.line
      && indentOf(sourceCode, previous) === indent
    ) {
      current.push(comment);
      continue;
    }
    current = [comment];
    runs.push(current);
  }
  return runs;
}

/** True when any comment in the run carries directive meaning. */
function runHasDirective(run) {
  return run.some(comment => DIRECTIVE_COMMENT.test(comment.value));
}

/**
 * Neutralise a block-comment terminator inside comment TEXT.
 *
 * JS block comments do not nest, so a run whose prose quotes a CSS comment
 * would otherwise END at that inner terminator and spill the remainder into the
 * code as syntax. This is not hypothetical: `packages/core/src/tree/any.ts`
 * documents a CSS value that embeds a comment, and wrapping it naively produced
 * an unterminated string literal.
 *
 * The escape is the ordinary JS idiom — a backslash between the star and the
 * slash. It is not a terminator, renders as the same two characters to a
 * reader, and is exactly what this file's own doc comments use.
 */
function escapeTerminators(text) {
  return text.replaceAll('*/', `*${String.fromCharCode(0x5C)}/`);
}

/**
 * Rewrite a run of `//` comments as one starred block comment, preserving
 * indentation and the text of every line. A single-line run collapses to a
 * one-line block; two or more become a starred block.
 */
function runToBlock(run, indent) {
  const bodies = run.map(comment => escapeTerminators(comment.value.trim()));
  if (bodies.length === 1) {
    return `/* ${bodies[0]} */`;
  }
  const lines = bodies.map(body => (body === '' ? `${indent} *` : `${indent} * ${body}`));
  return [`/*`, ...lines, `${indent} */`].join('\n');
}

/**
 * Report one run and attach its autofix. Shared by both comment rules so the
 * terminator handling cannot be applied to one of them and forgotten on the
 * other.
 */
function reportRun(context, sourceCode, run, messageId) {
  const last = run[run.length - 1];
  const loc = { start: run[0].loc.start, end: last.loc.end };
  const indent = indentOf(sourceCode, run[0]);
  const range = [run[0].range[0], last.range[1]];
  context.report({
    loc,
    messageId,
    fix: fixer => fixer.replaceTextRange(range, runToBlock(run, indent))
  });
}

/*
 * ---------------------------------------------------------------------------
 * no-line-comments  —  grammar files only
 * ---------------------------------------------------------------------------
 */

const noLineComments = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'Grammar sources use block comments only; `//` is reserved for directives.'
    },
    schema: [],
    messages: {
      lineComment: 'Grammar sources use block comments (`/* … */`), not `//`. Autofixable with `--fix`; upgrade to `/** … */` where the comment documents a production.'
    }
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program() {
        for (const run of lineCommentRuns(sourceCode)) {
          if (runHasDirective(run)) {
            continue;
          }
          reportRun(context, sourceCode, run, 'lineComment');
        }
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * no-multiline-line-comments  —  repo-wide
 * ---------------------------------------------------------------------------
 */

const noMultilineLineComments = {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'A comment that spans multiple lines must be one block comment, not a stack of `//` lines.'
    },
    schema: [],
    messages: {
      multiline: 'A multi-line comment must be a block comment (`/* … */`), not consecutive `//` lines. Autofixable with `--fix`.'
    }
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program() {
        for (const run of lineCommentRuns(sourceCode)) {
          if (run.length < 2 || runHasDirective(run)) {
            continue;
          }
          reportRun(context, sourceCode, run, 'multiline');
        }
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * no-literal-non-ascii-in-regex
 * ---------------------------------------------------------------------------
 *
 * A raw U+0080 and a raw U+00A0 are indistinguishable on screen, so a reviewer
 * cannot check a range endpoint written as a literal character. Escapes also
 * survive copy-paste, editor normalisation, and file-encoding changes.
 *
 * The fix is byte-preserving for the COMPILED pattern: each UTF-16 code unit
 * becomes its own `\uXXXX`, which is the identical code unit. Surrogate pairs
 * are emitted as two escapes, which is what the engine already sees without a
 * `u` flag, and is still the same pair with one.
 */

/** `\uXXXX` for a single UTF-16 code unit. */
function unitEscape(code) {
  return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

const noLiteralNonAsciiInRegex = {
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description: 'Regex literals spell non-ASCII code points as `\\uXXXX`, never as raw characters.'
    },
    schema: [],
    messages: {
      literal: 'Regex contains the literal non-ASCII character U+{{code}}. Write it as `{{escape}}` — a raw character cannot be verified by a reviewer and does not survive re-encoding. Autofixable with `--fix`.'
    }
  },
  create(context) {
    return {
      Literal(node) {
        if (!node.regex) {
          return;
        }
        const { pattern, flags } = node.regex;
        let escaped = '';
        let found = null;
        for (const character of pattern) {
          for (let index = 0; index < character.length; index++) {
            const code = character.charCodeAt(index);
            if (code > 0x7F) {
              escaped += unitEscape(code);
              found ??= code;
            } else {
              escaped += character[index];
            }
          }
        }
        if (found === null) {
          return;
        }
        context.report({
          node,
          messageId: 'literal',
          data: {
            code: found.toString(16).toUpperCase().padStart(4, '0'),
            escape: unitEscape(found)
          },
          fix: fixer => fixer.replaceText(node, `/${escaped}/${flags}`)
        });
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * no-hand-rolled-keyword-regex
 * ---------------------------------------------------------------------------
 *
 * `regex(/not(?![-\w])/i)` is a hand-rolled copy of the `keyword()` combinator.
 * It is a CORRECTNESS rule, not a style one: `/i` without `/u` applies
 * non-ASCII case folding incorrectly, and parseman fixed exactly that defect
 * INSIDE the combinator — so every hand-rolled copy carries the unfixed bug.
 */

/** Pattern body with an optional trailing word-boundary negative lookahead removed. */
function stripBoundaryLookahead(pattern) {
  const match = /^(.*?)\(\?![^()]*\)$/.exec(pattern);
  return match ? { body: match[1], hadLookahead: true } : { body: pattern, hadLookahead: false };
}

/**
 * True when the body is nothing but literal words, alternated and/or grouped.
 *
 * Every alternative must contain a LETTER. `[-\w]+` alone also admits punctuation
 * and digit runs, which are not keywords: `regex(/-(?![0-9.])/)` is a sign
 * disambiguator (`less-parser/src/grammar.ts`), not a hand-rolled `keyword()`, and
 * `keywords()` is not the fix for it. Measured false-positive rate before this
 * guard: 1 of 70 sites.
 */
function isPlainKeywordBody(body) {
  const unwrapped = body.replace(/^\(\?:(.*)\)$/, '$1');
  if (unwrapped === '' || /[\\[\]{}+*?.^$()]/.test(unwrapped)) {
    return false;
  }
  return unwrapped.split('|').every(alternative => /^[-\w]+$/.test(alternative) && /[a-zA-Z]/.test(alternative));
}

const noHandRolledKeywordRegex = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Keyword recognition uses the `keyword()` combinator, not a hand-rolled boundary regex.'
    },
    schema: [],
    messages: {
      handRolled: 'Hand-rolled keyword regex `/{{pattern}}/{{flags}}`. Use parseman\'s keyword combinator instead — it owns the word-boundary and the case-fold class, and a hand-rolled `/i` without `/u` folds non-ASCII incorrectly (the defect parseman fixed inside the combinator). Not autofixable: converting a production by hand is a grammar change and must be reviewed.'
    }
  },
  create(context) {
    return {
      Literal(node) {
        if (!node.regex) {
          return;
        }
        const { pattern, flags } = node.regex;
        const { body, hadLookahead } = stripBoundaryLookahead(pattern);
        if (!hadLookahead || !isPlainKeywordBody(body)) {
          return;
        }
        context.report({ node, messageId: 'handRolled', data: { pattern, flags } });
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * no-regex-outside-combinator
 * ---------------------------------------------------------------------------
 */

const noRegexOutsideCombinator = {
  meta: {
    type: 'problem',
    docs: {
      description: 'In a grammar, a regex literal may appear only as an argument to `regex()`.'
    },
    schema: [{
      type: 'object',
      properties: { combinators: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false
    }],
    messages: {
      outside: 'Regex literal outside `regex()`. A grammar recognises input through combinators; an ad-hoc regex is invisible to the macro compiler and to first-set computation.',
      constructed: '`new RegExp(...)` in a grammar. The macro compiler cannot statically evaluate a constructed pattern, which degrades the compiled artifact into an interpreter.'
    }
  },
  create(context) {
    const allowed = new Set(context.options[0]?.combinators ?? ['regex']);
    return {
      Literal(node) {
        if (!node.regex) {
          return;
        }
        const parent = node.parent;
        const inCombinator = parent
          && parent.type === 'CallExpression'
          && parent.callee.type === 'Identifier'
          && allowed.has(parent.callee.name)
          && parent.arguments.includes(node);
        if (!inCombinator) {
          context.report({ node, messageId: 'outside' });
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'RegExp') {
          context.report({ node, messageId: 'constructed' });
        }
      }
    };
  }
};

/*
 * ---------------------------------------------------------------------------
 * no-macro-hazards
 * ---------------------------------------------------------------------------
 *
 * The grammar is an AUTHORED parseman macro DSL. The compiler expands it at
 * build time into flat JS; anything it cannot statically evaluate falls back to
 * the runtime interpreter and the whole file loses its compiled dispatch. The
 * constraint (documented, owner-stated) is: parameterless combinator consts and
 * plain reducers only — no factories, no spreads, no hoisted regex sources.
 *
 * `check-macro-buildable` already catches this, but only at build time; this
 * catches it at write time, which is strictly better.
 */

/** Combinator calls whose argument list the macro compiler must see literally. */
const COMBINATORS = new Set([
  'choice', 'sequence', 'many', 'oneOrMore', 'optional', 'not', 'node', 'parser',
  'rules', 'compose', 'attempt', 'field', 'leaf', 'literal', 'regex', 'label',
  'noTrivia', 'scanTo', 'balanced', 'trivia', 'expect', 'composeLeaf'
]);

/** A function whose body ultimately produces a combinator call is a factory. */
function returnsCombinator(node) {
  const body = node.body;
  if (body && body.type === 'CallExpression') {
    return body.callee.type === 'Identifier' && COMBINATORS.has(body.callee.name);
  }
  if (body && body.type === 'BlockStatement') {
    return body.body.some(statement => statement.type === 'ReturnStatement'
      && statement.argument
      && statement.argument.type === 'CallExpression'
      && statement.argument.callee.type === 'Identifier'
      && COMBINATORS.has(statement.argument.callee.name));
  }
  return false;
}

const noMacroHazards = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Grammar files stay macro-buildable: no factories, spreads, or constructed patterns.'
    },
    schema: [],
    messages: {
      factory: 'Grammar factory function `{{name}}` returns a combinator. The macro compiler cannot expand a parameterised producer, so the grammar degrades into the interpreter. Use a parameterless combinator const.',
      spread: 'Spread in a `{{name}}()` argument list. The macro compiler needs the arm list literally; a spread hides it and forces interpretation.',
      hoistedSource: 'Hoisted regex source. The macro compiler statically evaluates `regex(/…/)` literals only; a pattern assembled from a variable or template cannot be compiled.'
    }
  },
  create(context) {
    function checkFactory(node, name) {
      if (node.params.length > 0 && returnsCombinator(node)) {
        context.report({ node, messageId: 'factory', data: { name: name ?? '(anonymous)' } });
      }
    }
    return {
      FunctionDeclaration(node) {
        checkFactory(node, node.id?.name);
      },
      VariableDeclarator(node) {
        const init = node.init;
        if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
          checkFactory(init, node.id.type === 'Identifier' ? node.id.name : undefined);
        }
      },
      SpreadElement(node) {
        const parent = node.parent;
        if (parent
          && parent.type === 'CallExpression'
          && parent.callee.type === 'Identifier'
          && COMBINATORS.has(parent.callee.name)) {
          context.report({ node, messageId: 'spread', data: { name: parent.callee.name } });
        }
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'regex') {
          return;
        }
        const argument = node.arguments[0];
        if (argument && argument.type !== 'Literal' && argument.type !== 'SpreadElement') {
          context.report({ node: argument, messageId: 'hoistedSource' });
        }
      }
    };
  }
};

export const rules = {
  'no-line-comments': noLineComments,
  'no-multiline-line-comments': noMultilineLineComments,
  'no-literal-non-ascii-in-regex': noLiteralNonAsciiInRegex,
  'no-hand-rolled-keyword-regex': noHandRolledKeywordRegex,
  'no-regex-outside-combinator': noRegexOutsideCombinator,
  'no-macro-hazards': noMacroHazards
};

export default { rules };
