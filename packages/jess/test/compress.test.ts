/**
 * `output.compress` — minified output in the AST-v2 serializer.
 *
 * Every fold is driven by the value's CLASSIFICATION (its AST node type / typed
 * value), never by re-scanning serialized bytes. The two halves of the gate:
 *   - PRESERVED: a bare keyword (`white`) is never folded in ANY property; custom
 *     property values, strings, and urls stay verbatim.
 *   - FOLDED: a value classified as a color/dimension shortens; structure minifies.
 *
 * See docs/less/advanced/compressed-output.md for the settled spec.
 */
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/** Render `src` with `output.compress: true` and return the CSS string. */
async function min(src: string, extension = '.less'): Promise<string> {
  const c = new Compiler({ output: { compress: true } });
  return String(await c.renderString(src, { extension, suppressWarnings: true }));
}

/** Render `src` pretty (compress off). */
async function pretty(src: string, extension = '.less'): Promise<string> {
  const c = new Compiler({ output: { compress: false } });
  return String(await c.renderString(src, { extension, suppressWarnings: true }));
}

describe('output.compress — preserved (must NOT fold)', () => {
  it('leaves a bare `white` keyword verbatim in every property (no property-grammar guessing)', async () => {
    expect(await min('a { animation-name: white }')).toBe('a{animation-name:white}');
    expect(await min('a { font-family: white }')).toBe('a{font-family:white}');
    expect(await min('a { will-change: white }')).toBe('a{will-change:white}');
    expect(await min('a { counter-reset: white 0 }')).toBe('a{counter-reset:white 0}');
  });

  it('keeps `white` verbatim across a @keyframes name and an animation-name', async () => {
    const out = await min('@keyframes white { from { color: red } } a { animation-name: white }');
    expect(out).toContain('@keyframes white{');
    expect(out).toContain('animation-name:white');

    // the ONLY folded `white`-adjacent token is the hex red inside the keyframe
    expect(out).toContain('color:red');
  });

  it('leaves a custom property value region EXACTLY as pretty (compress changes nothing from `:` onward)', async () => {
    /*
     * A custom property's value is an opaque token stream where whitespace can BE
     * the value: the `: ` separator, the value bytes, and the trailing `;` are all
     * emitted verbatim — only the outer indent/newline compress. The `;` is kept
     * even when the declaration is LAST in its block (dropping it would let the
     * value absorb trailing whitespace/`}`).
     */
    expect(await min('a { --foo: ; }')).toBe('a{--foo: ;}');
    expect(await min('a { --foo:; }')).toBe('a{--foo: ;}'); // pretty normalizes to `: `
    expect(await min('a { --gap: 0.5; }')).toBe('a{--gap: 0.5;}'); // `: ` kept, NOT `.5`
    expect(await min('a { --x: 1px  2px; }')).toBe('a{--x: 1px  2px;}'); // internal ws kept
    expect(await min('a { --token: white; }')).toBe('a{--token: white;}'); // keyword verbatim
  });

  it('keeps a custom property `;` when last in block; regular declarations still drop theirs', async () => {
    // last leaf is the custom property → its `;` is kept
    expect(await min('a { color: red; --foo: bar; }')).toBe('a{color:red;--foo: bar;}');

    // last leaf is a regular declaration → its `;` drops, the earlier custom keeps its own
    expect(await min('a { --foo: bar; color: red; }')).toBe('a{--foo: bar;color:red}');
  });

  it('leaves strings and urls untouched', async () => {
    expect(await min('a { content: "white" }')).toBe('a{content:"white"}');
    expect(await min('a { content: "#ffffff" }')).toBe('a{content:"#ffffff"}');
    expect(await min('a { content: "0.5" }')).toBe('a{content:"0.5"}');
    expect(await min('a { background: url(white.png) }')).toBe('a{background:url(white.png)}');
  });
});

describe('output.compress — value folds (must fold)', () => {
  it('folds a hex color to its shortest still-valid form', async () => {
    expect(await min('a { color: #ffffff }')).toBe('a{color:#fff}');
    expect(await min('a { color: #ff0000 }')).toBe('a{color:red}'); // red (3) < #f00 (4)
    expect(await min('a { color: #ffffffff }')).toBe('a{color:#ffff}');
  });

  it('folds a COMPUTED color by its result type', async () => {
    expect(await min('a { color: mix(#fff, #fff, 50%) }')).toBe('a{color:#fff}');
  });

  it('trims dimension zeros, keeping the unit', async () => {
    expect(await min('a { opacity: 0.5 }')).toBe('a{opacity:.5}');
    expect(await min('a { margin: 0.5px }')).toBe('a{margin:.5px}');
    expect(await min('a { margin: 0px }')).toBe('a{margin:0px}'); // unit kept, no drop
    expect(await min('a { margin: -0.5px }')).toBe('a{margin:-.5px}');
    expect(await min('a { width: 1.50px }')).toBe('a{width:1.5px}');
  });

  it('tightens a comma-separated value list', async () => {
    expect(await min('a { transition: color 1px, background 2px }'))
      .toBe('a{transition:color 1px,background 2px}');
  });

  it('tightens function-arg commas (list dividers) and folds args by classification', async () => {
    /*
     * The list-divider (comma) space is minified. A CSS-shaped call whose bytes are
     * PRESERVED (rgba/rgb/hsl/… in a .less doc) keeps its arg SEPARATORS verbatim,
     * but each arg is still folded by its NODE CLASSIFICATION — a `Dimension` arg
     * trims its leading zero (`0.1`→`.1`) off the node type, never by re-scanning the
     * joined string. Position does not change a token's shape.
     */
    expect(await min('a { color: rgba(255, 238, 170, 0.1) }'))
      .toBe('a{color:rgba(255,238,170,.1)}');

    // a generic (evaluated) call folds via typed nodes AND tightens commas
    expect(await min('a { transform: translate(1px, 2px) }'))
      .toBe('a{transform:translate(1px,2px)}');

    /*
     * modern space-separated color syntax: the spaces/`/` ARE the separators (kept),
     * but the alpha `Dimension` still folds its leading zero
     */
    expect(await min('a { color: rgb(15 23 42 / 0.5) }'))
      .toBe('a{color:rgb(15 23 42 / .5)}');
  });

  it('emits `!important` with no leading space', async () => {
    expect(await min('a { color: red !important }')).toBe('a{color:red!important}');
  });
});

describe('output.compress — structural', () => {
  it('removes indentation/newlines, drops the last `;`, tightens the block', async () => {
    expect(await min('a { color: red; background: blue }'))
      .toBe('a{color:red;background:blue}');
    expect(await min('.a { color: red }')).toBe('.a{color:red}');
  });

  it('joins a selector list with a bare comma', async () => {
    expect(await min('.a, .b { color: red }')).toBe('.a,.b{color:red}');
  });

  it('tightens combinator spacing', async () => {
    expect(await min('.a > .b { color: red }')).toBe('.a>.b{color:red}');
    expect(await min('.a + .b { color: red }')).toBe('.a+.b{color:red}');
    expect(await min('.a ~ .b { color: red }')).toBe('.a~.b{color:red}');
    expect(await min('.a .b { color: red }')).toBe('.a .b{color:red}'); // descendant space kept
  });

  it('tightens `@media (` / `@supports (` and the feature colon', async () => {
    expect(await min('@media (min-width: 40em) { a { color: red } }'))
      .toBe('@media(min-width:40em){a{color:red}}');
    expect(await min('@supports (display: grid) { a { color: red } }'))
      .toBe('@supports(display:grid){a{color:red}}');
  });

  it('drops an empty rule entirely', async () => {
    expect(await min('.a {} .b { color: red }')).toBe('.b{color:red}');
  });

  it('drops non-bang comments and keeps bang comments', async () => {
    const out = await min('/* drop me */ /*! keep me */ a { color: red }');
    expect(out).toContain('/*! keep me */');
    expect(out).not.toContain('drop me');
    expect(out).toContain('a{color:red}');
  });
});

describe('output.compress — off is unchanged', () => {
  it('pretty output keeps whitespace, comments, and verbatim colors', async () => {
    const out = await pretty('a { color: #ffffff; background: red }');
    expect(out).toContain('color: #ffffff');
    expect(out).toContain('background: red');
    expect(out).toContain('\n');
  });
});
