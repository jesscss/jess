import { Parser } from '../src/jess.js';
import { serializeTypes } from '@jesscss/core';

/**
 * Locks the EXACT segmentation of a compound selector where a plain basic
 * selector is adjacent to (glued against) an `@{…}` interpolation.
 *
 * `basicSel`'s charset is a strict superset of the interpolation-prefix charset
 * (it also accepts unicode, escapes, `%`, `*`). So a plain selector part whose
 * name contains an out-of-interp-charset char is a SEPARATE `BasicSelector`, and
 * the interpolation starts a fresh `InterpolatedSelector` — the two do NOT glue
 * into one node. When the whole leading run IS interp-charset, the number + unit…
 * er, the prefix + interp glue into ONE `InterpolatedSelector`.
 *
 * These are the guard cases for the `interpOrBasic` merge: the merge must
 * reproduce this split byte- and structure-identically (no gluing `.café@{x}`).
 */
const parser = new Parser();
const types = (src: string) => {
  const { errors, tree } = parser.parse(`${src} { x: 1 }`);
  expect(errors.length).toBe(0);
  return serializeTypes(tree).replace(/\s+/g, ' ');
};

describe('basic + interpolation adjacency segmentation', () => {
  describe('SPLIT — out-of-interp-charset prefix stays a separate BasicSelector', () => {
    it('unicode class name: .café@{x} → [BasicSelector .café, InterpolatedSelector @{x}]', () => {
      expect(types('.café@{x}')).toContainString(
        "(CompoundSelector value: [ '.café' (InterpolatedSelector value: (Interpolated [role=ident] source: '%%'"
      );
    });
    it('universal: *@{x} → [BasicSelector *, InterpolatedSelector @{x}]', () => {
      expect(types('*@{x}')).toContainString(
        "(CompoundSelector value: [ '*' (InterpolatedSelector value: (Interpolated [role=ident] source: '%%'"
      );
    });
    it('percentage: 10%@{x} → [BasicSelector 10%, InterpolatedSelector @{x}]', () => {
      expect(types('10%@{x}')).toContainString(
        "(CompoundSelector value: [ '10%' (InterpolatedSelector value: (Interpolated [role=ident] source: '%%'"
      );
    });
  });

  describe('GLUED — interp-charset prefix folds into ONE InterpolatedSelector', () => {
    it('class-dash prefix: .a-@{n} → InterpolatedSelector source .a-%%', () => {
      expect(types('.a-@{n}')).toContainString(
        "selector: (InterpolatedSelector value: (Interpolated [role=ident] source: '.a-%%'"
      );
    });
    it('type prefix: div@{n} → InterpolatedSelector source div%%', () => {
      expect(types('div@{n}')).toContainString(
        "selector: (InterpolatedSelector value: (Interpolated [role=ident] source: 'div%%'"
      );
    });
    it('id prefix: #id@{y} → InterpolatedSelector source #id%%', () => {
      expect(types('#id@{y}')).toContainString(
        "selector: (InterpolatedSelector value: (Interpolated [role=ident] source: '#id%%'"
      );
    });
    it('interleaved: foo@{bar}baz → InterpolatedSelector source foo%%baz', () => {
      expect(types('foo@{bar}baz')).toContainString(
        "selector: (InterpolatedSelector value: (Interpolated [role=ident] source: 'foo%%baz'"
      );
    });
    it('bare interpolation: @{parent} → InterpolatedSelector source %%', () => {
      expect(types('@{parent}')).toContainString(
        "selector: (InterpolatedSelector value: (Interpolated [role=ident] source: '%%'"
      );
    });
    it('dot + bare interp: .@{n} → InterpolatedSelector source .%%', () => {
      expect(types('.@{n}')).toContainString(
        "selector: (InterpolatedSelector value: (Interpolated [role=ident] source: '.%%'"
      );
    });
  });

  describe('PLAIN — no interpolation, unchanged', () => {
    it('.btn stays a bare string selector', () => {
      expect(types('.btn')).toContainString("selector: '.btn'");
    });
    it('.foo.bar stays a two-part CompoundSelector of strings', () => {
      expect(types('.foo.bar')).toContainString("(CompoundSelector value: [ '.foo' '.bar' ]");
    });
  });
});
