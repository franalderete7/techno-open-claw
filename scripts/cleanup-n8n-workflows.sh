#!/usr/bin/env bash
# Cleanup n8n workflows - keep only v17 published ones
# Usage: ./scripts/cleanup-n8n-workflows.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 DRY RUN MODE - No changes will be made"
fi

N8N_CONTAINER="n8n-n8n-1"
DB_PATH="/home/node/.n8n/database.sqlite"
N8N_API_USER="aldegol"
N8N_API_PASS="Jeronimo32"
N8N_API_BASE="http://127.0.0.1:5678"

echo "📋 Scanning n8n workflows..."

# Get all TechnoStore workflows from database
WORKFLOW_IDS=$(docker exec $N8N_CONTAINER sh -c "cat $DB_PATH | strings" | grep -oE '"id":"[^"]*","name":"TechnoStore[^"]*"' | grep -oE '"id":"[^"]*"' | cut -d'"' -f4 | sort -u || true)

if [[ -z "$WORKFLOW_IDS" ]]; then
  echo "❌ No TechnoStore workflows found"
  exit 1
fi

echo "Found $(echo "$WORKFLOW_IDS" | wc -l) TechnoStore workflows"

# v17 workflow IDs to keep
V17_IDS="Zh2Tsqj-Iwj0HJF8borq3 DICGvMxJ4G19Pe2052uez u35r-7F_twFTPb_L4DEbG BY00FFywXd4eTgLBY_Kg- kIB7QWGbk-c10wipEkuR1"

# Separate keep vs delete
KEEP_IDS=""
DELETE_IDS=""

for id in $WORKFLOW_IDS; do
  if echo "$V17_IDS" | grep -q "$id"; then
    KEEP_IDS="$KEEP_IDS $id"
  else
    DELETE_IDS="$DELETE_IDS $id"
  fi
done

echo ""
echo "✅ KEEPING (v17 workflows):"
for id in $KEEP_IDS; do
  echo "  - $id"
done

echo ""
echo "🗑️  TO DELETE ($(echo $DELETE_IDS | wc -w) old workflows):"
for id in $DELETE_IDS; do
  echo "  - $id"
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "✅ Dry run complete. Run without --dry-run to actually delete."
  exit 0
fi

echo ""
read -p "⚠️  This will deactivate and delete $(echo $DELETE_IDS | wc -w) old workflows. Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Aborted"
  exit 0
fi

# Deactivate workflows first (via API)
echo ""
echo "⏳ Deactivating old workflows..."
for id in $DELETE_IDS; do
  echo "  Deactivating: $id"
  curl -s -X PATCH "$N8N_API_BASE/rest/workflows/$id" \
    -u "$N8N_API_USER:$N8N_API_PASS" \
    -H "Content-Type: application/json" \
    -d '{"active":false}' > /dev/null || true
done

# Wait a bit
sleep 2

# Delete workflows
echo ""
echo "🗑️  Deleting old workflows..."
for id in $DELETE_IDS; do
  echo "  Deleting: $id"
  curl -s -X DELETE "$N8N_API_BASE/rest/workflows/$id" \
    -u "$N8N_API_USER:$N8N_API_PASS" > /dev/null || true
done

echo ""
echo "✅ Cleanup complete!"
echo "💡 Restart n8n to free memory: docker compose restart n8n"
echo "📊 Verify: $(docker exec $N8N_CONTAINER sh -c "cat $DB_PATH | strings" | grep -c 'TechnoStore' || echo 0) workflows remaining"
