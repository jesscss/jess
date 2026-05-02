import { describe, it, expect } from 'vitest';
import type { IToken } from 'chevrotain';
import { OutputWriter, getPrintOptions } from '../print.js';
import { buildSourceMap } from '../sourcemap.js';
import { rules, decl, any, ruleset, sellist, sel, el } from '../../index.js';

const token = (image: string): IToken => ({
  image,
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length,
  tokenType: { name: 'WS' } as IToken['tokenType']
});

describe('source map segments', () => {
  it('collects segments for simple declaration', () => {
    const w = new OutputWriter();
    const root = rules([
      decl({ name: any('color'), value: any('red') })
    ]);
    // fake location & file for mapping
    (root.value[0] as any)._location = [0, 1, 1, 0, 1, 6];
    (root as any).treeContext.file = { name: 'root.jess', path: '.', fullPath: '/abs/root.jess' };
    const css = root.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('color: red;\n');
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
          decl({ name: any('x'), value: any('y') })
        ])
      })
    ]);
    // attach fake locations and files
    const rs = (nested.value[0] as any).value.rules;
    (rs.value[0] as any)._location = [0, 1, 3, 0, 1, 8];
    (nested as any).treeContext.file = { name: 'nested.jess', path: '.', fullPath: '/abs/nested.jess' };
    const css = nested.toString(getPrintOptions({ writer: w }));
    expect(css).toBe('.a {\n  x: y;\n}\n');
    const segs = w.getSegments();
    // Segment should exist on the generated line containing "x: y;"
    const lines = css.split('\n');
    const lineIdx = lines.findIndex(l => l.includes('x: y;'));
    const hasInnerLine = segs.some(s => s.genLine === lineIdx);
    expect(hasInnerLine, `expected a segment on generated line ${lineIdx}`).toBe(true);
    const map = buildSourceMap(w, { file: 'out.css' });
    expect(map.version).toBe(3);
    expect(map.file).toBe('out.css');
    expect(Array.isArray(map.sources)).toBe(true);
    expect(typeof map.mappings).toBe('string');
  });

  it('writer line/column advance for newlines between rules', () => {
    const w = new OutputWriter();
    const a = decl({ name: any('a'), value: any('1') });
    const b = decl({ name: any('b'), value: any('2') });
    // Attach fake locations so segments are recorded (orig lines are 1-based here)
    a._location = [0, 1, 1, 0, 1, 5];   // original line 1 (0-based 0)
    b._location = [0, 4, 1, 0, 4, 5];   // original line 2 (0-based 1)
    const root = rules([a, b]);
    const trivia = {
      before: new Map<number, IToken[]>(),
      after: new Map([[a.location[3], [token('\n\n\n')]]])
    };
    const css = root.toString(getPrintOptions({ writer: w, trivia }));
    expect(css).toBe('a: 1;\n' + 'b: 2;\n');
    // After first declaration 'a: 1;', writer should have advanced one line on the newline
    // Find index of newline and validate writer's internal line/column
    const idx = css.indexOf('\n');
    expect(idx).toBeGreaterThan(0);
    // Simulate writer state by splitting lines
    const lines = css.split('\n');
    // Current serializer emits trailing newline for root rules output
    expect(css.endsWith('\n')).toBe(true);
    // First and second lines are correct
    expect(lines[0]).toBe('a: 1;');
    expect(lines[1]).toBe('b: 2;');

    // Confirm that a segment exists at the generated start of 'b: 2;'
    const segs = w.getSegments();
    // Assert segment for 'a' is on generated line 0 and maps to original line 0
    const aLineIdx = 0;
    const aColIdx = lines[aLineIdx]!.indexOf('a');
    const aSeg = segs.find(s => s.genLine === aLineIdx && s.genColumn === aColIdx);
    expect(aSeg && aSeg.origLine === 0).toBe(true);

    // Assert segment for 'b' is on generated line 1 but maps to original line 3 (line 4 in 1-based),
    // because we compressed three newlines in serialization
    const bLineIdx = 1; // generated is 0-based: second line
    const bColIdx = lines[bLineIdx]!.indexOf('b');
    const bSeg = segs.find(s => s.genLine === bLineIdx && s.genColumn === bColIdx);
    expect(bSeg && bSeg.origLine === 3).toBe(true);
    expect(bSeg?.genLine).toBe(1);
  });

  it('combines segments from different trees (files)', () => {
    const w = new OutputWriter();
    const left = rules([
      decl({ name: any('a'), value: any('1') })
    ]);
    // attach file+location to the declaration itself so segments carry sources
    (left.value[0] as any).treeContext.file = { name: 'left.jess', path: '.', fullPath: '/abs/left.jess' };
    (left.value[0] as any)._location = [0, 1, 1, 0, 1, 5];

    const right = rules([
      decl({ name: any('b'), value: any('2') })
    ]);
    (right.value[0] as any).treeContext.file = { name: 'right.jess', path: '.', fullPath: '/abs/right.jess' };
    (right.value[0] as any)._location = [0, 1, 1, 0, 1, 5];

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
