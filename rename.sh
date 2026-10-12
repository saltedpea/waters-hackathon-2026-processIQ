#!/usr/bin/env bash
# Rename ProcessIQ -> Nexora in FRONTEND files only (templates/ and static/).
# Never touches Python files, and never touches PROCESSIQ_USER / PROCESSIQ_PASSWORD (the underscore is skipped).
# Run from the repo root, after committing:  bash rename.sh     (macOS: use  sed -i '' )
set -e
FILES=$(grep -rIlE --include='*.html' --include='*.js' --include='*.css' 'ProcessIQ|PROCESSIQ' templates static 2>/dev/null || true)
[ -z "$FILES" ] && { echo "Nothing to rename."; exit 0; }
echo "$FILES"
for f in $FILES; do
  sed -i -E 's/ProcessIQ/Nexora/g; s/PROCESSIQ($|[^_A-Za-z])/NEXORA\1/g' "$f"
done
echo "Done. Review with: git diff"
