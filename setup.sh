#!/usr/bin/env bash
# One-line install for someone who already has Obsidian on a Mac:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/BarkernotBob/obsidian-ytfree/main/setup.sh)"
#
# Installs Homebrew if missing, then yt-dlp, downloads the latest release of the
# plugin into the vault's .obsidian/plugins/ytfree/, and enables it. Re-running
# it updates to the latest release. `bash -c "$(curl …)"` rather than
# `curl … | bash` so the prompts below can read from the terminal.
set -euo pipefail

REPO="BarkernotBob/obsidian-ytfree"
RELEASE="https://github.com/$REPO/releases/latest/download"
FILES=(main.js manifest.json styles.css)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "This installer is for macOS. On other systems, install yt-dlp and copy the plugin files by hand — see the README."

# ── 1. Homebrew + yt-dlp ─────────────────────────────────────────────────────
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  [[ -x "$b" ]] && eval "$("$b" shellenv)" && break
done
if ! command -v brew >/dev/null; then
  say "Installing Homebrew (it will ask for your Mac password)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [[ -x "$b" ]] && eval "$("$b" shellenv)" && break
  done
  command -v brew >/dev/null || die "Homebrew did not install. Open a new Terminal window and run this again."
fi

if command -v yt-dlp >/dev/null; then
  say "yt-dlp already installed; updating…"
  brew upgrade yt-dlp >/dev/null 2>&1 || true
else
  say "Installing yt-dlp…"
  brew install yt-dlp
fi

# ── 2. Find the vault ────────────────────────────────────────────────────────
VAULT="${YTFREE_VAULT:-}"
if [[ -z "$VAULT" ]]; then
  REGISTRY="$HOME/Library/Application Support/obsidian/obsidian.json"
  VAULTS=()
  if [[ -f "$REGISTRY" ]]; then
    while IFS= read -r line; do VAULTS+=("$line"); done < <(
      python3 -c 'import json,sys; [print(v["path"]) for v in json.load(open(sys.argv[1]))["vaults"].values()]' "$REGISTRY" 2>/dev/null || true
    )
  fi
  if [[ ${#VAULTS[@]} -eq 1 ]]; then
    VAULT="${VAULTS[0]}"
  elif [[ ${#VAULTS[@]} -gt 1 ]]; then
    say "Which vault?"
    for i in "${!VAULTS[@]}"; do printf '  %d) %s\n' "$((i + 1))" "$(basename "${VAULTS[$i]}")  (${VAULTS[$i]})"; done
    while :; do
      read -r -p "Number: " n
      [[ "$n" =~ ^[0-9]+$ ]] && (( n >= 1 && n <= ${#VAULTS[@]} )) && break
    done
    VAULT="${VAULTS[$((n - 1))]}"
  else
    say "Could not find your Obsidian vault."
    read -r -p "Drag your vault folder into this window and press Return: " VAULT
    VAULT="${VAULT%"${VAULT##*[![:space:]]}"}"   # trim trailing space Finder adds
    VAULT="${VAULT//\\ / }"                        # un-escape spaces from drag-and-drop
  fi
fi
[[ -d "$VAULT" ]] || die "Not a folder: $VAULT"

# ── 3. Download the plugin ───────────────────────────────────────────────────
DEST="$VAULT/.obsidian/plugins/ytfree"
say "Installing YT Free into $(basename "$VAULT")…"
mkdir -p "$DEST"
for f in "${FILES[@]}"; do
  curl -fsSL "$RELEASE/$f" -o "$DEST/$f" || die "Download failed: $RELEASE/$f"
done

# ── 4. Enable it ─────────────────────────────────────────────────────────────
# Obsidian keeps its own copy of this list in memory and writes it back on any
# settings change, so only edit it while Obsidian is closed.
LIST="$VAULT/.obsidian/community-plugins.json"
if pgrep -xq Obsidian; then
  say "Done. Last step, in Obsidian:"
  echo "  Settings → Community plugins → click the reload icon next to “Installed plugins” → turn on YT Free."
  echo "  (If it says Restricted mode, click “Turn on community plugins” first.)"
else
  python3 - "$LIST" <<'EOF'
import json, os, sys
p = sys.argv[1]
try:
    ids = json.load(open(p))
except (OSError, ValueError):
    ids = []
if "ytfree" not in ids:
    ids.append("ytfree")
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(ids, open(p, "w"))
EOF
  say "Done. Open Obsidian — YT Free is switched on."
  echo "  (If Obsidian says Restricted mode: Settings → Community plugins → “Turn on community plugins”.)"
fi
echo
echo "Use it: put a YouTube link inside a \`\`\`ytfree code block in any note."
