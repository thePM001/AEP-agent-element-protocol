#!/usr/bin/env bash
# NLA Policy 4 Pre-Commit Hook - Blocks em-dash, en-dash, and double-hyphens
# Installed by: NLA-PLATFORM/hooks/pre-commit-check.sh
# Policy ref: NLA-PLATFORM/policies/nla-server-writing-conventions.gap

set -euo pipefail

EM_DASH=$(printf '\xe2\x80\x94')
EN_DASH=$(printf '\xe2\x80\x93')
VIOLATIONS=0
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}NLA Policy 4: Scanning for em-dash, en-dash, and double-hyphen violations...${NC}"

# Get list of staged files (text only, skip binaries)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    echo "No staged files to scan."
    exit 0
fi

# Scan each staged file
while IFS= read -r file; do
    [ -z "$file" ] && continue
    [ ! -f "$file" ] && continue

    # Skip binary files
    if file -b "$file" | grep -qE '^(data|PNG|JPEG|GIF|RIFF|WebM|ISO Media|PE32|ELF)'; then
        continue
    fi

    # Check for em-dash (U+2014)
    if grep -Hn "$EM_DASH" "$file" 2>/dev/null; then
        VIOLATIONS=$((VIOLATIONS + 1))
    fi

    # Check for en-dash (U+2013)
    if grep -Hn "$EN_DASH" "$file" 2>/dev/null; then
        VIOLATIONS=$((VIOLATIONS + 1))
    fi

done <<< "$STAGED_FILES"

if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo -e "${RED}============================================${NC}"
    echo -e "${RED}  COMMIT BLOCKED: Policy 4 Violation${NC}"
    echo -e "${RED}============================================${NC}"
    echo ""
    echo "Found $VIOLATIONS em-dash or en-dash characters in staged files."
    echo ""
    echo "Replacement rules (per Policy 4):"
    echo "  Em-dash (U+2014)  ->  \" - \" (space-hyphen-space)"
    echo "  En-dash (U+2013)  ->  \"-\"  (hyphen)"
    echo ""
    echo "Fix with:"
    echo "  find . -type f -exec sed -i 's/\\xe2\\x80\\x94/ - /g' {} +"
    echo "  find . -type f -exec sed -i 's/\\xe2\\x80\\x93/-/g' {} +"
    echo ""
    echo "Then re-stage and commit."
    echo -e "${RED}This block is non-negotiable per NLA Policy 4.${NC}"
    exit 1
fi

echo "Policy 4 scan passed: no em-dashes or en-dashes found."
exit 0
