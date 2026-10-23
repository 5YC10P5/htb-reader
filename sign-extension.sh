#!/usr/bin/env sh
# Gets the extension signed by Mozilla (free, unlisted) so it installs
# permanently in normal Firefox. Get API keys at:
# https://addons.mozilla.org/developers/addon/api/key/
cd "$(dirname "$0")" || exit 1
if [ -z "$AMO_JWT_ISSUER" ]; then printf 'Paste your "JWT issuer" key: '; read -r AMO_JWT_ISSUER; fi
if [ -z "$AMO_JWT_SECRET" ]; then printf 'Paste your "JWT secret": '; stty -echo 2>/dev/null; read -r AMO_JWT_SECRET; stty echo 2>/dev/null; echo; fi
npx web-ext sign --source-dir extension --artifacts-dir dist --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
echo
echo 'If it worked, your signed extension (.xpi file) is in the "dist" folder.'
