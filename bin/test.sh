#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Running tests..."
echo

failed=0

for test in $(find . -name "*.test.js" -not -path "./node_modules/*"); do
  echo "=== $test ==="
  if node "$test"; then
    echo
  else
    failed=1
    echo
  fi
done

if [ $failed -eq 0 ]; then
  echo "All tests passed."
else
  echo "Some tests failed."
  exit 1
fi
