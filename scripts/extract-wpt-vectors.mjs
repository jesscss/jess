/**
 * Regenerate `test/css-corpus/wpt-accept.json` from a web-platform-tests checkout.
 *
 * WPT is not an npm package and a full clone is ~2 GB, so the extracted vectors
 * are vendored rather than materialized at install time. This script is how the
 * vendored file is reproduced; it is not run by `pnpm install` or by any test.
 *
 *   git clone --filter=blob:none --no-checkout https://github.com/web-platform-tests/wpt
 *   git -C wpt sparse-checkout set --no-cone '/css/**'
 *   git -C wpt checkout
 *   node scripts/extract-wpt-vectors.mjs --wpt ./wpt
 *
 * WPT is BSD-3-Clause. The vendored output carries the licence text
 * (`test/css-corpus/LICENSE.wpt.md`), the upstream commit, and a notice that
 * jess is not endorsed by the project — all three are licence conditions, not
 * courtesies. See `test/css-corpus/README.md`.
 *
 * ## Why ACCEPT vectors only
 *
 * WPT's `test_invalid_value(prop, value)` asserts that the CSSOM refuses to
 * STORE a declaration — that the value fails the *property's* value grammar.
 * That is not a syntax question. A structural balance check over all 8,903
 * reject vectors found 8,871 (99.6%) to be perfectly well-formed CSS:
 * `color: #00000`, `color: #0000fg`, `::checkmark::checkmark`. jess's parser
 * accepts SHAPES, not semantics — validity is the language service's job — so
 * importing those as `expect: reject` would encode ~8,871 wrong expectations.
 * The 32 genuinely malformed ones are too few to be worth a separate lane here.
 *
 * The accept side has no such problem, and is the point of the exercise: 17,421
 * real value payloads drawn from every CSS spec with a `parsing/` directory,
 * which a CSS-superset parser must swallow verbatim.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(repoRoot, 'test', 'css-corpus', 'wpt-accept.json');

/** The `parsing-testcommon.js` helpers that state a parse verdict. */
const HELPERS = {
  test_valid_value: { expect: 'accept', kind: 'declaration' },
  test_invalid_value: { expect: 'reject', kind: 'declaration' },
  test_valid_rule: { expect: 'accept', kind: 'rule' },
  test_invalid_rule: { expect: 'reject', kind: 'rule' },
  test_valid_selector: { expect: 'accept', kind: 'selector' },
  test_valid_forgiving_selector: { expect: 'accept', kind: 'selector' },
  test_invalid_selector: { expect: 'reject', kind: 'selector' },
  test_keyframes_name_valid: { expect: 'accept', kind: 'keyframes-name' },
  test_keyframes_name_invalid: { expect: 'reject', kind: 'keyframes-name' }
};

const HELPER_NAMES = Object.keys(HELPERS);
const CALLS_ANY = new RegExp(`(?<![\\w.])(${HELPER_NAMES.join('|')})\\s*\\(`);

/**
 * Other `testharness.js` / WPT surface the test files touch. These are stubbed
 * rather than harvested: the file has to RUN to completion, because most of the
 * verdicts come from loops over property tables rather than literal call sites
 * (10,367 static sites produce 26,503 actual calls).
 */
const STUBBED = [
  'assert_equals', 'assert_true', 'assert_false', 'assert_not_equals',
  'assert_in_array', 'assert_throws_dom', 'assert_throws_js', 'assert_array_equals',
  'assert_approx_equals', 'assert_regexp_match', 'assert_less_than', 'assert_greater_than',
  'assert_unreached', 'assert_class_string', 'assert_own_property', 'assert_not_own_property',
  'test_computed_value', 'test_shorthand_value', 'test_valid_declaration',
  'test_invalid_declaration', 'test_computed_value_greater_than', 'test_property_value',
  'test_initial_value', 'test_inherited_value', 'test_shorthand_serialization',
  'test_number_value', 'test_length_value', 'test_percentage_value', 'test_color_value',
  'assert_computed_style', 'test_supports', 'test_can_animate', 'runTests',
  'test_animation_value', 'test_ref', 'test_parse_value', 'test_serialization'
];

function walkHtml(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkHtml(full, acc);
    } else if (entry.name.endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

function inlineScripts(html) {
  const bodies = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (!/\bsrc\s*=/i.test(match[1])) {
      bodies.push(match[2]);
    }
  }
  return bodies;
}

/** Minimal DOM/CSSOM shim: enough for the harness files to run, no more. */
function makeSandbox(record) {
  const noop = () => {};
  const style = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : ''),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    }
  });
  const el = {
    style,
    sheet: { cssRules: [], rules: [], insertRule: noop, deleteRule: noop },
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    append: noop,
    remove: noop,
    removeChild: noop,
    attachShadow: () => el,
    textContent: '',
    innerText: '',
    classList: { add: noop, remove: noop },
    querySelector: () => el,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({})
  };
  const document = {
    getElementById: () => el,
    createElement: () => el,
    createElementNS: () => el,
    querySelector: () => el,
    querySelectorAll: () => [],
    head: el,
    body: el,
    documentElement: el,
    adoptedStyleSheets: [],
    styleSheets: [],
    addEventListener: noop
  };
  const sandbox = {
    document,
    console,
    CSS: { supports: () => true, registerProperty: noop, escape: s => s },
    getComputedStyle: () => style,
    test: noop,
    async_test: () => ({ done: noop, step: noop, step_func: f => f }),
    promise_test: noop,
    setup: noop,
    done: noop,
    add_result_callback: noop,
    CSSStyleSheet: function CSSStyleSheet() {
      return el.sheet;
    },
    DOMException: { SYNTAX_ERR: 12 },
    requestAnimationFrame: noop,
    setTimeout: noop
  };
  for (const name of STUBBED) {
    sandbox[name] = noop;
  }
  for (const name of HELPER_NAMES) {
    sandbox[name] = (...args) => record(name, args);
  }
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

/** WPT passes IDL-cased property names; the corpus stores CSS-cased ones. */
function toCssProperty(name) {
  if (typeof name !== 'string') {
    return undefined;
  }
  return name.startsWith('--') ? name : name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
}

/** Every vector is a COMPLETE stylesheet; a fragment is put back in context. */
function toStylesheet(kind, args) {
  const [first, second] = args;
  if (kind === 'declaration') {
    const property = toCssProperty(first);
    return property !== undefined && typeof second === 'string'
      ? `.t { ${property}: ${second}; }`
      : undefined;
  }
  if (typeof first !== 'string') {
    return undefined;
  }
  if (kind === 'selector') {
    return `${first} { color: red; }`;
  }
  if (kind === 'rule') {
    return first;
  }
  if (kind === 'keyframes-name') {
    return `@keyframes ${first} { }`;
  }
  return undefined;
}

function main() {
  const flag = process.argv.indexOf('--wpt');
  if (flag === -1 || process.argv[flag + 1] === undefined) {
    throw new Error('usage: node scripts/extract-wpt-vectors.mjs --wpt <path-to-wpt-checkout>');
  }
  const wptRoot = path.resolve(process.argv[flag + 1]);
  const cssRoot = path.join(wptRoot, 'css');
  if (!fs.existsSync(cssRoot)) {
    throw new Error(`no css/ directory under ${wptRoot}`);
  }

  const commit = fs.readFileSync(path.join(wptRoot, '.git', 'HEAD'), 'utf8').trim();
  const files = walkHtml(cssRoot);

  const calls = [];
  let tried = 0;
  let failed = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    if (!CALLS_ANY.test(html)) {
      continue;
    }
    tried++;
    const relative = path.relative(wptRoot, file);
    const context = vm.createContext(
      makeSandbox((name, args) => calls.push({ file: relative, name, args }))
    );
    let ok = true;
    for (const body of inlineScripts(html)) {
      if (!CALLS_ANY.test(body)) {
        continue;
      }
      try {
        vm.runInContext(body, context, { timeout: 5000 });
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      failed++;
    }
  }

  const seen = new Set();
  const vectors = [];
  for (const call of calls) {
    const helper = HELPERS[call.name];
    if (helper === undefined || helper.expect !== 'accept') {
      continue;
    }
    const source = toStylesheet(helper.kind, call.args);
    if (source === undefined || source.trim() === '') {
      continue;
    }
    if (seen.has(source)) {
      continue;
    }
    seen.add(source);
    vectors.push({
      id: '',
      source,
      kind: helper.kind,
      origin: `wpt:${call.file}#${call.name}`
    });
  }

  const width = String(vectors.length).length;
  vectors.forEach((vector, index) => {
    vector.id = `wpt-${String(index + 1).padStart(width, '0')}`;
  });

  fs.writeFileSync(outFile, JSON.stringify({
    source: 'web-platform-tests',
    repository: 'https://github.com/web-platform-tests/wpt',
    commit,
    license: 'BSD-3-Clause',
    license_file: './LICENSE.wpt.md',
    notice:
      'Extracted and reformatted from web-platform-tests. Not endorsed by the '
      + 'web-platform-tests project or the W3C.',
    extracted_by: 'scripts/extract-wpt-vectors.mjs',
    verdict: 'accept',
    count: vectors.length,
    vectors
  }));

  console.log(
    `[wpt] ${tried} files with helper calls (${failed} with script errors), `
    + `${calls.length} recorded calls, ${vectors.length} accept vectors -> ${outFile}`
  );
}

main();
