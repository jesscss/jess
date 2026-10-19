import { describe, expect, it } from 'vitest';
import { createTriviaMapFromParseman } from '@jesscss/core/ast';
import { makeSassRegistry } from '@jesscss/fns/sass/registry';
import { cssSyntax } from '@jesscss/parser-shared/recognition';
import { createTriviaMapFromParseman as coreAstSource } from '../../core/src/ast.js';
import { makeSassRegistry as sassRegistrySource } from '../../fns/src/sass/registry.js';
import { cssSyntax as recognitionSource } from '../../parser-shared/src/recognition.js';

/**
 * `vitest.config.ts` aliases every workspace SUBPATH export to source, not only the
 * bare package names. A subpath left on node resolution loads built `lib` — a
 * second, possibly stale, module instance beside the source one. That includes a
 * package with subpath exports and no root entry (`@jesscss/parser-shared`).
 */
describe('workspace subpath aliases', () => {
  it('resolve a subpath export to the same module as its source file', () => {
    expect(createTriviaMapFromParseman).toBe(coreAstSource);
    expect(makeSassRegistry).toBe(sassRegistrySource);
    expect(cssSyntax).toBe(recognitionSource);
  });
});
