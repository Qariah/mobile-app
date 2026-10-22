// @ai
//
// scripts/lib/auto-sprint-policy.mjs — a shared reader for
// docs/operations/auto-sprint-policy.json. scripts/local-pr-checks.mjs and
// scripts/check-ci-health.mjs both use it for `adopt.advisoryWorkflows` and
// `adopt.requiredWorkflows`, so those two cannot drift apart. The path comes
// from this file's location, not from the caller's cwd.

import {readFileSync} from 'node:fs';

const POLICY_URL = new URL(
  '../../docs/operations/auto-sprint-policy.json',
  import.meta.url,
);

/** The whole policy object. Throws when the file is missing or not JSON. */
export function readPolicy() {
  return JSON.parse(readFileSync(POLICY_URL, 'utf8'));
}

/** The `adopt` block, or `{}` when the policy has none. */
export function readAdopt() {
  return readPolicy().adopt || {};
}
