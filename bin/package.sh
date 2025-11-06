#!/usr/bin/env bash
set -euo pipefail

# Package the Chrome extension into a zip file suitable for upload.
# Usage (from repo root):
#   ./extension/bin/package.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_DIR="${EXT_DIR}/chrome"
OUT_DIR="${EXT_DIR}/dist"

if ! command -v zip >/dev/null 2>&1; then
  echo "error: 'zip' command not found. Please install it (e.g. 'brew install zip' or your OS equivalent)." >&2
  exit 1
fi

if [ ! -f "${SRC_DIR}/manifest.json" ]; then
  echo "error: manifest.json not found in ${SRC_DIR}" >&2
  exit 1
fi

# Extract version from manifest.json (best-effort).
VERSION_RAW="$(grep -m1 '"version"' "${SRC_DIR}/manifest.json" || true)"
VERSION="$(printf '%s\n' "${VERSION_RAW}" | sed -E 's/.*\"version\"[^0-9]*([0-9.]+).*/\1/' | tr -d '[:space:]')"
if [ -z "${VERSION}" ]; then
  VERSION="dev"
fi

mkdir -p "${OUT_DIR}"
OUT_FILE="${OUT_DIR}/overmod-chrome-v${VERSION}.zip"

echo "Packaging Chrome extension from ${SRC_DIR}"
echo "Output: ${OUT_FILE}"

rm -f "${OUT_FILE}"
(
  cd "${SRC_DIR}"
  zip -r "${OUT_FILE}" . >/dev/null
)

echo "Done."
