import { describe, it, expect } from 'vitest';

function detectTyposquatting(toolName: string, knownTools: string[]): string | null {
  for (const known of knownTools) {
    if (toolName === known) continue;
    const dist = levenshteinDistance(toolName, known);
    if (dist === 1) return known;
  }
  return null;
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b.charAt(i-1) === a.charAt(j-1)
        ? matrix[i-1][j-1]
        : Math.min(matrix[i-1][j-1] + 1, matrix[i][j-1] + 1, matrix[i-1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

describe('MCP Security Gateway', () => {
  const knownTools = ['terminal', 'write_file', 'read_file', 'search_files', 'browser_navigate'];

  it('should detect typosquatting with 1-char difference', () => {
    expect(detectTyposquatting('termnal', knownTools)).toBe('terminal');
    expect(detectTyposquatting('writefile', knownTools)).toBe('write_file');
  });

  it('should not flag exact matches', () => {
    expect(detectTyposquatting('terminal', knownTools)).toBeNull();
    expect(detectTyposquatting('write_file', knownTools)).toBeNull();
  });

  it('should not flag names > 1 char different', () => {
    expect(detectTyposquatting('completely_different_tool', knownTools)).toBeNull();
  });
});
