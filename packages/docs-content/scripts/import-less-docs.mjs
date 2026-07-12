import * as fs from 'node:fs';
import * as path from 'node:path';
import { cleanDir, docsRoot, ensureDir, walkFiles } from './_fs-utils.mjs';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const sourceFlag = args.find(arg => arg.startsWith('--source='));
  if (sourceFlag) {
    return sourceFlag.slice('--source='.length);
  }
  const sourceIdx = args.indexOf('--source');
  if (sourceIdx >= 0 && args[sourceIdx + 1]) {
    return args[sourceIdx + 1];
  }
  return '';
};

const sourceRoot = parseArgs();
if (!sourceRoot) {
  throw new Error('Missing required --source path to less/less-docs');
}

const contentRoot = path.join(path.resolve(sourceRoot), 'content');
if (!fs.existsSync(contentRoot)) {
  throw new Error(`Could not find less-docs content directory at: ${contentRoot}`);
}

const targetRoot = path.join(docsRoot, 'less');
cleanDir(targetRoot);

const toTitle = (raw) => {
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, m => m.toUpperCase());
};

const getFrontmatterTitle = (source) => {
  const match = source.match(/^---\n[\s\S]*?\n---\n?/);
  if (!match) {
    return null;
  }
  const titleMatch = match[0].match(/^title:\s*(.+)$/m);
  return titleMatch ? titleMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
};

const stripExistingFrontmatter = (source) => {
  return source.replace(/^---\n[\s\S]*?\n---\n?/, '');
};

const sanitizeMarkdown = (source) => {
  return source
    // Legacy less-docs used runtime holder.js placeholders; replace with neutral text marker.
    .replace(/!\[[^\]]*]\(holder\.js\/100x40\/[^)]+\)/g, '`[color swatch]`');
};

const markdownFiles = walkFiles(contentRoot).filter(filePath => filePath.endsWith('.md'));

for (const filePath of markdownFiles) {
  const rel = path.relative(contentRoot, filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const title = getFrontmatterTitle(source) ?? toTitle(path.basename(filePath, '.md'));
  const slug = `/${rel.replace(/\\/g, '/').replace(/\.md$/, '')}`;
  const body = sanitizeMarkdown(stripExistingFrontmatter(source)).trim();
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `slug: ${JSON.stringify(slug)}`,
    'audiences:',
    '  - less',
    'origin: less',
    '---',
    ''
  ].join('\n');

  const outPath = path.join(targetRoot, rel);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, `${frontmatter}${body}\n`, 'utf8');
}

console.log(`Imported Less docs markdown files: ${markdownFiles.length}`);
console.log(`  from ${contentRoot}`);
console.log(`  to   ${targetRoot}`);
