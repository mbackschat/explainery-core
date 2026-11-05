import { readFileSync } from 'node:fs';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true });
const schema = (name: string) => JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));
ajv.addSchema(schema('story'), 'story.schema.json');
const compile = (name: string) => ajv.compile(schema(name));
const validateStory = ajv.getSchema('story.schema.json')!;
const validateSceneSource = compile('scene');
const validateTiming = compile('timing');

function describe({ instancePath, message, params }: ErrorObject): string {
  const path = instancePath || '/';
  if (params.additionalProperty) return `${path}: must NOT have additional property "${params.additionalProperty}"`;
  if (params.allowedValues) return `${path}: ${message} (${params.allowedValues.join(', ')})`;
  return `${path}: ${message}`;
}

const check = (validate: ValidateFunction) => (value: unknown): string[] => (validate(value) ? [] : (validate.errors ?? []).filter(error => error.keyword !== 'if').map(describe));

/** Returns the story's schema violations as "path: message" strings; empty when it conforms. */
export const checkStory = check(validateStory);

/** Returns violations of a referenced scene definition, including visual/card source exclusivity. */
export const checkSceneSource = check(validateSceneSource);

/** Returns the timing's schema violations as "path: message" strings; empty when it conforms. */
export const checkTiming = check(validateTiming);
