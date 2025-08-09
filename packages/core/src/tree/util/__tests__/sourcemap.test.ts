import { describe, it, expect } from 'vitest';
import { OutputWriter, getPrintOptions } from '../print';
import { buildSourceMap } from '../sourcemap';
import { rules, decl, any, ruleset, sellist, sel, el, name } from '../../index';

describe('source map segments', () => {
  it('collects segments for simple declaration', () => {
    const w = new OutputWriter();
    const root = rules([
      decl({ name: name('color'), value: any('red') })
    ]);
    // fake location & file for mapping
    (root.value[0] as any)._location = [0, 1, 1, 0, 1, 6];
    (root as any).treeContext.file = { name: 'root.jess', path: '.', fullPath: '/abs/root.jess' };
    const css = root.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('color: red;');
    const segs = w.getSegments();
    // Should have at least one segment at start
    expect(segs[0]?.genLine).toBe(0);
    expect(segs[0]?.genColumn).toBe(0);
  });

  it('maps nested rules content lines', () => {
    const w = new OutputWriter();
    const nested = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: rules([
          decl({ name: name('x'), value: any('y') })
        ])
      })
    ]);
    // attach fake locations and files
    const rs = (nested.value[0] as any).value.rules;
    (rs.value[0] as any)._location = [0, 1, 3, 0, 1, 8];
    (nested as any).treeContext.file = { name: 'nested.jess', path: '.', fullPath: '/abs/nested.jess' };
    const css = nested.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('.a {\n  x: y;\n}');
    const segs = w.getSegments();
    // Segment should exist at the generated start of "x: y;"
    const lines = css.split('\n');
    const lineIdx = lines.findIndex(l => l.includes('x: y;'));
    const colIdx = lines[lineIdx]!.indexOf('x');
    const hasInner = segs.some(s => s.genLine === lineIdx && s.genColumn === colIdx);
    expect(hasInner, `expected a segment at line ${lineIdx}, column ${colIdx}`).toBe(true);
    const map = buildSourceMap(w, { file: 'out.css' });
    expect(map.version).toBe(3);
    expect(map.file).toBe('out.css');
    expect(Array.isArray(map.sources)).toBe(true);
    expect(typeof map.mappings).toBe('string');
  });

  it('combines segments from different trees (files)', () => {
    const w = new OutputWriter();
    const left = rules([
      decl({ name: name('a'), value: any('1') })
    ]);
    // attach file+location to the declaration itself so segments carry sources
    (left.value[0] as any).treeContext.file = { name: 'left.jess', path: '.', fullPath: '/abs/left.jess' };
    (left.value[0] as any)._location = [0, 1, 1, 0, 1, 5];

    const right = rules([
      decl({ name: name('b'), value: any('2') })
    ]);
    (right.value[0] as any).treeContext.file = { name: 'right.jess', path: '.', fullPath: '/abs/right.jess' };
    (right.value[0] as any)._location = [0, 1, 1, 0, 1, 5];

    const root = rules([left, right]);
    const css = root.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('a: 1;' + '\n' + 'b: 2;');

    const map = buildSourceMap(w, { file: 'out.css' });
    expect(map.version).toBe(3);
    const srcs = map.sources.filter((s): s is string => typeof s === 'string');
    expect(srcs.some(s => s.includes('left.jess'))).toBe(true);
    expect(srcs.some(s => s.includes('right.jess'))).toBe(true);
  });
});
