import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Compiler } from '../../src';
import lessPlugin from '@jesscss/plugin-less';
import { serializeTypes } from '@jesscss/core';

describe('Debug extend count - ONE extend statement', () => {
  it('should find only 1 Extend node', async () => {
    const lessCode = `
.ext {
  test: 1;
}
.a, .b {
  .c:extend(.ext all) {
    test: 3;
    .d {
      test: 4;
    }
  }
}
`;

    const tmpFile = join(__dirname, 'tmp-extend-count.less');
    writeFileSync(tmpFile, lessCode);

    try {
      const compiler = new Compiler({
        output: { collapseNesting: true },
        compile: {
          plugins: [lessPlugin()]
        }
      });

      const context = compiler.createContext(tmpFile);
      const { node } = await context.getTree(tmpFile);
      
      // Count Extend nodes in the parsed tree
      const sExpr = serializeTypes(node);
      const extendMatches = sExpr.match(/\(Extend/g);
      const extendCount = extendMatches?.length || 0;
      
      // Find all Extend nodes and show their structure
      const allExtends = sExpr.match(/\(Extend[\s\S]{0,2000}?\)/g);
      
      console.log(`Extend nodes in parsed tree: ${extendCount}`);
      if (allExtends) {
        allExtends.forEach((ext, i) => {
          console.log(`\nExtend ${i + 1}:`);
          console.log(ext.substring(0, 1000));
        });
      }
      
      // Show the full S-expression structure around Extend nodes
      const extendIndices: number[] = [];
      let idx = sExpr.indexOf('(Extend');
      while (idx !== -1) {
        extendIndices.push(idx);
        idx = sExpr.indexOf('(Extend', idx + 1);
      }
      
      console.log(`\nExtend node positions in S-expression:`);
      extendIndices.forEach((pos, i) => {
        const context = sExpr.substring(Math.max(0, pos - 200), Math.min(sExpr.length, pos + 500));
        console.log(`\nExtend ${i + 1} at position ${pos}:`);
        console.log(context);
      });
      
      // There should only be 1 Extend node
      expect(extendCount).toBe(1);
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
