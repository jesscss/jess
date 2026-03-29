import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = join(process.cwd(), 'lib');
const content = "export * from '../src/index.js';\n";

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.d.ts'), content);
writeFileSync(join(outDir, 'index.d.cts'), content);
