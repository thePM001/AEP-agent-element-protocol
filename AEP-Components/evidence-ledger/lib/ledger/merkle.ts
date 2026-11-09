import { createHash } from "node:crypto";

export class MerkleTree {
  private leaves: string[];
  private layers: string[][];

  constructor(entries: string[]) {
    this.leaves = entries.map(e => MerkleTree.hash(e));
    this.layers = this.buildTree();
  }

  getRoot(): string {
    return this.layers.at(-1)?.[0] ?? MerkleTree.hash("");
  }

  generateProof(index: number): string[] {
    if (index < 0 || index >= this.leaves.length) return [];
    const proof: string[] = [];
    let idx = index;

    // The top layer is the root and has no sibling.
    for (const layer of this.layers.slice(0, -1)) {
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      // An odd last node is paired with itself in buildTree, so its proof step
      // is its own hash on the right.
      const sibling = layer[siblingIdx] ?? layer[idx];
      if (sibling === undefined) break;
      proof.push((isRight ? "L:" : "R:") + sibling);
      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  static verifyProof(leaf: string, proof: string[], root: string): boolean {
    let current = MerkleTree.hash(leaf);

    for (const step of proof) {
      const direction = step.substring(0, 2);
      const hash = step.substring(2);
      if (direction !== "L:" && direction !== "R:") {
        return false;
      }
      if (direction === "L:") {
        current = MerkleTree.hash(hash + current);
      } else {
        current = MerkleTree.hash(current + hash);
      }
    }

    return current === root;
  }

  static computeRoot(entries: string[]): string {
    const tree = new MerkleTree(entries);
    return tree.getRoot();
  }

  static hash(data: string): string {
    return createHash("sha256").update(data).digest("hex");
  }

  private buildTree(): string[][] {
    if (this.leaves.length === 0) return [];
    const layers: string[][] = [this.leaves];
    let current = this.leaves;

    while (current.length > 1) {
      const next: string[] = [];

      for (let i = 0; i < current.length; i += 2) {
        const left = current[i] ?? "";
        // Odd node count: the last node is paired with itself.
        const right = current[i + 1] ?? left;
        next.push(MerkleTree.hash(left + right));
      }

      layers.push(next);
      current = next;
    }

    return layers;
  }
}
