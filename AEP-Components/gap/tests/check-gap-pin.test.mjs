import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AEP_ROOT,
  PIN_PATH,
  base32,
  checkPin,
  digest,
  gitHead,
  parsePin,
  parseVersions,
  renderPin,
  repin,
} from "../bin/check-gap-pin.mjs";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const CRATE_SRC = "AEP-Components/gap-schema-profile-v13/crate/src";
const CRATE_MANIFEST = "AEP-Components/gap-schema-profile-v13/crate/Cargo.toml";
const SCHEMA = "AEP-Components/gap/schemas/gap-meta-schema-v1.3.json";

const dirs = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "aep-"));
  dirs.push(dir);
  return dir;
}

function put(root, rel, body) {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

/** A tree with the minimum the pin check reads, consistent with its pin. */
function fakeTree() {
  const root = tempDir();
  const files = [
    { gap: "packages/p/src/lib.rs", aep: `${CRATE_SRC}/lib.rs`, body: "pub fn f() {}\n" },
    { gap: "schemas/gap-meta-schema-v1.3.json", aep: SCHEMA, body: "{}\n" },
  ];
  for (const f of files) put(root, f.aep, f.body);
  put(root, CRATE_MANIFEST, '[package]\nname = "p"\nversion = "0.2.1"\n');
  put(root, "Cargo.toml", '[workspace]\nmembers = []\n\n[workspace.package]\nversion = "2.9.0"\n');
  put(root, "package.json", JSON.stringify({ name: "aep", version: "2.9.0" }));
  put(root, "AEP-Components/gap/gap-versions.toml", '# v\naep = "2.9.0"\nlive_schema = "1.3"\ngap-schema-profile-v13 = "0.2.1"\n');
  const pin = {
    header: ["# pin header"],
    repository: "https://example.invalid/GAP",
    commit: COMMIT_A,
    files: files.map((f) => ({ hash: digest(Buffer.from(f.body)), gap: f.gap, aep: f.aep })),
  };
  put(root, PIN_PATH, renderPin(pin));
  return { root, files };
}

function fakeGapCheckout(files, head = COMMIT_A) {
  const dir = tempDir();
  for (const f of files) put(dir, f.gap, f.body);
  put(dir, ".git/HEAD", `${head}\n`);
  return dir;
}

describe("base32 and digest", () => {
  it("matches the RFC 4648 test vectors in lowercase without padding", () => {
    const vectors = [
      ["", ""],
      ["f", "my"],
      ["fo", "mzxq"],
      ["foo", "mzxw6"],
      ["foob", "mzxw6yq"],
      ["fooba", "mzxw6ytb"],
      ["foobar", "mzxw6ytboi"],
    ];
    for (const [input, want] of vectors) expect(base32(Buffer.from(input))).toBe(want);
  });

  it("digest is the base32 of the sha256", () => {
    const bytes = Buffer.from("hello");
    expect(digest(bytes)).toBe(base32(createHash("sha256").update(bytes).digest()));
    expect(digest(bytes)).toHaveLength(52);
    expect(digest(bytes)).toMatch(/^[a-z2-7]+$/);
  });
});

describe("gitHead", () => {
  it("reads a detached HEAD", () => {
    const dir = tempDir();
    put(dir, ".git/HEAD", `${COMMIT_A}\n`);
    expect(gitHead(dir)).toBe(COMMIT_A);
  });

  it("follows a loose ref", () => {
    const dir = tempDir();
    put(dir, ".git/HEAD", "ref: refs/heads/main\n");
    put(dir, ".git/refs/heads/main", `${COMMIT_B}\n`);
    expect(gitHead(dir)).toBe(COMMIT_B);
  });

  it("falls back to packed refs", () => {
    const dir = tempDir();
    put(dir, ".git/HEAD", "ref: refs/heads/main\n");
    put(dir, ".git/packed-refs", `# pack-refs with: peeled\n${COMMIT_A} refs/heads/other\n${COMMIT_B} refs/heads/main\n`);
    expect(gitHead(dir)).toBe(COMMIT_B);
  });

  it("throws on an unreadable HEAD or an unresolved ref", () => {
    const dir = tempDir();
    put(dir, ".git/HEAD", "garbage\n");
    expect(() => gitHead(dir)).toThrow(/HEAD not understood/);
    put(dir, ".git/HEAD", "ref: refs/heads/gone\n");
    expect(() => gitHead(dir)).toThrow(/refs\/heads\/gone does not resolve/);
  });
});

describe("parsePin and renderPin", () => {
  const text = [
    "# header one",
    "gap_repository https://example.invalid/GAP",
    `gap_commit ${COMMIT_A}`,
    "",
    "file h1 g/one a/one",
    "file h2 g/two a/two",
    "",
  ].join("\n");

  it("parses repository, commit, files and header", () => {
    const pin = parsePin(text);
    expect(pin.repository).toBe("https://example.invalid/GAP");
    expect(pin.commit).toBe(COMMIT_A);
    expect(pin.header).toEqual(["# header one"]);
    expect(pin.files).toEqual([
      { hash: "h1", gap: "g/one", aep: "a/one" },
      { hash: "h2", gap: "g/two", aep: "a/two" },
    ]);
  });

  it("round trips through renderPin", () => {
    const pin = parsePin(text);
    expect(parsePin(renderPin(pin))).toEqual(pin);
    expect(renderPin(pin).endsWith("file h2 g/two a/two\n")).toBe(true);
  });

  it("rejects malformed pins", () => {
    expect(() => parsePin(text + "file only three\n")).toThrow(/line not understood/);
    expect(() => parsePin(`gap_commit ${COMMIT_A}\nfile h g a\n`)).toThrow(/gap_repository missing/);
    expect(() => parsePin("gap_repository r\ngap_commit abc\nfile h g a\n")).toThrow(/not a commit id/);
    expect(() => parsePin(`gap_repository r\ngap_commit ${COMMIT_A}\n`)).toThrow(/no file lines/);
  });

  it("parses the shipped pin of this tree", () => {
    const pin = parsePin(readFileSync(join(AEP_ROOT, PIN_PATH), "utf8"));
    expect(pin.repository).toMatch(/GAP$/);
    expect(pin.files.length).toBeGreaterThan(0);
  });
});

describe("parseVersions", () => {
  it("reads key value lines and skips comments", () => {
    expect(parseVersions('# c\n\naep = "2.9.0"\ngap-x_y = "1"\n')).toEqual({ aep: "2.9.0", "gap-x_y": "1" });
  });

  it("rejects a line that is not key = quoted value", () => {
    expect(() => parseVersions("aep = 2.9.0\n")).toThrow(/line not understood/);
  });
});

describe("checkPin", () => {
  it("is green on a consistent tree", () => {
    const { root } = fakeTree();
    expect(checkPin(root)).toEqual([]);
  });

  it("is green on the shipped tree", () => {
    expect(checkPin()).toEqual([]);
  });

  it("reports changed bytes, missing files and stray crate sources", () => {
    const { root } = fakeTree();
    put(root, `${CRATE_SRC}/lib.rs`, "changed\n");
    put(root, `${CRATE_SRC}/extra.rs`, "x\n");
    unlinkSync(join(root, SCHEMA));
    expect(checkPin(root).sort()).toEqual([
      `byte check: ${CRATE_SRC}/extra.rs is not a pinned GAP file`,
      `byte check: ${CRATE_SRC}/lib.rs differs from GAP packages/p/src/lib.rs at ${COMMIT_A}`,
      `byte check: ${SCHEMA} is missing`,
    ]);
  });

  it("reports version disagreements", () => {
    const { root } = fakeTree();
    put(root, "package.json", JSON.stringify({ version: "3.0.0" }));
    put(root, "Cargo.toml", '[workspace.package]\nversion = "3.1.0"\n');
    put(root, CRATE_MANIFEST, '[package]\nversion = "9.9.9"\n');
    put(root, "AEP-Components/gap/gap-versions.toml", 'aep = "2.9.0"\nlive_schema = "1.4"\ngap-schema-profile-v13 = "0.2.1"\n');
    expect(checkPin(root)).toEqual([
      "version check: GAP names AEP 2.9.0, Cargo.toml workspace.package is 3.1.0",
      "version check: GAP names AEP 2.9.0, package.json is 3.0.0",
      "version check: GAP names gap-schema-profile-v13 0.2.1, the pinned crate is 9.9.9",
      "version check: live schema AEP-Components/gap/schemas/gap-meta-schema-v1.4.json is not pinned",
    ]);
  });

  it("compares with a GAP checkout when one is given", () => {
    const { root, files } = fakeTree();
    const good = fakeGapCheckout(files);
    expect(checkPin(root, good)).toEqual([]);

    const drift = fakeGapCheckout([{ ...files[0], body: "other\n" }], COMMIT_B);
    expect(checkPin(root, drift)).toEqual([
      "GAP checkout packages/p/src/lib.rs differs from the pinned bytes",
      "GAP checkout has no schemas/gap-meta-schema-v1.3.json",
      `GAP checkout is at ${COMMIT_B}, the pin names ${COMMIT_A}`,
    ]);
  });

  it("throws when the pin itself is unreadable", () => {
    const root = tempDir();
    expect(() => checkPin(root)).toThrow();
  });
});

describe("repin", () => {
  it("copies pinned files from the checkout and rewrites hashes and commit", () => {
    const { root, files } = fakeTree();
    const updated = files.map((f) => ({ ...f, body: f.body + "// new\n" }));
    const gap = fakeGapCheckout(updated, COMMIT_B);
    const pin = repin(gap, root);
    expect(pin.commit).toBe(COMMIT_B);
    expect(pin.files.map((f) => f.hash)).toEqual(updated.map((f) => digest(Buffer.from(f.body))));
    expect(readFileSync(join(root, files[0].aep), "utf8")).toBe(updated[0].body);
    const written = parsePin(readFileSync(join(root, PIN_PATH), "utf8"));
    expect(written).toEqual(pin);
    expect(written.header).toEqual(["# pin header"]);
    expect(checkPin(root, gap)).toEqual([]);
  });
});
