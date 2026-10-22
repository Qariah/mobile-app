#!/usr/bin/env bash
# bounded.sh — run one command with a wall-clock limit, and kill ALL of it at the limit.
#
# Usage:
#   bash scripts/bounded.sh <minutes> -- <command> [args...]
#
# Examples:
#   bash scripts/bounded.sh 45 -- xcodebuild -workspace ios/Qariah.xcworkspace ...
#   bash scripts/bounded.sh 15 -- npx eslint .
#   bash scripts/bounded.sh 45 -- scripts/with-device-lock.sh -- maestro test .maestro/flows/smoke/
#
# Why this exists (planning/retro-automation-jobs-2026-09-27.md §3.2):
#   On 2026-09-22 one eslint call hung for 7 hours in a scheduled run. The Bash tool
#   timeout does not kill a command. At the limit it only moves the command to the
#   background. Only a kill stops a hung command.
#
# Behaviour:
#   - The command runs in its own process group. At the limit, the script sends TERM to
#     the whole group. After 10 more seconds it sends KILL to the group. A child process
#     that the command started is in the same group, so it stops too.
#   - A process that leaves the group on purpose (setsid, for example a Gradle daemon)
#     is not in the group. This script does not kill it.
#   - Exit 124 when the limit stops the command. Otherwise the exit code of the command.
#     A command that a signal stopped gives 128 + the signal number.
#   - Linux: uses GNU `timeout`, which kills the group itself. macOS has no `timeout`,
#     so the script uses a `perl` alarm. Both give the same exit codes.
#
# The limits for scheduled runs are in docs/operations/auto-sprint-policy.json
# (runLimits.commandMinutes). The run-limits hook (.claude/hooks/qariah-run-limits.sh)
# denies a long command in a scheduled run when this script does not wrap it.
set -uo pipefail

usage() {
  echo "usage: bash scripts/bounded.sh <minutes> -- <command> [args...]" >&2
  exit 2
}

[ $# -ge 3 ] || usage
minutes="$1"
shift
case "$minutes" in
  '' | *[!0-9]*) usage ;;
esac
[ "$minutes" -gt 0 ] || usage
[ "$1" = "--" ] || usage
shift

secs=$((minutes * 60))
start=$(date +%s)

timed_out_msg() {
  echo "bounded.sh: TIMEOUT after ${minutes} min. The process group of this command was stopped: $*" >&2
}

if command -v timeout >/dev/null 2>&1 && timeout --version 2>/dev/null | grep -q 'GNU'; then
  timeout --kill-after=10 "${secs}" "$@"
  rc=$?
  # 124 = TERM stopped it. 137 = TERM did not stop it and KILL did.
  if [ "$rc" -eq 124 ] || { [ "$rc" -eq 137 ] && [ $(($(date +%s) - start)) -ge "$secs" ]; }; then
    timed_out_msg "$@"
    exit 124
  fi
  exit "$rc"
fi

command -v perl >/dev/null 2>&1 || {
  echo "bounded.sh: neither GNU timeout nor perl is on PATH, so the command cannot be bounded" >&2
  exit 125
}

BOUNDED_SECS="$secs" perl -e '
  use strict; use warnings; no warnings "exec"; use POSIX ();
  my $secs = $ENV{BOUNDED_SECS};
  my $pid = fork();
  die "bounded.sh: fork failed: $!\n" unless defined $pid;
  if ($pid == 0) {
    setpgrp(0, 0);
    exec { $ARGV[0] } @ARGV
      or do { print STDERR "bounded.sh: cannot run $ARGV[0]: $!\n"; POSIX::_exit(127); };
  }
  setpgrp($pid, $pid);   # the same call in the parent closes the fork race
  my $stage = 0;
  $SIG{ALRM} = sub {
    $stage++;
    if ($stage == 1) { kill "TERM", -$pid; alarm 10; }
    else             { kill "KILL", -$pid; }
  };
  # If this wrapper gets TERM or INT, pass it to the whole group.
  $SIG{TERM} = sub { kill "TERM", -$pid; };
  $SIG{INT}  = sub { kill "INT",  -$pid; };
  alarm $secs;
  my $r;
  while (1) {
    $r = waitpid($pid, 0);
    last if $r == $pid;
    last if $r == -1 && !$!{EINTR};
  }
  my $st = $?;
  alarm 0;
  if ($stage > 0) {
    kill "KILL", -$pid;    # a child that outlived the leader
    exit 124;
  }
  exit(($st & 127) ? 128 + ($st & 127) : ($st >> 8));
' "$@"
rc=$?
if [ "$rc" -eq 124 ] && [ $(($(date +%s) - start)) -ge "$secs" ]; then timed_out_msg "$@"; fi
exit "$rc"
