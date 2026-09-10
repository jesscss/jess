import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../src/index.js';

/**
 * Minimal base64-VLQ source-map decoder. Returns every mapping as absolute
 * values so a test can assert that a generated position resolves to the right
 * source FILE + line + column — the multi-file (`@import`) correctness crux.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface DecodedMapping {
  genLine: number; // 0-based
  genColumn: number; // 0-based
  sourceIndex: number;
  sourceLine: number; // 0-based
  sourceColumn: number; // 0-based
}

function decodeMappings(mappings: string): DecodedMapping[] {
  const out: DecodedMapping[] = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  const lines = mappings.split(';');
  for (let genLine = 0; genLine < lines.length; genLine++) {
    let genColumn = 0;
    const segments = lines[genLine]!.length === 0 ? [] : lines[genLine]!.split(',');
    for (const segment of segments) {
      const fields = decodeVlqSegment(segment);
      genColumn += fields[0]!;
      if (fields.length >= 4) {
        sourceIndex += fields[1]!;
        sourceLine += fields[2]!;
        sourceColumn += fields[3]!;
        out.push({ genLine, genColumn, sourceIndex, sourceLine, sourceColumn });
      }
    }
  }
  return out;
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = B64.indexOf(char);
    const continuation = digit & 32;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
    } else {
      const negate = value & 1;
      value >>= 1;
      values.push(negate ? -value : value);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

interface V3Map {
  version: number;
  sources: string[];
  names: string[];
  mappings: string;
  file?: string;
  sourcesContent?: string[];
}

describe('source map generation (live AST-v2 render path)', () => {
  let dir: string;
  let entry: string;
  let importedPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-sourcemap-'));
    importedPath = path.join(dir, 'imported.less');
    entry = path.join(dir, 'entry.less');
    fs.writeFileSync(importedPath, '.imported {\n  color: green;\n}\n');
    fs.writeFileSync(entry, '@import "imported";\n.entry {\n  color: red;\n}\n');
  });

  afterEach(() => {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits the annotation and maps a generated position back to the IMPORTED file', async () => {
    const result = await new Compiler().renderToResult(entry, {
      output: { sourceMap: { outputSourceFiles: true, sourceMapFilename: 'entry.css.map' } }
    });

    // (a) annotation present
    expect(result.css).toContain('/*# sourceMappingURL=entry.css.map */');
    expect(result.sourceMapURL).toBe('entry.css.map');
    expect(result.map).toBeTypeOf('string');

    const map = JSON.parse(result.map!) as V3Map;
    expect(map.version).toBe(3);
    expect(map.names).toEqual([]);

    /* both files present; outputSourceFiles embeds their content */
    expect(map.sources).toContain(importedPath);
    expect(map.sources).toContain(entry);
    expect(map.sourcesContent).toBeDefined();
    const importedSourceIndex = map.sources.indexOf(importedPath);
    expect(map.sourcesContent![importedSourceIndex]).toContain('.imported');

    /*
     * (b) THE CRUX: a generated position resolves to the imported file.
     * `.imported` is emitted verbatim at the top of the output.
     */
    const cssLines = result.css.split('\n');
    const genLine = cssLines.findIndex(line => line.startsWith('.imported'));
    expect(genLine).toBeGreaterThanOrEqual(0);

    const decoded = decodeMappings(map.mappings);
    const importedMappings = decoded.filter(m => m.sourceIndex === importedSourceIndex);
    expect(importedMappings.length).toBeGreaterThan(0);

    // The `.imported` selector: generated line start -> imported.less line 1, col 0.
    const selectorMapping = importedMappings.find(m => m.genLine === genLine && m.genColumn === 0);
    expect(selectorMapping).toBeDefined();
    expect(selectorMapping!.sourceLine).toBe(0); // 0-based line 1
    expect(selectorMapping!.sourceColumn).toBe(0);

    // A declaration inside the imported file (`color: green;` is indented 2 cols).
    const declGenLine = cssLines.findIndex(line => line.includes('color: green'));
    const declMapping = importedMappings.find(m => m.genLine === declGenLine);
    expect(declMapping).toBeDefined();
    expect(declMapping!.sourceLine).toBe(1); // 0-based line 2
    expect(declMapping!.sourceColumn).toBe(2); // after two spaces of indent
  });

  it('honors sourceMapFileInline / disableSourcemapAnnotation / sourceMapRootpath', async () => {
    const inline = await new Compiler().renderToResult(entry, {
      output: { sourceMap: { sourceMapFileInline: true } }
    });
    expect(inline.css).toMatch(/sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+/);

    const disabled = await new Compiler().renderToResult(entry, {
      output: { sourceMap: { sourceMapFilename: 'x.map', disableSourcemapAnnotation: true } }
    });
    expect(disabled.css).not.toContain('sourceMappingURL');
    expect(disabled.map).toBeTypeOf('string'); // map still produced for external write

    const rooted = await new Compiler().renderToResult(entry, {
      output: { sourceMap: { sourceMapRootpath: 'assets/', sourceMapBasepath: dir } }
    });
    const rootedMap = JSON.parse(rooted.map!) as V3Map;
    expect(rootedMap.sources).toContain('assets/imported.less');
    expect(rootedMap.sources).toContain('assets/entry.less');
  });

  it('is zero-cost when off: no annotation and byte-identical to a bare render', async () => {
    const off = await new Compiler().renderToResult(entry, {});
    expect(off.css).not.toContain('sourceMappingURL');
    expect(off.map).toBeUndefined();
    expect(off.sourceMapURL).toBeUndefined();

    const bare = await new Compiler().render(entry, {});
    expect(bare).toBe(off.css);
  });
});
