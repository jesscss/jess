/*
 * Grammar guardrails — the source scan behind `pnpm check:guardrails`
 * assertion 8. Pure functions over a TypeScript AST, so the gate and its tests
 * (`scripts/__tests__/grammar-guardrails.test.mjs`) run the same code.
 *
 * Owner rules this enforces (docs/architecture/parser/GRAMMAR-REVIEW-STANDARD.md
 * items 9, 16 and 18; AGENTS.md "Parser Runtime Boundary"):
 *
 *   lookahead       Parseman never backtracks, re-parses or pre-scans; a grammar
 *                   decides on the CURRENT token. `not(X)` / `peek(X)` is allowed
 *                   only when X is one token wide. A regex, a sequence, a
 *                   repetition or a production that spans more than one token is
 *                   a pre-scan: a workaround for a missing parseman capability.
 *                   So is a lookaround past one token inside a consuming
 *                   `regex()`, a `regex()` whose pattern is not a literal, a
 *                   `dispatch` selector wider than one token, and a non-last
 *                   `choice` arm or an `optional` that starts with a wide regex
 *                   or a `scanTo`.
 *   dialect-prefix  A rule name carries no dialect name (`css…`, `LESS…`,
 *                   `DeclarationScss`, …) and no `Ast`/`Cst`. Exported whole
 *                   grammars (`rules`/`compose`/`composeLeaf` results) are not
 *                   rule names.
 *   runtime-codegen Parser packages never build code at runtime (`new
 *                   Function`, `Function(…)`, `eval(…)`, `node:vm`, or any other
 *                   route to them: `const F = Function`, `globalThis.eval`,
 *                   `(0, eval)`, `x.constructor(…)`, a string to `setTimeout`).
 *                   Codegen belongs to parseman's build-time `compile()`.
 *   attempt         `attempt(...)` tries a parse and rolls it back on failure,
 *                   which is backtracking: a missing parseman capability, like a
 *                   pre-scan.
 *   parseman-import A grammar source names each combinator itself: no alias, no
 *                   default or namespace import, no destructuring, no dynamic
 *                   import, no re-export, no binding `not`/`peek`/`attempt`/
 *                   `regex`/`token` to a value. A scan by name is only sound if
 *                   names are honest.
 *   jsdoc           Every rule — a PascalCase const or rule-map property whose
 *                   value is a combinator — carries a non-empty `/** … *\/` JSDoc
 *                   block (review items 4 and 5).
 *   productions.ts  No package carries a `productions.ts` (PRODUCTIONS_FILE).
 *
 * WIDTH MODEL. Every combinator expression has a width: 0 (zero-width: a
 * lookahead or trivia), 1 (one token) or MANY.
 *
 *   one token   `literal`, `keywords`, `word`, a `makeWord`/`makeWhen` matcher
 *               (each only if its text is one token), a one-token `regex`
 *               (below), `token(x)`, or a wrapper (`node`, `field`, `noTrivia`,
 *               `optional`, `parser`, …) around one.
 *   trivia      `classifiedTrivia(...)`; a whitespace or comment regex.
 *   sequence    adds its arms; leading trivia is free. A nested `not`/`peek`
 *               after a consuming arm reads the next token, so it counts.
 *   choice      its widest arm.
 *   MANY        repetition (`many`, `oneOrMore`, …), scanning (`scanTo`,
 *               `balanced`, `dispatch`), recursion, and any name neither the
 *               scanned sources nor parseman defines.
 *
 * NAMES. A name is a combinator only if this file imports it from parseman and
 * no local variable shadows it. `g.Rule` resolves through every definition of
 * that name in the scanned sources, because a composed grammar can override it;
 * a bare name resolves in this file first. Anything else on the left of a dot,
 * and a function parameter, cannot be proven narrow.
 *
 * `token(x)` is parseman's declaration that glued pieces form one lexical token,
 * but it proves nothing by itself. It narrows a SOFT width (adjacent pieces) only
 * when x has a one-token shape: sigils, at most one name or number, at most a
 * glued `(` or `%`. It cannot narrow a HARD width: whitespace between tokens, a
 * scan, or a lookaround past the token are never one token, whatever wraps them.
 *
 * WHAT THIS SCAN DOES NOT SEE. A consuming `choice` arm or `optional` that starts
 * with a rule reference and fails several tokens in is backtracking too: parseman's
 * backtrack probe measures that (parseman#246). A hand-written `{ parse() }` object
 * and a reducer that reads the input are not combinators, so only a `not`/`peek`
 * directly over one is caught; `verify:parser-runtime-boundary` covers both in CI.
 * Regex width counts lexical shapes, not meaning: `=` then a name reads as one token.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const MANY = 2;

/* "Never create a `productions.ts`. Upgrade `productions/*.ts` in place." (GRAMMAR-REVIEW-STANDARD §3) */
export const PRODUCTIONS_FILE = /^packages\/(?:.*\/)?productions\.ts$/;

/* The sources the scan reads: every parser package's `src/` and `parser-shared/src/`, tests excluded. */
export const GRAMMAR_SOURCE = /^packages\/(?:syntax\/[^/]+\/[^/]+-parser|parser-shared)\/src\/(?!(?:.*\/)?__tests__\/).+(?<!\.d|\.test|\.spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
export const ANY_SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/*
 * What may import parseman without being a grammar, because it never ships:
 * docs and dev tools, test files, and test or perf directories outside a `src/`.
 * Anything under a `src/` ships unless it is a `__tests__` directory or a test file.
 */
export const NOT_A_GRAMMAR = /^(?:docs|scratchpad|scripts|tools)\/|(?:^|\/)__tests__\/|\.(?:test|spec)\.[^/]+$|^(?:(?!src\/)[^/]+\/)*(?:tests?|perf|bench|benchmarks?|fixtures?)\//;

const ZERO_WIDTH = new Set(['not', 'peek']);
const ONE_TOKEN = new Set(['literal', 'keywords', 'word']);
const MATCHER_FACTORIES = new Set(['makeWord', 'makeWhen']);

/*
 * Wrappers whose width is their combinator argument's. `routed()` with no
 * argument re-places the one token a `dispatch` selector already consumed.
 */
const TRANSPARENT = new Set([
  'node', 'field', 'label', 'leaf', 'sourceLeaf', 'transform', 'noTrivia', 'attempt', 'expect', 'withCtx', 'optional', 'parser', 'routed'
]);
const REPEATS = new Set(['many', 'oneOrMore', 'oneOrMoreSep']);
const SCANS = new Set(['scanTo', 'balanced', 'dispatch']);

/* `rules`/`compose`/`composeLeaf` build whole grammars, not rules. */
const GRAMMAR_BUILDERS = new Set(['rules', 'compose', 'composeLeaf']);

const COMBINATORS = new Set([
  ...ZERO_WIDTH, ...ONE_TOKEN, ...MATCHER_FACTORIES, ...TRANSPARENT, ...REPEATS, ...SCANS,
  'regex', 'sequence', 'choice', 'token', 'classifiedTrivia'
]);

const DIALECT_PREFIX = /^(?:[Cc]ss|[Ll]ess|[Ss]css|[Jj]ess|CSS|LESS|SCSS|JESS)(?=[A-Z0-9_]|$)|[a-z0-9](?:Css|Less|Scss|Jess|CSS|LESS|SCSS|JESS)(?=[A-Z0-9_]|$)|(?:^|[a-z0-9])(?:Ast|Cst|AST|CST)(?=[A-Z0-9_]|$)|^(?:ast|cst)(?=[A-Z])/;

export const RULE_MESSAGES = {
  lookahead: [
    '  Parseman never backtracks, re-parses or pre-scans: a grammar decides on the CURRENT',
    '  token. `not(...)` / `peek(...)` over a regex, a multi-token sequence, a repetition or',
    '  a whole production looks past it, and so does a lookaround past one token inside a',
    '  `regex()`, and so does a `choice` arm or `optional` that starts by scanning and then',
    '  rewinds. That is a MISSING PARSEMAN CAPABILITY, not a grammar problem: file a',
    '  parseman issue (github.com/matthew-dean/parseman) describing the decision the',
    '  grammar cannot make on one token, and do NOT land a grammar workaround. One-token',
    '  lookahead (`not(literal(\'{\'))`, `peek(keywords([...]))`) stays allowed.',
    '  GRAMMAR-REVIEW-STANDARD.md items 9 and 18.'
  ],
  'dialect-prefix': [
    '  A dialect name (`css…`, `LESS…`, `DeclarationScss`, …) or an `Ast`/`Cst` in a rule',
    '  name claims the rule accepts a different language than its plain counterpart.',
    '  Use the plain name; where the divergence is real, name the divergence, not the',
    '  dialect. GRAMMAR-REVIEW-STANDARD.md item 16.'
  ],
  attempt: [
    '  Parseman never backtracks: a grammar decides on the CURRENT token. `attempt(...)`',
    '  tries a parse and rolls it back when it fails, which is backtracking. That is a',
    '  MISSING PARSEMAN CAPABILITY, not a grammar problem: file a parseman issue',
    '  (github.com/matthew-dean/parseman) describing the decision the grammar cannot make',
    '  on one token, and do NOT land a grammar workaround. GRAMMAR-REVIEW-STANDARD.md item 18.'
  ],
  jsdoc: [
    '  Every grammar rule (a PascalCase const or rule-map property whose value is a',
    '  combinator) carries a non-empty `/** … */` JSDoc block saying what it recognizes',
    '  (GRAMMAR-REVIEW-STANDARD.md items 4 and 5). A `/* … */` block above the rule becomes',
    '  one by changing its opener.'
  ],
  'parseman-import': [
    '  A grammar source imports each combinator under its own name, so the scan sees every',
    '  call: no `import { not as … }`, no default or `import * as …` import, no destructuring,',
    '  no dynamic import, `require()` or `createRequire`, no re-export, no import from a test',
    '  file, and no passing `not`/`peek`/`attempt`/`regex`/`token` around as a value. A renamed',
    '  lookahead is still a lookahead. GRAMMAR-REVIEW-STANDARD.md item 18.'
  ],
  'runtime-codegen': [
    '  Parser packages never build code at runtime (`new Function`, `Function(...)`,',
    '  `eval(...)`, `node:vm`, or any other route to them: `const F = Function`,',
    '  `globalThis.eval`, `(0, eval)`, `x.constructor(...)`, a string to `setTimeout`). Code',
    '  generation belongs to parseman\'s build-time `compile()`; a grammar that needs it at',
    '  runtime is a missing parseman capability.'
  ]
};

const ONE = { width: 1, why: '' };
const ZERO = { width: 0, why: '' };
const TRIVIA = { width: 0, why: '', trivia: true };
const soft = why => ({ width: MANY, why, hard: false });
const hard = why => ({ width: MANY, why, hard: true });

/*
 * ------------------------------------------------------------------------
 * Regex width — an abstract run over the pattern's AST from
 * `@eslint-community/regexpp` (the parser ESLint ships; resolved through eslint,
 * no extra dependency). It counts TOKENS; it never decides what the pattern
 * matches.
 *
 * The run carries the set of lexical states the pattern can be in. One token is
 * the shape `token()` allows: sigils, at most one name or number (a decimal
 * included), at most a glued `(` or `%`; or a run of operator characters; or one
 * structural character; or a quoted string; or one any-character atom, alone.
 * Whitespace ends the token. Reaching `over` means a second token:
 *
 *   `/color:/`  word, then `:`        `/[^;]?[^;]?;/`  any, then any
 *   `/;[-\w]+/` `;`, then a word      `/[-\w]+[ \t]*(?=:)/`  a gap, then a token
 *
 * A group is the union of its alternatives, a quantifier a fixpoint, and `{0}`
 * nothing, so groups hide nothing. A lookahead continues from the states before
 * it and rejoins them: reaching `over` inside reads past the token. A consuming
 * regex may span several tokens, so `lookarounds` is computed by a second run
 * that starts a new token instead of going `over`, and asks only whether each
 * lookaround reads past the token it follows. A comment is trivia only in its
 * canonical spellings (COMMENT_FORMS).
 * ------------------------------------------------------------------------
 */

const requireHere = createRequire(import.meta.url);
let regexParser;
function parseRegexLiteral(text) {
  regexParser ??= new (createRequire(requireHere.resolve('eslint'))('@eslint-community/regexpp').RegExpParser)({ ecmaVersion: 2025 });
  return regexParser.parseLiteral(text);
}

/* The comment spellings the grammars use, read as one whitespace atom. */
const COMMENT_FORMS = [
  String.raw`\/(?:\*(?:[^*]|\*(?!\/))*\*\/|\/[^\n\r]*)`,
  String.raw`\/\*(?:[^*]|\*(?!\/))*\*\/`,
  String.raw`\/\*[^*]*\*\/`,
  String.raw`\/\/[^\n\r]*`,
  String.raw`\/[/*]`,
  String.raw`\/[*/]`
];
const canonicalComments = text => COMMENT_FORMS.reduce((t, form) => t.split(form).join(String.raw`\s`), text);

const OVER = 'over';

/* state -> kind of the next character -> state; anything unlisted is a second token. */
const NEXT = {
  start: { ws: 'start', digit: 'num', name: 'word', dash: 'op', sigil: 'op', dot: 'op', percent: 'op', open: 'end', brace: 'end', struct: 'end', any: 'end', string: 'end' },
  op: { ws: 'gap', digit: 'num', name: 'word', dash: 'op', sigil: 'op', dot: 'op', percent: 'op', open: 'end', brace: 'end' },
  num: { ws: 'gap', digit: 'num', name: 'word', dash: 'word', dot: 'dot', percent: 'end', open: 'end' },
  dot: { ws: 'gap', digit: 'frac' },
  frac: { ws: 'gap', digit: 'frac', name: 'word', dash: 'word', percent: 'end' },
  word: { ws: 'gap', digit: 'word', name: 'word', dash: 'word', open: 'end', percent: 'end' },
  end: { ws: 'gap' },
  gap: { ws: 'gap' },
  [OVER]: {}
};

/* CSS whitespace (plus `\v`); every non-ASCII code point is a name code point (CSS Syntax §4.2). */
function charKind(cp) {
  if (cp === 0x20 || (cp >= 0x09 && cp <= 0x0d)) {
    return 'ws';
  }

  /* A backslash starts an escape, which is a name code point (CSS Syntax §4.3.7). */
  if (cp >= 0x80 || cp === 0x5c) {
    return 'name';
  }
  const ch = String.fromCharCode(cp);
  if (ch === '-') {
    return 'dash';
  }
  if (/[0-9]/.test(ch)) {
    return 'digit';
  }
  if (/[a-zA-Z_]/.test(ch)) {
    return 'name';
  }
  if (ch === '.' || ch === '%') {
    return ch === '.' ? 'dot' : 'percent';
  }
  if (ch === '(') {
    return 'open';
  }
  if (ch === '{' || ch === '[') {
    return 'brace';
  }
  return /[@:$#*!&+~?<>=/^|]/.test(ch) ? 'sigil' : 'struct';
}

/* `\p{L}`-style properties are letters; anything else (`\p{Any}`, `\p{P}`) can match anything. */
const NAME_PROPERTY = /^(?:L|Lu|Ll|Lt|Lm|Lo|Letter|N|Nd|Number|Alphabetic|ID_Start|ID_Continue|XID_Start|XID_Continue|Uppercase|Lowercase)$/;

function setKinds(set) {
  if (set.kind === 'any' || set.negate) {
    return ['any'];
  }
  if (set.kind === 'space') {
    return ['ws'];
  }
  if (set.kind === 'digit') {
    return ['digit'];
  }
  if (set.kind === 'word') {
    return ['digit', 'name'];
  }
  return NAME_PROPERTY.test(set.value ?? set.key ?? '') ? ['name'] : ['any'];
}

function classKinds(cls) {
  if (cls.type !== 'CharacterClass' || cls.negate) {
    return ['any'];
  }
  const kinds = new Set();
  for (const el of cls.elements) {
    if (el.type === 'Character') {
      kinds.add(charKind(el.value));
    } else if (el.type === 'CharacterClassRange') {
      for (let cp = el.min.value; cp <= Math.min(el.max.value, 0x7f); cp++) {
        kinds.add(charKind(cp));
      }
      if (el.max.value >= 0x80) {
        kinds.add('name');
      }
    } else if (el.type === 'CharacterSet') {
      setKinds(el).forEach(k => kinds.add(k));
    } else {
      kinds.add('any');
    }
  }
  return kinds.has('any') ? ['any'] : [...kinds];
}

function atomKinds(el) {
  if (el.type === 'Character') {
    return [charKind(el.value)];
  }
  if (el.type === 'CharacterSet') {
    return setKinds(el);
  }
  return el.type === 'Backreference' ? ['any'] : classKinds(el);
}

const isBackslash = el => el?.type === 'Character' && el.value === 0x5c;

/*
 * What follows a backslash in a CSS escape: one character, or
 * `(?:[0-9a-fA-F]{1,6}[ \t\n\r\f]?|[^\n\r\f])`. The one whitespace character that
 * ends a hex escape belongs to the escape (CSS Syntax §4.3.7), so it is not trivia.
 */
const isHexRun = el => el?.type === 'Quantifier' && el.max !== null && el.max <= 6 && el.element.type === 'CharacterClass'
  && classKinds(el.element).every(k => k === 'digit' || k === 'name');
const isTerminator = el => el?.type === 'Quantifier' && el.min === 0 && el.max === 1 && classKinds(el.element).join() === 'ws';
const isOneChar = el => el.type === 'Character' || el.type === 'CharacterSet' || el.type === 'CharacterClass';
function isEscapeBody(el) {
  if (isOneChar(el)) {
    return true;
  }
  if (isHexRun(el)) {
    return true;
  }
  return el?.type === 'Group' && el.alternatives.every(({ elements: e }) => (e.length === 1 && (isOneChar(e[0]) || isHexRun(e[0])))
    || (e.length === 2 && isHexRun(e[0]) && isTerminator(e[1])));
}

/* A string body: repeats of anything but its quote, and escapes. */
function isStringBody(el, quote) {
  const atom = el.type === 'Quantifier' ? el.element : el;
  if (atom.type === 'CharacterClass') {
    return atom.negate && atom.elements.some(m => m.type === 'Character' && m.value === quote);
  }
  return atom.type === 'Group' && atom.alternatives.every(({ elements: e }) => (e.length === 1 && isStringBody(e[0], quote))
    || (e.length === 2 && isBackslash(e[0]) && isOneChar(e[1])));
}

function stringEnd(elements, i) {
  const open = elements[i];
  if (open.type !== 'Character' || (open.value !== 0x22 && open.value !== 0x27)) {
    return -1;
  }
  for (let j = i + 1; j < elements.length; j++) {
    const el = elements[j];
    if (el.type === 'Character' && el.value === open.value) {
      return j;
    }
    if (!isStringBody(el, open.value)) {
      return -1;
    }
  }
  return -1;
}

function step(states, kinds, ctx) {
  const out = new Set();
  for (const state of states) {
    for (const kind of kinds) {
      ctx.word ||= kind === 'name' || kind === 'digit';
      ctx.trivia ||= kind === 'ws';
      const next = NEXT[state][kind] ?? (ctx.restart ? NEXT.start[kind] : OVER);
      out.add(next);
    }
  }
  return out;
}

/* `(?![-\w])`: not followed by one character. It ends the token it follows, and reads nothing past it. */
const isBoundaryCheck = el => el.kind === 'lookahead' && el.negate
  && el.alternatives.every(({ elements: e }) => e.length === 1 && isOneChar(e[0]));

function runLookaround(el, states, ctx) {
  if (isBoundaryCheck(el)) {
    return states;
  }
  const probe = { ...ctx, restart: false };
  const from = el.kind === 'lookbehind' ? new Set(['start']) : new Set([...states].filter(s => s !== OVER));
  const inner = runAlternatives(el.alternatives, from, probe);
  ctx.lookarounds = probe.lookarounds;
  if (inner.has(OVER)) {
    if (!ctx.lookarounds.includes(el.raw)) {
      ctx.lookarounds.push(el.raw);
    }
    return ctx.restart ? states : new Set([...states, OVER]);
  }
  ctx.reads ||= states.has('start') && [...inner].some(s => s !== 'start');
  return states;
}

function runElement(el, states, ctx) {
  if (el.type === 'Quantifier') {
    if (el.max === 0) {
      return states;
    }
    const out = new Set(el.min === 0 ? states : []);
    let current = states;
    for (let grew = true; grew;) {
      current = runElement(el.element, current, ctx);
      const size = out.size;
      current.forEach(s => out.add(s));
      grew = el.max !== 1 && out.size > size;
    }
    return out;
  }
  if (el.type === 'Assertion') {
    return el.kind === 'lookahead' || el.kind === 'lookbehind' ? runLookaround(el, states, ctx) : states;
  }
  if (el.type === 'Group' || el.type === 'CapturingGroup') {
    return runAlternatives(el.alternatives, states, ctx);
  }
  return step(states, atomKinds(el), ctx);
}

function runAlternatives(alternatives, states, ctx) {
  const out = new Set();
  for (const { elements } of alternatives) {
    let current = states;
    for (let i = 0; i < elements.length; i++) {
      const end = stringEnd(elements, i);
      if (end !== -1) {
        current = step(current, ['string'], ctx);
        i = end;
      } else if (isBackslash(elements[i]) && i + 1 < elements.length && isEscapeBody(elements[i + 1])) {
        current = step(current, ['name'], ctx);
        i += isHexRun(elements[i + 1]) && isTerminator(elements[i + 2]) ? 2 : 1;
      } else {
        current = runElement(elements[i], current, ctx);
      }
    }
    current.forEach(s => out.add(s));
  }
  return out;
}

const runPattern = (pattern, restart) => {
  const ctx = { lookarounds: [], restart, word: false, trivia: false, reads: false };
  return { states: runAlternatives(pattern.alternatives, new Set(['start']), ctx), ctx };
};

/**
 * Width of a regex literal: `{ width, hard, why, trivia, word, reads }` (`word`:
 * it can match a name or digit; `reads`: though zero-width, a lookaround reads a
 * token), plus `lookarounds`: every lookaround in it that reads past the token
 * it follows, which a consuming `regex()` is reported for.
 */
export function regexWidth(literalText) {
  let pattern;
  try {
    pattern = parseRegexLiteral(canonicalComments(literalText)).pattern;
  } catch (error) {
    return { ...hard(`regex ${literalText} does not parse: ${error.message}`), lookarounds: [] };
  }
  const { lookarounds } = runPattern(pattern, true).ctx;
  const { states, ctx } = runPattern(pattern, false);
  if (states.has(OVER)) {
    const reason = ctx.lookarounds.length > 0 ? `its lookaround \`${ctx.lookarounds[0]}\` reads past the token` : 'its pattern spans more than one token';
    return { ...hard(`regex ${literalText}: ${reason}`), lookarounds };
  }
  if ([...states].every(s => s === 'start')) {
    return { ...(ctx.trivia ? TRIVIA : ZERO), reads: ctx.reads ? 1 : 0, lookarounds };
  }
  return { ...ONE, word: ctx.word, lookarounds };
}

/** Width of matcher text (`literal('a:b')`), read character by character like a regex. */
function textIsOneToken(text) {
  let states = new Set(['start']);
  const ctx = { restart: false };
  for (const ch of text) {
    states = step(states, [charKind(ch.codePointAt(0))], ctx);
  }
  return !states.has(OVER);
}

/*
 * ------------------------------------------------------------------------
 * Names: what a call really is.
 * ------------------------------------------------------------------------
 */

/* Strip what changes a node's type but not its value: parens, `as`, `satisfies`, `!`, `<T>x`. */
function unwrap(ts, node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node))) {
    node = node.expression;
  }
  return node;
}

const PARSEMAN_MODULE = /^parseman(?:\/|$)|\/node_modules\/(?:\.pnpm\/[^/]*\/node_modules\/)?parseman\//;

const parsemanImports = new WeakMap();

/* Value names this source file imports from parseman: local name -> imported name. */
function importsOf(ts, sourceFile) {
  let imports = parsemanImports.get(sourceFile);
  if (!imports) {
    imports = new Map();
    for (const st of sourceFile.statements) {
      if (ts.isImportDeclaration(st) && PARSEMAN_MODULE.test(st.moduleSpecifier.text) && !st.importClause?.isTypeOnly
        && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
        for (const spec of st.importClause.namedBindings.elements) {
          if (!spec.isTypeOnly) {
            imports.set(spec.name.text, (spec.propertyName ?? spec.name).text);
          }
        }
      }
    }
    parsemanImports.set(sourceFile, imports);
  }
  return imports;
}

/* Names a binding (identifier or destructuring pattern) declares. */
function boundNames(ts, name, out = []) {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
  } else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) {
        boundNames(ts, el.name, out);
      }
    }
  }
  return out;
}

const hasParameter = (ts, fn, name) => fn.parameters?.some(p => boundNames(ts, p.name).includes(name));

/* Is `id` a function parameter in scope? Its value could be anything. */
function isParameter(ts, id) {
  for (let n = id.parent; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isFunctionLike(n) && hasParameter(ts, n, id.text)) {
      return true;
    }
  }
  return false;
}

/* Is `id` a local variable, parameter or catch binding, shadowing an import of the same name? */
function declaredLocally(ts, id) {
  for (let n = id.parent; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isFunctionLike(n) && hasParameter(ts, n, id.text)) {
      return true;
    }
    if (ts.isCatchClause(n) && n.variableDeclaration && boundNames(ts, n.variableDeclaration.name).includes(id.text)) {
      return true;
    }
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)
      && n.initializer.declarations.some(d => boundNames(ts, d.name).includes(id.text))) {
      return true;
    }
    for (const st of n.statements ?? []) {
      if ((ts.isVariableStatement(st) && st.declarationList.declarations.some(d => boundNames(ts, d.name).includes(id.text)))
        || (ts.isFunctionDeclaration(st) && st.name?.text === id.text)) {
        return true;
      }
    }
  }
  return false;
}

/* The parseman combinator this identifier is, if it is one. */
function parsemanName(ts, id) {
  const imported = importsOf(ts, id.getSourceFile()).get(id.text);
  return imported !== undefined && !declaredLocally(ts, id) ? imported : undefined;
}

function calleeName(ts, call) {
  const callee = unwrap(ts, call.expression);
  return ts.isIdentifier(callee) ? parsemanName(ts, callee) : undefined;
}

const GRAMMAR_BASE = /^packages\/(?:parser-shared\/src\/|syntax\/css\/css-parser\/src\/grammar\.ts$)/;

const scriptKind = (ts, rel) => (/\.[cm]?tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.[cm]?jsx?$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

const isCombinatorShape = (ts, init) => ts.isCallExpression(init) || ts.isIdentifier(init) || ts.isPropertyAccessExpression(init);

/**
 * Every combinator-valued const, rule-map property and reassignment in one
 * source file, by name. The map over all scanned sources is passed to each scan,
 * so an inherited `g.Rule` resolves and an override in any dialect counts.
 */
export function grammarDefinitions(ts, rel, text) {
  const defs = new Map();
  const add = (name, init) => {
    if (!defs.has(name)) {
      defs.set(name, []);
    }
    defs.get(name).push(init);
  };
  const visit = (node) => {
    const init = node.initializer && unwrap(ts, node.initializer);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && init && isCombinatorShape(ts, init)) {
      add(node.name.text, init);
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text)) {
      add(node.name.text, init);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = unwrap(ts, node.left);
      if (ts.isIdentifier(target)) {
        add(target.text, unwrap(ts, node.right));
      } else if (ts.isPropertyAccessExpression(target)) {
        add(target.name.text, unwrap(ts, node.right));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(ts, rel)));
  return defs;
}

const collapse = text => text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
const clip = text => (text.length > 160 ? `${text.slice(0, 159)}…` : text);

/*
 * ------------------------------------------------------------------------
 * Combinator width over the TypeScript AST.
 * ------------------------------------------------------------------------
 */

const SIGIL_CHARS = /^[@:$#.*!&%+~-]+$/;
const SUFFIXES = new Set(['(', '%']);
const MAX_SHAPES = 256;

const effective = w => Math.max(w.width, w.reads ?? 0);

function punctPiece(text) {
  return { kind: 'punct', sigil: SIGIL_CHARS.test(text), suffix: SUFFIXES.has(text), text };
}

function shapeProblem(pieces) {
  let i = 0;
  while (i < pieces.length && pieces[i].kind === 'punct' && pieces[i].sigil) {
    i++;
  }
  if (i < pieces.length && pieces[i].kind === 'word') {
    i++;
  }
  if (i < pieces.length && pieces[i].kind === 'punct' && pieces[i].suffix) {
    i++;
  }
  return i === pieces.length ? null : `\`${pieces.map(p => (p.kind === 'word' ? '<word>' : p.text)).join(' ')}\``;
}

/* Is `id` the grammar parameter, `g` in `g.Rule`? Any other object could hold anything. */
const isGrammarObject = (ts, node) => ts.isIdentifier(node) && isParameter(ts, node);

/* Strings a matcher call recognizes: its string arguments and string-array elements. */
function matcherTexts(ts, call, name) {
  const first = call.arguments[0];
  if (!first) {
    return [];
  }
  if (name === 'keywords' && ts.isArrayLiteralExpression(first)) {
    return first.elements.filter(e => ts.isStringLiteralLike(e)).map(e => e.text);
  }
  return ts.isStringLiteralLike(first) ? [first.text] : [];
}

function createWidth(ts, defs, baseDefs) {
  const active = new Set();
  const definitions = name => defs.get(name) ?? baseDefs.get(name);

  /* `g.Rule` can be overridden by any dialect composed over this one, so every definition counts. */
  const memberDefinitions = name => [...new Set([...(defs.get(name) ?? []), ...(baseDefs.get(name) ?? [])])];

  function resolveAll(name, inits) {
    if (inits === undefined || inits.length === 0) {
      return hard(`\`${name}\` is defined nowhere in the scanned sources, so it cannot be proven one token wide`);
    }
    let best = ZERO;
    for (const init of inits) {
      if (active.has(init)) {
        return hard(`\`${name}\` is recursive`);
      }
      active.add(init);
      const w = width(init);
      active.delete(init);
      if (w.width === MANY) {
        return { ...w, why: w.why.startsWith('`') ? w.why : `\`${name}\` — ${w.why}` };
      }
      if (effective(w) > effective(best) || (effective(w) === effective(best) && w.trivia)) {
        best = w;
      }
    }
    return best;
  }

  function sequenceWidth(args) {
    let tokens = 0;
    let gap = false;
    for (const arg of args) {
      const w = width(arg);
      if (w.width === MANY) {
        return w;
      }
      if (w.reads && tokens > 0) {
        return hard('a lookahead after a consuming arm reads another token');
      }
      if (w.trivia) {
        gap ||= tokens > 0;
        continue;
      }
      tokens += w.width;
    }
    if (tokens > 1) {
      return gap ? hard('a sequence of more than one token') : soft('a sequence of more than one token');
    }
    return tokens === 0 ? ZERO : ONE;
  }

  function widest(args) {
    let best = ZERO;
    for (const arg of args) {
      const w = width(arg);
      if (w.width === MANY) {
        return w;
      }
      if (effective(w) > effective(best) || (effective(w) === effective(best) && w.trivia)) {
        best = w;
      }
    }
    return best;
  }

  const isFunction = arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg);

  function isCombinatorArgument(arg) {
    return !ts.isStringLiteralLike(arg) && !isFunction(arg)
      && !ts.isObjectLiteralExpression(arg) && !ts.isArrayLiteralExpression(arg) && !ts.isNumericLiteral(arg);
  }

  function choiceArms(args) {
    return args.map((arg) => {
      if (!ts.isObjectLiteralExpression(arg)) {
        return arg;
      }
      const arm = arg.properties.find(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'combinator');
      return arm ? arm.initializer : arg;
    });
  }

  function isFactoryProduct(call) {
    const callee = unwrap(ts, call.expression);
    return ts.isIdentifier(callee) && !isParameter(ts, callee) && definitions(callee.text)?.some(init => ts.isCallExpression(init) && MATCHER_FACTORIES.has(calleeName(ts, init)));
  }

  function matcherWidth(call, name) {
    const wide = matcherTexts(ts, call, name).find(text => !textIsOneToken(text));
    return wide === undefined ? ONE : hard(`its text ${JSON.stringify(wide)} spans more than one token`);
  }

  /* The piece sequences x can match, or `{ problem }`. */
  function shapes(node) {
    node = unwrap(ts, node);
    const union = (nodes) => {
      const out = [];
      for (const n of nodes) {
        const s = shapes(n);
        if (s.problem) {
          return s;
        }
        out.push(...s);
      }
      return out.length > MAX_SHAPES ? { problem: 'too many alternatives to prove' } : out;
    };
    const concat = (nodes) => {
      let out = [[]];
      for (const n of nodes) {
        const s = shapes(n);
        if (s.problem) {
          return s;
        }
        out = out.flatMap(prefix => s.map(rest => [...prefix, ...rest]));
        if (out.length > MAX_SHAPES) {
          return { problem: 'too many alternatives to prove' };
        }
      }
      return out;
    };
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const name = ts.isIdentifier(node) ? node.text : node.name.text;
      const inits = ts.isIdentifier(node) ? definitions(name) : memberDefinitions(name);
      if (!inits || inits.length === 0) {
        return { problem: `\`${name}\` is undefined here` };
      }
      if (inits.some(init => active.has(init))) {
        return { problem: `\`${name}\` is recursive` };
      }
      inits.forEach(init => active.add(init));
      const s = union(inits);
      inits.forEach(init => active.delete(init));
      return s;
    }
    if (ts.isConditionalExpression(node)) {
      return union([node.whenTrue, node.whenFalse]);
    }
    if (!ts.isCallExpression(node)) {
      return { problem: `\`${clip(collapse(node.getText()))}\`` };
    }
    const name = calleeName(ts, node);
    const args = [...node.arguments];
    if (name === 'literal') {
      const text = args[0] && ts.isStringLiteralLike(args[0]) ? args[0].text : undefined;
      if (text === undefined || /\s/.test(text)) {
        return { problem: 'whitespace' };
      }
      return [[/[-\w\u0080-￿]/.test(text) && !SIGIL_CHARS.test(text) ? { kind: 'word' } : punctPiece(text)]];
    }
    if (name === 'keywords' || name === 'word' || isFactoryProduct(node)) {
      const w = matcherWidth(node, name);
      return w.width === MANY ? { problem: w.why } : [[{ kind: 'word' }]];
    }
    if (name === 'regex') {
      const w = args[0] && ts.isRegularExpressionLiteral(args[0]) ? regexWidth(args[0].text) : hard('regex() over a non-literal pattern');
      if (w.width === MANY) {
        return { problem: w.why };
      }
      if (w.width === 0) {
        return w.trivia ? { problem: 'whitespace' } : [[]];
      }
      const body = args[0].text.slice(1, args[0].text.lastIndexOf('/')).replace(/\\(.)/g, '$1').replace(/[[\]?]/g, '');
      return [[w.word ? { kind: 'word' } : punctPiece(body)]];
    }
    if (ZERO_WIDTH.has(name)) {
      return [[]];
    }
    if (name === 'sequence') {
      return concat(args.filter(isCombinatorArgument));
    }
    if (name === 'choice') {
      return union(choiceArms(args));
    }
    if (name === 'optional') {
      const s = concat(args.filter(isCombinatorArgument));
      return s.problem ? s : [[], ...s];
    }
    if (name === 'token' || TRANSPARENT.has(name)) {
      const inner = args.filter(isCombinatorArgument);
      return inner.length === 0 ? [[{ kind: 'word' }]] : concat(inner);
    }
    if (name === 'classifiedTrivia') {
      return { problem: 'whitespace' };
    }
    if (REPEATS.has(name)) {
      return { problem: `${name}() repeats` };
    }
    return { problem: `\`${clip(collapse(node.getText()))}\`` };
  }

  function tokenWidth(call, args) {
    const inner = args.filter(isCombinatorArgument);
    const w = widest(inner);
    if (w.width !== MANY) {
      return w.width === 0 ? w : ONE;
    }
    if (w.hard) {
      return w;
    }
    const s = shapes(call.arguments.length === 1 ? call.arguments[0] : call);
    const problem = s.problem ?? s.map(shapeProblem).find(Boolean);
    return problem ? { ...hard(`token() cannot make ${problem} one lexical token`), declaredToken: true } : ONE;
  }

  function callWidth(call) {
    const name = calleeName(ts, call);
    const args = [...call.arguments];
    if (name === undefined) {
      if (isFactoryProduct(call)) {
        return matcherWidth(call);
      }
      const callee = unwrap(ts, call.expression);
      return hard(`\`${ts.isIdentifier(callee) ? callee.text : 'a computed callee'}(...)\` is not a parseman combinator this scan can prove one token wide`);
    }
    if (ZERO_WIDTH.has(name)) {
      const w = args[0] ? width(args[0]) : ZERO;
      return w.width === MANY ? w : { ...ZERO, reads: effective(w) };
    }
    if (name === 'classifiedTrivia') {
      return TRIVIA;
    }
    if (ONE_TOKEN.has(name)) {
      return matcherWidth(call, name);
    }
    if (name === 'regex') {
      const pattern = args[0] && unwrap(ts, args[0]);
      return pattern && ts.isRegularExpressionLiteral(pattern) ? regexWidth(pattern.text) : hard('regex() over a non-literal pattern');
    }
    if (name === 'sequence') {
      return sequenceWidth(args);
    }
    if (name === 'choice') {
      return widest(choiceArms(args));
    }
    if (name === 'token') {
      return tokenWidth(call, args);
    }
    if (TRANSPARENT.has(name)) {
      const inner = args.filter(isCombinatorArgument);
      if (inner.length === 0) {
        return args.some(isFunction) ? hard(`${name}() over a function cannot be read`) : ONE;
      }
      return widest(inner);
    }
    if (REPEATS.has(name)) {
      return soft(`${name}() repeats`);
    }
    if (SCANS.has(name)) {
      return hard(`${name}() scans more than one token`);
    }
    return hard(`\`${name}(...)\` is not a combinator this scan can prove one token wide`);
  }

  function width(node) {
    node = unwrap(ts, node);
    if (ts.isCallExpression(node)) {
      return callWidth(node);
    }
    if (ts.isIdentifier(node)) {
      return isParameter(ts, node)
        ? hard(`\`${node.text}\` is a function parameter, so it cannot be proven one token wide`)
        : resolveAll(node.text, definitions(node.text));
    }
    if (ts.isPropertyAccessExpression(node)) {
      return isGrammarObject(ts, node.expression)
        ? resolveAll(node.name.text, memberDefinitions(node.name.text))
        : hard(`\`${clip(collapse(node.getText()))}\` is not a rule of the grammar parameter, so it cannot be proven one token wide`);
    }
    if (ts.isConditionalExpression(node)) {
      return widest([node.whenTrue, node.whenFalse]);
    }
    return hard(`\`${node.getText().slice(0, 40)}\` is not a combinator expression`);
  }

  /* The grammar this file composes: its own definition of a name, else the CSS grammar's or parser-shared's. */
  const composedDefinitions = name => defs.get(name) ?? baseDefs.get(name)?.filter(init => GRAMMAR_BASE.test(init.getSourceFile().fileName));

  /*
   * What a baselined site means: its own text and the definitions reachable from
   * it, with comments, formatting and reducers stripped. Any change to what it reads
   * changes the fingerprint; a comment or a reducer does not. In the CSS grammar or
   * parser-shared, `g.X` reads every dialect's definition, since a dialect composed
   * over it can override X and the site then runs that. Elsewhere a site reads the
   * grammar it is written for.
   *
   * `shallow` stops one level down, for `attempt`: its target usually reaches much
   * of a grammar, so a full closure would move on most edits, and a real widening
   * would hide among routine notes.
   */
  const printer = ts.createPrinter({ removeComments: true });
  const stripReducers = node => ts.transform(node, [(ctx) => {
    const visitor = n => (ts.isFunctionLike(n) ? ts.factory.createIdentifier('reducer') : ts.visitEachChild(n, visitor, ctx));
    return root => ts.visitNode(root, visitor);
  }]).transformed[0];
  const print = node => printer.printNode(ts.EmitHint.Unspecified, stripReducers(node), node.getSourceFile());
  function fingerprint(site, { shallow = false } = {}) {
    const readsEveryDialect = GRAMMAR_BASE.test(site.getSourceFile().fileName);
    const seen = new Map();
    const visit = (node) => {
      if (ts.isFunctionLike(node)) {
        return;
      }
      if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node)) {
        const isMember = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
        const inits = isMember && readsEveryDialect ? memberDefinitions(node.text) : composedDefinitions(node.text);
        if (inits?.length && !seen.has(node.text)) {
          seen.set(node.text, inits.map(print).sort().join('|'));
          if (!shallow) {
            inits.forEach(visit);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(site);
    const closure = [...seen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, text]) => `${name}=${text}`).join('\n');
    return createHash('sha256').update(`${print(site)}\n${closure}`).digest('hex').slice(0, 16);
  }

  return { width, fingerprint };
}

/* Name of the const or rule-map property the node sits in. */
function ownerName(ts, node) {
  for (let n = node; n; n = n.parent) {
    if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && ts.isIdentifier(n.name)) {
      return n.name.text;
    }
  }
  return '(module)';
}

const CODEGEN = new Set(['eval', 'Function']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);
const STRING_TIMERS = new Set(['setTimeout', 'setInterval']);
const VM_MODULE = /^(?:node:)?vm$/;
const BARE_MODULE = /^[^./]/;
const TEST_MODULE = /(?:^|\/)__tests__\/|\.(?:test|spec)(?:\.[^/]+)?$/;

/* Combinators the scan reads by name: bound to anything else, their calls would escape it. */
const REBIND_WATCHED = new Set([...ZERO_WIDTH, 'attempt', 'regex', 'token']);

/* Is this identifier a reference to a value, rather than a name being declared, a property key or a type? */
function isValueReference(ts, id) {
  const p = id.parent;
  if (!p) {
    return false;
  }
  if ((ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) && p.name === id) {
    return false;
  }
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p)
    || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === id) {
    return false;
  }
  if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isParameter(p) || ts.isClassDeclaration(p)
    || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) && p.name === id) {
    return false;
  }
  if (ts.isBindingElement(p) && p.initializer !== id) {
    return false;
  }
  if (ts.isExportSpecifier(p) && p.parent.parent.moduleSpecifier) {
    return false;
  }
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) {
    return false;
  }
  return !ts.isLabeledStatement(p) && !ts.isBreakOrContinueStatement(p);
}

/* A non-empty JSDoc block above the rule (read from the comments: TypeScript attaches none to a map property). */
function hasJsdoc(ts, node, text) {
  const host = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (ts.getLeadingCommentRanges(text, host.getFullStart()) ?? []).some(({ pos, end }) => text.startsWith('/**', pos) && text.slice(pos + 3, end - 2).replace(/[\s*]/g, '') !== '');
}

/**
 * Scan one parser source file. Returns hits shaped
 * `{ rule, file, line, const, construct, why, resolved? }`. `construct` is the
 * clipped, whitespace-collapsed source text, for people. `resolved`, on a
 * lookahead or `attempt`, is a fingerprint of the site and what it reads.
 */
export function scanGrammarSource(ts, rel, text, baseDefs = new Map()) {
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(ts, rel));
  const defs = grammarDefinitions(ts, rel, text);
  const { width, fingerprint } = createWidth(ts, defs, baseDefs);
  const hits = [];
  const lineOf = node => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const hit = (rule, node, why, extra = {}) => hits.push({
    rule,
    file: rel,
    line: lineOf(node),
    const: ownerName(ts, node),
    construct: clip(collapse(node.getText(sourceFile))),
    why,
    ...extra
  });
  const siteHit = (rule, node, why) => hit(rule, node, why, { resolved: fingerprint(node) });
  const checkName = (node, name) => {
    if (DIALECT_PREFIX.test(name)) {
      hit('dialect-prefix', node, `rule name \`${name}\``);
    }
  };
  const isCombinatorValue = (n) => {
    const value = n && unwrap(ts, n);
    if (!value || !ts.isCallExpression(value)) {
      return false;
    }
    const name = calleeName(ts, value);
    if (name !== undefined) {
      return !GRAMMAR_BUILDERS.has(name);
    }
    const callee = unwrap(ts, value.expression);
    return ts.isIdentifier(callee) && (defs.get(callee.text) ?? baseDefs.get(callee.text))?.some(init => ts.isCallExpression(init) && MATCHER_FACTORIES.has(calleeName(ts, init)));
  };
  const isRuleReference = (n, seen = new Set()) => {
    const value = n && unwrap(ts, n);
    if (!value || seen.has(value) || !(ts.isIdentifier(value) || ts.isPropertyAccessExpression(value))) {
      return false;
    }
    seen.add(value);
    const name = ts.isIdentifier(value) ? value.text : value.name.text;
    return (defs.get(name) ?? baseDefs.get(name))?.some(init => isCombinatorValue(init) || isRuleReference(init, seen));
  };
  const insideLookahead = (node) => {
    for (let n = node.parent; n; n = n.parent) {
      if (ts.isCallExpression(n) && ZERO_WIDTH.has(calleeName(ts, n))) {
        return true;
      }
    }
    return false;
  };
  const importRule = (node, why) => hit('parseman-import', node, why);

  /*
   * The wide regex or `scanTo` a consuming arm starts with, read through bare consts
   * and wrappers. A `g.Rule` is not followed: where a rule fails is not a pre-scan
   * this can see. A regex with a wide lookaround is already reported as itself.
   */
  const leadingScan = (arm, depth = 0) => {
    const n = arm && unwrap(ts, arm);
    if (!n || depth > 6) {
      return null;
    }
    const firstOf = list => list.map(a => leadingScan(a, depth + 1)).find(Boolean) ?? null;
    if (ts.isIdentifier(n)) {
      return isParameter(ts, n) ? null : firstOf(defs.get(n.text) ?? baseDefs.get(n.text) ?? []);
    }
    if (ts.isObjectLiteralExpression(n)) {
      return firstOf(n.properties.filter(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'combinator').map(p => p.initializer));
    }
    if (!ts.isCallExpression(n)) {
      return null;
    }
    const name = calleeName(ts, n);
    const args = [...n.arguments];
    if (name === 'scanTo') {
      return n;
    }
    if (name === 'regex') {
      const pattern = args[0] && unwrap(ts, args[0]);
      const w = pattern && ts.isRegularExpressionLiteral(pattern) ? regexWidth(pattern.text) : undefined;
      return w?.width === MANY && w.lookarounds.length === 0 ? n : null;
    }
    if (name === 'sequence') {
      for (const arg of args) {
        const lead = leadingScan(arg, depth + 1);
        if (lead || width(arg).width !== 0) {
          return lead;
        }
      }
      return null;
    }
    if (name === 'choice') {
      return firstOf(args);
    }
    return TRANSPARENT.has(name) || REPEATS.has(name) || name === 'token'
      ? firstOf(args.filter(a => !ts.isStringLiteralLike(a) && !ts.isFunctionLike(a)).slice(0, 1))
      : null;
  };
  const checkConsumingArms = (node, name) => {
    if ((name !== 'choice' && name !== 'optional') || insideLookahead(node)) {
      return;
    }
    const arms = name === 'optional' ? node.arguments.slice(0, 1) : node.arguments.slice(0, -1);
    for (const arm of arms) {
      const lead = leadingScan(arm);
      if (lead) {
        hit('lookahead', arm, `this arm starts by scanning past one token, then rewinds if it fails: \`${clip(collapse(lead.getText(lead.getSourceFile())))}\``, { resolved: fingerprint(lead) });
      }
    }
  };

  const visitImport = (node) => {
    const clause = node.importClause;
    const module = node.moduleSpecifier.text;
    if (clause?.isTypeOnly) {
      return;
    }
    if (VM_MODULE.test(module)) {
      hit('runtime-codegen', node, `\`${module}\` runs code at runtime`);
    }
    if (TEST_MODULE.test(module)) {
      importRule(node, 'a shipping source imports a test file, which the scan does not read');
    }
    const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.filter(s => !s.isTypeOnly) : [];
    if (!PARSEMAN_MODULE.test(module)) {
      if (BARE_MODULE.test(module)) {
        for (const spec of named.filter(s => REBIND_WATCHED.has((s.propertyName ?? s.name).text))) {
          importRule(spec, `\`${(spec.propertyName ?? spec.name).text}\` imported from \`${module}\`, not from parseman`);
        }
      }
      return;
    }
    if (clause?.name) {
      importRule(node, 'a default import of parseman');
    }
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      importRule(node, 'a namespace import');
    }
    for (const spec of named) {
      const imported = (spec.propertyName ?? spec.name).text;
      if (imported !== spec.name.text && (COMBINATORS.has(imported) || imported === 'default')) {
        importRule(spec, `\`${imported}\` imported under another name`);
      }
    }
  };

  const visitCall = (node) => {
    const name = calleeName(ts, node);
    checkConsumingArms(node, name);
    if (ZERO_WIDTH.has(name) && node.arguments.length > 0) {
      const w = width(node.arguments[0]);
      if (w.width === MANY) {
        siteHit('lookahead', node, w.why);
      }
    } else if (name === 'attempt') {
      hit('attempt', node, 'attempt() tries a parse and rolls it back on failure: backtracking', { resolved: fingerprint(node, { shallow: true }) });
    } else if (name === 'dispatch' && node.arguments[0]) {
      /* A selector is `token()` around a name built from pieces: parseman reads it as one token. */
      const w = width(node.arguments[0]);
      if (w.width === MANY && !w.declaredToken) {
        hit('lookahead', node, `its selector looks past one token: ${w.why}`, { resolved: fingerprint(node.arguments[0]), construct: clip(collapse(node.arguments[0].getText(sourceFile))) });
      }
    } else if (name === 'node' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      checkName(node.arguments[0], node.arguments[0].text);
    } else if (name === 'regex' && !insideLookahead(node)) {
      const pattern = node.arguments[0] && unwrap(ts, node.arguments[0]);
      if (!pattern || !ts.isRegularExpressionLiteral(pattern)) {
        siteHit('lookahead', node, 'regex() over a non-literal pattern cannot be read, so its lookarounds cannot be checked');
      } else {
        const { lookarounds } = regexWidth(pattern.text);
        if (lookarounds.length > 0) {
          siteHit('lookahead', node, `its lookaround \`${lookarounds[0]}\` reads past the token it consumes`);
        }
      }
    } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      importRule(node, 'a dynamic import or require()');
    }
    if (name === 'word' || name === 'keywords' || name === 'makeWord' || name === 'makeWhen') {
      const options = name === 'word' || name === 'keywords' ? node.arguments.slice(1) : [...node.arguments];
      const strings = options.flatMap(arg => (ts.isObjectLiteralExpression(arg) ? arg.properties.map(p => p.initializer).filter(Boolean) : [arg])).filter(arg => ts.isStringLiteralLike(arg));
      if (strings.some(arg => /[()]/.test(arg.text))) {
        siteHit('lookahead', node, 'its boundary option carries regex source, which can read past the token');
      }
    }
    const callee = unwrap(ts, node.expression);
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'constructor') {
      hit('runtime-codegen', node, '`.constructor(...)` reaches the Function constructor');
    }
    if (ts.isIdentifier(callee) && STRING_TIMERS.has(callee.text) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      hit('runtime-codegen', node, `a string passed to \`${callee.text}\` is evaluated`);
    }
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      visitCall(node);
    } else if (ts.isImportDeclaration(node)) {
      visitImport(node);
    } else if (ts.isImportEqualsDeclaration(node)) {
      importRule(node, 'an `import = require()`');
    } else if (ts.isIdentifier(node) && CODEGEN.has(node.text) && isValueReference(ts, node)) {
      hit('runtime-codegen', node.parent, `\`${node.text}\` used at runtime`);
    } else if ((ts.isPropertyAccessExpression(node) && CODEGEN.has(node.name.text))
      || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && CODEGEN.has(node.argumentExpression.text))) {
      hit('runtime-codegen', node, 'a global code-generation function reached through an object');
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text) && !ts.isStringLiteralLike(node.argumentExpression)) {
      hit('runtime-codegen', node, 'a computed member of the global object can reach eval');
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && PARSEMAN_MODULE.test(node.moduleSpecifier.text)
      && !(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(e => e.isTypeOnly || !COMBINATORS.has((e.propertyName ?? e.name).text)))) {
      importRule(node, 'a re-export of parseman, which hides the combinator names from the importing file');
    } else if (ts.isBindingElement(node)) {
      const bound = (node.propertyName ?? node.name).getText(sourceFile);
      if (REBIND_WATCHED.has(bound)) {
        importRule(node, 'a combinator taken by destructuring');
      } else if (CODEGEN.has(bound)) {
        hit('runtime-codegen', node, 'a global code-generation function taken by destructuring');
      }
    } else if (ts.isIdentifier(node) && node.text === 'createRequire' && isValueReference(ts, node)) {
      importRule(node.parent, 'createRequire can load parseman under any name');
    } else if (ts.isIdentifier(node) && REBIND_WATCHED.has(node.text) && parsemanName(ts, node) && isValueReference(ts, node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
      importRule(node.parent, `\`${node.text}\` passed or bound as a value, so its calls escape the scan`);
    }
    if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && ts.isIdentifier(node.name)) {
      const combinator = isCombinatorValue(node.initializer);
      if (combinator || isRuleReference(node.initializer)) {
        checkName(node.name, node.name.text);
      }
      if (combinator && /^[A-Z]/.test(node.name.text) && !hasJsdoc(ts, node, text)) {
        hits.push({ rule: 'jsdoc', file: rel, line: lineOf(node), const: node.name.text, construct: node.name.text, why: 'no JSDoc block' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

/**
 * Parseman combinators imported by a file outside the scanned grammar globs:
 * a grammar written there would escape every check above. Text-only, so it
 * runs without the TypeScript parser.
 */
export function parsemanCombinatorImports(text) {
  const found = [];
  for (const m of text.matchAll(/\b(?:import|export)\s+(type\s+)?([^'";]*?)\s*from\s+['"]([^'"]+)['"]/g)) {
    if (!PARSEMAN_MODULE.test(m[3]) || m[1]) {
      continue;
    }
    if (m[2].includes('*')) {
      found.push(`* from ${m[3]}`);
      continue;
    }
    for (const spec of /\{([^}]*)\}/.exec(m[2])?.[1].split(',') ?? []) {
      const imported = spec.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (COMBINATORS.has(imported) && !/^type\s/.test(spec.trim())) {
        found.push(imported);
      }
    }
  }
  for (const m of text.matchAll(/\(\s*['"](parseman)['"]\s*\)/g)) {
    found.push(`dynamic ${m[1]}`);
  }
  return found;
}

/*
 * ------------------------------------------------------------------------
 * Baseline.
 *
 * A lookahead or `attempt` entry is one SITE, identified by rule, file and owning
 * const, and carries `resolved`, the fingerprint of what it reads today. A new
 * site is never allowed. An existing site whose fingerprint changes may land only
 * if its entry records the new fingerprint and a `changed` note saying why, and
 * the gate prints every note: a widening can never be silent, and a harmless edit
 * to a shared definition does not get stuck. Other entries have no fingerprint and
 * are identified by their construct text.
 * ------------------------------------------------------------------------
 */

const siteKey = e => (e.resolved === undefined ? `${e.rule}\u0000${e.file}\u0000${e.construct}` : `${e.rule}\u0000${e.file}\u0000${e.const}`);

/** The exact identity of a baseline entry: its site and, where it has one, its fingerprint. */
export const grammarBaselineKey = e => `${siteKey(e)}\u0000${e.resolved ?? ''}`;

/** A baseline file as flat entries: `entries`, plus `undocumentedRules` as `jsdoc` entries. */
export function grammarBaselineEntries(baseline) {
  const undocumented = Object.entries(baseline.undocumentedRules ?? {})
    .flatMap(([file, names]) => names.map(name => ({ rule: 'jsdoc', file, construct: name, issue: baseline.issue })));
  return [...(baseline.entries ?? []), ...undocumented];
}

function multimap(entries, key) {
  const map = new Map();
  for (const entry of entries) {
    const k = key(entry);
    if (!map.has(k)) {
      map.set(k, []);
    }
    map.get(k).push(entry);
  }
  return map;
}

/**
 * Ratchet hits against the baseline's entries, never by line, so editing above a
 * site does not move it. Returns `fresh` (hits at no baselined site), `stale`
 * (entries with no hit), `changed` (`{ hit, entry }` pairs: the site is baselined
 * but what it reads is not what the entry records), and `kept`: the matching
 * entries with their line, const, construct and reason refreshed.
 */
export function compareGrammarBaseline(hits, entries) {
  const exact = multimap(entries, grammarBaselineKey);
  const kept = [];
  const pending = [];
  for (const hit of hits) {
    const match = exact.get(grammarBaselineKey(hit))?.shift();
    if (match) {
      const { line, construct, why } = hit;
      kept.push({ ...match, ...(line === undefined ? {} : { line }), ...(hit.rule === 'jsdoc' ? {} : { construct, why }) });
    } else {
      pending.push(hit);
    }
  }
  const sites = multimap([...exact.values()].flat(), siteKey);
  const fresh = [];
  const changed = [];
  for (const hit of pending) {
    const open = sites.get(siteKey(hit));
    if (open?.length > 0) {
      const same = open.findIndex(e => e.construct === hit.construct);
      changed.push({ hit, entry: open.splice(same === -1 ? 0 : same, 1)[0] });
    } else {
      fresh.push(hit);
    }
  }
  return { fresh, stale: [...sites.values()].flat(), changed, kept };
}

/**
 * The baseline against the one on the base branch: `added` entries (counting
 * repeats), and `unexplained`: sites whose fingerprint moved with no new `changed`
 * note. A note copied from the base branch explains nothing.
 */
export function compareBaselineToBase(base, current) {
  const { fresh, changed } = compareGrammarBaseline(grammarBaselineEntries(current), grammarBaselineEntries(base));
  return {
    added: fresh,
    unexplained: changed.filter(({ hit, entry }) => !hit.changed?.trim() || hit.changed === entry.changed).map(({ hit }) => hit)
  };
}
