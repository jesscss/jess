#!/bin/bash
# Profile a vitest test with CPU profiling enabled.
# Usage: ./scripts/profile-test.sh <package> [test-filter]
#
# Examples:
#   ./scripts/profile-test.sh css-parser
#   ./scripts/profile-test.sh jess "all-less" -t "at-rules-declarations"
#   ./scripts/profile-test.sh core "mixin"
#
# Profiles are saved to ./profiling/ in the package directory.

set -e

PACKAGE="${1:?Usage: $0 <package> [vitest args...]}"
shift

PROF_DIR="packages/$PACKAGE/profiling"
mkdir -p "$PROF_DIR"

echo "Profiling @jesscss/$PACKAGE tests..."
echo "Output: $PROF_DIR/"
echo ""

pnpm --filter "@jesscss/$PACKAGE" exec vitest run \
  --pool=forks \
  --poolOptions.forks.singleFork \
  --poolOptions.forks.execArgv='["--cpu-prof","--cpu-prof-dir=./profiling"]' \
  "$@"

echo ""
echo "Profile(s) saved to $PROF_DIR/"
echo "Open in Chrome DevTools: chrome://inspect → Open dedicated DevTools for Node"
