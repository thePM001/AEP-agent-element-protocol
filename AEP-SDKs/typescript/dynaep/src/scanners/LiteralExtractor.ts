// @PAD: /root/dynAEP/sdk/typescript/src/scanners/LiteralExtractor.ts
// ===========================================================================
// OPT-003: Literal Substring Extractor
// Parses regex patterns and extracts the longest contiguous literal substrings
// for use as Aho-Corasick pre-filter keys.
// ===========================================================================

// ---------------------------------------------------------------------------
// Character Classes & Meta Characters
// ---------------------------------------------------------------------------

/** Characters that are regex meta-characters (outside character classes) */
const META_CHARS = new Set([
  ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "^", "$", "\\",
]);

/**
 * Extract the longest contiguous literal substrings from a RegExp.
 *
 * Examples:
 * - /api[_-]key[=:]\s*[A-Za-z0-9]{32}/ -> ["api", "key"]
 * - /\b\d{3}-\d{2}-\d{4}\b/ -> ["-", "-"]
 * - /SELECT\s+.*\s+FROM/i -> ["select", "from"]
 * - /^https?:\/\/example\.com/ -> ["http", "://example.com"]
 *
 * If no literals can be extracted (pure character classes), returns [].
 * Patterns with no extractable literals fall back to direct regex evaluation.
 */
export function extractLiterals(regex: RegExp): string[] {
  const source = regex.source;
  const flags = regex.flags;
  const caseInsensitive = flags.includes("i");

  const literals: string[] = [];
  let currentLiteral = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\\") {
      // Escape sequence
      if (i + 1 < source.length) {
        const next = source[i + 1];

        // Literal escapes of non-meta characters
        if (isLiteralEscape(next)) {
          currentLiteral += next;
          i += 2;
          continue;
        }

        // Character class shortcuts (\d, \w, \s, etc.) break the literal
        flushLiteral();
        i += 2;
        continue;
      }
      // Trailing backslash
      flushLiteral();
      i++;
      continue;
    }

    if (ch === "[") {
      // Character class -- skip until closing ]
      flushLiteral();
      i = skipCharacterClass(source, i);
      continue;
    }

    if (ch === "(") {
      // Group start -- handle non-capturing groups, lookahead, etc.
      flushLiteral();
      // Skip the opening group markers
      if (i + 1 < source.length && source[i + 1] === "?") {
        // (?:...), (?=...), (?!...), (?<=...), (?<!...)
        i += 2;
        if (i < source.length && (source[i] === ":" || source[i] === "=" || source[i] === "!" || source[i] === "<")) {
          i++;
          if (source[i - 1] === "<" && i < source.length && (source[i] === "=" || source[i] === "!")) {
            i++;
          }
        }
      } else {
        i++;
      }
      continue;
    }

    if (ch === ")") {
      flushLiteral();
      i++;
      continue;
    }

    if (ch === "|") {
      // Alternation -- flush current literal
      flushLiteral();
      i++;
      continue;
    }

    if (ch === "." || ch === "^" || ch === "$") {
      flushLiteral();
      i++;
      continue;
    }

    if (ch === "*" || ch === "+" || ch === "?") {
      // Quantifier -- the preceding character is not a guaranteed literal
      if (currentLiteral.length > 0) {
        // Remove last character from literal (it's quantified, not guaranteed)
        currentLiteral = currentLiteral.substring(0, currentLiteral.length - 1);
        flushLiteral();
      }
      // Skip lazy modifier if present
      i++;
      if (i < source.length && source[i] === "?") i++;
      continue;
    }

    if (ch === "{") {
      // Counted quantifier {n} or {n,m}
      const closeBrace = source.indexOf("}", i);
      if (closeBrace > i) {
        const quantifier = source.substring(i + 1, closeBrace);
        if (/^\d+(,\d*)?$/.test(quantifier)) {
          // Remove last character (it's quantified)
          if (currentLiteral.length > 0) {
            currentLiteral = currentLiteral.substring(0, currentLiteral.length - 1);
            flushLiteral();
          }
          i = closeBrace + 1;
          // Skip lazy modifier
          if (i < source.length && source[i] === "?") i++;
          continue;
        }
      }
      // Not a valid quantifier -- treat as literal
      currentLiteral += ch;
      i++;
      continue;
    }

    // Regular literal character
    currentLiteral += ch;
    i++;
  }

  flushLiteral();

  // Filter out very short literals (1 char is too noisy for pre-filtering)
  // unless it's the only literal we have
  const filtered = literals.filter(l => l.length >= 2);
  if (filtered.length === 0 && literals.length > 0) {
    return literals; // Return single-char literals as last resort
  }

  // Apply case normalization if case-insensitive
  if (caseInsensitive) {
    return filtered.map(l => l.toLowerCase());
  }

  return filtered;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function flushLiteral(): void {
    if (currentLiteral.length > 0) {
      literals.push(currentLiteral);
      currentLiteral = "";
    }
  }
}

/**
 * Skip a character class [...] and return the index after the closing bracket.
 */
function skipCharacterClass(source: string, start: number): number {
  let i = start + 1; // skip opening [

  // Handle negation
  if (i < source.length && source[i] === "^") i++;

  // Handle ] as first character in class
  if (i < source.length && source[i] === "]") i++;

  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2; // skip escaped character
      continue;
    }
    if (source[i] === "]") {
      return i + 1;
    }
    i++;
  }

  // Unclosed character class -- return end of string
  return source.length;
}

/**
 * Check if an escaped character represents a literal (not a character class shortcut).
 */
function isLiteralEscape(ch: string): boolean {
  // These are character class shortcuts, not literal escapes
  const shortcuts = new Set(["d", "D", "w", "W", "s", "S", "b", "B", "n", "r", "t", "f", "v", "0"]);
  if (shortcuts.has(ch)) return false;

  // Everything else is a literal escape (e.g., \., \*, \/, etc.)
  return true;
}
