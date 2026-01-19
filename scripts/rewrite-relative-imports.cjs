/* eslint-disable no-console */
/**
 * Rewrite extensionless relative ESM imports/exports in emitted JS to include `.js`.
 *
 * Why:
 * - Our TS build emits ESM (`import ... from './x'`) but many runtimes (Node/Vite SSR)
 *   require full specifiers for ESM and will not resolve `./x` to `./x.js`.
 *
 * Usage:
 *   node scripts/rewrite-relative-imports.cjs <dir1> <dir2> ...
 *
 * Example:
 *   node ../../scripts/rewrite-relative-imports.cjs ./lib
 */
const fs = require('node:fs');
const path = require('node:path');

const INPUT_DIRS = process.argv.slice(2).filter(Boolean);
if (INPUT_DIRS.length === 0) {
  console.error('Usage: node scripts/rewrite-relative-imports.cjs <dir...>');
  process.exit(2);
}

const EXT_OK = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);

function hasKnownExtension(spec) {
  const clean = spec.split('?')[0].split('#')[0];
  return EXT_OK.has(path.extname(clean));
}

function splitSuffix(spec) {
  // preserve ?query and/or #hash
  const q = spec.indexOf('?');
  const h = spec.indexOf('#');
  const cut = (q === -1) ? h : (h === -1 ? q : Math.min(q, h));
  if (cut === -1) return { base: spec, suffix: '' };
  return { base: spec.slice(0, cut), suffix: spec.slice(cut) };
}

function resolveWithJsExtension(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  if (spec.endsWith('/')) return null;
  if (hasKnownExtension(spec)) return null;

  const { base, suffix } = splitSuffix(spec);
  const fromDir = path.dirname(fromFile);
  const absBase = path.resolve(fromDir, base);

  const candidates = [
    absBase + '.js',
    absBase + '.mjs',
    absBase + '.cjs',
    path.join(absBase, 'index.js'),
    path.join(absBase, 'index.mjs'),
    path.join(absBase, 'index.cjs')
  ];

  for (const abs of candidates) {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const rel = path.relative(fromDir, abs).split(path.sep).join('/');
      const relWithDot = rel.startsWith('.') ? rel : './' + rel;
      return relWithDot + suffix;
    }
  }
  return null;
}

function rewriteFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Handles:
  // - import ... from './x'
  // - export ... from './x'
  // - export * from './x'
  // - import './x'
  // - import('./x')
  let out = src;

  // from '...'
  out = out.replace(/(from\s+)(['"])(\.[^'"]+)\2/g, (m, p1, quote, spec) => {
    const replacement = resolveWithJsExtension(filePath, spec);
    if (!replacement) return m;
    changed = true;
    return `${p1}${quote}${replacement}${quote}`;
  });

  // import '...'
  out = out.replace(/(import\s+)(['"])(\.[^'"]+)\2/g, (m, p1, quote, spec) => {
    const replacement = resolveWithJsExtension(filePath, spec);
    if (!replacement) return m;
    changed = true;
    return `${p1}${quote}${replacement}${quote}`;
  });

  // import('...')
  out = out.replace(/(import\s*\(\s*)(['"])(\.[^'"]+)\2(\s*\))/g, (m, p1, quote, spec, p4) => {
    const replacement = resolveWithJsExtension(filePath, spec);
    if (!replacement) return m;
    changed = true;
    return `${p1}${quote}${replacement}${quote}${p4}`;
  });

  if (changed) {
    fs.writeFileSync(filePath, out, 'utf8');
  }
  return changed;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(abs, files);
    } else if (e.isFile()) {
      if (abs.endsWith('.js') || abs.endsWith('.mjs') || abs.endsWith('.cjs')) {
        files.push(abs);
      }
    }
  }
  return files;
}

let touched = 0;
let total = 0;
for (const input of INPUT_DIRS) {
  const dir = path.resolve(process.cwd(), input);
  const files = walk(dir);
  for (const f of files) {
    total++;
    if (rewriteFile(f)) touched++;
  }
}

if (process.env.DEBUG) {
  console.log(`[rewrite-relative-imports] processed ${total} files; updated ${touched}`);
}

