#!/bin/bash
# Import v3 post chunks to D1, one by one.
# Usage: bash scripts/migrate/import-v3.sh [start_num]
# Resumes from p{start_num}.sql, default p001.

set -euo pipefail

cd /Users/nocoo/workspace/personal/ellie
DIR="output/d1-import/v3"
DB="tongjinet-db"
START=${1:-1}
TOTAL=150

echo "=== D1 Import: p$(printf '%03d' $START).sql to p$(printf '%03d' $TOTAL).sql ==="
echo "Started at $(date)"

for i in $(seq $START $TOTAL); do
  FILE="$DIR/p$(printf '%03d' $i).sql"
  if [ ! -f "$FILE" ]; then
    echo "[$i/$TOTAL] SKIP (file not found: $FILE)"
    continue
  fi

  SIZE=$(ls -lh "$FILE" | awk '{print $5}')
  LINES=$(wc -l < "$FILE" | tr -d ' ')
  echo ""
  echo "[$i/$TOTAL] $FILE ($SIZE, $LINES lines)"
  echo "  Start: $(date)"

  # Retry up to 3 times
  for attempt in 1 2 3; do
    if npx wrangler d1 execute "$DB" --remote --file="$FILE" 2>&1 | tee /tmp/d1-import-last.log | grep -q '"success": true'; then
      # Check if rows were actually written
      WRITTEN=$(grep -o '"rows_written": [0-9]*' /tmp/d1-import-last.log | tail -1 | grep -o '[0-9]*')
      if [ -n "$WRITTEN" ] && [ "$WRITTEN" -gt 0 ]; then
        echo "  OK: $WRITTEN rows written (attempt $attempt)"
        echo "  End: $(date)"
        break
      else
        echo "  WARNING: success=true but rows_written=$WRITTEN (attempt $attempt)"
        if [ $attempt -lt 3 ]; then
          echo "  Retrying in 30s..."
          sleep 30
        else
          echo "  FAILED after 3 attempts, stopping."
          echo "  Resume with: bash scripts/migrate/import-v3.sh $i"
          exit 1
        fi
      fi
    else
      echo "  ERROR on attempt $attempt"
      if grep -q "D1_RESET_DO" /tmp/d1-import-last.log; then
        echo "  D1 in recovery mode, waiting 120s..."
        sleep 120
      elif [ $attempt -lt 3 ]; then
        echo "  Retrying in 60s..."
        sleep 60
      else
        echo "  FAILED after 3 attempts, stopping."
        echo "  Resume with: bash scripts/migrate/import-v3.sh $i"
        exit 1
      fi
    fi
  done
done

echo ""
echo "=== All done at $(date) ==="
