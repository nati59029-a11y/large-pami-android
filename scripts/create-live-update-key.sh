#!/usr/bin/env bash
# One-time script for the project owner: creates the key that signs the live update bundles
# ("עדכון חי"). The phones accept a bundle only if it is signed with this key.
#
# Run it ONCE, on your own computer, from the root of the repository:
#     bash scripts/create-live-update-key.sh
#
# What it does:
#   1. Creates a private key (ECDSA P-256) in a new folder OUTSIDE the repository.
#   2. Shows the matching public key (the build puts it into the app by itself).
#   3. Prints what to copy into the GitHub secret LIVE_UPDATE_SIGNING_KEY.
# It does NOT send anything anywhere, does NOT change the repository, and refuses
# to write its output inside a git repository.
#
# Needs: openssl.
# Optional (for testing): LP_OUT_DIR = output folder (default: ~/large-pami-live-update-YYYYMMDD-HHMMSS)
set -euo pipefail
umask 077

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v openssl >/dev/null 2>&1 || die "openssl not found."

OUT="${LP_OUT_DIR:-$HOME/large-pami-live-update-$(date +%Y%m%d-%H%M%S)}"
[ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ] && die "Output folder already exists and is not empty: $OUT"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
if git -C "$OUT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  rmdir "$OUT" 2>/dev/null || true
  die "The output folder is inside a git repository. Choose a folder outside the repository (LP_OUT_DIR)."
fi

KEY="$OUT/live-update-signing-key.pem"
PUB="$OUT/live-update-public-key.pem"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$KEY" 2>/dev/null
openssl pkey -in "$KEY" -pubout -out "$PUB" 2>/dev/null
FP=$(openssl pkey -pubin -in "$PUB" -outform DER 2>/dev/null | openssl dgst -sha256 | awk '{print $NF}')

say ""
say "Done. Nothing was sent anywhere. Files are in: $OUT"
say "  live-update-signing-key.pem  = the PRIVATE key (secret)"
say "  live-update-public-key.pem   = the public key (not secret)"
say "  public key fingerprint (SHA-256): $FP"
say ""
say "Next steps:"
say "  1. GitHub -> the repository -> Settings -> Secrets and variables -> Actions -> New repository secret"
say "     Name:  LIVE_UPDATE_SIGNING_KEY"
say "     Value: ALL the text of live-update-signing-key.pem, including the BEGIN and END lines."
say "  2. Save a copy of the folder on two USB drives, kept in two different places."
say "     Without this key you cannot sign new bundles; the phones then keep getting updates"
say "     only through a new APK (GitHub Releases), like today."
say "  3. Then delete the folder from this computer."
say "  The build adds the PUBLIC key to the app by itself. Never put the private key in the repository."
