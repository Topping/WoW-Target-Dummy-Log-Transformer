import type {
  OperationResult,
  SourceLineTerminator,
  SourceLocation,
} from "../contracts";

import { parserFailure } from "./diagnostics";

export interface DecodedLine {
  readonly raw: string;
  readonly location: SourceLocation;
  readonly terminated: boolean;
  readonly lineTerminator: SourceLineTerminator;
}

/** Stateful UTF-8 decoder and line splitter. It accepts arbitrary byte boundaries. */
export class IncrementalLineDecoder {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  #pending = "";
  #lineNumber = 1;
  #finished = false;

  push(chunk: Uint8Array): OperationResult<readonly DecodedLine[]> {
    if (this.#finished) {
      return {
        ok: false,
        error: parserFailure(
          "DECODER_ALREADY_FINISHED",
          "The byte decoder received data after it was finalized.",
        ),
        warnings: [],
      };
    }

    try {
      this.#pending += this.#decoder.decode(chunk, { stream: true });
      return { ok: true, value: this.#drainLines(), warnings: [] };
    } catch (error: unknown) {
      return {
        ok: false,
        error: parserFailure(
          "INVALID_UTF8",
          "The combat log contains bytes that are not valid UTF-8.",
          { lineNumber: this.#lineNumber },
          undefined,
          { cause: error instanceof Error ? error.message : String(error) },
        ),
        warnings: [],
      };
    }
  }

  finish(): OperationResult<readonly DecodedLine[]> {
    if (this.#finished) {
      return { ok: true, value: [], warnings: [] };
    }
    this.#finished = true;
    try {
      this.#pending += this.#decoder.decode();
      const lines = [...this.#drainLines()];
      if (this.#pending.length > 0) {
        lines.push({
          raw: this.#pending,
          location: { lineNumber: this.#lineNumber },
          terminated: false,
          lineTerminator: "",
        });
        this.#pending = "";
        this.#lineNumber += 1;
      }
      return { ok: true, value: lines, warnings: [] };
    } catch (error: unknown) {
      return {
        ok: false,
        error: parserFailure(
          "INVALID_UTF8",
          "The combat log ends with an incomplete UTF-8 character.",
          { lineNumber: this.#lineNumber },
          undefined,
          { cause: error instanceof Error ? error.message : String(error) },
        ),
        warnings: [],
      };
    }
  }

  #drainLines(): DecodedLine[] {
    const lines: DecodedLine[] = [];
    let newlineIndex = this.#pending.indexOf("\n");
    while (newlineIndex >= 0) {
      const beforeNewline = this.#pending.slice(0, newlineIndex);
      const usesCrLf = beforeNewline.endsWith("\r");
      lines.push({
        raw: usesCrLf ? beforeNewline.slice(0, -1) : beforeNewline,
        location: { lineNumber: this.#lineNumber },
        terminated: true,
        lineTerminator: usesCrLf ? "\r\n" : "\n",
      });
      this.#lineNumber += 1;
      this.#pending = this.#pending.slice(newlineIndex + 1);
      newlineIndex = this.#pending.indexOf("\n");
    }
    return lines;
  }
}
