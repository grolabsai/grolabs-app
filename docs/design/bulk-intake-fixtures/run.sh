#!/usr/bin/env bash
# Drive a fixture through the bulk-intake pipeline and print each stage.
#
#   GROLABS_WRITE_KEY=glw_live_... ./run.sh objects   # structured whole objects
#   GROLABS_WRITE_KEY=glw_live_... ./run.sh dump       # structured multi-table dump
#   GROLABS_WRITE_KEY=glw_live_... ./run.sh flat       # unstructured messy flat file
#
# Override the target with BASE=http://localhost:3000/api/v1 for local testing.
set -euo pipefail

MODE="${1:-objects}"
: "${GROLABS_WRITE_KEY:?set GROLABS_WRITE_KEY (the per-instance write key)}"
BASE="${BASE:-https://app.grolabs.ai/api/v1}"
INST="${INSTANCE_ID:-99999}"
DIR="$(cd "$(dirname "$0")" && pwd)"
H=(-H "Authorization: Bearer $GROLABS_WRITE_KEY" -H "Content-Type: application/json")

open='{"instance_id":'"$INST"',"source_type":"custom"}'
[ "$MODE" = "dump" ] && open='{"instance_id":'"$INST"',"source_type":"custom","data_dictionary":{"products":{"key":"product_id"},"variants":{"links_to":"product_id"}}}'

ID=$(curl -s "${H[@]}" -X POST "$BASE/catalog/sessions" -d "$open" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['session_id'])")
echo "session=$ID  mode=$MODE  base=$BASE"

case "$MODE" in
  objects) curl -s "${H[@]}" -X POST "$BASE/catalog/sessions/$ID/parts" -d @"$DIR/structured-objects.json" >/dev/null ;;
  dump)
    for f in structured-dump-products structured-dump-variants structured-dump-categories; do
      curl -s "${H[@]}" -X POST "$BASE/catalog/sessions/$ID/parts" -d @"$DIR/$f.json" >/dev/null
    done ;;
  flat) curl -s "${H[@]}" -X POST "$BASE/catalog/sessions/$ID/parts" -d @"$DIR/unstructured-flat.json" >/dev/null ;;
  *) echo "unknown mode: $MODE (use objects|dump|flat)"; exit 1 ;;
esac

curl -s "${H[@]}" -X POST "$BASE/catalog/sessions/$ID/complete" -d '{"instance_id":'"$INST"'}' >/dev/null

echo "=== OVERVIEW (totals) ===";  curl -s "${H[@]}" "$BASE/catalog/sessions/$ID/overview?instance_id=$INST" | python3 -m json.tool
echo "=== PREVIEW (stitched) ==="; curl -s "${H[@]}" "$BASE/catalog/sessions/$ID/preview?instance_id=$INST&limit=5" | python3 -m json.tool
echo "=== INTERPRET (AI categories) ===";
curl -s "${H[@]}" -X POST "$BASE/catalog/sessions/$ID/interpret" \
  -d '{"instance_id":'"$INST"',"candidates":[{"category_id":1,"name":"Footwear"},{"category_id":2,"name":"Apparel"},{"category_id":3,"name":"Accessories"}]}' \
  | python3 -m json.tool
