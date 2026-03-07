import * as fs from 'node:fs';
import * as path from 'node:path';
import { docsRoot, walkFiles } from './_fs-utils.mjs';

const hasFrontmatter = source => source.startsWith('---\n');

const parseFrontmatter = (source) => {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: '', body: source };
  }
  const frontmatter = match[1] ?? '';
  const body = source.slice(match[0].length);
  return { frontmatter, body };
};

const stripAudienceAndOrigin = (frontmatter) => {
  const lines = frontmatter.split('\n');
  const out = [];
  let skippingAudienceItems = false;
  for (const line of lines) {
    if (/^\s*audiences:\s*/.test(line)) {
      skippingAudienceItems = true;
      continue;
    }
    if (skippingAudienceItems) {
      if (/^\s*-\s+/.test(line) || /^\s+$/.test(line)) {
        continue;
      }
      skippingAudienceItems = false;
    }
    if (/^\s*origin:\s*/.test(line)) {
      continue;
    }
    out.push(line);
  }
  return out.join('\n').trim();
};

const files = walkFiles(docsRoot).filter(p => p.endsWith('.md') || p.endsWith('.mdx'));

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(docsRoot, filePath).replace(/\\/g, '/');
  const inferredAudience = rel.startsWith('less/') ? 'less' : 'jess';

  if (!hasFrontmatter(source)) {
    const title = path.basename(filePath).replace(/\.(md|mdx)$/i, '');
    const body = source.trim();
    const content = [
      '---',
      `title: ${JSON.stringify(title)}`,
      'audiences:',
      `  - ${inferredAudience}`,
      `origin: ${inferredAudience}`,
      '---',
      '',
      body,
      ''
    ].join('\n');
    fs.writeFileSync(filePath, content, 'utf8');
    continue;
  }

  const { frontmatter, body } = parseFrontmatter(source);
  let next = stripAudienceAndOrigin(frontmatter);
  next = `${next}\naudiences:\n  - ${inferredAudience}\norigin: ${inferredAudience}`.trim();
  const content = `---\n${next}\n---\n${body.replace(/^\n*/, '')}`;
  fs.writeFileSync(filePath, content, 'utf8');
}

console.log(`Normalized frontmatter in ${files.length} docs files.`);
