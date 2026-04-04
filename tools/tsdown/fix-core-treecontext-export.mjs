import { readFile, writeFile } from 'node:fs/promises';

const files = process.argv.slice(2);

if (!files.length) {
  throw new Error('Expected one or more declaration files to patch.');
}

for (const file of files) {
  const source = await readFile(file, 'utf8');
  const patched = source.replace(/\btype TreeContext\b/g, 'TreeContext');
  if (patched !== source) {
    await writeFile(file, patched);
  }
}
