import * as path from 'node:path';
import { cleanDir, copyTree, docsRoot, repoRoot } from './_fs-utils.mjs';

const source = path.join(repoRoot, 'packages', 'docs', 'docs');
const target = path.join(docsRoot, 'jess');

cleanDir(target);
copyTree(source, target);

console.log(`Migrated Jess docs:\n  from ${source}\n  to   ${target}`);
