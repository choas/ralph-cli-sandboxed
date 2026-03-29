#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for file in PRD-GENERATOR.md RALPH-SETUP-TEMPLATE.md; do
  src="$SCRIPT_DIR/docs/$file"
  if [ ! -f "$src" ]; then
    echo "Error: $src not found" >&2
    exit 1
  fi
  cp "$src" .
done

echo "take a look at the concept file and @PRD-GENERATOR to create Ralph PRDs and update @.ralph/prd.yaml ... based on the technology stack and @RALPH-SETUP-TEMPLATE create a new RALPH-SETUP.md file and adjust @.ralph/config.json" > prompt.txt

