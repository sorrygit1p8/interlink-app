#!/usr/bin/env bash
# Static verification only. These deliberately non-working settings are never
# deployed or used to send an Auth/database request.
set -euo pipefail
INTERLINK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${INTERLINK_TOOLS_ENV:-}" ]; then
    if [ ! -f "$INTERLINK_TOOLS_ENV" ]; then
        printf '%s\n' 'INTERLINK_TOOLS_ENV must name an existing environment file.' >&2
        exit 1
    fi
    if [[ "$INTERLINK_TOOLS_ENV" = /* ]]; then
        source "$INTERLINK_TOOLS_ENV"
    else
        source "./$INTERLINK_TOOLS_ENV"
    fi
fi
export CI=1 EXPO_OFFLINE=1 EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1
export EXPO_PUBLIC_DATA_MODE=supabase EXPO_PUBLIC_APP_ENV=production
export EXPO_PUBLIC_SUPABASE_URL=https://static-bundle-check.invalid
export EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_static_bundle_check_not_a_real_key
export INTERLINK_ANDROID_PACKAGE=invalid.interlink.staticcheck
export INTERLINK_IOS_BUNDLE_ID=invalid.interlink.staticcheck
cd "$INTERLINK_ROOT/apps/mobile"
../../node_modules/.bin/expo export --platform all --no-bytecode \
  --source-maps external --max-workers 1 \
  --output-dir "$INTERLINK_ROOT/artifacts/prod-check"
python3 "$INTERLINK_ROOT/scripts/check-production-bundle.py"
