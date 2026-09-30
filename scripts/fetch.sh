#!/usr/bin/env bash
# Fetch the Redfin pages a run needs, politely.
#
#   scripts/fetch.sh search                    # the three target ZIPs + adjacent coverage check
#   scripts/fetch.sh detail work/urls.txt      # one listing detail page per line of urls.txt
#
# Redfin throttles bursts by returning HTTP 202 with a zero-length body. That is throttling,
# not a dead listing — retry with a longer sleep. Never read a 202 as "off market".
set -uo pipefail

OUT="${OUT:-work}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
mkdir -p "$OUT"

# get <url> <destination> — retries with growing backoff while the body comes back empty
get() {
  local url="$1" dest="$2" delay=6
  for attempt in 1 2 3 4; do
    local code
    code=$(curl -sS -L --max-time 60 -A "$UA" \
                -H "Accept-Language: en-US,en;q=0.9" \
                -H "Referer: https://www.redfin.com/" \
                "$url" -o "$dest" -w "%{http_code}")
    if [ "$code" = "200" ] && [ -s "$dest" ]; then
      printf '  ok   %-8s %s\n' "$(wc -c <"$dest")" "$url"
      return 0
    fi
    printf '  %s   attempt %d, backing off %ds  %s\n' "$code" "$attempt" "$delay" "$url"
    sleep "$delay"
    delay=$((delay * 2))
  done
  printf '  FAIL %s\n' "$url"
  return 1
}

case "${1:-search}" in
  search)
    # 95667 Placerville · 95682 Shingle Springs · 95672 Rescue
    # then adjacent ZIPs, swept only to catch target-city addresses that fall outside the three
    for z in 95667 95682 95672 95619 95623 95664 95726; do
      get "https://www.redfin.com/zipcode/$z" "$OUT/rf_$z.html"
      sleep 4
    done
    ;;
  detail)
    src="${2:-$OUT/urls.txt}"
    mkdir -p "$OUT/det"
    while read -r url; do
      [ -z "$url" ] && continue
      # the trailing path segment is the propertyId; parse_detail.py checks payloads against it
      get "$url" "$OUT/det/${url##*/home/}.html"
      sleep 4
    done < "$src"
    ;;
  *)
    echo "usage: $0 {search|detail [urls-file]}" >&2
    exit 64
    ;;
esac
