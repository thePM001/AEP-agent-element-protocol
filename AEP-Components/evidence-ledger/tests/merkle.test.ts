import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MerkleTree } from "../lib/ledger/merkle.js";

const h = (s: string): string => createHash("sha256").update(s).digest("hex");

function leaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `entry-${i}`);
}

describe("MerkleTree", () => {
  it("uses sha256 hex for hashing", () => {
    expect(MerkleTree.hash("abc")).toBe(h("abc"));
  });

  it("returns hash of empty string as the root of an empty tree", () => {
    expect(new MerkleTree([]).getRoot()).toBe(h(""));
    expect(MerkleTree.computeRoot([])).toBe(h(""));
  });

  it("root of a single leaf is the leaf hash", () => {
    expect(MerkleTree.computeRoot(["only"])).toBe(h("only"));
  });

  it("builds the expected root for two and three leaves", () => {
    expect(MerkleTree.computeRoot(["a", "b"])).toBe(h(h("a") + h("b")));
    // Odd count: the last node pairs with itself
    const left = h(h("a") + h("b"));
    const right = h(h("c") + h("c"));
    expect(MerkleTree.computeRoot(["a", "b", "c"])).toBe(h(left + right));
  });

  it("is order sensitive", () => {
    expect(MerkleTree.computeRoot(["a", "b"])).not.toBe(MerkleTree.computeRoot(["b", "a"]));
  });

  it("generates verifying proofs for every leaf in trees of size 1..17", () => {
    for (let n = 1; n <= 17; n++) {
      const data = leaves(n);
      const tree = new MerkleTree(data);
      const root = tree.getRoot();
      data.forEach((leaf, i) => {
        const proof = tree.generateProof(i);
        for (const step of proof) expect(step).toMatch(/^[LR]:[0-9a-f]{64}$/);
        expect(MerkleTree.verifyProof(leaf, proof, root), `n=${n} i=${i}`).toBe(true);
      });
    }
  });

  it("proof for the odd last leaf includes its self pairing step", () => {
    const tree = new MerkleTree(["a", "b", "c"]);
    expect(tree.generateProof(2)).toEqual(["R:" + h("c"), "L:" + h(h("a") + h("b"))]);
  });

  it("returns an empty proof for out of range indexes", () => {
    const tree = new MerkleTree(leaves(4));
    expect(tree.generateProof(-1)).toEqual([]);
    expect(tree.generateProof(4)).toEqual([]);
  });

  it("rejects a proof for a different leaf, a wrong root, or a tampered step", () => {
    const data = leaves(8);
    const tree = new MerkleTree(data);
    const root = tree.getRoot();
    const proof = tree.generateProof(3);

    expect(MerkleTree.verifyProof("entry-4", proof, root)).toBe(false);
    expect(MerkleTree.verifyProof("entry-3", proof, h("other"))).toBe(false);

    const flipped = proof.map((s, i) => (i === 0 ? (s.startsWith("L:") ? "R:" : "L:") + s.slice(2) : s));
    expect(MerkleTree.verifyProof("entry-3", flipped, root)).toBe(false);

    const bad = [...proof];
    bad[1] = "L:" + "0".repeat(64);
    expect(MerkleTree.verifyProof("entry-3", bad, root)).toBe(false);
  });

  it("rejects steps with an unknown direction prefix", () => {
    const tree = new MerkleTree(["a", "b"]);
    const proof = tree.generateProof(0);
    const step = proof[0] ?? "";
    expect(MerkleTree.verifyProof("a", ["X:" + step.slice(2)], tree.getRoot())).toBe(false);
  });

  it("a changed leaf changes the root", () => {
    const data = leaves(5);
    const before = MerkleTree.computeRoot(data);
    data[2] = "changed";
    expect(MerkleTree.computeRoot(data)).not.toBe(before);
  });
});
