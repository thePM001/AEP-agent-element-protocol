export interface StreamVerdict {
  continue: boolean;
  violation?: { rule: string; reason: string };
  abortSignal?: AbortSignal;
}

export interface StreamValidator {
  onChunk(chunk: string, accumulated: string): StreamVerdict;
}
