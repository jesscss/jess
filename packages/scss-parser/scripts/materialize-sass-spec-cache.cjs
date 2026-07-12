/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Materialize sass-spec HRX fixtures into a local cache directory.
 *
 * Why: HRX parsing + directory walking is expensive, and we want a stable
 * intermediate format we can reuse across multiple test suites.
 *
 * Output (gitignored):
 *   packages/scss-parser/.cache/sass-spec/manifest.json
 *   packages/scss-parser/.cache/sass-spec/inputs/<id>.scss
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * sass-spec HRX format (simplified):
 * <===> path/to/file
 * ... contents ...
 * <===>
 * ================================================================================
 */
function parseHrx(text) {
  /** @type {{ sectionPath: string, contents: string }[]} */
  const out = [];
  const lines = text.split(/\r?\n/);
  /** @type {string | undefined} */
  let currentPath;
  /** @type {string[]} */
  let buf = [];

  const flush = () => {
    if (!currentPath) return;
    out.push({ sectionPath: currentPath, contents: buf.join('\n') });
  };

  for (const line of lines) {
    const start = /^<===>\s+(.+?)\s*$/.exec(line);
    const end = /^<===>\s*$/.test(line) || /^<===+>\s*$/.test(line);
    if (start) {
      flush();
      currentPath = start[1];
      buf = [];
    } else if (end) {
      flush();
      currentPath = undefined;
      buf = [];
    } else if (/^=+$/.test(line)) {
      // section separator
    } else {
      if (currentPath) buf.push(line);
    }
  }
  flush();
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function stableJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function writeFileIfChanged(filePath, contents) {
  try {
    if (fs.existsSync(filePath)) {
      const prev = fs.readFileSync(filePath, 'utf8');
      if (prev === contents) return false;
    }
  } catch {}
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents);
  return true;
}

function main() {
  const pkgRoot = path.resolve(__dirname, '..');
  const cacheRoot = path.join(pkgRoot, '.cache', 'sass-spec');
  const inputsDir = path.join(cacheRoot, 'inputs');
  const manifestPath = path.join(cacheRoot, 'manifest.json');

  // Resolve sass-spec from this package.
  let sassSpecDir;
  try {
    sassSpecDir = path.dirname(require.resolve('sass-spec/package.json', { paths: [pkgRoot] }));
  } catch (e) {
    console.warn('[scss-parser] sass-spec not installed; skipping cache materialization.');
    return;
  }

  const specRoot = path.join(sassSpecDir, 'spec');
  if (!fs.existsSync(specRoot) || !fs.statSync(specRoot).isDirectory()) {
    console.warn(`[scss-parser] sass-spec "spec" dir not found at ${specRoot}; skipping.`);
    return;
  }

  // Keep feature bucketing consistent with test suite.
  const features = [
    { name: 'map', match: (rel) => rel.includes('/map/') || rel.includes('core_functions/map/') },
    { name: 'mixin', match: (rel) => rel.includes('mixin') || rel.includes('include') || rel.includes('callable') },
    { name: 'control', match: (rel) => rel.includes('/if/') || rel.includes('/for/') || rel.includes('/each/') || rel.includes('/while/') },
    { name: 'modules', match: (rel) => rel.includes('module') || rel.includes('/use/') || rel.includes('/forward/') }
  ];

  const allHrx = walk(specRoot).filter((p) => p.endsWith('.hrx')).sort();

  /** @type {{ id: string, feature: string, hrxRelPath: string, sectionPath: string, inputRelPath: string }[]} */
  const cases = [];
  let wroteAny = false;

  for (const hrxPath of allHrx) {
    const hrxRelPath = path.relative(specRoot, hrxPath).replace(/\\/g, '/');
    const relLower = hrxRelPath.toLowerCase();
    const feature = features.find((f) => f.match(relLower))?.name;
    if (!feature) continue;

    const hrxText = fs.readFileSync(hrxPath, 'utf8');
    const sections = parseHrx(hrxText);
    for (const s of sections) {
      if (!s.sectionPath.endsWith('/input.scss')) continue;
      const id = sha1(`${feature}\n${hrxRelPath}\n${s.sectionPath}\n${s.contents}`).slice(0, 16);
      const inputRelPath = `inputs/${id}.scss`;
      const inputAbsPath = path.join(cacheRoot, inputRelPath);
      wroteAny = writeFileIfChanged(inputAbsPath, s.contents) || wroteAny;
      cases.push({ id, feature, hrxRelPath, sectionPath: s.sectionPath, inputRelPath });
    }
  }

  cases.sort((a, b) =>
    a.feature.localeCompare(b.feature) ||
    a.hrxRelPath.localeCompare(b.hrxRelPath) ||
    a.sectionPath.localeCompare(b.sectionPath) ||
    a.id.localeCompare(b.id)
  );

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sassSpecDir,
    specRoot,
    cases
  };

  ensureDir(inputsDir);
  wroteAny = writeFileIfChanged(manifestPath, stableJson(manifest)) || wroteAny;

  if (wroteAny) {
    console.log(`[scss-parser] sass-spec cache updated: ${path.relative(pkgRoot, manifestPath)} (${cases.length} cases)`);
  }
}

main();

