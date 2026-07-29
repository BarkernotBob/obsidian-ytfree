#!/usr/bin/env bash
# Build and copy the plugin into the MyVault vault.
# Source of truth stays in ~/Projects; the vault only ever holds build output.
set -euo pipefail

VAULT="${YTFREE_VAULT:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault}"
DEST="$VAULT/.obsidian/plugins/ytfree"

cd "$(dirname "$0")"
# check, not build: the tests run before anything reaches the vault. The state
# file is shared with a phone, and a change that quietly breaks the merge would
# otherwise be discovered by hidden videos coming back — see tests/merge.test.ts.
npm run check

mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"

echo "Installed to: $DEST"
echo "Now: Obsidian → Settings → Community plugins → reload, then enable 'YT Free'."
