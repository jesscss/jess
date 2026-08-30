import * as fs from 'node:fs';
import * as path from 'node:path';
import { docsRoot, packageRoot, walkFiles, ensureDir, cleanDir } from './_fs-utils.mjs';

/**
 * Materialize the single content pool (docs-content/docs/{jess,less,shared}/**)
 * into one gitignored tree per audience facing under docs-content/.site/<facing>.
 *
 * A doc appears on a facing iff its `audiences` frontmatter includes that facing.
 * Path mapping:
 *   - default: strip the leading pool segment (jess/|less/|shared/) and keep the
 *     rest of the relative path under the facing root (numeric prefixes preserved).
 *   - override: a doc may declare `facing_paths: { jess: <relpath>, less: <relpath> }`
 *     (extension-less) to land at a different nav location per facing.
 * Non-doc assets (e.g. _category_.json, images):
 *   - under jess/ or less/: copied only to that same facing.
 *   - under shared/: copied to every facing.
 */

const FACINGS = ['jess', 'less'];
const siteRoot = path.join(packageRoot, '.site');
const isDoc = p => /\.mdx?$/i.test(p);
const docExt = p => (p.toLowerCase().endsWith('.mdx') ? '.mdx' : '.md');

const readFrontmatter = (source) => {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : '';
};

/** Parse the `audiences:` YAML list (block form: `- jess`). */
const parseAudiences = (frontmatter) => {
  const lines = frontmatter.split('\n');
  const out = [];
  let collecting = false;
  for (const line of lines) {
    if (/^audiences:\s*$/.test(line)) {
      collecting = true;
      continue;
    }
    if (collecting) {
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item) {
        out.push(item[1].replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (/^\s+$/.test(line)) {
        continue;
      }
      collecting = false;
    }
  }
  return out;
};

/** Parse the `facing_paths:` YAML map (`jess: <path>` / `less: <path>`). */
const parseFacingPaths = (frontmatter) => {
  const lines = frontmatter.split('\n');
  const out = {};
  let collecting = false;
  for (const line of lines) {
    if (/^facing_paths:\s*$/.test(line)) {
      collecting = true;
      continue;
    }
    if (collecting) {
      const entry = line.match(/^\s+(jess|less):\s*(.+?)\s*$/);
      if (entry) {
        out[entry[1]] = entry[2].replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (/^\s+$/.test(line)) {
        continue;
      }
      collecting = false;
    }
  }
  return out;
};

const writeFile = (dest, source) => {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(source, dest);
};

/** Parse an `include`/`exclude` audience list from an `<AudienceGate>` open tag. */
const parseGateList = (attrs, key) => {
  const m = attrs.match(new RegExp(`${key}=\\{\\[([^\\]]*)\\]\\}`));
  if (!m) {
    return null;
  }
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

/**
 * Resolve `<AudienceGate include|exclude={[...]}>…</AudienceGate>` blocks at
 * materialization time so each facing's `.mdx` is audience-pure (content,
 * headings, and the auto-generated TOC). A matching gate is unwrapped (inner
 * content kept); a non-matching gate is removed entirely. Innermost-first so
 * nested gates resolve correctly; multiline and repeated gates are handled.
 * Everything outside the gate tags is preserved verbatim.
 */
const stripAudienceGates = (source, facing) => {
  const innermostGate =
    /<AudienceGate\b([^>]*)>((?:(?!<AudienceGate\b)[\s\S])*?)<\/AudienceGate>/;
  let out = source;
  let guard = 0;
  while (innermostGate.test(out)) {
    out = out.replace(innermostGate, (whole, attrs, inner) => {
      const include = parseGateList(attrs, 'include');
      const exclude = parseGateList(attrs, 'exclude');
      let keep = true;
      if (include) {
        keep = include.includes(facing);
      }
      if (keep && exclude) {
        keep = !exclude.includes(facing);
      }
      return keep ? inner : '';
    });
    if (++guard > 100000) {
      throw new Error(`stripAudienceGates: runaway on facing ${facing}`);
    }
  }
  return out;
};

const writeDoc = (dest, srcPath, facing) => {
  ensureDir(path.dirname(dest));

  /*
   * Strip the audience gates, then drop the now-dead `import AudienceGate …` line —
   * the tags are gone, so the import would dangle against a component the per-facing
   * build doesn't ship (gating is resolved here at build time, not at runtime).
   */
  const stripped = stripAudienceGates(fs.readFileSync(srcPath, 'utf8'), facing)
    .replace(/^import\s+AudienceGate\s+from\s+['"]@theme\/AudienceGate['"];?[ \t]*\r?\n/m, '');
  fs.writeFileSync(dest, stripped);
};

const main = () => {
  for (const facing of FACINGS) {
    cleanDir(path.join(siteRoot, facing));
  }

  const files = walkFiles(docsRoot);
  const counts = Object.fromEntries(FACINGS.map(f => [f, 0]));

  for (const filePath of files) {
    const rel = path.relative(docsRoot, filePath).split(path.sep).join('/');
    const topSeg = rel.split('/')[0];
    const restPath = rel.slice(topSeg.length + 1);

    if (!isDoc(filePath)) {
      // Non-doc asset: owned-facing dirs go to that facing; shared/ goes to all.
      const targets = topSeg === 'shared' ? FACINGS : FACINGS.filter(f => f === topSeg);
      for (const facing of targets) {
        writeFile(path.join(siteRoot, facing, restPath), filePath);
      }
      continue;
    }

    const frontmatter = readFrontmatter(fs.readFileSync(filePath, 'utf8'));
    const audiences = parseAudiences(frontmatter);
    const facingPaths = parseFacingPaths(frontmatter);

    for (const facing of FACINGS) {
      if (!audiences.includes(facing)) {
        continue;
      }
      const override = facingPaths[facing];
      const destRel = override ? `${override}${docExt(filePath)}` : restPath;
      writeDoc(path.join(siteRoot, facing, destRel), filePath, facing);
      counts[facing] += 1;
    }
  }

  for (const facing of FACINGS) {
    console.log(`Materialized ${counts[facing]} doc(s) into .site/${facing}`);
  }
};

main();
