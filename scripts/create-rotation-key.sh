#!/usr/bin/env bash
# One-time script for the project owner: prepares a NEW signing key and a
# "proof of rotation" (apksigner rotate) from the OLD key to the new one.
#
# Run it ONCE, on your own computer, from the root of the repository:
#     bash scripts/create-rotation-key.sh
#
# What it does:
#   1. Creates a new signing key (PKCS12 keystore, RSA 4096).
#   2. Creates the proof of rotation (lineage) old key -> new key.
#   3. Writes base64 text files for the GitHub secrets and prints instructions.
# It does NOT send anything anywhere, does NOT change the repository, and refuses
# to write its output inside the repository.
#
# Needs: keytool (comes with Java 17+) and apksigner (Android SDK build-tools).
#
# Optional environment variables (for testing):
#   LP_OUT_DIR    output folder (default: ~/large-pami-signing-YYYYMMDD-HHMMSS)
#   LP_PASSWORD   password for the new key (default: a random one is generated)
#   LP_OLD_KS     old keystore (default: app-source/keystore/debug.keystore)
#   LP_ALIAS      alias of the new key (default: largepami-release)
set -euo pipefail
umask 077

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v keytool >/dev/null 2>&1 || die "keytool not found. Install Java 17 (for example Temurin 17) and try again."
APKSIGNER="${APKSIGNER:-}"
if [ -z "$APKSIGNER" ]; then
  if command -v apksigner >/dev/null 2>&1; then APKSIGNER=$(command -v apksigner)
  elif [ -n "${ANDROID_HOME:-}" ] && ls -d "$ANDROID_HOME"/build-tools/*/ >/dev/null 2>&1; then
    APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner"
  fi
fi
[ -n "$APKSIGNER" ] && [ -x "$APKSIGNER" ] || die "apksigner not found. Install Android SDK build-tools (for example with Android Studio) and set ANDROID_HOME, or set APKSIGNER=/path/to/apksigner."
command -v base64 >/dev/null 2>&1 || die "base64 not found."

OLD_KS="${LP_OLD_KS:-app-source/keystore/debug.keystore}"
[ -f "$OLD_KS" ] || die "Old keystore not found: $OLD_KS (run this script from the root of the repository)."
OLD_ALIAS=androiddebugkey
OLD_PASS=android
NEW_ALIAS="${LP_ALIAS:-largepami-release}"

OUT="${LP_OUT_DIR:-$HOME/large-pami-signing-$(date +%Y%m%d-%H%M%S)}"
[ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ] && die "Output folder already exists and is not empty: $OUT"
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
# Refuse to write secrets inside a git repository (they could be committed by mistake).
if git -C "$OUT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  rmdir "$OUT" 2>/dev/null || true
  die "The output folder is inside a git repository. Choose a folder outside the repository (LP_OUT_DIR)."
fi

if [ -n "${LP_PASSWORD:-}" ]; then
  PW="$LP_PASSWORD"
else
  # 24 random bytes as 48 hex characters (no early-closing pipe, safe with pipefail)
  PW=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
fi
[ "${#PW}" -ge 12 ] || die "Password must be at least 12 characters."
export LP_PW="$PW"

say "== 1/4 Checking the old key"
keytool -list -keystore "$OLD_KS" -storepass "$OLD_PASS" -alias "$OLD_ALIAS" -v 2>/dev/null | grep -E "SHA256:" | head -1

say "== 2/4 Creating the new key: $OUT/release.p12"
keytool -genkeypair -noprompt -keystore "$OUT/release.p12" -storetype PKCS12 \
  -alias "$NEW_ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Large Pami, O=Large Pami, C=IL" \
  -storepass:env LP_PW -keypass:env LP_PW >/dev/null 2>&1
keytool -list -keystore "$OUT/release.p12" -storetype PKCS12 -storepass:env LP_PW -alias "$NEW_ALIAS" -v 2>/dev/null | grep -E "SHA256:" | head -1

say "== 3/4 Creating the proof of rotation (old -> new): $OUT/lineage.bin"
"$APKSIGNER" rotate --out "$OUT/lineage.bin" \
  --old-signer --ks "$OLD_KS" --ks-pass "pass:$OLD_PASS" --ks-key-alias "$OLD_ALIAS" --key-pass "pass:$OLD_PASS" \
  --new-signer --ks "$OUT/release.p12" --ks-type PKCS12 --ks-pass env:LP_PW --ks-key-alias "$NEW_ALIAS" --key-pass env:LP_PW
"$APKSIGNER" lineage --in "$OUT/lineage.bin" --print-certs 2>/dev/null | grep -E "certificate (DN|SHA-256)" || true

say "== 4/4 Writing the values for the GitHub secrets"
base64 <"$OUT/release.p12" | tr -d '\n\r' >"$OUT/RELEASE_KEYSTORE_B64.txt"
base64 <"$OUT/lineage.bin" | tr -d '\n\r' >"$OUT/SIGNING_LINEAGE_B64.txt"
printf '%s' "$PW" >"$OUT/RELEASE_KEYSTORE_PASSWORD.txt"
printf '%s' "$NEW_ALIAS" >"$OUT/RELEASE_KEY_ALIAS.txt"
chmod 600 "$OUT"/*

cat <<EOF

Done. Nothing was sent anywhere. Files are in: $OUT

Add 4 secrets in GitHub (repository large-pami-android):
  Settings -> Secrets and variables -> Actions -> New repository secret
    Name: RELEASE_KEYSTORE_B64        Value: the whole content of RELEASE_KEYSTORE_B64.txt
    Name: RELEASE_KEYSTORE_PASSWORD   Value: the content of RELEASE_KEYSTORE_PASSWORD.txt
    Name: RELEASE_KEY_ALIAS           Value: $NEW_ALIAS
    Name: SIGNING_LINEAGE_B64         Value: the whole content of SIGNING_LINEAGE_B64.txt

Offline backup (very important - without it, future updates cannot be signed):
  - Copy release.p12 and lineage.bin to TWO USB drives, kept in different places.
  - Keep the password separately (password manager or paper), NOT on the same USB drive.
  - Never put these files in the repository, in email or in chat.
After the secrets are added and the backup is checked, delete the four .txt files.
EOF
