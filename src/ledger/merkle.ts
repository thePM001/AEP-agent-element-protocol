import { createHash } from "node:crypto";

export class MerkleTree {
  private leaves: string[];
  private layers: string[][];

  constructor(entries: string[]) {
    this.leaves = entries.map(e => MerkleTree.hash(e));
    this.layers = this.buildTree();
  }

  getRoot(): string {
    if (this.layers.length === 0) return MerkleTree.hash("");
    return this.layers[this.layers.length - 1][0] ?? MerkleTree.hash("");
  }

  generateProof(index: number): string[] {
    if (index < 0 || index >= this.leaves.length) return [];
    const proof: string[] = [];
    let idx = index;

    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i];
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;

      if (siblingIdx < layer.length) {
        proof.push((isRight ? "L:" : "R:") + layer[siblingIdx]);
      }
      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  static verifyProof(leaf: string, proof: string[], root: string): boolean {
    let current = MerkleTree.hash(leaf);

    for (const step of proof) {
      const direction = step.substring(0, 2);
      const hash = step.substring(2);

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

    while (layers[layers.length - 1].length > 1) {
      const current = layers[layers.length - 1];
      const next: string[] = [];

      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          next.push(MerkleTree.hash(current[i] + current[i + 1]));
        } else {
          next.push(current[i]);
        }
      }

      layers.push(next);
    }

    return layers;
  }
}
