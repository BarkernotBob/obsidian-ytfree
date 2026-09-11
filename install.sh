#!/usr/bin/env bash
# Check and copy the plugin into your vault. Set YTFREE_VAULT to the vault path.
# Source of truth stays in ~/Projects; the vault only ever holds build output.
set -euo pipefail

if [[ -z "${YTFREE_VAULT:-}" ]]; then
  echo "Set YTFREE_VAULT to your vault path, e.g.:" >&2
  echo '  YTFREE_VAULT="$HOME/Documents/My Vault" ./install.sh' >&2
  exit 1
fi
VAULT="$YTFREE_VAULT"
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
