import { setSourceSpan } from '../provenance.js';
import { describe, it, expect } from 'vitest';
import { OutputWriter, getPrintOptions } from '../print.js';
import { buildSourceMap } from '../sourcemap.js';
import { rules, decl, any, ruleset, sellist, sel, el } from '../../index.js';
import { isNode } from '../is-node.js';
import { N } from '../../node-type.js';
import { TreeContext } from '../../../context.js';

// Nodes now carry only source OFFSETS (spanStart/spanEnd); the source map derives
// original line/column from the offset + the file source on the cold gen path.
const spanOf = (start: number, end: number) => ({ start, end });

describe('source map segments', () => {
  it('collects segments for simple declaration', () => {
    const w = new OutputWriter();
    const treeContext = new TreeContext({
      file: { name: 'root.jess', path: '.', fullPath: '/abs/root.jess', source: 'color: red;' }
    });
    const root = rules([
      decl({ name: 'color', value: any('red') })
    ], undefined, undefined, treeContext);
    const firstRule = root.rules[0];
    if (isNode(firstRule, N.Declaration)) {
      setSourceSpan(firstRule, spanOf(0, 11)); // offset 0 → line 0, col 0
    }
    const css = root.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('color: red;\n');
    const segs = w.getSegments();
    expect(segs[0]?.genLine).toBe(0);
    expect(segs[0]?.genColumn).toBe(0);
    expect(segs[0]?.origLine).toBe(0);
    expect(segs[0]?.origColumn).toBe(0);
  });

  it('maps nested rules content lines', () => {
    const w = new OutputWriter();
    const treeContext = new TreeContext({
      file: { name: 'nested.jess', path: '.', fullPath: '/abs/nested.jess', source: '.a {\n  x: y;\n}' }
    });
    const nested = rules([
      ruleset({
        selector: sellist([sel([el('.a')])]),
        rules: [
          decl({ name: 'x', value: any('y') })
        ]
      })
    ], undefined, undefined, treeContext);
    const rs = (nested.rules[0] as any).rules;
    setSourceSpan(rs[0] as any, spanOf(7, 11)); // `x: y;` at offset 7 → line 1
    const css = nested.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('.a {\n  x: y;\n}\n');
    const segs = w.getSegments();
    const lines = css.split('\n');
    const lineIdx = lines.findIndex(l => l.includes('x: y;'));
    expect(segs.some(s => s.genLine === lineIdx), `expected a segment on generated line ${lineIdx}`).toBe(true);
    const map = buildSourceMap(w, { file: 'out.css' });
    expect(map.version).toBe(3);
    expect(map.file).toBe('out.css');
    expect(Array.isArray(map.sources)).toBe(true);
    expect(typeof map.mappings).toBe('string');
  });

  it('writer line/column advance for newlines between rules', () => {
    const w = new OutputWriter();
    // Source with `a` on line 0 and `b` on line 3 (offsets 0 and 8).
    const source = 'a: 1;\n\n\nb: 2;';
    const treeContext = new TreeContext({
      file: { name: 'ab.jess', path: '.', fullPath: '/abs/ab.jess', source }
    });
    const a = decl({ name: 'a', value: any('1') });
    const b = decl({ name: 'b', value: any('2') });
    setSourceSpan(a, spanOf(0, 5)); // original line 0
    setSourceSpan(b, spanOf(8, 13)); // original line 3 (after "a: 1;\n\n\n")
    const root = rules([a, b], undefined, undefined, treeContext);
    const css = root.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('a: 1;\n' + 'b: 2;\n');
    const lines = css.split('\n');
    expect(lines[0]).toBe('a: 1;');
    expect(lines[1]).toBe('b: 2;');

    const segs = w.getSegments();
    const aSeg = segs.find(s => s.genLine === 0 && s.genColumn === lines[0]!.indexOf('a'));
    expect(aSeg?.origLine).toBe(0);
    const bSeg = segs.find(s => s.genLine === 1 && s.genColumn === lines[1]!.indexOf('b'));
    expect(bSeg?.origLine).toBe(3); // three source newlines mapped to the original line
    expect(bSeg?.genLine).toBe(1);
  });

  it('combines segments from different trees (files)', () => {
    const w = new OutputWriter();
    const leftContext = new TreeContext({
      file: { name: 'left.jess', path: '.', fullPath: '/abs/left.jess', source: 'a: 1;' }
    });
    const left = rules([
      decl({ name: 'a', value: any('1') })
    ], undefined, undefined, leftContext);
    setSourceSpan(left.rules[0] as any, spanOf(0, 5));

    const rightContext = new TreeContext({
      file: { name: 'right.jess', path: '.', fullPath: '/abs/right.jess', source: 'b: 2;' }
    });
    const right = rules([
      decl({ name: 'b', value: any('2') })
    ], undefined, undefined, rightContext);
    setSourceSpan(right.rules[0] as any, spanOf(0, 5));

    const root = rules([left, right]);
    const css = root.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('a: 1;' + '\n' + 'b: 2;\n');

    const map = buildSourceMap(w, { file: 'out.css' });
    expect(map.version).toBe(3);
    const srcs = map.sources.filter((s): s is string => typeof s === 'string');
    expect(srcs.some(s => s.includes('left.jess'))).toBe(true);
    expect(srcs.some(s => s.includes('right.jess'))).toBe(true);
  });
});
