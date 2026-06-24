// @PAD: /root/dynAEP/sdk/typescript/src/scanners/AhoCorasick.ts
// ===========================================================================
// OPT-003: Aho-Corasick Multi-Pattern String Matching
// Pure TypeScript implementation. No external dependencies.
// Single-pass O(n + m) text scanning for all registered patterns.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AhoCorasickMatch {
  /** Index of the matched pattern in the original patterns array */
  patternIndex: number;
  /** Start position in the searched text */
  start: number;
  /** End position in the searched text (exclusive) */
  end: number;
  /** The matched text */
  text: string;
}

// ---------------------------------------------------------------------------
// Trie Node
// ---------------------------------------------------------------------------

interface TrieNode {
  /** Children keyed by character */
  children: Map<string, TrieNode>;
  /** Failure link (suffix pointer) */
  fail: TrieNode | null;
  /** Pattern indices that end at this node (including via dictionary suffix links) */
  output: number[];
  /** Depth in the trie (= length of the string represented by this node) */
  depth: number;
}

function createNode(depth: number): TrieNode {
  return {
    children: new Map(),
    fail: null,
    output: [],
    depth,
  };
}

// ---------------------------------------------------------------------------
// Aho-Corasick Automaton
// ---------------------------------------------------------------------------

export class AhoCorasick {
  private readonly root: TrieNode;
  private readonly patterns: string[];
  private readonly caseSensitive: boolean;
  private built = false;

  /**
   * @param patterns Array of literal strings to search for.
   * @param caseSensitive If false (default), matching is case-insensitive.
   */
  constructor(patterns: string[], caseSensitive = false) {
    this.patterns = patterns;
    this.caseSensitive = caseSensitive;
    this.root = createNode(0);
    this.root.fail = this.root;

    this.buildTrie();
    this.buildFailureLinks();
    this.built = true;
  }

  /**
   * Search text in a single pass. Returns all matches with pattern index,
   * start position, end position, and matched text.
   */
  search(text: string): AhoCorasickMatch[] {
    if (!this.built || this.patterns.length === 0) return [];

    const matches: AhoCorasickMatch[] = [];
    let current = this.root;
    const searchText = this.caseSensitive ? text : text.toLowerCase();

    for (let i = 0; i < searchText.length; i++) {
      const ch = searchText[i];

      // Follow failure links until we find a transition or reach root
      while (current !== this.root && !current.children.has(ch)) {
        current = current.fail!;
      }

      if (current.children.has(ch)) {
        current = current.children.get(ch)!;
      }
      // else: current remains root

      // Collect all outputs at this node (including via dictionary suffix links)
      let outputNode: TrieNode | null = current;
      while (outputNode !== null && outputNode !== this.root) {
        for (const patIdx of outputNode.output) {
          const patLen = this.patterns[patIdx].length;
          const start = i - patLen + 1;
          matches.push({
            patternIndex: patIdx,
            start,
            end: i + 1,
            text: text.substring(start, i + 1),
          });
        }
        outputNode = outputNode.fail!;
        // Prevent infinite loop at root
        if (outputNode === this.root) break;
      }
    }

    return matches;
  }

  /**
   * Return the number of patterns registered.
   */
  get patternCount(): number {
    return this.patterns.length;
  }

  // -----------------------------------------------------------------------
  // Build Phase
  // -----------------------------------------------------------------------

  private buildTrie(): void {
    for (let i = 0; i < this.patterns.length; i++) {
      const pattern = this.caseSensitive ? this.patterns[i] : this.patterns[i].toLowerCase();
      let current = this.root;

      for (let j = 0; j < pattern.length; j++) {
        const ch = pattern[j];
        if (!current.children.has(ch)) {
          current.children.set(ch, createNode(j + 1));
        }
        current = current.children.get(ch)!;
      }

      // Mark end of pattern
      current.output.push(i);
    }
  }

  private buildFailureLinks(): void {
    // BFS to compute failure links
    const queue: TrieNode[] = [];

    // Depth-1 nodes: failure link → root
    for (const child of this.root.children.values()) {
      child.fail = this.root;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const [ch, child] of current.children) {
        queue.push(child);

        // Compute failure link for child
        let failNode = current.fail!;
        while (failNode !== this.root && !failNode.children.has(ch)) {
          failNode = failNode.fail!;
        }

        child.fail = failNode.children.has(ch) ? failNode.children.get(ch)! : this.root;

        // Merge dictionary suffix link outputs
        if (child.fail !== child) {
          child.output = child.output.concat(child.fail.output);
        }
      }
    }
  }
}
