# Branding conformance: drop the matches that sit inside a block comment.
#
# Input: `grep -n` lines, `path:line:text` (scripts/check-branding.sh).
# Output: the same lines, without the ones inside a block comment that starts
# at the beginning of a line with `/*` or with the JSX form `{/*`.
#
# Why: a JSX comment (`{/* … */}`) has no `*` at the start of each line, so the
# line filter in check-branding.sh (`//`, `/*`, `*`, `*/`) cannot see that a
# continuation line is a comment. Upstream writes JSX comments in that form.
#
# The gate still catches user-visible text:
#   - a comment ends at the first `*/`, as in JavaScript;
#   - the line that ends the comment counts as a comment only when nothing but
#     an optional `}` and white space follows the `*/`;
#   - a comment that opens after code on the same line is not skipped.
#
# Run: awk -f scripts/lib/branding-comment-filter.awk  (matches on stdin)

function load(path,    line, n, open, text, pos, rest) {
  delete commentLine
  n = 0
  open = 0
  while ((getline line < path) > 0) {
    n++
    text = line
    if (!open && text ~ /^[[:space:]]*[{]?\/\*/) {
      open = 1
      sub(/^[[:space:]]*[{]?\/\*/, "", text)
    }
    if (!open) continue
    pos = index(text, "*/")
    if (pos == 0) {
      commentLine[n] = 1
      continue
    }
    open = 0
    rest = substr(text, pos + 2)
    if (rest ~ /^[}]?[[:space:]]*$/) commentLine[n] = 1
  }
  close(path)
  loaded = path
}

{
  if (!match($0, /^[^:]+:[0-9]+:/)) {
    print
    next
  }
  head = substr($0, 1, RLENGTH - 1)
  path = head
  sub(/:[0-9]+$/, "", path)
  lineNo = head
  sub(/^.*:/, "", lineNo)
  if (path != loaded) load(path)
  if (!((lineNo + 0) in commentLine)) print
}
