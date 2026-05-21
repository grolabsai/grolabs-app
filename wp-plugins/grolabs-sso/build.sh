#!/usr/bin/env bash
# Build the GroLabs SSO plugin into a versioned zip for WordPress upload.
#
# Output: build/grolabs-sso-v<version>.zip   (version read from plugin header)
#
# Usage: ./build.sh   (run from inside wp-plugins/grolabs-sso/)

set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(grep -E "^\s*\*\s*Version:" grolabs-sso.php | head -1 | awk '{print $NF}')
if [[ -z "${VERSION}" ]]; then
  echo "Could not read Version from grolabs-sso.php header" >&2
  exit 1
fi

OUT_DIR="build"
OUT_FILE="${OUT_DIR}/grolabs-sso-v${VERSION}.zip"

mkdir -p "${OUT_DIR}"
rm -f "${OUT_FILE}"

# Zip everything except build/, *.DS_Store, and the build script itself
cd ..
zip -r "grolabs-sso/${OUT_FILE}" grolabs-sso \
  -x "grolabs-sso/build/*" \
  -x "grolabs-sso/build.sh" \
  -x "*.DS_Store" >/dev/null

echo "Built: wp-plugins/grolabs-sso/${OUT_FILE}"
