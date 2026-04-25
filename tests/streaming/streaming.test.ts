import { AEPStreamValidator } from "../../src/streaming/validator.js";
import { StreamMiddleware } from "../../src/streaming/middleware.js";
import { EvidenceLedger } from "../../src/ledger/ledger.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CovenantSpec } from "../../src/covenant/types.js";
import type { Policy } from "../../src/policy/types.js";
import type { AEPScene, AEPRegistry } from "../../src/streaming/validator.js";
import { validatePolicy } from "../../src/policy/loader.js";

function makeReadableStream(chunks: string[]): ReadableStream<string> {
  let index = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

async function collectStream(
  stream: ReadableStream<string>
): Promise<{ text: string; error?: Error }> {
  const reader = stream.getReader();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
    }
    return { text };
  } catch (err) {
    return { text, error: err as Error };
  }
}

describe("Streaming Validation", () => {
  describe("AEPStreamValidator", () => {
    it("passes clean output through without violation", () => {
      const validator = new AEPStreamValidator({});
      const v1 = validator.onChunk("Hello ", "Hello ");
      expect(v1.continue).toBe(true);
      expect(v1.violation).toBeUndefined();

      const v2 = validator.onChunk("world", "Hello world");
      expect(v2.continue).toBe(true);
      expect(v2.violation).toBeUndefined();
    });

    it("detects covenant forbid violation mid-stream", () => {
      const covenant: CovenantSpec = {
        name: "TestCovenant",
        rules: [
          { type: "forbid", action: "file:delete", conditions: [] },
          { type: "permit", action: "file:read", conditions: [] },
        ],
      };
      const validator = new AEPStreamValidator({ covenant });

      const v1 = validator.onChunk("I will read ", "I will read ");
      expect(v1.continue).toBe(true);

      const v2 = validator.onChunk(
        "and file:delete ",
        "I will read and file:delete "
      );
      expect(v2.continue).toBe(false);
      expect(v2.violation).toBeDefined();
      expect(v2.violation!.rule).toContain("covenant:forbid");
      expect(v2.violation!.reason).toContain("file:delete");
    });

    it("detects protected AEP element references mid-stream", () => {
      const scene: AEPScene = {
        elements: [
          { id: "SH-00001", protected: true },
          { id: "PN-00002", protected: false },
        ],
      };
      const validator = new AEPStreamValidator({ scene });

      const v1 = validator.onChunk("Creating PN-00002", "Creating PN-00002");
      expect(v1.continue).toBe(true);

      const v2 = validator.onChunk(
        " and SH-00001",
        "Creating PN-00002 and SH-00001"
      );
      expect(v2.continue).toBe(false);
      expect(v2.violation!.rule).toContain("aep:protected-element");
      expect(v2.violation!.reason).toContain("SH-00001");
    });

    it("detects z-band violations mid-stream", () => {
      const registry: AEPRegistry = {
        zBands: { CP: [20, 29], SH: [0, 9] },
        parentRules: {},
      };
      const validator = new AEPStreamValidator({ registry });

      const v1 = validator.onChunk(
        '{"id": "CP-00010", "z": 25}',
        '{"id": "CP-00010", "z": 25}'
      );
      expect(v1.continue).toBe(true);

      validator.reset();

      const v2 = validator.onChunk(
        '{"id": "CP-00011", "z": 50}',
        '{"id": "CP-00011", "z": 50}'
      );
      expect(v2.continue).toBe(false);
      expect(v2.violation!.rule).toContain("aep:z-band:CP");
      expect(v2.violation!.reason).toContain("50");
    });

    it("detects structural violations (orphan elements)", () => {
      const registry: AEPRegistry = {
        zBands: {},
        parentRules: { CP: { requireParent: true } },
      };
      const validator = new AEPStreamValidator({ registry });

      const v = validator.onChunk(
        '"id": "CP-00020", "parent": null',
        '"id": "CP-00020", "parent": null'
      );
      expect(v.continue).toBe(false);
      expect(v.violation!.rule).toContain("aep:structural:orphan");
    });

    it("detects policy forbidden patterns mid-stream", () => {
      const policy = {
        version: "2.2",
        name: "test",
        capabilities: [],
        limits: {},
        session: { max_actions: 100 },
        forbidden: [{ pattern: "\\.env", reason: "secrets file" }],
      } as unknown as Policy;

      const validator = new AEPStreamValidator({ policy });

      const v1 = validator.onChunk("reading config", "reading config");
      expect(v1.continue).toBe(true);

      const v2 = validator.onChunk(
        ".json and .env",
        "reading config.json and .env"
      );
      expect(v2.continue).toBe(false);
      expect(v2.violation!.rule).toContain("policy:forbidden");
      expect(v2.violation!.reason).toContain("secrets file");
    });

    it("reset clears abort state for reuse", () => {
      const covenant: CovenantSpec = {
        name: "ResetTest",
        rules: [{ type: "forbid", action: "rm -rf", conditions: [] }],
      };
      const validator = new AEPStreamValidator({ covenant });

      // Trigger violation
      const v1 = validator.onChunk("rm -rf /", "rm -rf /");
      expect(v1.continue).toBe(false);

      // Reset and verify clean state
      validator.reset();
      const v2 = validator.onChunk("ls -la", "ls -la");
      expect(v2.continue).toBe(true);
    });

    it("provides AbortSignal on violation", () => {
      const covenant: CovenantSpec = {
        name: "SignalTest",
        rules: [{ type: "forbid", action: "DROP TABLE", conditions: [] }],
      };
      const validator = new AEPStreamValidator({ covenant });

      const v = validator.onChunk("DROP TABLE users", "DROP TABLE users");
      expect(v.continue).toBe(false);
      expect(v.abortSignal).toBeDefined();
      expect(v.abortSignal!.aborted).toBe(true);
    });
  });

  describe("StreamMiddleware", () => {
    it("wraps ReadableStream and passes clean chunks", async () => {
      const validator = new AEPStreamValidator({});
      const source = makeReadableStream(["Hello ", "world", "!"]);

      const wrapped = StreamMiddleware.wrap(source, validator);
      const result = await collectStream(wrapped);

      expect(result.text).toBe("Hello world!");
      expect(result.error).toBeUndefined();
    });

    it("aborts stream on violation and logs to evidence ledger", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "aep-stream-test-"));

      try {
        const ledger = new EvidenceLedger({
          dir: tmpDir,
          sessionId: "stream-test-001",
        });
        const covenant: CovenantSpec = {
          name: "StreamGuard",
          rules: [{ type: "forbid", action: "DANGER", conditions: [] }],
        };
        const validator = new AEPStreamValidator({ covenant });

        const source = makeReadableStream([
          "safe content ",
          "more safe ",
          "DANGER zone ",
          "never reached",
        ]);

        const wrapped = StreamMiddleware.wrap(source, validator, ledger);
        const result = await collectStream(wrapped);

        // Only safe chunks should have passed
        expect(result.text).toBe("safe content more safe ");

        // Stream should have errored
        expect(result.error).toBeDefined();
        expect(result.error!.message).toContain("AEP stream aborted");
        expect(result.error!.message).toContain("DANGER");

        // Evidence ledger should have a stream:abort entry
        const entries = ledger.entries();
        const abortEntry = entries.find((e) => e.type === "stream:abort");
        expect(abortEntry).toBeDefined();
        expect(abortEntry!.data.rule).toContain("covenant:forbid");
        expect(abortEntry!.data.reason).toContain("DANGER");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles empty stream gracefully", async () => {
      const validator = new AEPStreamValidator({});
      const source = makeReadableStream([]);

      const wrapped = StreamMiddleware.wrap(source, validator);
      const result = await collectStream(wrapped);

      expect(result.text).toBe("");
      expect(result.error).toBeUndefined();
    });

    it("aborts on first violating chunk", async () => {
      const policy = {
        version: "2.2",
        name: "test",
        capabilities: [],
        limits: {},
        session: { max_actions: 100 },
        forbidden: [{ pattern: "SECRET_KEY" }],
      } as unknown as Policy;

      const validator = new AEPStreamValidator({ policy });
      const source = makeReadableStream([
        "config = ",
        "SECRET_KEY=abc123",
        "more output",
      ]);

      const wrapped = StreamMiddleware.wrap(source, validator);
      const result = await collectStream(wrapped);

      expect(result.text).toBe("config = ");
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("policy:forbidden");
    });
  });

  describe("Policy streaming config", () => {
    it("streaming config defaults are correct", () => {
      const policy = validatePolicy({
        version: "2.2",
        name: "stream-test",
        capabilities: [],
        limits: {},
        session: { max_actions: 10 },
        streaming: { enabled: true },
      });

      expect(policy.streaming).toBeDefined();
      expect(policy.streaming!.enabled).toBe(true);
      expect(policy.streaming!.abort_on_violation).toBe(true);
    });

    it("streaming config accepts explicit values", () => {
      const policy = validatePolicy({
        version: "2.2",
        name: "stream-test",
        capabilities: [],
        limits: {},
        session: { max_actions: 10 },
        streaming: { enabled: true, abort_on_violation: false },
      });

      expect(policy.streaming!.enabled).toBe(true);
      expect(policy.streaming!.abort_on_violation).toBe(false);
    });
  });
});
