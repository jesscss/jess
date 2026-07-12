import { serializeTypes } from '@jesscss/core';
import { Parser } from '../src/jess.js';

const parser = new Parser();

// Less 4.x resolves `@{var}` interpolation inside a QUOTED url body the same as any
// other quoted string (`url("@{base}/@{i}.svg")` → `url("/assets/icon.svg")`), but
// leaves an UNQUOTED url body verbatim. The url body must therefore build a
// Quoted(Interpolated) — the same node string interpolation builds elsewhere — not a
// raw-string Quoted (which never interpolates).
describe('url() interpolation', () => {
  it('builds a double-quoted url body as Quoted(Interpolated)', () => {
    const { errors, tree } = parser.parse('a: url("@{base}/@{i}.svg")', 'declaration');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: false });
    expect(out).toContainString('(Url');
    expect(out).toContainString('(Quoted');
    expect(out).toContainString('(Interpolated');
  });

  it('builds a single-quoted url body as Quoted(Interpolated)', () => {
    const { errors, tree } = parser.parse('a: url(\'@{x}\')', 'declaration');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: false });
    expect(out).toContainString('(Quoted');
    expect(out).toContainString('(Interpolated');
  });

  it('leaves an unquoted url body verbatim (no interpolation, matching Less 4.x)', () => {
    const { errors, tree } = parser.parse('a: url(@{x}.svg)', 'declaration');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: false });
    expect(out).toContainString('(Url');
    expect(out).not.toContainString('(Interpolated');
  });

  it('keeps a non-interpolated quoted url body a plain string Quoted', () => {
    const { errors, tree } = parser.parse('a: url("data:image/png;base64,AAAA")', 'declaration');
    expect(errors.length).toBe(0);
    const out = serializeTypes(tree, { showOptions: false });
    expect(out).not.toContainString('(Interpolated');
  });
});
