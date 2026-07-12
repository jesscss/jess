/* eslint-disable no-console */
/**
 * Codemod: rewrite extensionless relative specifiers in TS source to `.js`.
 *
 * Example:
 *   import { x } from "./node";
 * becomes:
 *   import { x } from "./node.js";
 *
 * This is the recommended long-term pattern for Node/Vite ESM projects:
 * - source uses `.js` specifiers
 * - TS resolver maps them to `.ts` during typechecking
 * - emitted JS already matches runtime resolution
 *
 * Usage:
 *   node scripts/codemod-add-js-specifiers.cjs <dir...>
 *
 * Recommended:
 *   node scripts/codemod-add-js-specifiers.cjs packages
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOTS = process.argv.slice(2).filter(Boolean);
if (ROOTS.length === 0) {
  console.error('Usage: node scripts/codemod-add-js-specifiers.cjs <dir...>');
  process.exit(2);
}

const EXT_OK = new Set(['.js', '.mjs', '.cjs', '.json', '.node', '.css', '.less', '.scss']);

function splitSuffix(spec) {
  const q = spec.indexOf('?');
  const h = spec.indexOf('#');
  const cut = (q === -1) ? h : (h === -1 ? q : Math.min(q, h));
  if (cut === -1) return { base: spec, suffix: '' };
  return { base: spec.slice(0, cut), suffix: spec.slice(cut) };
}

function hasKnownExtension(spec) {
  const { base } = splitSuffix(spec);
  return EXT_OK.has(path.extname(base));
}

function resolveTsTarget(fromFile, specBase) {
  const fromDir = path.dirname(fromFile);
  const absBase = path.resolve(fromDir, specBase);
  const candidates = [
    absBase + '.ts',
    absBase + '.tsx',
    absBase + '.mts',
    absBase + '.cts',
    path.join(absBase, 'index.ts'),
    path.join(absBase, 'index.tsx'),
    path.join(absBase, 'index.mts'),
    path.join(absBase, 'index.cts')
  ];
  for (const abs of candidates) {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function toPosixRelative(fromDir, absFile) {
  const rel = path.relative(fromDir, absFile).split(path.sep).join('/');
  return rel.startsWith('.') ? rel : './' + rel;
}

function replaceExtWithJs(p) {
  // replace final extension with .js
  return p.replace(/\.[a-z]+$/i, '.js');
}

function computeReplacement(fromFile, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  if (spec.endsWith('/')) return null;

  const { base, suffix } = splitSuffix(spec);
  const fromDir = path.dirname(fromFile);

  // If spec already has an extension:
  // - keep non-.js (css/json/etc)
  // - for .js: ensure it actually corresponds to a TS file (or directory index)
  if (hasKnownExtension(spec)) {
    if (!base.endsWith('.js')) return null;
    const withoutJs = base.slice(0, -3);
    const target = resolveTsTarget(fromFile, withoutJs);
    if (!target) return null;
    const rel = toPosixRelative(fromDir, target);
    return replaceExtWithJs(rel) + suffix;
  }

  const target = resolveTsTarget(fromFile, base);
  if (!target) return null;

  const rel = toPosixRelative(fromDir, target);
  return replaceExtWithJs(rel) + suffix;
}

function rewriteTsFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  let out = src;

  // from '...'
  out = out.replace(/(from\s+)(['"])(\.[^'"]+)\2/g, (m, p1, q, spec) => {
    const rep = computeReplacement(filePath, spec);
    if (!rep || rep === spec) return m;
    changed = true;
    return `${p1}${q}${rep}${q}`;
  });

  // import '...'
  out = out.replace(/(import\s+)(['"])(\.[^'"]+)\2/g, (m, p1, q, spec) => {
    const rep = computeReplacement(filePath, spec);
    if (!rep || rep === spec) return m;
    changed = true;
    return `${p1}${q}${rep}${q}`;
  });

  // import('...')
  out = out.replace(/(import\s*\(\s*)(['"])(\.[^'"]+)\2(\s*\))/g, (m, p1, q, spec, p4) => {
    const rep = computeReplacement(filePath, spec);
    if (!rep || rep === spec) return m;
    changed = true;
    return `${p1}${q}${rep}${q}${p4}`;
  });

  // require('...') (common in TS sources using createRequire)
  out = out.replace(/(require\s*\(\s*)(['"])(\.[^'"]+)\2(\s*\))/g, (m, p1, q, spec, p4) => {
    const rep = computeReplacement(filePath, spec);
    if (!rep || rep === spec) return m;
    changed = true;
    return `${p1}${q}${rep}${q}${p4}`;
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
      // skip output and dependencies
      if (e.name === 'node_modules' || e.name === 'lib' || e.name === 'dist' || e.name === '.turbo') continue;
      walk(abs, files);
    } else if (e.isFile()) {
      if (abs.endsWith('.ts') || abs.endsWith('.tsx') || abs.endsWith('.mts') || abs.endsWith('.cts')) {
        files.push(abs);
      }
    }
  }
  return files;
}

let touched = 0;
let total = 0;
for (const root of ROOTS) {
  const absRoot = path.resolve(process.cwd(), root);
  const files = walk(absRoot);
  for (const f of files) {
    total++;
    if (rewriteTsFile(f)) touched++;
  }
}

console.log(`[codemod-add-js-specifiers] processed ${total} files; updated ${touched}`);

