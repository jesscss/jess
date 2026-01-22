import * as path from 'node:path';

export type StyleLang = 'css' | 'less' | 'scss' | 'jess';

export type FsLike = {
  exists(filePath: string): boolean;
};

export type StylesConfig = {
  /** Project root; used as an optional search base. */
  rootDir?: string;
  /** Less-style include paths. */
  includePaths?: string[];
  /** SCSS-style load paths. */
  loadPaths?: string[];
};

export type ImportStatement = {
  lang: StyleLang;
  specifier: string;
  options?: string[];
  specifierRange: { startOffset: number; endOffset: number };
};

export type ResolveResult = {
  filePath: string;
  resolvedBy: 'exact' | 'extension' | 'partial' | 'index' | 'loadPath';
};

export type ResolveImportOptions = {
  lang: StyleLang;
  fromFilePath: string;
  specifier: string;
  config?: StylesConfig;
};

function uniq<T>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
  }
  return out;
}

function stripQueryHash(input: string): { filePart: string; suffix: string } {
  const m = input.match(/^([^?#]+)([?#].*)?$/);
  return { filePart: m?.[1] ?? input, suffix: m?.[2] ?? '' };
}

// Intentionally tolerant extraction for editor features (not a full parser).
// Supports:
// - @import "x";
// - @import (multiple, reference) "x";
// - @use "x";
// - @import url("x");
export function extractImports(sourceText: string, lang: StyleLang): ImportStatement[] {
  const out: ImportStatement[] = [];

  // options: (a, b) blocks (Less)
  // optional url(
  // then a quoted string
  const re = /@(import|use)\s*(?:\(([^)]*)\)\s*)*(?:url\(\s*)?(?:'([^']+)'|"([^"]+)")/g;
  for (let m: RegExpExecArray | null; (m = re.exec(sourceText)); ) {
    const optionsRaw = m[2] ?? '';
    const options = optionsRaw
      ? optionsRaw.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const spec = m[3] ?? m[4] ?? '';
    if (!spec) continue;

    const startInMatch = m[3] != null ? m[0].indexOf(m[3]) : m[0].indexOf(m[4] ?? '');
    const startOffset = m.index + startInMatch;
    const endOffset = startOffset + spec.length;

    out.push({
      lang,
      specifier: spec,
      options,
      specifierRange: { startOffset, endOffset }
    });
  }

  return out;
}

// Mirrors current plugin behavior:
// - If ext is not .less: try `${importPath}.less`, then `${importPath}`.
// - If ext is .less: try as-is.
export function expandLessImportCandidates(importPath: string): string[] {
  const ext = path.extname(importPath);
  if (ext !== '.less') {
    return [`${importPath}.less`, `${importPath}`];
  }
  return [importPath];
}

// Mirrors current scss plugin behavior (no .sass support):
// - If ext is provided:
//   - try explicit path
//   - also underscore partial variant if basename isn't already underscored
// - Else try:
//   - foo.scss
//   - _foo.scss
//   - foo/index.scss
//   - foo/_index.scss
export function expandScssImportCandidates(importPath: string): string[] {
  const ext = path.extname(importPath);
  const base = ext ? importPath.slice(0, -ext.length) : importPath;

  const candidates: string[] = [];
  const pushUnique = (p: string) => {
    if (!candidates.includes(p)) candidates.push(p);
  };

  const withExt = (p: string) => (p.endsWith('.scss') ? p : `${p}.scss`);

  if (ext) {
    pushUnique(importPath);
    const dir = path.dirname(importPath);
    const file = path.basename(importPath);
    if (!file.startsWith('_')) {
      pushUnique(path.join(dir, `_${file}`));
    }
    return candidates;
  }

  pushUnique(withExt(base));
  pushUnique(withExt(path.join(path.dirname(base), `_${path.basename(base)}`)));
  pushUnique(withExt(path.join(base, 'index')));
  pushUnique(withExt(path.join(base, '_index')));

  return candidates;
}

export function resolveImport(fs: FsLike, opts: ResolveImportOptions): ResolveResult | null {
  const specifier = opts.specifier.trim();
  if (!specifier) return null;

  // Don’t resolve URLs here.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(specifier) || specifier.startsWith('data:')) {
    return null;
  }

  const { filePart, suffix } = stripQueryHash(specifier);

  const fromDir = path.dirname(opts.fromFilePath);
  const cfg = opts.config ?? {};
  const searchPaths: string[] = [fromDir];
  if (opts.lang === 'less' && Array.isArray(cfg.includePaths)) searchPaths.push(...cfg.includePaths);
  if (opts.lang === 'scss' && Array.isArray(cfg.loadPaths)) searchPaths.push(...cfg.loadPaths);
  if (cfg.rootDir) searchPaths.push(cfg.rootDir);

  const candidatesRel =
    opts.lang === 'less'
      ? expandLessImportCandidates(filePart)
      : opts.lang === 'scss'
        ? expandScssImportCandidates(filePart)
        : [filePart.endsWith('.css') ? filePart : `${filePart}.css`, filePart];

  const candidatesAbs: Array<{ p: string; resolvedBy: ResolveResult['resolvedBy'] }> = [];
  for (const baseDir of uniq(searchPaths)) {
    for (const rel of candidatesRel) {
      const abs = path.resolve(baseDir, rel);
      candidatesAbs.push({ p: abs, resolvedBy: baseDir === fromDir ? 'exact' : 'loadPath' });
    }
  }

  for (const c of candidatesAbs) {
    if (fs.exists(c.p)) {
      return { filePath: c.p + suffix, resolvedBy: c.resolvedBy };
    }
  }

  return null;
}

