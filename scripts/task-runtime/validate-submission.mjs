import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const [file] = process.argv.slice(2);

if (!file) {
  console.error('Usage: node scripts/task-runtime/validate-submission.mjs <file>');
  process.exit(2);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

let schema;
let payload;

try {
  schema = loadJson(new URL('./worker-submission.schema.json', import.meta.url));
} catch (error) {
  console.error(`Failed to read schema: ${error.message}`);
  process.exit(1);
}

try {
  payload = loadJson(file);
} catch (error) {
  console.error(`Failed to read submission: ${error.message}`);
  process.exit(1);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

if (!validate(payload)) {
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}

console.log('ok');
