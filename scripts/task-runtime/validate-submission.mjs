import { readFileSync } from 'node:fs';

const [file] = process.argv.slice(2);

if (!file) {
  console.error('Usage: node scripts/task-runtime/validate-submission.mjs <file>');
  process.exit(2);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function typeMatches(value, expectedType) {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return false;
  }
}

function describeType(type) {
  return Array.isArray(type) ? type.join(' | ') : type;
}

function validateSchema(value, schema, path = '$') {
  const errors = [];

  const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !expectedTypes.some((type) => typeMatches(value, type))) {
    errors.push({
      path,
      message: `expected type ${describeType(schema.type)}`
    });
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      path,
      message: `expected one of ${JSON.stringify(schema.enum)}`
    });
    return errors;
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateSchema(item, schema.items, `${path}[${index}]`));
    });
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = schema.required ?? [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({
          path,
          message: `missing required property ${key}`
        });
      }
    }

    if (schema.properties) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(...validateSchema(value[key], propertySchema, `${path}.${key}`));
        }
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          errors.push({
            path: `${path}.${key}`,
            message: 'additional properties are not allowed'
          });
        }
      }
    }
  }

  return errors;
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

const errors = validateSchema(payload, schema);

if (errors.length > 0) {
  console.error(JSON.stringify(errors, null, 2));
  process.exit(1);
}

console.log('ok');
