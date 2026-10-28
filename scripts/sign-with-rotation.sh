#!/usr/bin/env bash
# Re-signs the APK with key rotation (APK Signature Scheme v3), ONLY when the
# secrets RELEASE_KEYSTORE_B64 and SIGNING_LINEAGE_B64 are set.
#   - Without them: does nothing. The APK stays exactly as Gradle signed it.
#   - With them: v1 + v2 signatures by the OLD key (Android 8 and older keep
#     accepting the update), v3 signature by the NEW key with the proof of
#     rotation (Android 9 and newer move to the new key without uninstalling).
# Usage: sign-with-rotation.sh <apk> <old-keystore>
set -euo pipefail
APK="$1"
OLD_KS="$2"
OLD_ALIAS=androiddebugkey
OLD_PASS=android

if [ -z "${RELEASE_KEYSTORE_B64:-}" ] && [ -z "${SIGNING_LINEAGE_B64:-}" ]; then
  echo "Key rotation secrets are not set: the APK keeps today's signature (old key). Nothing changed."
  exit 0
fi
# Half-configured secrets are an error: better to stop than to publish a wrongly signed APK.
for v in RELEASE_KEYSTORE_B64 RELEASE_KEYSTORE_PASSWORD RELEASE_KEY_ALIAS SIGNING_LINEAGE_B64; do
  [ -n "${!v:-}" ] || { echo "::error::Secret $v is missing. Set all four key rotation secrets, or none of them."; exit 1; }
done

if [ -z "${APKSIGNER:-}" ]; then
  APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner"
fi
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
printf '%s' "$RELEASE_KEYSTORE_B64" | base64 -d >"$T/release.p12"
printf '%s' "$SIGNING_LINEAGE_B64" | base64 -d >"$T/lineage.bin"
export RELEASE_KEYSTORE_PASSWORD

# Newer apksigner versions apply rotation only from Android 13 by default.
# --rotation-min-sdk-version 28 makes the rotation apply from Android 9.
ROT=()
if "$APKSIGNER" sign --help 2>&1 | grep -q -- '--rotation-min-sdk-version'; then
  ROT=(--rotation-min-sdk-version 28)
fi

"$APKSIGNER" sign \
  --ks "$OLD_KS" --ks-pass "pass:$OLD_PASS" --ks-key-alias "$OLD_ALIAS" --key-pass "pass:$OLD_PASS" \
  --next-signer --ks "$T/release.p12" --ks-type PKCS12 --ks-pass env:RELEASE_KEYSTORE_PASSWORD \
  --ks-key-alias "$RELEASE_KEY_ALIAS" --key-pass env:RELEASE_KEYSTORE_PASSWORD \
  --lineage "$T/lineage.bin" "${ROT[@]}" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$T/signed.apk" "$APK"

OUT=$("$APKSIGNER" verify --print-certs -v "$T/signed.apk" 2>&1 | grep -v "^WARNING")
echo "$OUT"
echo "$OUT" | grep -q "Verified using v3 scheme (APK Signature Scheme v3): true" \
  || { echo "::error::The rotated APK is not verified with v3."; exit 1; }
{ echo "### Key rotation signing: ON"; echo '```'; echo "$OUT"; echo '```'; } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
mv "$T/signed.apk" "$APK"
echo "APK re-signed with key rotation."
