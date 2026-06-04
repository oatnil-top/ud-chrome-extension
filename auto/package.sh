#!/usr/bin/env bash
# Package the Chrome extension for Chrome Web Store upload.
# Usage: ./auto/package.sh [version]
#   version  Optional semver (e.g. 0.2.0). If omitted, uses current manifest version.
#
# Output: dist/ud-web-clipper-v{version}.zip

set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="manifest.json"
DIST="dist"

# Determine version
if [[ $# -ge 1 ]]; then
  VERSION="$1"
  # Update manifest.json version
  sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" "$MANIFEST"
  echo "Version bumped to $VERSION in manifest.json"
else
  VERSION=$(grep '"version"' "$MANIFEST" | sed 's/.*: "\(.*\)".*/\1/')
fi

echo "Packaging UnderControl Web Clipper v${VERSION}..."

# Clean & create dist
rm -rf "$DIST"
mkdir -p "$DIST"

ZIP_NAME="ud-web-clipper-v${VERSION}.zip"

# Zip extension files, excluding dev/meta files
zip -r "$DIST/$ZIP_NAME" . \
  -x '.*' \
  -x 'auto/*' \
  -x 'dist/*' \
  -x 'node_modules/*' \
  -x 'STORE_LISTING.md' \
  -x 'CLAUDE.md' \
  -x 'README.md' \
  -x '*.sh' \
  -x 'lib/list/*'

echo ""
echo "Done: $DIST/$ZIP_NAME"
echo "Upload at: https://chrome.google.com/webstore/devconsole"
