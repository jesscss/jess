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
 *                   `regex()`, and a `regex()` whose pattern is not a literal.
 *   dialect-prefix  A rule name carries no dialect prefix (`css…`, `less…`,
 *                   `scss…`, `jess…`) and no `Ast`/`Cst`. Exported whole
 *                   grammars (`rules`/`compose`/`composeLeaf` results) are not
 *                   rule names.
 *   runtime-codegen Parser packages never build code at runtime (`new
 *                   Function`, `Function(…)`, `eval(…)`, or either by another
 *                   route: `const F = Function`, `globalThis.eval`, `(0, eval)`).
 *                   Codegen belongs to parseman's build-time `compile()`.
 *   attempt         `attempt(...)` tries a parse and rolls it back on failure:
 *                   backtracking. Orchestrator ruling 2026-11-04: it counts
 *                   against the owner's zero-backtracking rule, so it is a
 *                   missing parseman capability, like a pre-scan.
 *   parseman-import A grammar source names each combinator itself: no alias, no
 *                   namespace import, no destructuring, no dynamic import, no
 *                   re-export, no binding `not`/`peek`/`attempt`/`regex`/`token`
 *                   to a value. A scan by name is only sound if names are honest.
 *   jsdoc           Every rule — a PascalCase const whose value is a combinator
 *                   — carries a `/** … *\/` JSDoc block (review items 4 and 5).
 *   productions.ts  No package carries a `productions.ts` (PRODUCTIONS_FILE).
 *
 * WIDTH MODEL. Every combinator expression has a width: 0 (zero-width: a
 * lookahead or trivia), 1 (one token) or MANY.
 *
 *   one token   `literal`, `keywords`, `word`, a `makeWord`/`makeWhen` matcher,
 *               a one-token `regex` (below), `token(x)`, or a wrapper (`node`,
 *               `field`, `noTrivia`, `optional`, `parser`, …) around one.
 *   trivia      `classifiedTrivia(...)`; a whitespace or comment regex.
 *   sequence    adds its arms; leading trivia is free.
 *   choice      its widest arm.
 *   MANY        repetition (`many`, `oneOrMore`, …), scanning (`scanTo`,
 *               `balanced`, `dispatch`), recursion, and any name neither this
 *               file nor the base grammar defines: what the scan cannot prove
 *               narrow is reported, because an unprovable lookahead is the
 *               defect this exists for.
 *
 * `token(x)` is parseman's declaration that glued pieces form one lexical token,
 * but it proves nothing by itself. It narrows a SOFT width (adjacent pieces) only
 * when x has a one-token shape: sigils, at most one name or number, at most a
 * glued `(` or `%`. It cannot narrow a HARD width: whitespace between tokens, a
 * scan, or a lookaround past the token are never one token, whatever wraps them.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const MANY = 2;

/* "Never create a `productions.ts`. Upgrade `productions/*.ts` in place." (GRAMMAR-REVIEW-STANDARD §3) */
export const PRODUCTIONS_FILE = /^packages\/(?:.*\/)?productions\.ts$/;

/* The sources the scan reads: every parser package's `src/` and `parser-shared/src/`, tests excluded. */
export const GRAMMAR_SOURCE = /^packages\/(?:syntax\/[^/]+\/[^/]+-parser|parser-shared)\/src\/(?!(?:.*\/)?__tests__\/).+(?<!\.d|\.test|\.spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
export const ANY_SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/* What may import parseman without being a grammar, because it never ships: tests, perf probes, docs and dev tools. */
export const NOT_A_GRAMMAR = /^(?:docs|scratchpad|scripts|tools)\/|(?:^|\/)(?:__tests__|tests?|perf|bench|benchmarks?|fixtures?)\/|\.(?:test|spec)\.[^/]+$/;

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

/* `rules`/`compose`/`composeLeaf` build whole grammars, not rules, so they are not here. */
const COMBINATORS = new Set([
  ...ZERO_WIDTH, ...ONE_TOKEN, ...TRANSPARENT, ...REPEATS, ...SCANS,
  'regex', 'sequence', 'choice', 'token', 'classifiedTrivia'
]);

const DIALECT_PREFIX = /^(?:[Cc]ss|[Ll]ess|[Ss]css|[Jj]ess)(?=[A-Z0-9_]|$)|(?:^|[a-z0-9])(?:Ast|Cst|AST|CST)(?=[A-Z0-9_]|$)|^(?:ast|cst)(?=[A-Z])/;

export const RULE_MESSAGES = {
  lookahead: [
    '  Parseman never backtracks, re-parses or pre-scans: a grammar decides on the CURRENT',
    '  token. `not(...)` / `peek(...)` over a regex, a multi-token sequence, a repetition or',
    '  a whole production looks past it. That is a MISSING PARSEMAN CAPABILITY, not a',
    '  grammar problem: file a parseman issue (github.com/jesscss/parseman) describing',
    '  the decision the grammar cannot make on one token, and do NOT land a grammar',
    '  workaround. One-token lookahead (`not(literal(\'{\'))`, `peek(keywords([...]))`)',
    '  stays allowed. GRAMMAR-REVIEW-STANDARD.md items 9 and 18.'
  ],
  'dialect-prefix': [
    '  A dialect prefix (`css…`, `less…`, `scss…`, `jess…`) or an `Ast`/`Cst` in a rule',
    '  name claims the rule accepts a different language than its plain counterpart.',
    '  Use the plain name; where the divergence is real, name the divergence, not the',
    '  dialect. GRAMMAR-REVIEW-STANDARD.md item 16.'
  ],
  attempt: [
    '  Parseman never backtracks: a grammar decides on the CURRENT token. `attempt(...)`',
    '  tries a parse and rolls it back when it fails, which is backtracking. That is a',
    '  MISSING PARSEMAN CAPABILITY, not a grammar problem: file a parseman issue',
    '  (github.com/jesscss/parseman) describing the decision the grammar cannot make on',
    '  one token, and do NOT land a grammar workaround. GRAMMAR-REVIEW-STANDARD.md item 18.'
  ],
  jsdoc: [
    '  Every grammar rule (a PascalCase const whose value is a combinator) carries a',
    '  `/** … */` JSDoc block saying what it recognizes (GRAMMAR-REVIEW-STANDARD.md items',
    '  4 and 5). A `/* … */` block above the rule becomes one by changing its opener.'
  ],
  'parseman-import': [
    '  A grammar source imports each combinator under its own name, so the scan sees every',
    '  call: no `import { not as … }`, no `import * as …`, no destructuring, no dynamic',
    '  import or `require()`, no re-export, and no passing `not`/`peek`/`attempt`/`regex`/',
    '  `token` around as a value.',
    '  A renamed lookahead is still a lookahead. GRAMMAR-REVIEW-STANDARD.md item 18.'
  ],
  'runtime-codegen': [
    '  Parser packages never build code at runtime (`new Function`, `Function(...)`,',
    '  `eval(...)`, or either reached by another name: `const F = Function`,',
    '  `globalThis.eval`, `(0, eval)`). Code generation belongs to parseman\'s build-time `compile()`; a',
    '  grammar that needs it at runtime is a missing parseman capability.'
  ]
};

const ONE = { width: 1, why: '' };
const ZERO = { width: 0, why: '' };
const TRIVIA = { width: 0, why: '', trivia: true };
const soft = (why, at = '') => ({ width: MANY, why, hard: false, at });
const hard = (why, at = '') => ({ width: MANY, why, hard: true, at });

/*
 * ------------------------------------------------------------------------
 * Regex width — a walk over the pattern's AST from `@eslint-community/regexpp`
 * (the parser ESLint ships; resolved through eslint, no extra dependency). It
 * counts TOKENS; it never decides what the pattern matches.
 *
 *   - Characters, escapes, classes and groups glue into one token. A character
 *     is classified by its code point, so `\x20` is whitespace and `\x3a` is
 *     punctuation; a `{0}` quantifier removes its atom.
 *   - Whitespace (a whitespace character, `\s`, a class of only whitespace) is
 *     trivia: it ends the token, and a token after it is another token (HARD).
 *     A class that mixes whitespace with token characters counts as whitespace;
 *     repeated, it is HARD on its own.
 *   - A comment is trivia only in its canonical spellings (COMMENT_FORMS); any
 *     other text after `\/\*` or `\/\/` is read like the rest of the pattern.
 *   - A repeated atom followed by a non-name atom at the same nesting level
 *     (`[-\w]+:`, `[\w]*\$\{`) starts another token (SOFT: `token()` may declare
 *     it one only in a one-token shape, below).
 *   - A group carries its edge whitespace: `(?:[-\w]+[ \t]*):` is a name, a gap
 *     and another token (HARD), not one glued atom.
 *   - A lookaround checks one boundary (`(?![-\w])`, `(?=\()`) or, before any
 *     atom, leading trivia and one token; a lookaround that crosses whitespace
 *     to a token after the token, or spans more than one token, reads past the
 *     token (HARD). This holds in a consuming `regex()` too: there the scan
 *     reports the lookaround itself (`lookarounds`).
 *   - A repeated any-character class (`[^;]*`, `.+`, `[\s\S]*`) is a scan (HARD).
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
  String.raw`\/\/[^\n\r]*`,
  String.raw`\/[/*]`,
  String.raw`\/[*/]`
];
const canonicalComments = text => COMMENT_FORMS.reduce((t, form) => t.split(form).join(String.raw`\s`), text);

/* CSS whitespace (plus `\v`); every non-ASCII code point is a name code point (CSS Syntax §4.2). */
const isWhitespace = cp => cp === 0x20 || (cp >= 0x09 && cp <= 0x0d);
const isNameChar = cp => cp >= 0x80 || /[-\w]/.test(String.fromCharCode(cp));
const charKind = cp => (isWhitespace(cp) ? 'ws' : isNameChar(cp) ? 'name' : 'punct');

function rangeKinds(min, max, kinds) {
  for (let cp = min; cp <= Math.min(max, 0x7f); cp++) {
    kinds.add(charKind(cp));
  }
  if (max >= 0x80) {
    kinds.add('name');
  }
}

function setKind(set) {
  if (set.kind === 'any' || set.negate) {
    return 'any';
  }
  return set.kind === 'space' ? 'ws' : 'name';
}

function classKind(cls) {
  if (cls.type !== 'CharacterClass' || cls.negate) {
    return 'any';
  }
  const kinds = new Set();
  for (const el of cls.elements) {
    if (el.type === 'Character') {
      kinds.add(charKind(el.value));
    } else if (el.type === 'CharacterClassRange') {
      rangeKinds(el.min.value, el.max.value, kinds);
    } else if (el.type === 'CharacterSet') {
      kinds.add(setKind(el));
    } else {
      kinds.add('any');
    }
  }
  if (kinds.has('any')) {
    return 'any';
  }
  if (kinds.has('ws')) {
    return kinds.size === 1 ? 'ws' : 'mixed';
  }
  return kinds.has('punct') ? 'punct' : 'name';
}

/*
 * `\\[0-9a-fA-F]{1,6}[ \t\n\r\f]?`: the one whitespace character that ends a CSS
 * hex escape belongs to the escape (CSS Syntax §4.3.7), so it is not trivia.
 */
const isHexRun = el => el?.type === 'Quantifier' && el.max !== null && el.max <= 6 && el.element.type === 'CharacterClass'
  && /^\[(?:0-9a-fA-F|a-fA-F0-9|0-9A-Fa-f|a-f0-9|0-9a-f)\]$/.test(el.element.raw);
const isBackslash = el => el?.type === 'Character' && el.value === 0x5c;
function followsBackslash(elements, i) {
  if (i > 0) {
    return isBackslash(elements[i - 1]);
  }
  const group = elements[0].parent.parent;
  const outer = group.parent;
  return (group.type === 'Group' || group.type === 'CapturingGroup') && outer.type === 'Alternative' && isBackslash(outer.elements[outer.elements.indexOf(group) - 1]);
}
const isEscapeTerminator = (elements, i) => i > 0 && elements[i].type === 'Quantifier' && elements[i].min === 0 && elements[i].max === 1
  && classKind(elements[i].element) === 'ws' && isHexRun(elements[i - 1]) && followsBackslash(elements, i - 1);

/*
 * Reads one alternative. Returns MANY (hard/soft) or
 * `{ tokens, trivia, name, lead, trail, triviaThenToken }`: `lead`/`trail` say
 * whitespace can sit before the first / after the last token, and
 * `triviaThenToken` that a token follows whitespace.
 */
function alternativeWidth(elements) {
  let tokens = 0;
  let gap = false;
  let inToken = false;
  let lastRepeated = false;
  let name = true;
  let word = false;
  let trivia = false;
  let lead = false;
  let trail = false;
  let triviaThenToken = false;
  const whitespace = () => {
    trivia = true;
    lead ||= tokens === 0;
    trail = tokens > 0;
    gap ||= tokens > 0;
    inToken = false;
  };
  const atom = (nameAtom, repeats) => {
    if (!inToken) {
      tokens++;
      triviaThenToken ||= trivia;
      if (tokens > 1 && gap) {
        return hard('its pattern spans more than one token');
      }
    } else if (lastRepeated && !nameAtom) {
      tokens++;
    }
    trail = false;
    inToken = true;
    name &&= nameAtom;
    word ||= nameAtom;
    lastRepeated = repeats;
    return undefined;
  };
  for (const [index, element] of elements.entries()) {
    let node = element;
    let repeats = false;
    if (isEscapeTerminator(elements, index)) {
      continue;
    }
    if (element.type === 'Quantifier') {
      if (element.max === 0) {
        continue;
      }
      node = element.element;
      repeats = element.max === null || element.max > 1;
    }
    let kind;
    if (node.type === 'Character') {
      kind = charKind(node.value);
    } else if (node.type === 'CharacterSet') {
      kind = setKind(node);
    } else if (node.type === 'Backreference') {
      kind = 'punct';
    } else if (node.type === 'Assertion') {
      if (node.kind === 'lookahead' || node.kind === 'lookbehind') {
        const inner = alternativesWidth(node.alternatives);
        if (inner.width === MANY || (tokens > 0 && inner.triviaThenToken)) {
          return hard(`its lookaround \`${node.raw}\` reads past the token`);
        }
      }
      continue;
    } else if (node.type === 'Group' || node.type === 'CapturingGroup') {
      const inner = alternativesWidth(node.alternatives);
      if (inner.width === MANY) {
        return inner;
      }
      if (repeats && inner.tokens > 0 && (inner.lead || inner.trail)) {
        return hard('it repeats a group that crosses whitespace');
      }
      if (inner.lead || (inner.tokens === 0 && inner.trivia)) {
        whitespace();
      }
      if (inner.tokens > 0) {
        const fail = atom(inner.name, repeats);
        if (fail) {
          return fail;
        }
        word ||= inner.word;
        if (inner.trail) {
          whitespace();
        }
      }
      continue;
    } else {
      kind = classKind(node);
    }
    if (repeats && kind === 'any') {
      return hard('it repeats an any-character class, a scan');
    }
    if (repeats && kind === 'mixed') {
      return hard('it repeats a class that matches whitespace and token characters');
    }
    if (kind === 'ws' || kind === 'mixed') {
      whitespace();
      continue;
    }
    const fail = atom(kind === 'name', repeats);
    if (fail) {
      return fail;
    }
  }
  return { tokens, trivia, name, word, lead, trail, triviaThenToken };
}

function alternativesWidth(alternatives) {
  const best = { width: 0, tokens: 0, trivia: false, name: true, word: false, lead: false, trail: false, triviaThenToken: false };
  let firstSoft = null;
  for (const alternative of alternatives) {
    const r = alternativeWidth(alternative.elements);
    if (r.width === MANY) {
      if (r.hard) {
        return r;
      }
      firstSoft ??= r;
      continue;
    }
    best.tokens = Math.max(best.tokens, r.tokens);
    best.trivia ||= r.trivia;
    best.name &&= r.name;
    best.word ||= r.word;
    best.lead ||= r.lead;
    best.trail ||= r.trail;
    best.triviaThenToken ||= r.triviaThenToken;
  }
  if (firstSoft) {
    return firstSoft;
  }
  if (best.tokens > 1) {
    return soft('its pattern spans more than one token');
  }
  return { ...best, width: best.tokens };
}

/* Does anything but whitespace or an assertion match before `node` in the pattern? */
function consumesBefore(node) {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type !== 'Alternative') {
      continue;
    }
    for (const el of parent.elements.slice(0, parent.elements.indexOf(child))) {
      const inner = el.type === 'Quantifier' ? (el.max === 0 ? null : el.element) : el;
      if (!inner || inner.type === 'Assertion') {
        continue;
      }
      if (inner.type === 'Group' || inner.type === 'CapturingGroup') {
        const w = alternativesWidth(inner.alternatives);
        if (w.width !== 0) {
          return true;
        }
      } else if ((inner.type === 'Character' ? charKind(inner.value) : inner.type === 'CharacterSet' ? setKind(inner) : inner.type === 'Backreference' ? 'punct' : classKind(inner)) !== 'ws') {
        return true;
      }
    }
  }
  return false;
}

/* Every lookaround that reads past the token: it spans more than one token, or it follows a token and crosses whitespace to another. */
function wideLookarounds(node, out) {
  if (node.type === 'Assertion' && (node.kind === 'lookahead' || node.kind === 'lookbehind')) {
    const inner = alternativesWidth(node.alternatives);
    if (inner.width === MANY || (inner.triviaThenToken && consumesBefore(node))) {
      out.push(node.raw);
    }
  }
  for (const child of node.alternatives ?? node.elements ?? (node.element ? [node.element] : [])) {
    if (child.type !== 'CharacterClass') {
      wideLookarounds(child, out);
    }
  }
  return out;
}

/**
 * Width of a regex literal: `{ width, hard, why, trivia, word, at }` (`word`:
 * it can match a name character, so it is no bare punctuation), plus
 * `lookarounds`: every lookaround in it that reads past the token, which a
 * consuming `regex()` is reported for.
 */
export function regexWidth(literalText) {
  let pattern;
  try {
    pattern = parseRegexLiteral(canonicalComments(literalText)).pattern;
  } catch (error) {
    return { ...hard(`regex ${literalText} does not parse: ${error.message}`, literalText), lookarounds: [] };
  }
  const lookarounds = wideLookarounds(pattern, []);
  const result = alternativesWidth(pattern.alternatives);
  if (result.width === MANY) {
    return { width: MANY, hard: result.hard, why: `regex ${literalText}: ${result.why}`, at: literalText, lookarounds };
  }
  const base = result.width === 0 ? (result.trivia ? TRIVIA : ZERO) : { ...ONE, word: result.word };
  return { ...base, lookarounds };
}

/*
 * ------------------------------------------------------------------------
 * Combinator width over the TypeScript AST.
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

const isCombinatorShape = (ts, init) => ts.isCallExpression(init) || ts.isIdentifier(init) || ts.isPropertyAccessExpression(init);

const scriptKind = (ts, rel) => (/\.[cm]?tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.[cm]?jsx?$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/**
 * Every combinator-valued const and every PascalCase rule-map property in one
 * source file, by name. The base grammar's map (CSS plus `parser-shared`) is
 * passed to each dialect's scan so an inherited `g.Rule` resolves.
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
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(ts, rel)));
  return defs;
}

function calleeName(ts, call) {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

const collapse = text => text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
const clip = text => (text.length > 160 ? `${text.slice(0, 159)}…` : text);

/*
 * `token(x)` narrows a soft width only when x is provably ONE lexical token:
 * sigils, then at most one name or number, then at most a glued `(` or `%`
 * (`@media`, `:nth-child(`, `$name`, `10%`, `url(`). No whitespace, no second
 * word, no repetition, no scan.
 */
const SIGIL_CHARS = /^[@:$#.*!&%-]+$/;
const SUFFIXES = new Set(['(', '%']);
const MAX_SHAPES = 256;

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

function createWidth(ts, defs, baseDefs) {
  const active = new Set();
  const definitions = name => defs.get(name) ?? baseDefs.get(name);
  const textOf = node => collapse(node.getText());

  function resolve(name) {
    const inits = definitions(name);
    if (!inits) {
      return hard(`\`${name}\` is defined neither in this file nor in the base grammar, so it cannot be proven one token wide`, name);
    }
    let best = ZERO;
    for (const init of inits) {
      if (active.has(init)) {
        return hard(`\`${name}\` is recursive`, name);
      }
      active.add(init);
      const w = width(init);
      active.delete(init);
      if (w.width === MANY) {
        return { ...w, why: w.why.startsWith('`') ? w.why : `\`${name}\` — ${w.why}`, at: `${name} = ${w.at}` };
      }
      if (w.width > best.width || (w.width === best.width && w.trivia)) {
        best = w;
      }
    }
    return best;
  }

  function sequenceWidth(call, args) {
    let tokens = 0;
    let gap = false;
    for (const arg of args) {
      const w = width(arg);
      if (w.width === MANY) {
        return w;
      }
      if (w.trivia) {
        gap ||= tokens > 0;
        continue;
      }
      tokens += w.width;
    }
    if (tokens > 1) {
      return gap ? hard('a sequence of more than one token', textOf(call)) : soft('a sequence of more than one token', textOf(call));
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
      if (w.width > best.width || (w.width === best.width && w.trivia)) {
        best = w;
      }
    }
    return best;
  }

  function isCombinatorArgument(arg) {
    return !ts.isStringLiteralLike(arg) && !ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)
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

  const isFactoryProduct = name => definitions(name)?.some(init => ts.isCallExpression(init) && MATCHER_FACTORIES.has(calleeName(ts, init)));

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
      const inits = definitions(name);
      if (!inits) {
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
      return { problem: `\`${clip(textOf(node))}\`` };
    }
    const name = calleeName(ts, node);
    const args = [...node.arguments];
    if (name === 'literal') {
      const text = args[0] && ts.isStringLiteralLike(args[0]) ? args[0].text : undefined;
      if (text === undefined || /\s/.test(text)) {
        return { problem: 'whitespace' };
      }
      return [[/[-\w\u0080-￿]/.test(text) ? { kind: 'word' } : punctPiece(text)]];
    }
    if (name === 'keywords' || name === 'word' || (name && isFactoryProduct(name))) {
      return [[{ kind: 'word' }]];
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
    return { problem: `\`${clip(textOf(node))}\`` };
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
    return problem ? hard(`token() cannot make ${problem} one lexical token`, textOf(call)) : ONE;
  }

  function callWidth(call) {
    const name = calleeName(ts, call);
    const args = [...call.arguments];
    if (name === undefined) {
      return hard('it calls a computed combinator', textOf(call));
    }
    if (ZERO_WIDTH.has(name)) {
      return ZERO;
    }
    if (name === 'classifiedTrivia') {
      return TRIVIA;
    }
    if (ONE_TOKEN.has(name)) {
      return ONE;
    }
    if (name === 'regex') {
      const pattern = args[0];
      return pattern && ts.isRegularExpressionLiteral(pattern) ? regexWidth(pattern.text) : hard('regex() over a non-literal pattern', textOf(call));
    }
    if (name === 'sequence') {
      return sequenceWidth(call, args);
    }
    if (name === 'choice') {
      return widest(choiceArms(args));
    }
    if (name === 'token') {
      return tokenWidth(call, args);
    }
    if (TRANSPARENT.has(name)) {
      const inner = args.filter(isCombinatorArgument);
      return inner.length === 0 ? ONE : widest(inner);
    }
    if (REPEATS.has(name)) {
      return soft(`${name}() repeats`, textOf(call));
    }
    if (SCANS.has(name)) {
      return hard(`${name}() scans more than one token`, textOf(call));
    }
    return isFactoryProduct(name) ? ONE : hard(`\`${name}(...)\` is not a combinator this scan can prove one token wide`, textOf(call));
  }

  function width(node) {
    node = unwrap(ts, node);
    if (ts.isCallExpression(node)) {
      return callWidth(node);
    }
    if (ts.isIdentifier(node)) {
      return resolve(node.text);
    }
    if (ts.isPropertyAccessExpression(node)) {
      return resolve(node.name.text);
    }
    if (ts.isConditionalExpression(node)) {
      return widest([node.whenTrue, node.whenFalse]);
    }
    return hard(`\`${node.getText().slice(0, 40)}\` is not a combinator expression`, textOf(node));
  }

  return width;
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

/* A fingerprint of what a lookahead resolved to: a baselined `not(g.X)` fails again when X widens. */
const fingerprint = at => createHash('sha256').update(at).digest('hex').slice(0, 12);

const CODEGEN = new Set(['eval', 'Function']);

/* Combinators the scan reads by name: bound to anything else, their calls would escape it. */
const REBIND_WATCHED = new Set([...ZERO_WIDTH, 'attempt', 'regex', 'token']);
const PARSEMAN_MODULE = /^parseman(?:\/|$)/;

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
    || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isBindingElement(p)) && p.name === id) {
    return false;
  }
  if (ts.isBindingElement(p) && p.initializer !== id) {
    return false;
  }
  if (ts.isExportSpecifier(p) && p.parent.parent.moduleSpecifier) {
    return false;
  }
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) {
    return false;
  }
  return !ts.isLabeledStatement(p) && !ts.isBreakOrContinueStatement(p);
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

/* Is `id` a local variable or parameter (shadowing an import of the same name)? */
function declaredLocally(ts, id) {
  for (let n = id.parent; n && !ts.isSourceFile(n); n = n.parent) {
    if (ts.isFunctionLike(n) && n.parameters?.some(p => boundNames(ts, p.name).includes(id.text))) {
      return true;
    }
    if ((ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isForStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)
      && n.initializer.declarations.some(d => boundNames(ts, d.name).includes(id.text))) {
      return true;
    }
    const statements = n.statements ?? [];
    for (const st of statements) {
      if (ts.isVariableStatement(st) && st.declarationList.declarations.some(d => boundNames(ts, d.name).includes(id.text))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Scan one parser source file. Returns hits shaped
 * `{ rule, file, line, const, construct, why, resolved? }`; `construct` (the
 * whitespace-collapsed source text) and, for a lookahead, `resolved` (a
 * fingerprint of the definitions it resolved through) are the baseline key.
 */
export function scanGrammarSource(ts, rel, text, baseDefs = new Map()) {
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(ts, rel));
  const width = createWidth(ts, grammarDefinitions(ts, rel, text), baseDefs);
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
  const checkName = (node, name) => {
    if (DIALECT_PREFIX.test(name)) {
      hit('dialect-prefix', node, `rule name \`${name}\``);
    }
  };
  const isCombinatorCall = (n) => {
    const call = n && unwrap(ts, n);
    return call && ts.isCallExpression(call) && COMBINATORS.has(calleeName(ts, call));
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

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(ts, node);
      if (ZERO_WIDTH.has(name) && node.arguments.length > 0) {
        const w = width(node.arguments[0]);
        if (w.width === MANY) {
          hit('lookahead', node, w.why, { resolved: fingerprint(w.at ?? '') });
        }
      } else if (name === 'attempt') {
        hit('attempt', node, 'attempt() tries a parse and rolls it back on failure: backtracking');
      } else if (name === 'node' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        checkName(node.arguments[0], node.arguments[0].text);
      } else if (name === 'regex' && !insideLookahead(node)) {
        const pattern = node.arguments[0] && unwrap(ts, node.arguments[0]);
        if (!pattern || !ts.isRegularExpressionLiteral(pattern)) {
          hit('lookahead', node, 'regex() over a non-literal pattern cannot be read, so its lookarounds cannot be checked');
        } else {
          const { lookarounds } = regexWidth(pattern.text);
          if (lookarounds.length > 0) {
            hit('lookahead', node, `its lookaround \`${lookarounds[0]}\` reads past the token it consumes`);
          }
        }
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require') {
        importRule(node, 'a dynamic import or require()');
      }
    } else if (ts.isIdentifier(node) && CODEGEN.has(node.text) && isValueReference(ts, node)) {
      hit('runtime-codegen', node.parent, `\`${node.text}\` used at runtime`);
    } else if ((ts.isPropertyAccessExpression(node) && CODEGEN.has(node.name.text))
      || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && CODEGEN.has(node.argumentExpression.text))) {
      hit('runtime-codegen', node, 'a global code-generation function reached through an object');
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && PARSEMAN_MODULE.test(node.moduleSpecifier.text)
      && !(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(e => e.isTypeOnly || !COMBINATORS.has((e.propertyName ?? e.name).text)))) {
      importRule(node, 'a re-export of parseman, which hides the combinator names from the importing file');
    } else if (ts.isNamespaceImport(node)) {
      importRule(node.parent.parent, 'a namespace import');
    } else if (ts.isImportSpecifier(node) && node.propertyName && COMBINATORS.has(node.propertyName.text) && node.propertyName.text !== node.name.text) {
      importRule(node, `\`${node.propertyName.text}\` imported under another name`);
    } else if (ts.isBindingElement(node) && COMBINATORS.has((node.propertyName ?? node.name).getText(sourceFile))) {
      importRule(node, 'a combinator taken by destructuring');
    } else if (ts.isIdentifier(node) && REBIND_WATCHED.has(node.text) && isValueReference(ts, node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node) && !declaredLocally(ts, node)) {
      importRule(node.parent, `\`${node.text}\` passed or bound as a value, so its calls escape the scan`);
    }
    if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && ts.isIdentifier(node.name) && isCombinatorCall(node.initializer)) {
      checkName(node.name, node.name.text);
      if (ts.isVariableDeclaration(node) && /^[A-Z]/.test(node.name.text) && ts.getJSDocCommentsAndTags(node).length === 0) {
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
  for (const m of text.matchAll(/\b(?:import|require)\(\s*['"]([^'"]+)['"]/g)) {
    if (m[1] === 'parseman') {
      found.push(`dynamic ${m[1]}`);
    }
  }
  return found;
}

/*
 * ------------------------------------------------------------------------
 * Baseline.
 * ------------------------------------------------------------------------
 */

/** The identity of a baseline entry: rule, file, construct and, for a lookahead, what it resolved to. */
export const grammarBaselineKey = e => `${e.rule}\u0000${e.file}\u0000${e.construct}\u0000${e.resolved ?? ''}`;

/** A baseline file as flat entries: `entries`, plus `undocumentedRules` as `jsdoc` entries. */
export function grammarBaselineEntries(baseline) {
  const undocumented = Object.entries(baseline.undocumentedRules ?? {})
    .flatMap(([file, names]) => names.map(name => ({ rule: 'jsdoc', file, construct: name, issue: baseline.issue })));
  return [...(baseline.entries ?? []), ...undocumented];
}

/**
 * Baseline keys in `current` beyond those in `base`, counting repeats. The
 * baseline only shrinks: nothing may be added, whatever the scan says about it.
 */
export function addedBaselineEntries(base, current) {
  const remaining = new Map();
  for (const entry of grammarBaselineEntries(base)) {
    const k = grammarBaselineKey(entry);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  return grammarBaselineEntries(current).filter((entry) => {
    const k = grammarBaselineKey(entry);
    const left = remaining.get(k) ?? 0;
    remaining.set(k, left - 1);
    return left <= 0;
  });
}

/**
 * Ratchet hits against the baseline's `entries`. Matching is by
 * `grammarBaselineKey` — never by line, so editing above a site does not move
 * it, while widening what a baselined lookahead resolves to does.
 * Returns the hits with no entry (`fresh`) and the entries with no hit
 * (`stale`), plus `kept`: the surviving entries with their lines refreshed.
 */
export function compareGrammarBaseline(hits, entries) {
  const key = grammarBaselineKey;
  const open = new Map();
  for (const entry of entries) {
    const k = key(entry);
    if (!open.has(k)) {
      open.set(k, []);
    }
    open.get(k).push(entry);
  }
  const fresh = [];
  const kept = [];
  for (const hit of hits) {
    const match = open.get(key(hit))?.shift();
    if (match) {
      kept.push({ ...match, line: hit.line });
    } else {
      fresh.push(hit);
    }
  }
  const stale = [...open.values()].flat();
  return { fresh, stale, kept };
}
