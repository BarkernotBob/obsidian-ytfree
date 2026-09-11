#!/usr/bin/env bash
# Check and copy the plugin into your vault. The vault path comes from
# YTFREE_VAULT, or from a gitignored .vault file at the repo root.
# Source of truth stays in ~/Projects; the vault only ever holds build output.
set -euo pipefail

cd "$(dirname "$0")"
VAULT="${YTFREE_VAULT:-$(cat .vault 2>/dev/null || true)}"
if [[ -z "$VAULT" ]]; then
  echo "Where is your vault? Either:" >&2
  echo '  echo "$HOME/Documents/My Vault" > .vault      # once, remembered' >&2
  echo '  YTFREE_VAULT="$HOME/Documents/My Vault" ./install.sh' >&2
  exit 1
fi
DEST="$VAULT/.obsidian/plugins/ytfree"

# check, not build: the tests run before anything reaches the vault. The state
# file is shared with a phone, and a change that quietly breaks the merge would
# otherwise be discovered by hidden videos coming back — see tests/merge.test.ts.
npm run check

mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"

echo "Installed to: $DEST"
echo "Now: Obsidian → Settings → Community plugins → reload, then enable 'YT Free'."
