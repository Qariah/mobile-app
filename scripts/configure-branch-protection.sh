#!/bin/bash
#
# Configure GitHub branch protection on `qariah-main`.
#
# Usage:
#   ./scripts/configure-branch-protection.sh
#
# Requires a GitHub token with `repo` scope (admin on the repo). The
# logged-in `gh` CLI's token is used; verify with `gh auth status`.
#
# This is the single source of truth for the `qariah-main` protection
# config — if branch protection drifts, re-run this script. The settings
# match Sprint 26 CI-1's hardening bundle (see CLAUDE.md).
#
# Idempotent: safe to re-run. The PUT replaces the existing protection
# config wholesale with this script's payload.

set -euo pipefail

REPO="${REPO:-omar-zarka/qariah-v2}"
BRANCH="${BRANCH:-qariah-main}"

# Required status checks — these must match the `name:` fields of the
# workflows that gate PRs. Keep this list in sync with
# `.github/workflows/*.yml` whenever a job is added or renamed.
#
# Workflow → check name mapping (as of Sprint 26):
#   .github/workflows/branding-conformance.yml → "No hardcoded Bayaan brand strings"
#   .github/workflows/lint.yml                  → "Prettier, ESLint, TypeScript"
#   .github/workflows/test.yml                  → "Jest"
#   .github/workflows/claude-code-review.yml    → "claude-review"
#
# Note: GitHub uses the job's `name:` field if set, otherwise the job id.
# The "Run Claude Code Review" step's outer job has no explicit name, so
# the job id `claude-review` is what shows up as a required check.

CONTEXTS_JSON='[
  "No hardcoded Bayaan brand strings",
  "Prettier, ESLint, TypeScript",
  "Jest",
  "claude-review"
]'

# Build the payload. PUT /repos/{owner}/{repo}/branches/{branch}/protection
# replaces the existing config; absent keys revert to defaults.
PAYLOAD=$(cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": $CONTEXTS_JSON
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
)

echo "Applying branch protection to ${REPO}@${BRANCH}…"
echo "$PAYLOAD" | gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}/branches/${BRANCH}/protection" \
  --input -

echo ""
echo "✓ Branch protection applied. Verify:"
echo "    gh api repos/${REPO}/branches/${BRANCH}/protection | jq ."
