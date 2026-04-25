import { MerkleTree } from "../../src/ledger/merkle.js";

describe("MerkleTree", () => {
  it("computes root for single leaf", () => {
    const tree = new MerkleTree(["hello"]);
    expect(tree.getRoot()).toBeDefined();
    // SHA-256 hex is 64 characters
    expect(tree.getRoot().length).toBe(64);
  });

  it("computes root for multiple leaves", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const root = tree.getRoot();
    expect(root).toBeDefined();
    expect(root.length).toBe(64);
  });

  it("different leaves produce different roots", () => {
    const tree1 = new MerkleTree(["a", "b"]);
    const tree2 = new MerkleTree(["c", "d"]);
    expect(tree1.getRoot()).not.toBe(tree2.getRoot());
  });

  it("same leaves produce identical roots", () => {
    const tree1 = new MerkleTree(["x", "y", "z"]);
    const tree2 = new MerkleTree(["x", "y", "z"]);
    expect(tree1.getRoot()).toBe(tree2.getRoot());
  });

  it("generates valid proof for leaf", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const proof = tree.generateProof(0);
    expect(proof).toBeDefined();
    expect(proof.length).toBeGreaterThan(0);
  });

  it("proof entries have direction prefix", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const proof = tree.generateProof(0);
    for (const step of proof) {
      const dir = step.substring(0, 2);
      expect(["L:", "R:"]).toContain(dir);
    }
  });

  it("verifies valid proof for leaf 0", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const proof = tree.generateProof(0);
    // verifyProof hashes the leaf internally, so pass raw data
    const valid = MerkleTree.verifyProof("a", proof, tree.getRoot());
    expect(valid).toBe(true);
  });

  it("verifies valid proof for leaf 1", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const proof = tree.generateProof(1);
    const valid = MerkleTree.verifyProof("b", proof, tree.getRoot());
    expect(valid).toBe(true);
  });

  it("rejects tampered leaf", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const proof = tree.generateProof(1);
    const valid = MerkleTree.verifyProof("fake", proof, tree.getRoot());
    expect(valid).toBe(false);
  });

  it("rejects wrong root", () => {
    const tree = new MerkleTree(["a", "b", "c", "d"]);
    const proof = tree.generateProof(0);
    const bogusRoot = "0".repeat(64);
    const valid = MerkleTree.verifyProof("a", proof, bogusRoot);
    expect(valid).toBe(false);
  });

  it("handles odd number of leaves", () => {
    const tree = new MerkleTree(["a", "b", "c"]);
    expect(tree.getRoot()).toBeDefined();

    const proof = tree.generateProof(2);
    const valid = MerkleTree.verifyProof("c", proof, tree.getRoot());
    expect(valid).toBe(true);
  });

  it("handles single leaf", () => {
    const tree = new MerkleTree(["only"]);
    const root = tree.getRoot();
    // Single leaf: root equals hash of the entry
    expect(root).toBe(MerkleTree.hash("only"));
  });

  it("proof for each leaf is valid across many leaves", () => {
    const leaves = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();

    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.generateProof(i);
      expect(MerkleTree.verifyProof(leaves[i], proof, root)).toBe(true);
    }
  });

  it("out of range index returns empty proof", () => {
    const tree = new MerkleTree(["a", "b"]);
    expect(tree.generateProof(-1)).toEqual([]);
    expect(tree.generateProof(5)).toEqual([]);
  });

  it("hash is deterministic", () => {
    const h1 = MerkleTree.hash("test");
    const h2 = MerkleTree.hash("test");
    expect(h1).toBe(h2);
  });

  it("computeRoot re-hashes entries", () => {
    // computeRoot creates a new MerkleTree internally,
    // so entries passed get hashed as leaves
    const leaves = ["x", "y"];
    const tree = new MerkleTree(leaves);
    const computedRoot = MerkleTree.computeRoot(leaves);
    expect(computedRoot).toBe(tree.getRoot());
  });
});
