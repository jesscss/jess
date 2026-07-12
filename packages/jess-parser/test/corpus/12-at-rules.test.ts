/**
 * Corpus 12 — Jess `@-` at-rules (compiler at-rules; dash-prefixed for future-CSS
 * safety).
 *
 *   @-compose 'path' [as ns|*];   → StyleImport{ type: 'compose' }
 *   @-export 'path';              → StyleImport{ type: 'compose', forward }
 *   @-import 'path';              → StyleImport{ type: 'import' }  (renders @import)
 *   @-use 'path' [as ns];         → JsImport{ source: 'use' }     (namespace module)
 *   @-from 'path' import (…) | * as ns;  → JsImport{ source: 'from' }  (ESM)
 *
 * `@-use` and `@-from` are DISTINCT constructs (user-adjudicated #3), not aliases:
 * `@-use` is the Sass-module namespace form, `@-from` the ESM `import` form. Both
 * map to a `JsImport`, differing by `source`.
 *
 * The at-rule surface lives in node OPTIONS (type/namespace/imports), not in the
 * serialized value, so these assert the round-tripped `toTrimmedString` — the
 * canonical surface oracle — rather than `serializeTypes`.
 *
 * NOTE: `@-import` round-trips as `@import` (core deliberately overlaps the CSS
 * at-rule; `StyleImport{ type: 'import' }.writeSyntax` emits `@import`).
 */
import { describe, it, expect } from 'vitest';
import { parse } from './_util.js';

/** Parse a top-level `@-…` statement and return its node's `toTrimmedString`. */
function atRuleSyntax(src: string): string {
  const { tree } = parse(src);
  type Serializable = { toTrimmedString(): string };
  type Holder = { rules?: Serializable[]; value?: Serializable[] };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const holder = tree as unknown as Holder;
  const node = holder.rules?.[0] ?? holder.value?.[0];
  return node!.toTrimmedString();
}

describe('corpus/at-rules', () => {
  it('`@-compose` → StyleImport, round-trips with `as ns`', () => {
    expect(atRuleSyntax('@-compose \'./theme\' as theme;')).toBe('@-compose \'./theme\' as theme;');
  });

  it('`@-compose` without namespace', () => {
    expect(atRuleSyntax('@-compose \'./theme.jess\';')).toBe('@-compose \'./theme.jess\';');
  });

  it('`@-compose … as *` (no namespace)', () => {
    expect(atRuleSyntax('@-compose \'./theme.jess\' as *;')).toBe('@-compose \'./theme.jess\' as *;');
  });

  it('`@-export` → StyleImport with forward', () => {
    expect(atRuleSyntax('@-export \'./stylesheet.jess\';')).toBe('@-export \'./stylesheet.jess\';');
  });

  it('`@-import` → StyleImport{ type: import } (renders as @import)', () => {
    expect(atRuleSyntax('@-import \'./my-file.jess\';')).toBe('@import \'./my-file.jess\';');
  });

  it('`@-use` (namespace module), with and without `as`', () => {
    expect(atRuleSyntax('@-use \'./my-module.js\';')).toBe('@-use \'./my-module.js\';');
    expect(atRuleSyntax('@-use \'./my-module.js\' as js;')).toBe('@-use \'./my-module.js\' as js;');
  });

  it('`@-from … import (name as alias)` (ESM named import)', () => {
    expect(atRuleSyntax('@-from \'./my-module.js\' import (myFunc as fromJs);'))
      .toBe('@-from \'./my-module.js\' import (myFunc as fromJs);');
  });

  it('`@-from … import * as ns` (ESM namespace import)', () => {
    expect(atRuleSyntax('@-from \'./my-module.js\' import * as js;'))
      .toBe('@-from \'./my-module.js\' import * as js;');
  });

  it('`@-from … import (a, b as c)` (mixed named + aliased)', () => {
    expect(atRuleSyntax('@-from \'./m.js\' import (a, b as c);'))
      .toBe('@-from \'./m.js\' import (a, b as c);');
  });

  it('`@-compose` / `@-from` build StyleImport / JsImport respectively', () => {
    const { tree: composeTree } = parse('@-compose \'./theme\';');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const compose = (composeTree as unknown as { rules: Array<{ type: string }> }).rules[0];
    expect(compose!.type).toBe('StyleImport');
    const { tree: fromTree } = parse('@-from \'./m.js\' import (a);');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const from = (fromTree as unknown as { rules: Array<{ type: string }> }).rules[0];
    expect(from!.type).toBe('JsImport');
  });
});
