import type { EvidenceLedger } from "../ledger/ledger.js";
import type { AEPStreamValidator } from "./validator.js";

export interface StreamAbortInfo {
  accumulated: string;
  violationAt: number;
  rule: string;
  reason: string;
}

export class StreamMiddleware {
  /**
   * Wraps a ReadableStream with AEP streaming validation.
   * Passes each chunk through the validator. On violation:
   * cancels the underlying stream, logs to evidence ledger
   * and terminates the output stream with partial content.
   */
  static wrap(
    readableStream: ReadableStream<string>,
    validator: AEPStreamValidator,
    ledger?: EvidenceLedger
  ): ReadableStream<string> {
    let accumulated = "";
    const reader = readableStream.getReader();

    return new ReadableStream<string>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            controller.close();
            return;
          }

          const chunk = value;
          accumulated += chunk;

          const verdict = validator.onChunk(chunk, accumulated);

          if (!verdict.continue && verdict.violation) {
            // Log abort to evidence ledger
            const abortInfo: StreamAbortInfo = {
              accumulated,
              violationAt: accumulated.length - chunk.length,
              rule: verdict.violation.rule,
              reason: verdict.violation.reason,
            };

            ledger?.append("stream:abort", abortInfo as unknown as Record<string, unknown>);

            // Cancel the upstream reader
            try {
              await reader.cancel();
            } catch {
              // Upstream may already be closed
            }

            controller.error(
              new Error(
                `AEP stream aborted: ${verdict.violation.rule} -- ${verdict.violation.reason}`
              )
            );
            return;
          }

          // Clean chunk -- pass it through
          controller.enqueue(chunk);
        } catch (err) {
          controller.error(err);
        }
      },

      cancel() {
        reader.cancel().catch(() => {});
      },
    });
  }
}
