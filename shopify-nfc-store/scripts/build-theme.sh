#!/usr/bin/env bash
# Regenere dist/nfc-store-theme.zip a partir du dossier theme/.
# A relancer apres toute modification du theme.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/theme"
OUT="$ROOT/dist/nfc-store-theme.zip"

if [ ! -f "$SRC/layout/theme.liquid" ]; then
  echo "Erreur : $SRC ne ressemble pas a un theme Shopify (layout/theme.liquid manquant)." >&2
  exit 1
fi

mkdir -p "$ROOT/dist"
rm -f "$OUT"

# Shopify exige que assets/ config/ layout/ locales/ sections/ snippets/ templates/
# soient a la RACINE du zip (pas dans un sous-dossier).
cd "$SRC"
zip -r -X -q "$OUT" \
  assets config layout locales sections snippets templates \
  README.md LICENSE.md release-notes.md \
  -x '*.DS_Store' '*/.git/*'

echo "ZIP genere : $OUT"
unzip -l "$OUT" | tail -1
