import type { CovenantSpec } from "../covenant/types.js";
import type { Policy } from "../policy/types.js";
import type { StreamVerdict, StreamValidator } from "./types.js";
import type { ScannerPipeline } from "../scanners/pipeline.js";

export interface AEPScene {
  elements: Array<{ id: string; protected?: boolean }>;
}

export interface AEPRegistry {
  zBands: Record<string, [number, number]>;
  parentRules: Record<string, { requireParent: boolean }>;
}

export interface StreamValidatorOptions {
  covenant?: CovenantSpec;
  policy?: Policy;
  scene?: AEPScene;
  registry?: AEPRegistry;
  scannerPipeline?: ScannerPipeline;
}

export class AEPStreamValidator implements StreamValidator {
  private covenant?: CovenantSpec;
  private policy?: Policy;
  private scene?: AEPScene;
  private registry?: AEPRegistry;
  private scannerPipeline?: ScannerPipeline;
  private abortController: AbortController;

  constructor(options: StreamValidatorOptions) {
    this.covenant = options.covenant;
    this.policy = options.policy;
    this.scene = options.scene;
    this.registry = options.registry;
    this.scannerPipeline = options.scannerPipeline;
    this.abortController = new AbortController();
  }

  onChunk(_chunk: string, accumulated: string): StreamVerdict {
    // 1. Covenant forbid patterns
    const covenantViolation = this.checkCovenantForbids(accumulated);
    if (covenantViolation) {
      this.abortController.abort();
      return {
        continue: false,
        violation: covenantViolation,
        abortSignal: this.abortController.signal,
      };
    }

    // 2. Protected element IDs
    const elementViolation = this.checkProtectedElements(accumulated);
    if (elementViolation) {
      this.abortController.abort();
      return {
        continue: false,
        violation: elementViolation,
        abortSignal: this.abortController.signal,
      };
    }

    // 3. Z-band violations
    const zbandViolation = this.checkZBandViolations(accumulated);
    if (zbandViolation) {
      this.abortController.abort();
      return {
        continue: false,
        violation: zbandViolation,
        abortSignal: this.abortController.signal,
      };
    }

    // 4. Structural violations (orphan references)
    const structuralViolation = this.checkStructuralViolations(accumulated);
    if (structuralViolation) {
      this.abortController.abort();
      return {
        continue: false,
        violation: structuralViolation,
        abortSignal: this.abortController.signal,
      };
    }

    // 5. Policy forbidden patterns
    const forbiddenViolation = this.checkForbiddenPatterns(accumulated);
    if (forbiddenViolation) {
      this.abortController.abort();
      return {
        continue: false,
        violation: forbiddenViolation,
        abortSignal: this.abortController.signal,
      };
    }

    // 6. Content scanner pipeline (hard findings only abort stream)
    const scannerViolation = this.checkScannerPipeline(accumulated);
    if (scannerViolation) {
      this.abortController.abort();
      return {
        continue: false,
        violation: scannerViolation,
        abortSignal: this.abortController.signal,
      };
    }

    return { continue: true };
  }

  reset(): void {
    this.abortController = new AbortController();
  }

  private checkCovenantForbids(
    accumulated: string
  ): { rule: string; reason: string } | null {
    if (!this.covenant) return null;

    for (const rule of this.covenant.rules) {
      if (rule.type !== "forbid") continue;
      // Match forbid action as a substring in accumulated output
      if (accumulated.includes(rule.action)) {
        return {
          rule: `covenant:forbid:${rule.action}`,
          reason: `Covenant "${this.covenant.name}" forbids "${rule.action}"`,
        };
      }
    }
    return null;
  }

  private checkProtectedElements(
    accumulated: string
  ): { rule: string; reason: string } | null {
    if (!this.scene) return null;

    for (const el of this.scene.elements) {
      if (!el.protected) continue;
      // Detect creation or mutation of protected element IDs
      if (accumulated.includes(el.id)) {
        return {
          rule: `aep:protected-element:${el.id}`,
          reason: `Output references protected AEP element "${el.id}"`,
        };
      }
    }
    return null;
  }

  private checkZBandViolations(
    accumulated: string
  ): { rule: string; reason: string } | null {
    if (!this.registry) return null;

    // Detect z-index assignments in output: "z": <number> or z: <number>
    const zPattern = /["']?z["']?\s*[:=]\s*(\d+)/g;
    const idPattern = /["']?id["']?\s*[:=]\s*["']([A-Z]{2}-\d{5})["']/g;

    const ids: string[] = [];
    let idMatch: RegExpExecArray | null;
    while ((idMatch = idPattern.exec(accumulated)) !== null) {
      ids.push(idMatch[1]);
    }

    let zMatch: RegExpExecArray | null;
    while ((zMatch = zPattern.exec(accumulated)) !== null) {
      const zValue = parseInt(zMatch[1], 10);
      // Check each detected ID's prefix against registry z-bands
      for (const id of ids) {
        const prefix = id.split("-")[0];
        const band = this.registry.zBands[prefix];
        if (band && (zValue < band[0] || zValue > band[1])) {
          return {
            rule: `aep:z-band:${prefix}`,
            reason: `Z-index ${zValue} outside allowed band [${band[0]}-${band[1]}] for prefix "${prefix}"`,
          };
        }
      }
    }
    return null;
  }

  private checkStructuralViolations(
    accumulated: string
  ): { rule: string; reason: string } | null {
    if (!this.registry) return null;

    // Detect parent:null for non-shell elements
    const parentNullPattern =
      /["']?id["']?\s*[:=]\s*["']([A-Z]{2}-\d{5})["'][^}]*["']?parent["']?\s*[:=]\s*null/g;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = parentNullPattern.exec(accumulated)) !== null) {
      const id = pMatch[1];
      const prefix = id.split("-")[0];
      const rules = this.registry.parentRules[prefix];
      if (rules?.requireParent) {
        return {
          rule: `aep:structural:orphan:${id}`,
          reason: `Element "${id}" (prefix "${prefix}") requires a parent but has null`,
        };
      }
    }
    return null;
  }

  private checkForbiddenPatterns(
    accumulated: string
  ): { rule: string; reason: string } | null {
    if (!this.policy?.forbidden) return null;

    for (const fp of this.policy.forbidden) {
      try {
        const regex = new RegExp(fp.pattern);
        if (regex.test(accumulated)) {
          return {
            rule: `policy:forbidden:${fp.pattern}`,
            reason: fp.reason ?? `Matched forbidden pattern "${fp.pattern}"`,
          };
        }
      } catch {
        // If the pattern is not valid regex, do literal match
        if (accumulated.includes(fp.pattern)) {
          return {
            rule: `policy:forbidden:${fp.pattern}`,
            reason: fp.reason ?? `Matched forbidden pattern "${fp.pattern}"`,
          };
        }
      }
    }
    return null;
  }

  private checkScannerPipeline(
    accumulated: string
  ): { rule: string; reason: string } | null {
    if (!this.scannerPipeline) return null;

    const result = this.scannerPipeline.scan(accumulated);
    if (result.passed) return null;

    // Only abort on hard findings during streaming
    const hardFindings = result.findings.filter((f) => f.severity === "hard");
    if (hardFindings.length === 0) return null;

    const first = hardFindings[0];
    return {
      rule: `scanner:${first.scanner}:${first.category}`,
      reason: `Content scanner "${first.scanner}" detected: ${first.match}`,
    };
  }
}
