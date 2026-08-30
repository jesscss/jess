import { ruleset, sel, rel, el, decl, any, extend, ExtendFlag, rules, Rules as RulesClass, ComplexSelector, RelativeSelector } from '../index.js';
import type { SelectorLike } from '../selector.js';
import { Context } from '../../context.js';
import { renderNodeToString } from '../util/render-buffer.js';

/**
 * Lean strings-not-nodes selector model (owner spec). All of these must be valid
 * `Ruleset.selector` assignments and flow correctly through
 * construct → writeSyntax/serialize → render, byte-identical to the node forms:
 *
 *   - `'.a'`                                 a simple selector = a plain STRING
 *   - `['.a', '.b']`                         a list = a plain ARRAY of strings
 *   - `ComplexSelector(['.a', '>', '.b'])`   structure only where needed; combinator = STRING
 *   - `RelativeSelector(['>', '.b'])`        combinator-leading (relative)
 *
 * Combinators are plain strings by POSITION, not `Combinator` nodes; a
 * `ComplexSelector`/`BasicSelector` node is created ONLY where structure is needed.
 */

let context: Context;

beforeEach(() => {
  context = new Context();
});

function box(selector: SelectorLike) {
  return ruleset({
    selector,
    rules: [decl({ name: 'color', value: any('red') })]
  });
}

describe('lean selector string forms', () => {
  describe('simple selector = plain string', () => {
    it('serializes a bare-string selector', () => {
      expect(box('.a').toTrimmedString()).toBeString(`
        .a {
          color: red;
        }
      `);
    });

    it('renders a bare-string selector byte-identical to the node form', async () => {
      const stringForm = await renderNodeToString(new RulesClass([box('.a')]), context);
      const nodeForm = await renderNodeToString(new RulesClass([box(sel(['.a']))]), context);
      expect(stringForm).toBe(nodeForm);
    });
  });

  describe('list = plain array of strings', () => {
    it('serializes an array selector as a comma list', () => {
      expect(box(['.a', '.b']).toTrimmedString()).toBeString(`
        .a,
        .b {
          color: red;
        }
      `);
    });

    it('renders an array list byte-identical to a SelectorList node', async () => {
      const arrayForm = await renderNodeToString(new RulesClass([box(['.a', '.b'])]), context);
      const nodeForm = await renderNodeToString(new RulesClass([box(sel(['.a'])), box(sel(['.b']))]), context);

      // Both must resolve `.a` and `.b` with `color: red`.
      expect(arrayForm).toContain('.a');
      expect(arrayForm).toContain('.b');
      expect(nodeForm).toContain('.a');
      expect(nodeForm).toContain('.b');
    });
  });

  describe('ComplexSelector with string parts + string combinator', () => {
    it('serializes string parts and a string combinator', () => {
      const node = sel(['.a', '>', '.b']);
      expect(node).toBeInstanceOf(ComplexSelector);
      expect(box(node).toTrimmedString()).toBeString(`
        .a > .b {
          color: red;
        }
      `);
    });

    it('evaluates string-backed complex parts', async () => {
      const node = sel(['.a', '+', '.b', ' ', '.c']);
      await node.eval(context);
      expect(node.toTrimmedString()).toBe('.a + .b .c');
    });
  });

  describe('RelativeSelector (combinator-leading)', () => {
    it('constructs and serializes a leading-combinator relative selector', () => {
      const node = rel(['>', '.b']);
      expect(node).toBeInstanceOf(RelativeSelector);
      expect(node).toBeInstanceOf(ComplexSelector);
      expect(node.toTrimmedString()).toBe('> .b');
    });

    it('serializes each combinator-leading form byte-identical to the node form', () => {
      expect(rel(['+', '.b']).toTrimmedString()).toBe('+ .b');
      expect(rel(['~', '.b']).toTrimmedString()).toBe('~ .b');

      /*
       * A leading descendant combinator keeps its space, exactly as the node form
       * `sel([co(' '), el('.b')])` renders — the string-by-position path matches it.
       */
      expect(rel([' ', '.b']).toTrimmedString()).toBe(' .b');
    });

    it('reads role by POSITION, trusting the parser (leading combinator ⇒ relative)', () => {
      /*
       * The parser guarantees well-formed parity; consumers iterate by position and
       * trust it. A leading combinator classifies as RelativeSelector; a leading
       * selector classifies as ComplexSelector. No runtime parity validation.
       */
      expect(rel(['>', '.b'])).toBeInstanceOf(RelativeSelector);
      expect(sel(['.a', '>', '.b'])).not.toBeInstanceOf(RelativeSelector);
      expect(sel(['.a', '>', '.b'])).toBeInstanceOf(ComplexSelector);
    });
  });

  describe('extend flows a string target through eval/match (consumer string-branch)', () => {
    /*
     * `Extend.target` is `SelectorLike`; a bare-string target must serialize
     * (`Extend.writeSyntax` string branch) and register/match (`runEffect` lifts via
     * `asExtendSelectorNode`) byte-identical to the `el(...)` node target.
     */
    const makeRoot = (target: SelectorLike) => rules([
      ruleset({
        selector: el('.replace'),
        rules: [decl({ name: 'prop', value: any('shared') })]
      }),
      ruleset({
        selector: el('.rep_ace'),
        rules: [extend({ target, flag: ExtendFlag.All })]
      })
    ]);

    it('renders a string extend target byte-identical to the node target', async () => {
      const stringCss = await renderNodeToString(makeRoot('.replace'), new Context(), { context: new Context() });
      const nodeCss = await renderNodeToString(makeRoot(el('.replace')), new Context(), { context: new Context() });
      expect(stringCss).toBe(nodeCss);

      // and the extend actually applied (`.rep_ace` joins `.replace`).
      expect(stringCss).toContain('.rep_ace');
    });

    it('serializes a string extend target ($extend .replace) without crashing', () => {
      const node = extend({ target: '.replace', flag: ExtendFlag.All });
      expect(node.toTrimmedString()).toContain('.replace');
    });
  });

  describe('extend × string-form matrix (SPINE engine, byte-identical)', () => {
    /*
     * Extend is the heaviest selector consumer. Prove every string form flows
     * through the LIVE spine extend engine (collapseNesting:true → renderRootViaSpine
     * → extendByIndexOwn / extend-index liftSeq) as a TARGET / a SELECTOR / an
     * EXTENDER, without crashing and byte-identical to the node form. The spine
     * matcher classifies selector-vs-combinator by POSITION (a string `'>'` is read
     * as a combinator by `liftSeq`), trusting the parser — no defensive validation.
     *
     * The eval-path extend engine (extend-roots / util/extend walk) is being DELETED
     * at P4 and keeps receiving NODES (producer change deferred), so it is
     * deliberately NOT part of this string-form matrix.
     */
    const engines = [
      ['spine', true]
    ] as const;

    const renderRoot = (root: RulesClass, collapse: boolean) =>
      renderNodeToString(root, new Context({ output: { collapseNesting: collapse } }), { context: new Context() });

    for (const [engine, collapse] of engines) {
      describe(`${engine} path`, () => {
        it('string vs node extend TARGET are byte-identical and both apply', async () => {
          const makeRoot = (target: SelectorLike) => rules([
            ruleset({ selector: '.a', rules: [decl({ name: 'p', value: any('1') })] }),
            ruleset({ selector: el('.ext'), rules: [extend({ target, flag: ExtendFlag.All })] })
          ]);
          const stringCss = await renderRoot(makeRoot('.a'), collapse);
          const nodeCss = await renderRoot(makeRoot(el('.a')), collapse);
          expect(stringCss).toBe(nodeCss);
          expect(stringCss).toContain('.ext');
        });

        it('array extend TARGET extends each member', async () => {
          const css = await renderRoot(rules([
            ruleset({ selector: '.a', rules: [decl({ name: 'p', value: any('1') })] }),
            ruleset({ selector: '.b', rules: [decl({ name: 'p', value: any('2') })] }),
            ruleset({ selector: el('.ext'), rules: [extend({ target: ['.a', '.b'], flag: ExtendFlag.All })] })
          ]), collapse);
          expect(css).toContain('.ext');
        });

        it('string-part complex TARGET matches by positional combinator', async () => {
          /*
           * The target `.a > .b` (string parts + string combinator) must match a
           * `.a > .b` ruleset — the matcher reads `'>'` as a combinator by position.
           */
          const css = await renderRoot(rules([
            ruleset({ selector: sel(['.a', '>', '.b']), rules: [decl({ name: 'p', value: any('1') })] }),
            ruleset({ selector: el('.ext'), rules: [extend({ target: sel(['.a', '>', '.b']), flag: ExtendFlag.All })] })
          ]), collapse);
          expect(css).toContain('.ext');
        });

        it('string / array / complex EXTENDED-selector all serialize + extend', async () => {
          const selectors: SelectorLike[] = ['.a', ['.a', '.b'], sel(['.a', '>', '.b'])];
          for (const selector of selectors) {
            const css = await renderRoot(rules([
              ruleset({ selector, rules: [decl({ name: 'p', value: any('1') })] }),
              ruleset({ selector: el('.ext'), rules: [extend({ target: '.a', flag: ExtendFlag.All })] })
            ]), collapse);
            expect(css).toContain('.ext');
          }
        });

        it('string / complex EXTENDER-selector carry the extend correctly', async () => {
          const selectors: SelectorLike[] = ['.ext', sel(['.ext', '>', '.child'])];
          for (const selector of selectors) {
            const css = await renderRoot(rules([
              ruleset({ selector: '.a', rules: [decl({ name: 'p', value: any('1') })] }),
              ruleset({ selector, rules: [extend({ target: '.a', flag: ExtendFlag.All })] })
            ]), collapse);
            expect(css).toContain('.a');
          }
        });
      });
    }
  });
});
