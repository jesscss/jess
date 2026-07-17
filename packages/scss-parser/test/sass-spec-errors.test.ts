/**
 * sass-spec NEGATIVE suite (parse-time errors).
 *
 * The sibling `sass-spec.smoke.test.ts` computes `isErrorFixture` and then
 * FILTERS error fixtures OUT — it only asserts that VALID fixtures parse clean.
 * This suite INVERTS that exclusion: for sass-spec fixtures that declare an
 * expected error (an `error` sibling section next to `input.scss`), we assert
 * that the parser reports at least one parse error.
 *
 * Scope discipline (important):
 *  - sass-spec `error` fixtures mix PARSE-time errors (grammar/lexer) with
 *    EVAL-time / SassScript runtime errors (undefined variable, bad units,
 *    argument validation, `@extend` outside a rule, …). A parser CANNOT and
 *    SHOULD NOT catch eval-time errors, so we classify each fixture from its
 *    dart-sass `error` message and assert ONLY the parse-time subset.
 *  - The parse-time subset is tracked as a frozen baseline. Fixtures the parser
 *    already rejects are the GREEN set (a regression guard); fixtures it misses
 *    today are the XFAIL set below (tracked false negatives). Both directions
 *    are enforced by one symmetric-diff assertion, so the suite stays green now
 *    while surfacing (a) any regression and (b) any newly-fixed fixture that
 *    should be promoted out of XFAIL.
 *
 * TEST-ONLY. Do not relax the parser to make this pass — fix the grammar and
 * then delete the corresponding XFAIL entries.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Parser } from '../src/jess.js';

const parser = new Parser();

/** True iff parsing `src` yields at least one lexer or parser error. */
function hasParseError(src: string): boolean {
  try {
    const r = parser.parse(src, 'Stylesheet');
    return r.lexerResult.errors.length > 0 || r.errors.length > 0;
  } catch {
    // A thrown parse is still a rejection of the input.
    return true;
  }
}

// ---------------------------------------------------------------------------
// HRX corpus loading (mirrors sass-spec.smoke.test.ts::parseHrx).
// ---------------------------------------------------------------------------
type Section = { sectionPath: string; contents: string };

function parseHrx(text: string): Section[] {
  const out: Section[] = [];
  const lines = text.split(/\r?\n/);
  let cur: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    if (cur) {
      out.push({ sectionPath: cur, contents: buf.join('\n') });
    }
  };
  for (const line of lines) {
    const start = /^<===>\s+(.+?)\s*$/.exec(line);
    const end = /^<===>\s*$/.test(line) || /^<===+>\s*$/.test(line);
    if (start) {
      flush();
      cur = start[1];
      buf = [];
    } else if (end) {
      flush();
      cur = undefined;
      buf = [];
    } else if (/^=+$/.test(line)) {
      // section separator
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parse-vs-eval classifier. Applied to the dart-sass `error` message.
// dart-sass SassFormatException (parse) messages use lowercase "expected",
// "unexpected", "Invalid CSS", unterminated/unclosed tokens, etc. Eval-time
// SassScriptException messages capitalize "Expected" and carry a "$name:"
// argument prefix, or describe values/units/scope.
// ---------------------------------------------------------------------------
function firstErrorLine(err: string): string {
  return err.split('\n').find(l => /^Error:/.test(l)) ?? err.split('\n')[0] ?? '';
}

const PARSE_SIGNALS: RegExp[] = [
  /^Error: expected /,
  /^Error: Expected (?:expression|identifier|selector|string|end of file|more input)/,
  /Invalid CSS after/,
  /^Error: unexpected /,
  /unterminated|unclosed/i,
  /^Error: Unterminated|^Error: Unclosed/,
  /^Error: Expected .* selector/,
  /^Error: Nothing may be indented/,
  /may not be nested/,
  /^Error: Invalid escape sequence/,
  /^Error: Invalid Unicode|Invalid UTF-8/,
  /^Error: Semicolons aren't allowed/,
  /can't have a namespace/
];

const EVAL_SIGNALS: RegExp[] = [
  /^\$[\w-]+:/,
  /undefined variable/i,
  /undefined mixin/i,
  /undefined function/i,
  /incompatible units/i,
  / is not a /i,
  / must be /i,
  /no mixin named/i,
  /not found/i,
  /can't find/i,
  /[Dd]ivision/i,
  /out of (range|bounds)/i,
  /takes \d|argument/i,
  /^Error: -?[\d.]/,
  /may only be used within/i,
  /can't be used as a parent/i,
  /can't be used in a calculation/i,
  /both define/i,
  /Duplicate key/i,
  /forbidden in plain CSS/i,
  /isn't a valid CSS value/i,
  /must be followed by/i,
  /^Error: This/
];

type Klass = 'parse' | 'eval' | 'unknown';
function classify(err: string): Klass {
  const first = firstErrorLine(err);
  const parse = PARSE_SIGNALS.some(r => r.test(first));
  const evals = EVAL_SIGNALS.some(r => r.test(first));
  if (parse && !evals) {
    return 'parse';
  }
  if (evals && !parse) {
    return 'eval';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Build the error-fixture corpus.
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
const specRoot = (() => {
  try {
    const dir = path.dirname(require.resolve('sass-spec/package.json'));
    const root = path.join(dir, 'spec');
    return fs.existsSync(root) && fs.statSync(root).isDirectory() ? root : undefined;
  } catch {
    return undefined;
  }
})();

type ErrorCase = { id: string; input: string; error: string; klass: Klass };

function loadErrorCases(root: string): ErrorCase[] {
  const cases: ErrorCase[] = [];
  for (const hrx of walk(root).filter(p => p.endsWith('.hrx'))) {
    const hrxRel = path.relative(root, hrx).replace(/\\/g, '/');
    const sections = parseHrx(fs.readFileSync(hrx, 'utf8'));
    const byDir = new Map<string, Record<string, string>>();
    for (const s of sections) {
      const dir = path.dirname(s.sectionPath);
      const base = path.basename(s.sectionPath);
      if (!byDir.has(dir)) {
        byDir.set(dir, {});
      }
      byDir.get(dir)![base] = s.contents;
    }
    for (const [dir, files] of byDir) {
      if (files['input.scss'] !== undefined && files['error'] !== undefined) {
        cases.push({
          id: `${hrxRel}::${dir}`,
          input: files['input.scss'],
          error: files['error'],
          klass: classify(files['error'])
        });
      }
    }
  }
  return cases;
}

/**
 * Frozen baseline: parse-time sass-spec error fixtures the parser currently
 * MISSES (declares an expected parse error, but `parseScss(input)` returns
 * zero errors). Every entry is a tracked false negative to be fixed in the
 * grammar/lexer (Phase 2). When a fixture starts erroring, the baseline test
 * fails with a "promote" message — remove it from this list at that point.
 * Regenerate cross-check: 189 entries at branch work/parser-error-hardening.
 */
const XFAIL_PARSE_MISSES: readonly string[] = [
  'callable/parameters.hrx::function/error/splat/before_final',
  'callable/parameters.hrx::mixin/error/splat/before_final',
  'core_functions/color/is_in_gamut.hrx::error/invalid_character_end',
  'core_functions/color/mix/error.hrx::extra_character_end',
  'core_functions/color/mix/error.hrx::extra_character_start',
  'core_functions/meta/load_css/error/from_other.hrx::syntax',
  'core_functions/selector/append.hrx::error/invalid',
  'core_functions/selector/nest/error.hrx::invalid/initial',
  'core_functions/selector/nest/error.hrx::invalid/later',
  'css/comment.hrx::error/loud/interpolation/unterminated',
  'css/comment.hrx::error/loud/unterminated/scss',
  'css/escape.hrx::error/syntax/too_high',
  'css/functions/error.hrx::single_equals/no_lhs',
  'css/functions/error.hrx::single_equals/no_lhs_or_rhs',
  'css/functions/error.hrx::single_equals/no_rhs',
  'css/functions/var.hrx::error/invalid_second_arg_syntax',
  'css/media/logic/error.hrx::and_after/or',
  'css/media/logic/error.hrx::and_after/type_and_not',
  'css/media/logic/error.hrx::nothing_after/and/after_interpolation',
  'css/media/logic/error.hrx::nothing_after/and/after_paren',
  'css/media/logic/error.hrx::nothing_after/and/after_type',
  'css/media/logic/error.hrx::nothing_after/and_not',
  'css/media/logic/error.hrx::nothing_after/not',
  'css/media/logic/error.hrx::nothing_after/or',
  'css/media/logic/error.hrx::or_after/and',
  'css/media/logic/error.hrx::or_after/interpolation',
  'css/media/logic/error.hrx::or_after/type',
  'css/media/logic/error.hrx::or_after/type_and_not',
  'css/media/logic/error.hrx::or_after/type_then_and',
  'css/media/range/error.hrx::invalid_binary_operator/before_colon',
  'css/media/range/error.hrx::invalid_binary_operator/eq',
  'css/media/range/error.hrx::invalid_binary_operator/gt',
  'css/media/range/error.hrx::invalid_binary_operator/gte',
  'css/media/range/error.hrx::invalid_binary_operator/in_subexpression',
  'css/media/range/error.hrx::invalid_binary_operator/lt',
  'css/media/range/error.hrx::invalid_binary_operator/lte',
  'css/media/range/error.hrx::invalid_comparison/gte',
  'css/media/range/error.hrx::invalid_comparison/lte',
  'css/media/range/error.hrx::invalid_comparison/range_gte',
  'css/media/range/error.hrx::mismatched_range/gt_lt',
  'css/media/range/error.hrx::mismatched_range/gte_lte',
  'css/media/range/error.hrx::mismatched_range/lt_gt',
  'css/media/range/error.hrx::mismatched_range/lte_gte',
  'css/plain/error/expression/calculation.hrx::line_noise',
  'css/plain/error/expression/function.hrx::variable_arguments',
  'css/plain/error/expression/list.hrx::empty',
  'css/plain/error/expression/list.hrx::empty_comma',
  'css/plain/error/expression/map.hrx::.',
  'css/plain/error/media.hrx::logic/and_after/or',
  'css/plain/error/media.hrx::logic/and_after/type_and_not',
  'css/plain/error/media.hrx::logic/nothing_after/and/after_paren',
  'css/plain/error/media.hrx::logic/nothing_after/and/after_type',
  'css/plain/error/media.hrx::logic/nothing_after/and_not',
  'css/plain/error/media.hrx::logic/nothing_after/not',
  'css/plain/error/media.hrx::logic/nothing_after/or',
  'css/plain/error/media.hrx::logic/or_after/and',
  'css/plain/error/media.hrx::logic/or_after/type',
  'css/plain/error/media.hrx::logic/or_after/type_and_not',
  'css/plain/error/media.hrx::logic/or_after/type_then_and',
  'css/plain/error/statement/at_rule.hrx::import/multi',
  'css/plain/error/statement/style_rule.hrx::trailing_combinator/nesting',
  'css/plain/error/statement/style_rule.hrx::trailing_combinator/no_nesting',
  'css/plain/functions.hrx::error/empty_fallback_var/empty_second_before_third',
  'css/plain/functions.hrx::error/empty_fallback_var/invalid_second_arg_syntax',
  'css/plain/import/conditions.hrx::error/wrong_order/url_after_comma',
  'css/supports/error.hrx::syntax/anything/colon',
  'css/supports/error.hrx::syntax/anything/non_identifier_start',
  'css/supports/error.hrx::syntax/declaration/multiple',
  'css/supports/error.hrx::syntax/function/not',
  'css/supports/error.hrx::syntax/none',
  'css/supports/error.hrx::syntax/operator/and_after_not',
  'css/supports/error.hrx::syntax/operator/lonely_not',
  'css/supports/error.hrx::syntax/operator/trailing_and',
  'css/supports/error.hrx::syntax/operator/trailing_or',
  'css/unicode_range/error.hrx::question_mark_after_minus',
  'directives/extend/error.hrx::no_selector',
  'directives/forward/error/syntax.hrx::as/asterisk',
  'directives/forward/error/syntax.hrx::as/no_star',
  'directives/forward/error/syntax.hrx::as/nothing',
  'directives/forward/error/syntax.hrx::empty',
  'directives/forward/error/syntax.hrx::url/unquoted',
  'directives/forward/error/syntax.hrx::with/empty',
  'directives/forward/error/syntax.hrx::with/no_arguments',
  'directives/if/error/syntax.hrx::else/partial_if',
  'directives/import/error/top_level_declaration.hrx::root',
  'directives/use/error/syntax/empty.hrx::.',
  'directives/use/error/syntax/member.hrx::function/definition',
  'directives/use/error/syntax/member.hrx::function/no_member',
  'directives/use/error/syntax/member.hrx::identifier_only',
  'directives/use/error/syntax/member.hrx::mixin/definition',
  'directives/use/error/syntax/member.hrx::variable/no_member',
  'directives/use/error/syntax/member.hrx::variable/no_namespace',
  'directives/use/error/syntax/url.hrx::unquoted',
  'directives/use/error/syntax/with.hrx::default',
  'directives/use/error/syntax/with.hrx::empty',
  'directives/use/error/syntax/within.hrx::function',
  'expressions/if/error/and.hrx::else',
  'expressions/if/error/and.hrx::empty',
  'expressions/if/error/and.hrx::not',
  'expressions/if/error/and.hrx::or',
  'expressions/if/error/not.hrx::and',
  'expressions/if/error/not.hrx::else',
  'expressions/if/error/not.hrx::empty',
  'expressions/if/error/not.hrx::not',
  'expressions/if/error/not.hrx::or',
  'expressions/if/error/or.hrx::and',
  'expressions/if/error/or.hrx::else',
  'expressions/if/error/or.hrx::empty',
  'expressions/if/error/or.hrx::not',
  'expressions/if/error/paren.hrx::else',
  'expressions/if/error/paren.hrx::empty',
  'expressions/if/error/raw.hrx::and/else',
  'expressions/if/error/raw.hrx::and/not',
  'expressions/if/error/raw.hrx::and/or',
  'expressions/if/error/raw.hrx::not/else',
  'expressions/if/error/raw.hrx::not/not',
  'expressions/if/error/raw.hrx::not/operator',
  'expressions/if/error/raw.hrx::or/and',
  'expressions/if/error/raw.hrx::or/else',
  'expressions/if/error/raw.hrx::or/not',
  'expressions/if/error/raw.hrx::paren/clause',
  'expressions/if/error/raw.hrx::paren/not',
  'expressions/if/error/raw.hrx::paren/operator',
  'expressions/if/error/semicolon.hrx::comma',
  'expressions/if/error/semicolon.hrx::multiple/end',
  'expressions/if/error/semicolon.hrx::multiple/middle',
  'libsass-closed-issues/issue_1093/property.hrx::.',
  'libsass-closed-issues/issue_2023/id-selector-id.hrx::.',
  'libsass-closed-issues/issue_2023/id-selector-nr.hrx::.',
  'libsass-closed-issues/issue_2023/pseudo-selector-id.hrx::.',
  'libsass-closed-issues/issue_2023/pseudo-selector-nr.hrx::.',
  'libsass-closed-issues/issue_2155.hrx::.',
  'libsass-closed-issues/issue_945.hrx::.',
  'libsass-todo-issues/issue_2016.hrx::.',
  'libsass-todo-issues/issue_2023/class-selector-id.hrx::.',
  'libsass-todo-issues/issue_2023/class-selector-nr.hrx::.',
  'libsass-todo-issues/issue_2023/type-selector-id.hrx::.',
  'libsass-todo-issues/issue_2023/type-selector-nr.hrx::.',
  'libsass-todo-issues/issue_2295/error/basic.hrx::.',
  'libsass-todo-issues/issue_2295/error/wrapped.hrx::.',
  'libsass-todo-issues/issue_238764.hrx::.',
  'libsass/base-level-parent/imported/at-root-alone-itpl.hrx::.',
  'libsass/base-level-parent/imported/basic-alone-itpl.hrx::.',
  'libsass/properties-in-media.hrx::.',
  'non_conformant/errors/fn-varargs/at-start.hrx::.',
  'non_conformant/errors/fn-varargs/multiple.hrx::.',
  'non_conformant/mixin/content/arguments/error/syntax.hrx::arglist/missing',
  'non_conformant/mixin/content/arguments/error/syntax.hrx::missing_block',
  'non_conformant/parser/arglists/can-end-with-comma/error-function-1.hrx::.',
  'non_conformant/parser/arglists/can-end-with-comma/error-function-2.hrx::.',
  'non_conformant/parser/arglists/can-end-with-comma/error-include-1.hrx::.',
  'non_conformant/parser/arglists/can-end-with-comma/error-include-2.hrx::.',
  'non_conformant/parser/arglists/can-end-with-comma/error-mixin-1.hrx::.',
  'non_conformant/parser/arglists/can-end-with-comma/error-mixin-2.hrx::.',
  'non_conformant/parser/interpolate/44_selector/todo_single_escape/11_escaped_interpolated_value.hrx::.',
  'non_conformant/parser/interpolate/44_selector/todo_single_escape/21_escaped_interpolated_variable.hrx::.',
  'non_conformant/parser/interpolate/44_selector/todo_single_escape/31_escaped_literal.hrx::.',
  'non_conformant/parser/malformed_expressions/at-debug/no-argument.hrx::.',
  'non_conformant/parser/malformed_expressions/at-error/no-argument.hrx::.',
  'non_conformant/parser/malformed_expressions/at-warn/no-argument.hrx::.',
  'non_conformant/scss/while_without_condition.hrx::.',
  'values/calculation/abs.hrx::error/syntax/invalid_arg',
  'values/calculation/acos.hrx::error/syntax/invalid_arg',
  'values/calculation/asin.hrx::error/syntax/invalid_arg',
  'values/calculation/atan2.hrx::error/syntax/invalid_arg',
  'values/calculation/calc-size.hrx::error/syntax/invalid_arg',
  'values/calculation/calc/error/syntax.hrx::dollar',
  'values/calculation/calc/error/syntax.hrx::hash',
  'values/calculation/calc/error/syntax.hrx::interpolation/in_function_arg',
  'values/calculation/clamp.hrx::error/syntax/invalid_arg',
  'values/calculation/cos.hrx::error/syntax/invalid_arg',
  'values/calculation/exp.hrx::error/syntax/invalid_arg',
  'values/calculation/hypot.hrx::error/syntax/invalid_arg',
  'values/calculation/log.hrx::error/syntax/invalid_arg',
  'values/calculation/max.hrx::error/syntax/invalid_arg',
  'values/calculation/min.hrx::error/syntax/invalid_arg',
  'values/calculation/mod.hrx::error/syntax/invalid_arg',
  'values/calculation/pow.hrx::error/syntax/invalid_arg',
  'values/calculation/rem.hrx::error/syntax/invalid_arg',
  'values/calculation/round/error.hrx::one_argument/syntax/invalid_arg',
  'values/calculation/sign.hrx::error/syntax/invalid_arg',
  'values/calculation/sin.hrx::error/syntax/invalid_arg',
  'values/calculation/sqrt.hrx::error/syntax/invalid_arg',
  'values/calculation/tan.hrx::error/syntax/invalid_arg',
  'values/maps/invalid-key.hrx::.'
];

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------
const describeCorpus = specRoot ? describe : describe.skip;

describeCorpus('sass-spec negative: parse-time error fixtures', () => {
  const cases = loadErrorCases(specRoot!);
  const parseCases = cases.filter(c => c.klass === 'parse');

  it('has a parse-time error corpus', () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(parseCases.length).toBeGreaterThan(0);
  });

  it('reports the parse/eval/unknown split (informational)', () => {
    const by = { parse: 0, eval: 0, unknown: 0 };
    for (const c of cases) {
      by[c.klass]++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[sass-spec-errors] error fixtures: ${cases.length} total — ` +
        `parse ${by.parse} (asserted), eval ${by.eval} (excluded, runtime), ` +
        `unknown ${by.unknown} (excluded, unclassified)`
    );
  });

  /**
   * Single frozen-baseline assertion. Recomputes which parse-time fixtures the
   * parser currently MISSES and compares to XFAIL_PARSE_MISSES. Any difference
   * is actionable:
   *  - REGRESSED: a fixture that used to error now parses clean (parser broke).
   *  - FIXED: an XFAIL fixture now errors — promote it (remove from XFAIL).
   * Green today by construction; flips red on any parser behavior change.
   */
  it('parse-time error baseline holds (regression + fix tracking)', () => {
    const missing = parseCases.filter(c => !hasParseError(c.input)).map(c => c.id).sort();
    const baseline = new Set(XFAIL_PARSE_MISSES);
    const current = new Set(missing);

    const regressed = missing.filter(id => !baseline.has(id));
    const fixed = [...baseline].filter(id => !current.has(id)).sort();

    expect(
      regressed,
      `REGRESSION: these parse-time fixtures used to error but now parse clean:\n${regressed.join('\n')}`
    ).toEqual([]);
    expect(
      fixed,
      `FIXED: these XFAIL fixtures now error — remove them from XFAIL_PARSE_MISSES:\n${fixed.join('\n')}`
    ).toEqual([]);

    // Floor: the GREEN set (parse-time fixtures already rejected) is non-empty.
    const green = parseCases.length - missing.length;
    expect(green).toBeGreaterThan(0);
  });

  it('every XFAIL id resolves to a real corpus fixture (no stale entries)', () => {
    const ids = new Set(parseCases.map(c => c.id));
    const stale = XFAIL_PARSE_MISSES.filter(id => !ids.has(id));
    expect(stale, `stale XFAIL ids not found in corpus:\n${stale.join('\n')}`).toEqual([]);
  });

  it('reports the directives-cluster coverage (informational)', () => {
    const rx = /directives\/(if|each|for|while|mixin|function|content|include|extend|forward|use|import|at[-_]root)/;
    const dirCases = parseCases.filter(c => rx.test(c.id));
    const dirGreen = dirCases.filter(c => hasParseError(c.input)).length;
    // eslint-disable-next-line no-console
    console.log(
      `[sass-spec-errors] directives parse-time fixtures: ${dirCases.length} — ` +
        `${dirGreen} caught, ${dirCases.length - dirGreen} tracked-failing`
    );
    expect(dirCases.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The flow-control / callable at-rule cluster: at-rules that REQUIRE a prelude
// (a condition, loop header, name, or return expression) and must ERROR when it
// is missing. Wave 2B hardened the grammar (structural `expect(...)` requirements,
// macro-safe) so each now reports a parse error IN PLACE — the enclosing block
// still parses (recovered), so exactly one error is emitted at the prelude site.
// These are real assertions on the error CATEGORY (message substring) + LINE/COLUMN.
// ---------------------------------------------------------------------------
/** Parse `src` and return its combined lexer + parser errors. */
function parseErrors(src: string) {
  const r = parser.parse(src, 'Stylesheet');
  return [...r.lexerResult.errors, ...r.errors];
}

describe('flow-control / callable at-rules reject a missing prelude', () => {
  // [name, src, message-category substring, expected line, expected column]
  const cases: Array<[string, string, string, number, number]> = [
    ['@if with no condition before block', '@if { color: red }', 'condition', 1, 5],
    ['@each with no variable (in-first)', '@each in $list {}', 'variable', 1, 7],
    ['@for missing "from"/"through"', '@for $i {}', 'from', 1, 9],
    ['@mixin with no name', '@mixin { color: red }', 'name', 1, 8],
    ['@include with empty name', '@include ;', 'name', 1, 10],
    ['@include with no name inside a rule', '.a { @include }', 'name', 1, 15],
    ['@function @return with no expression', '@function foo(){ @return }', 'expression', 1, 26]
  ];

  for (const [name, src, category, line, column] of cases) {
    it(`${name} reports a "${category}" error at ${line}:${column}`, () => {
      const errs = parseErrors(src);
      expect(errs.length, `expected a parse error for: ${src}`).toBeGreaterThanOrEqual(1);
      const err = errs[0]!;
      expect((err as { code?: string }).code).toBe('parse/syntax-error');
      expect((err as { message: string }).message.toLowerCase()).toContain(category.toLowerCase());
      expect({
        line: (err as { line: number }).line,
        column: (err as { column: number }).column
      }).toEqual({ line, column });
    });
  }

  // Their VALID counterparts must still parse CLEAN (positive coverage — the
  // requirement is exact, not a blanket rejection of the keyword).
  const valid: Array<[string, string]> = [
    ['@if $x { }', '@if $x { }'],
    ['@each $i in $list { }', '@each $i in $list { }'],
    ['@for $i from 1 through 3 { }', '@for $i from 1 through 3 { }'],
    ['@mixin foo { }', '@mixin foo { }'],
    ['@include foo;', '@include foo;'],
    ['@function f() { @return 1 }', '@function f() { @return 1 }']
  ];
  for (const [name, src] of valid) {
    it(`valid: ${name} parses clean`, () => {
      expect(parseErrors(src)).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Remaining tracked false negative OUTSIDE the flow-control/callable scope: an
// empty declaration value (`.a { color: }`). SCSS `Declaration` intentionally has
// a nullable value (`optional(g.valueList)`), so this is a separate hardening
// decision (declaration-level, not a missing at-rule prelude) deferred to a later
// wave. Kept as `it.fails` so it stays green while tracked.
// ---------------------------------------------------------------------------
describe('confirmed SCSS parse-time false negatives (tracked via it.fails)', () => {
  it.fails('declaration with nullable (empty) value', () => {
    expect(hasParseError('.a { color: }'), 'expected a parse error for: .a { color: }').toBe(true);
  });
});
