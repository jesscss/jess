import { describe, expect, it } from 'vitest';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';
import { parse as parseScss } from '../../../../syntax/scss/scss-parser/src/index.js';
import { buildEvaluator } from '../evaluator.js';
import { makeLessRegistry } from '@jesscss/fns';
import { serialize } from '../serialize.js';
import type { ImportDocument, ImportDocumentRequest } from '../serialize.js';

const evaluator = buildEvaluator(makeLessRegistry());

const LESS_CASES = [
  '@import "a.less";',
  '@import "a.css";',
  '@import url("a.css");',
  '@import (css) "a";',
  '@import (inline) "a.txt";',
  '@import (inline) "a.txt" (min-width: 100px);',
  '@import (reference) "a";',
  '@import (optional) "nope";',
  '@import "@{name}.css";',
  '@import "a" screen and (min-width: 100px);',
  '@import (css) "a.css";',
  '@import (less) "a.css";',
  '@import (multiple) "a";',
  '@import "a.css" screen;',
  '@import "a.css";\n@import "a.css";\n.x { color: red; }',
  '@import "http://example.com/a";',
  '@name: b;\n@import "@{name}.css";',
  '@w: 100px;\n@import (css) "a.css" (min-width: @w);',
  '@import (reference) "a.css";'
];

const SCSS_CASES = [
  '@use "x";',
  '@use "x" as y;',
  '@forward "x";',
  '@import "partial";',
  '@import "a.css";',
  '@use "x" with ($a: 1px);',
  '@import url("a.css");',
  '@import "a" screen;'
];

/* eslint-disable @typescript-eslint/naming-convention -- keys are FILE NAMES, not identifiers. */

const docs: Record<string, string> = {
  'a.less': '.a { color: red; }\n',
  a: '.a { color: red; }\n',
  'a.css': '.acss { color: blue; }\n',
  partial: '.partial { color: green; }\n',
  x: '.x-mod { color: teal; }\n',
  'b.css': '.bcss { color: gray; }\n'
};

/*
 * The stub replicates the gate `importThroughContext` applied BEFORE this change
 * (the deleted `canLoadImport`), so the with-loader column is comparable across
 * the change instead of measuring an ungated seam no real driver used.
 */
const declinedByOldGate = (request: ImportDocumentRequest): boolean => {
  const words = request.options === null ? [] : request.options.toLowerCase().split(',').map(w => w.trim());
  return words.includes('css')
    || (request.specifier.toLowerCase().endsWith('.css') && !words.includes('less'));
};

const importDocument = (parseFn: (src: string) => unknown) =>
  (request: ImportDocumentRequest): ImportDocument | undefined => {
    const spec = request.specifier;
    if (request.options !== null && /\binline\b/u.test(request.options)) {
      return { inline: 'RAW_BYTES\n' };
    }
    if (declinedByOldGate(request)) {
      return undefined;
    }
    const src = docs[spec];
    if (src === undefined) {
      return undefined;
    }
    return { document: parseFn(src) as never, key: spec };
  };

const renderLess = async (src: string, withLoader: boolean): Promise<string> => {
  const root = parseLess(src);
  const out = await serialize(root, {
    evaluator,
    ...(withLoader ? { importDocument: importDocument(s => parseLess(s)) } : {})
  });
  return out.css;
};

const renderScss = async (src: string, withLoader: boolean): Promise<string> => {
  const root = parseScss(src);
  const out = await serialize(root, {
    evaluator,
    ...(withLoader ? { importDocument: importDocument(s => parseScss(s)) } : {})
  });
  return out.css;
};

describe('import byte probe', () => {
  it('less, no loader', async () => {
    const lines: string[] = [];
    for (const src of LESS_CASES) {
      let out: string;
      try {
        out = await renderLess(src, false);
      } catch (error) {
        out = `!! ${error instanceof Error ? error.message : String(error)}`;
      }
      lines.push(`--- ${JSON.stringify(src)}\n${out}`);
    }
    expect(lines.join('\n')).toMatchSnapshot();
  });

  it('less, with loader', async () => {
    const lines: string[] = [];
    for (const src of LESS_CASES) {
      let out: string;
      try {
        out = await renderLess(src, true);
      } catch (error) {
        out = `!! ${error instanceof Error ? error.message : String(error)}`;
      }
      lines.push(`--- ${JSON.stringify(src)}\n${out}`);
    }
    expect(lines.join('\n')).toMatchSnapshot();
  });

  it('scss, no loader', async () => {
    const lines: string[] = [];
    for (const src of SCSS_CASES) {
      let out: string;
      try {
        out = await renderScss(src, false);
      } catch (error) {
        out = `!! ${error instanceof Error ? error.message : String(error)}`;
      }
      lines.push(`--- ${JSON.stringify(src)}\n${out}`);
    }
    expect(lines.join('\n')).toMatchSnapshot();
  });

  it('scss, with loader', async () => {
    const lines: string[] = [];
    for (const src of SCSS_CASES) {
      let out: string;
      try {
        out = await renderScss(src, true);
      } catch (error) {
        out = `!! ${error instanceof Error ? error.message : String(error)}`;
      }
      lines.push(`--- ${JSON.stringify(src)}\n${out}`);
    }
    expect(lines.join('\n')).toMatchSnapshot();
  });
});
