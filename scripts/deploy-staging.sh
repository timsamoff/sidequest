#!/bin/bash
# Deploys this working tree to the staging Worker at https://sidequest-staging.offware.io. Never production.
# Copies the working-tree version of tracked app, css, and assets files, as production staging does.
set -e
cd "$(dirname "$0")/.."
branch=$(git branch --show-current)
OUT=server/site
rm -rf "$OUT"
mkdir -p "$OUT"
git ls-files | grep -E '^(app/|css/|assets/)' | while IFS= read -r f; do
  [ -f "$f" ] || continue
  dest="${f#app/}"
  mkdir -p "$OUT/$(dirname "$dest")"
  cp "$f" "$OUT/$dest"
done
printf 'User-agent: *\nDisallow: /\n' > "$OUT/robots.txt"
printf '/*\n  X-Robots-Tag: noindex, nofollow\n' > "$OUT/_headers"
cd server
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
echo "Deployed branch '$branch' to https://sidequest-staging.offware.io"
