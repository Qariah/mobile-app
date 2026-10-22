#!/usr/bin/env node
// @ai
//
// scripts/signals/schema.mjs
// --------------------------
// The JSON Schema of a signals snapshot: the envelope, the shared types in
// $defs, and the `data` schema that each section exports. The page (Phase 3)
// and the brief (Phase 2) read files that pass this schema only.
//
//   node scripts/signals/schema.mjs --write   # regenerate snapshot.schema.json
//   node scripts/signals/schema.mjs --check   # exit 1 when the file is stale
//
// Shared types (use them as {$ref: '#/$defs/<name>'} in a section schema):
//   cell        a people count: 0, an integer >= 5, or "<5" — never 1 to 4
//   cellOrNull  a cell or null (no data)
//   eventCell   an event count: 0, an integer >= 5, or "<5" (1 to 4 events always
//               come from 1 to 4 installs)
//   rate        {num: cell, den: cell, value: number|null, lowN: boolean}
//   laDate      'YYYY-MM-DD'
//   notInstrumented  the string "notInstrumented" (an event the build does not send)

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import Ajv from 'ajv';
import {SECTIONS} from './sections/index.mjs';

export const SCHEMA_VERSION = 1;
export const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'snapshot.schema.json',
);
export const STATUSES = ['ok', 'partial', 'pending', 'not_configured', 'error'];

export const DEFS = {
  cell: {
    anyOf: [{const: 0}, {type: 'integer', minimum: 5}, {const: '<5'}],
  },
  cellOrNull: {anyOf: [{$ref: '#/$defs/cell'}, {type: 'null'}]},
  eventCell: {
    anyOf: [{const: 0}, {type: 'integer', minimum: 5}, {const: '<5'}],
  },
  rate: {
    type: 'object',
    required: ['num', 'den', 'value', 'lowN'],
    additionalProperties: false,
    properties: {
      num: {$ref: '#/$defs/cell'},
      den: {$ref: '#/$defs/cell'},
      value: {type: ['number', 'null'], minimum: 0},
      lowN: {type: 'boolean'},
    },
  },
  laDate: {type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$'},
  notInstrumented: {const: 'notInstrumented'},
};

const sectionEnvelope = dataSchema => ({
  type: 'object',
  required: ['status', 'source', 'ms', 'data'],
  additionalProperties: false,
  properties: {
    status: {enum: STATUSES},
    source: {type: 'string'},
    ms: {type: 'integer', minimum: 0},
    notes: {type: 'array', items: {type: 'string'}},
    error: {type: 'string', maxLength: 300},
    data: {anyOf: [{type: 'null'}, dataSchema]},
  },
  // ok and partial carry data; error, pending and not_configured may not.
  if: {properties: {status: {enum: ['ok', 'partial']}}},
  then: {properties: {data: {not: {type: 'null'}}}},
});

export function composeSchema(sections = SECTIONS) {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://qariah.org/schemas/signals-snapshot.json',
    title: 'Qariah signals snapshot',
    type: 'object',
    required: [
      'schemaVersion',
      'generatedAt',
      'date',
      'dataThrough',
      'asOf',
      'tz',
      'git',
      'rules',
      'sections',
    ],
    additionalProperties: false,
    properties: {
      schemaVersion: {const: SCHEMA_VERSION},
      generatedAt: {type: 'string', format: 'date-time'},
      date: {$ref: '#/$defs/laDate'},
      dataThrough: {$ref: '#/$defs/laDate'},
      asOf: {type: 'string'},
      tz: {const: 'America/Los_Angeles'},
      git: {
        type: 'object',
        required: ['sha'],
        properties: {sha: {type: 'string'}, ref: {type: 'string'}},
      },
      rules: {type: 'object', additionalProperties: {type: 'string'}},
      sections: {
        type: 'object',
        // A section added after the first files (`addedAt`) is optional, so an
        // older file stays valid (the check step validates yesterday's file).
        required: sections.filter(s => !s.addedAt).map(s => s.name),
        additionalProperties: false,
        properties: Object.fromEntries(
          sections.map(s => [s.name, sectionEnvelope(s.schema)]),
        ),
      },
    },
    $defs: DEFS,
  };
}

let compiled;
/** Validate a snapshot. Returns {valid, errors: ['<path> <message>']}. */
export function validateSnapshot(snapshot, schema) {
  const validate =
    schema !== undefined
      ? newAjv().compile(schema)
      : (compiled ||= newAjv().compile(composeSchema()));
  const valid = validate(snapshot);
  return {
    valid,
    errors: valid
      ? []
      : validate.errors
          .slice(0, 50)
          .map(e => `${e.instancePath || '/'} ${e.message}`),
  };
}

function newAjv() {
  // ajv-formats is not a dependency, so `format` is not checked. snapshot.mjs
  // writes generatedAt with Date.toISOString().
  return new Ajv({allErrors: true, strict: false, validateFormats: false});
}

const render = () => `${JSON.stringify(composeSchema(), null, 2)}\n`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes('--write')) {
    writeFileSync(SCHEMA_PATH, render());
    console.log(`wrote ${SCHEMA_PATH}`);
  } else if (process.argv.includes('--check')) {
    let cur = '';
    try {
      cur = readFileSync(SCHEMA_PATH, 'utf8');
    } catch {
      /* missing → stale */
    }
    if (cur !== render()) {
      console.error(
        'snapshot.schema.json is stale: run node scripts/signals/schema.mjs --write',
      );
      process.exit(1);
    }
    console.log('snapshot.schema.json is current');
  } else {
    process.stdout.write(render());
  }
}
