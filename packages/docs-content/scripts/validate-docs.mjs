import * as fs from 'node:fs';
import { docsRoot, walkFiles } from './_fs-utils.mjs';

const files = walkFiles(docsRoot).filter(p => p.endsWith('.md') || p.endsWith('.mdx'));
const errors = [];

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  if (!source.startsWith('---\n')) {
    errors.push(`${filePath}: missing frontmatter`);
    continue;
  }
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    errors.push(`${filePath}: malformed frontmatter`);
    continue;
  }
  const fm = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  if (!/^\s*title:\s*/m.test(fm)) {
    errors.push(`${filePath}: missing frontmatter.title`);
  }
  if (!/^\s*audiences:\s*$/m.test(fm)) {
    errors.push(`${filePath}: missing frontmatter.audiences`);
  }
  if (!/^\s*origin:\s*/m.test(fm)) {
    errors.push(`${filePath}: missing frontmatter.origin`);
  }
  if (!body) {
    errors.push(`${filePath}: empty body`);
  }
}

if (errors.length > 0) {
  console.error('Docs validation failed:');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log(`Docs validation passed for ${files.length} file(s).`);
