/*
 * The CHEAP STATIC COMPLEMENT to the behavioural acceptance matrix.
 *
 * ## What this is, and what it is NOT
 *
 * The gate is `acceptance-matrix.test.ts`. This module is a second, much
 * weaker instrument that costs almost nothing: pull every at-keyword LITERAL
 * out of the four grammar sources and diff the sets. It flags at-keywords a
 * dialect names that the CSS base does not, which is a CANDIDATE list for the
 * corpus — nothing more. It cannot prove anything about behaviour, because a
 * grammar can name a production and still refuse the input, or accept the input
 * through a generic arm while naming nothing.
 *
 * ## Why it reads inside `regex()` bodies
 *
 * Because that is where scss hides `@charset`. There is no `CharsetStatement`
 * production in the scss grammar at all; the at-keyword appears only as one
 * alternative of
 *
 *   regex(/@(?:charset|namespace|layer)(?![-_a-zA-Z0-9-￿])/i)
 *
 * (`packages/syntax/scss/scss-parser/src/grammar.ts:4478`). An extractor that
 * only read `identWord('@x')`-style string literals would report scss as having
 * no `@charset` and no `@namespace`, which is the opposite of true. So the
 * scanner expands `@(?:a|b|c)` alternations, and reads regex literals as well
 * as strings.
 *
 * ## Why it strips comments first
 *
 * These grammar files carry long prose comments that cite at-keywords by name.
 * Scanning raw text would report every at-keyword ever DISCUSSED as one the
 * grammar recognises, which would bury the real signal completely.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../..');

export const GRAMMAR_DIALECTS = ['css', 'less', 'scss', 'jess'] as const;

export type GrammarDialect = (typeof GRAMMAR_DIALECTS)[number];

export const GRAMMAR_SOURCES: Record<GrammarDialect, string> = {
  css: 'packages/syntax/css/css-parser/src/grammar.ts',
  less: 'packages/syntax/less/less-parser/src/grammar.ts',
  scss: 'packages/syntax/scss/scss-parser/src/grammar.ts',
  jess: 'packages/syntax/jess/jess-parser/src/grammar.ts'
};

/**
 * Remove `/* … *\/` and `// …` comments.
 *
 * Deliberately conservative: it tracks string and regex-literal state so that a
 * `//` inside a URL string or a `/*` inside a character class is not treated as
 * a comment opener. Getting that wrong would silently swallow grammar text and
 * make the extractor under-report, which is the failure mode that matters here.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  /** null when in code; otherwise the delimiter we are inside. */
  let inside: '"' | '\'' | '`' | '/' | null = null;

  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];

    if (inside !== null) {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 2;
        continue;
      }
      if (inside === '/' && c === '[') {
        /* Inside a character class `/` is literal, so skip to its close. */
        const close = source.indexOf(']', i);
        const end = close === -1 ? source.length : close + 1;
        out += source.slice(i, end);
        i = end;
        continue;
      }
      if (c === inside) {
        inside = null;
      }
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (c === '/' && next === '/') {
      const close = source.indexOf('\n', i);
      i = close === -1 ? source.length : close;
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') {
      inside = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/') {
      /*
       * A `/` here is a regex literal only if the previous non-space code
       * character cannot end an expression. In these grammar files every regex
       * literal follows `(`, `,`, `=`, `[`, `:` or `return`, so this is
       * sufficient and never misreads a division.
       */
      const prev = out.replace(/\s+$/, '').slice(-1);
      if (prev === '' || '(,=[:!&|?{;'.includes(prev)) {
        inside = '/';
      }
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * At-keywords in `text`, lowercased.
 *
 * Two forms are recognised: a plain `@ident`, and an alternation
 * `@(?:a|b|c)` / `@(a|b|c)`, which is expanded into one keyword per branch.
 * The alternation form is not a nicety — it is the only way `@charset` and
 * `@namespace` are visible in scss at all.
 */
export function extractAtKeywords(text: string): Set<string> {
  const found = new Set<string>();
  const code = stripComments(text);

  const alternation = /@\((\?:)?([-a-zA-Z|]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = alternation.exec(code)) !== null) {
    for (const branch of match[2]!.split('|')) {
      if (branch.length > 0) {
        found.add(`@${branch.toLowerCase()}`);
      }
    }
  }

  /* Plain `@ident`. `\\-` and `\\@` appear in regex escapes; a leading digit is
   * excluded so `@1foo` fixtures and `\@` escapes do not read as keywords. */
  const plain = /@(-{0,2}[a-zA-Z][-a-zA-Z0-9]*)/g;
  while ((match = plain.exec(code)) !== null) {
    found.add(`@${match[1]!.toLowerCase()}`);
  }

  return found;
}

/** At-keyword literals per dialect, read from the four grammar sources. */
export function atKeywordsByDialect(): Record<GrammarDialect, Set<string>> {
  /*
   * Built by naming all four keys, not by accumulating into an empty object.
   * The accumulating form needs a cast to claim the record is complete, and a
   * cast here would let a dropped dialect read as an empty diff.
   */
  const read = (dialect: GrammarDialect): Set<string> => {
    const relative = GRAMMAR_SOURCES[dialect];
    const text = readFileSync(resolve(REPO_ROOT, relative), 'utf8');
    if (text.length === 0) {
      throw new Error(`at-keyword extraction: ${relative} is empty — the diff would be meaningless`);
    }
    return extractAtKeywords(text);
  };
  return { css: read('css'), less: read('less'), scss: read('scss'), jess: read('jess') };
}
