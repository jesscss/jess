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
 *   dialect-prefix  A rule name carries no dialect prefix (`css…`, `less…`,
 *                   `scss…`, `jess…`) and no `Ast`/`Cst`. Exported whole
 *                   grammars (`rules`/`compose`/`composeLeaf` results) are not
 *                   rule names.
 *   runtime-codegen Parser packages never build code at runtime (`new
 *                   Function`, `Function(…)`, `eval(…)`). Codegen belongs to
 *                   parseman's build-time `compile()`.
 *   attempt         `attempt(...)` tries a parse and rolls it back on failure:
 *                   backtracking. Orchestrator ruling 2026-11-04: it counts
 *                   against the owner's zero-backtracking rule, so it is a
 *                   missing parseman capability, like a pre-scan.
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
 * so it narrows a SOFT width (adjacent pieces, repetition) to one. It cannot
 * narrow a HARD one: whitespace between tokens, a scan, or a lookaround past the
 * token are never one token, whatever wraps them.
 */

export const MANY = 2;

/* "Never create a `productions.ts`. Upgrade `productions/*.ts` in place." (GRAMMAR-REVIEW-STANDARD §3) */
export const PRODUCTIONS_FILE = /^packages\/(?:.*\/)?productions\.ts$/;

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
  'runtime-codegen': [
    '  Parser packages never build code at runtime (`new Function`, `Function(...)`,',
    '  `eval(...)`). Code generation belongs to parseman\'s build-time `compile()`; a',
    '  grammar that needs it at runtime is a missing parseman capability.'
  ]
};

const ONE = { width: 1, why: '' };
const ZERO = { width: 0, why: '' };
const TRIVIA = { width: 0, why: '', trivia: true };
const soft = why => ({ width: MANY, why, hard: false });
const hard = why => ({ width: MANY, why, hard: true });

/*
 * ------------------------------------------------------------------------
 * Regex width — a small recursive reader over the pattern source. It counts
 * TOKENS; it never decides what the pattern matches.
 *
 *   - Atoms (a character, an escape, a class, a group) glue into one token.
 *   - Whitespace (`[ \t\n\r\f]`, `\s`, a space) and a comment alternative
 *     (`\/\*…`, `\/\/…`) are trivia: they end the token, and a token after them
 *     is another token (HARD).
 *   - A repeated atom followed by a non-name atom at the same nesting level
 *     (`[-\w]+:`, `[\w]*\$\{`) starts another token (SOFT: `token()` may declare
 *     it one).
 *   - A lookaround checks one boundary (`(?![-\w])`) or, before any atom,
 *     leading trivia and one token; anything else looks past the token (HARD).
 *   - A repeated any-character class (`[^;]*`, `.+`, `[\s\S]*`) is a scan (HARD).
 * ------------------------------------------------------------------------
 */

const WHITESPACE_ESCAPE = new Set(['t', 'n', 'r', 'f', 'v', 's']);
const COMMENT_ALTERNATIVE = /^\\\/(?:\\\*|\\\/|\[[^\]]*\])/;
const NAME_CLASS_MEMBERS = /^(?:[-\w]|\\[wdux\\]|\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2})*$/;

function readClass(src, i) {
  let j = i + 1;
  const negated = src[j] === '^';
  let inverse = false;
  let members = '';
  while (j < src.length && src[j] !== ']') {
    if (src[j] === '\\') {
      inverse ||= 'DWS'.includes(src[j + 1]);
      members += WHITESPACE_ESCAPE.has(src[j + 1]) ? ' ' : src.slice(j, j + 2);
      j += 2;
    } else {
      members += src[j];
      j++;
    }
  }
  const end = j + 1;
  if (negated || inverse) {
    return { end, atom: 'any' };
  }
  if (members.trim() === '') {
    return { end, atom: 'ws' };
  }
  return { end, atom: 'set', name: NAME_CLASS_MEMBERS.test(members) };
}

function readEscape(src, i) {
  const e = src[i + 1];
  let end = i + 2;
  if (e === 'u') {
    end = src[end] === '{' ? src.indexOf('}', end) + 1 : end + 4;
  } else if (e === 'x') {
    end += 2;
  } else if (e === 'c') {
    end += 1;
  } else if ((e === 'p' || e === 'P') && src[end] === '{') {
    end = src.indexOf('}', end) + 1;
  }
  if ('bB'.includes(e)) {
    return { end, atom: 'zero' };
  }
  if (WHITESPACE_ESCAPE.has(e)) {
    return { end, atom: 'ws' };
  }
  if ('DWS'.includes(e) || e === 'P') {
    return { end, atom: 'any' };
  }
  return { end, atom: 'set', name: 'wdu'.includes(e) || e === 'p' };
}

function readQuantifier(src, i) {
  const c = src[i];
  let end = i;
  let repeats = false;
  if (c === '*' || c === '+') {
    end = i + 1;
    repeats = true;
  } else if (c === '?') {
    end = i + 1;
  } else if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
    if (m) {
      end = i + m[0].length;
      repeats = m[2] !== undefined ? m[3] === '' || Number(m[3]) > 1 : Number(m[1]) > 1;
    }
  }
  if (end > i && src[end] === '?') {
    end++;
  }
  return { end, repeats };
}

/* Index of the next `|` or `)` at this nesting depth. */
function skipAlternative(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') {
      i = readClass(src, i).end;
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if (c === '|' && depth === 0) {
      return i;
    }
    i++;
  }
  return i;
}

function readGroup(src, i, afterToken) {
  const lookaround = /^\(\?<?[=!]/.exec(src.slice(i));
  const prefix = lookaround ? lookaround[0] : (/^\(\?(?::|<[^>]+>)/.exec(src.slice(i))?.[0] ?? '(');
  const inner = readAlternatives(src, i + prefix.length);
  const text = src.slice(i, inner.end + 1);
  if (lookaround && (inner.width === MANY || (inner.trivia && afterToken && inner.width > 0))) {
    return { ...hard(`its lookaround \`${text}\` reads past the token`), end: inner.end };
  }
  if (inner.width === MANY) {
    return inner;
  }
  if (lookaround) {
    return { end: inner.end + 1, atom: 'zero' };
  }
  if (inner.width === 0) {
    return { end: inner.end + 1, atom: inner.trivia ? 'ws' : 'zero' };
  }
  return { end: inner.end + 1, atom: 'set', name: inner.name };
}

function readAtom(src, i, afterToken) {
  const c = src[i];
  if (c === '\\') {
    return readEscape(src, i);
  }
  if (c === '[') {
    return readClass(src, i);
  }
  if (c === '.') {
    return { end: i + 1, atom: 'any' };
  }
  if (c === '^' || c === '$') {
    return { end: i + 1, atom: 'zero' };
  }
  if (c === '(') {
    return readGroup(src, i, afterToken);
  }
  return { end: i + 1, atom: c === ' ' ? 'ws' : 'set', name: /[-\w]/.test(c) };
}

/* Reads alternatives up to an unmatched `)` or the end; returns the widest. */
function readAlternatives(src, start) {
  let i = start;
  let best = { width: 0, trivia: false, name: true };
  let tokens = 0;
  let gap = false;
  let inToken = false;
  let lastRepeated = false;
  let name = true;
  const close = () => {
    if (tokens > best.width) {
      best = { ...best, width: tokens };
    }
    best.name &&= name;
  };
  while (i < src.length && src[i] !== ')') {
    if (src[i] === '|' || i === start) {
      if (src[i] === '|') {
        close();
        tokens = 0;
        gap = false;
        inToken = false;
        lastRepeated = false;
        name = true;
        i++;
      }
      if (COMMENT_ALTERNATIVE.test(src.slice(i))) {
        best.trivia = true;
        i = skipAlternative(src, i);
        continue;
      }
      if (i >= src.length || src[i] === ')' || src[i] === '|') {
        continue;
      }
    }
    const read = readAtom(src, i, tokens > 0);
    if (read.width === MANY) {
      return read;
    }
    const q = readQuantifier(src, read.end);
    i = q.end;
    if (read.atom === 'zero') {
      continue;
    }
    if (read.atom === 'ws') {
      best.trivia = true;
      gap ||= tokens > 0;
      inToken = false;
      continue;
    }
    if (q.repeats && read.atom === 'any') {
      return { ...hard('it repeats an any-character class, a scan'), end: i };
    }
    const nameAtom = read.name === true;
    if (!inToken) {
      tokens++;
      if (tokens > 1 && gap) {
        return { ...hard('its pattern spans more than one token'), end: i };
      }
    } else if (lastRepeated && !nameAtom) {
      tokens++;
    }
    inToken = true;
    name &&= nameAtom;
    lastRepeated = q.repeats;
  }
  close();
  if (best.width > 1) {
    return { ...soft('its pattern spans more than one token'), end: i };
  }
  return { ...best, end: i };
}

export function regexWidth(literalText) {
  const body = literalText.slice(1, literalText.lastIndexOf('/'));
  const result = readAlternatives(body, 0);
  if (result.width === MANY) {
    return { width: MANY, hard: result.hard, why: `regex ${literalText}: ${result.why}` };
  }
  return result.width === 0 ? (result.trivia ? TRIVIA : ZERO) : ONE;
}

/*
 * ------------------------------------------------------------------------
 * Combinator width over the TypeScript AST.
 * ------------------------------------------------------------------------
 */

const isCombinatorShape = (ts, init) => ts.isCallExpression(init) || ts.isIdentifier(init) || ts.isPropertyAccessExpression(init);

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
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isCombinatorShape(ts, node.initializer)) {
      add(node.name.text, node.initializer);
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text)) {
      add(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return defs;
}

function calleeName(ts, call) {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

function createWidth(ts, defs, baseDefs) {
  const active = new Set();

  function resolve(name) {
    const inits = defs.get(name) ?? baseDefs.get(name);
    if (!inits) {
      return hard(`\`${name}\` is defined neither in this file nor in the base grammar, so it cannot be proven one token wide`);
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
      if (w.width > best.width || (w.width === best.width && w.trivia)) {
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

  function callWidth(call) {
    const name = calleeName(ts, call);
    const args = [...call.arguments];
    if (name === undefined) {
      return hard('it calls a computed combinator');
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
      return pattern && ts.isRegularExpressionLiteral(pattern) ? regexWidth(pattern.text) : hard('regex() over a non-literal pattern');
    }
    if (name === 'sequence') {
      return sequenceWidth(args);
    }
    if (name === 'choice') {
      return widest(choiceArms(args));
    }
    if (name === 'token') {
      const w = widest(args.filter(isCombinatorArgument));
      return w.width === MANY && w.hard ? w : w.width === 0 ? ZERO : ONE;
    }
    if (TRANSPARENT.has(name)) {
      const inner = args.filter(isCombinatorArgument);
      return inner.length === 0 ? ONE : widest(inner);
    }
    if (REPEATS.has(name)) {
      return soft(`${name}() repeats`);
    }
    if (SCANS.has(name)) {
      return hard(`${name}() scans more than one token`);
    }
    const factory = (defs.get(name) ?? baseDefs.get(name))?.find(init => ts.isCallExpression(init) && MATCHER_FACTORIES.has(calleeName(ts, init)));
    return factory ? ONE : hard(`\`${name}(...)\` is not a combinator this scan can prove one token wide`);
  }

  function width(node) {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
      return width(node.expression);
    }
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
    return hard(`\`${node.getText().slice(0, 40)}\` is not a combinator expression`);
  }

  return width;
}

/* Name of the const or rule-map property the node sits in. */
function ownerName(ts, node) {
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && ts.isIdentifier(n.name)) {
      return n.name.text;
    }
  }
  return '(module)';
}

const collapse = text => text.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
const clip = text => (text.length > 160 ? `${text.slice(0, 159)}…` : text);

/**
 * Scan one parser source file. Returns hits shaped
 * `{ rule, file, line, const, construct, why }`; `construct` is the
 * whitespace-collapsed source text and is the baseline key.
 */
export function scanGrammarSource(ts, rel, text, baseDefs = new Map()) {
  const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const width = createWidth(ts, grammarDefinitions(ts, rel, text), baseDefs);
  const hits = [];
  const lineOf = node => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const hit = (rule, node, why) => hits.push({
    rule,
    file: rel,
    line: lineOf(node),
    const: ownerName(ts, node),
    construct: clip(collapse(node.getText(sourceFile))),
    why
  });
  const checkName = (node, name) => {
    if (DIALECT_PREFIX.test(name)) {
      hit('dialect-prefix', node, `rule name \`${name}\``);
    }
  };
  const isCombinatorCall = n => n && ts.isCallExpression(n) && COMBINATORS.has(calleeName(ts, n));

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(ts, node);
      if (ZERO_WIDTH.has(name) && node.arguments.length > 0) {
        const w = width(node.arguments[0]);
        if (w.width === MANY) {
          hit('lookahead', node, w.why);
        }
      } else if (name === 'attempt') {
        hit('attempt', node, 'attempt() tries a parse and rolls it back on failure: backtracking');
      } else if (name === 'node' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        checkName(node.arguments[0], node.arguments[0].text);
      } else if (name === 'eval' || name === 'Function') {
        hit('runtime-codegen', node, `${name}(...) at runtime`);
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      hit('runtime-codegen', node, 'new Function(...) at runtime');
    } else if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && ts.isIdentifier(node.name) && isCombinatorCall(node.initializer)) {
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
 * Ratchet hits against the baseline's `entries`. Matching is by rule, file and
 * construct text — never by line, so editing above a site does not move it.
 * Returns the hits with no entry (`fresh`) and the entries with no hit
 * (`stale`), plus `kept`: the surviving entries with their lines refreshed.
 */
export function compareGrammarBaseline(hits, entries) {
  const key = e => `${e.rule}\u0000${e.file}\u0000${e.construct}`;
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
