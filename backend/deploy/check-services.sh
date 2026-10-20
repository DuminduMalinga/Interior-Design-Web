#!/usr/bin/env bash
# Checks a deployed backend: every service answers /health, and each one lets
# your web app's address call it from the browser (CORS).
#
#   ./check-services.sh https://3-110-20-5.nip.io https://your-app.vercel.app
#
# First argument: the public address of the services (SITE_ADDRESS, with https://).
# Second argument: the address of the deployed web app (an ALLOWED_ORIGINS entry).
# The detector is skipped with a note if it is not running (it is optional on small servers).

set -u
SITE="${1:-}"
ORIGIN="${2:-}"
if [ -z "$SITE" ] || [ -z "$ORIGIN" ]; then
  echo "usage: $0 <services-address> <web-app-address>" >&2
  exit 2
fi
SITE="${SITE%/}"
ORIGIN="${ORIGIN%/}"

failed=0
for name in detector living-room bedroom kitchen bathroom dining master-bedroom; do
  url="$SITE/$name/health"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo 000)
  if [ "$code" != "200" ]; then
    if [ "$name" = "detector" ]; then
      echo "SKIP  $name  (HTTP $code - start it with: docker compose --profile detector up -d)"
    else
      echo "FAIL  $name  health returned HTTP $code"
      failed=1
    fi
    continue
  fi

  allow=$(curl -s -o /dev/null -D - --max-time 15 -H "Origin: $ORIGIN" "$url" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin" {print $2}')
  if [ "$allow" = "$ORIGIN" ] || [ "$allow" = "*" ]; then
    echo "OK    $name  health 200, CORS allows $ORIGIN"
  else
    echo "FAIL  $name  health 200 but CORS does not allow $ORIGIN (ALLOWED_ORIGINS in .env)"
    failed=1
  fi
done

exit $failed
