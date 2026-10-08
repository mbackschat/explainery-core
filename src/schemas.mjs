import { readFileSync } from 'node:fs';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });
const compile = name => ajv.compile(JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8')));
const validateStory = compile('story');
const validateTiming = compile('timing');

function describe({ instancePath, message, params }) {
  const path = instancePath || '/';
  if (params.additionalProperty) return `${path}: must NOT have additional property "${params.additionalProperty}"`;
  if (params.allowedValues) return `${path}: ${message} (${params.allowedValues.join(', ')})`;
  return `${path}: ${message}`;
}

const check = validate => value => (validate(value) ? [] : validate.errors.map(describe));

/** Returns the story's schema violations as "path: message" strings; empty when it conforms. */
export const checkStory = check(validateStory);

/** Returns the timing's schema violations as "path: message" strings; empty when it conforms. */
export const checkTiming = check(validateTiming);
