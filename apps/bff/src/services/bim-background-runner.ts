import { Worker } from "node:worker_threads";
import path from "node:path";

/** One CPU task at a time across conversion AND indexing. No HTTP-thread fallback. */
export class BimBackgroundRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(private readonly maxPending = 4) {}

  run<T>(entry: string, data: unknown, onEvent?: (event: unknown) => void): Promise<T> {
    if (this.pending >= this.maxPending) return Promise.reject(new Error("BIM background queue is full; retry after active processing completes"));
    this.pending++;
    const result = this.tail.then(() => this.execute<T>(entry, data, onEvent));
    this.tail = result.catch(() => undefined);
    return result.finally(() => { this.pending--; });
  }

  private execute<T>(entry: string, data: unknown, onEvent?: (event: unknown) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      // tsx must be registered inside a TS worker, not inherited as a CLI loader.
      const worker = entry.endsWith(".ts")
        ? new Worker(`require('tsx/cjs'); require(${JSON.stringify(entry)});`, { eval: true, workerData: data, execArgv: [], stdout: true, stderr: true })
        : new Worker(entry, { workerData: data, execArgv: [], stdout: true, stderr: true });
      let settled = false;
      let loggedBytes = 0;
      let suppressedBytes = 0;
      const drain = (chunk: Buffer) => {
        // Native IFC diagnostics can flood stdout. Drain every byte, bound forwarding.
        if (loggedBytes + chunk.length <= 16_384) {
          loggedBytes += chunk.length;
          process.stderr.write(chunk);
        } else suppressedBytes += chunk.length;
      };
      worker.stdout.on("data", drain);
      worker.stderr.on("data", drain);
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        // Dispose WASM, connections and the worker before releasing the CPU slot.
        void worker.terminate().then(() => {
          if (suppressedBytes) console.warn(`[BIM worker] ${suppressedBytes} diagnostic bytes suppressed after log limit`);
          if (error) reject(error); else resolve(value as T);
        }, reject);
      };
      worker.on("message", (message) => {
        if (message?.type === "result") finish(undefined, message.value);
        else if (message?.type === "error") finish(new Error(message.error));
        else { try { onEvent?.(message); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); } }
      });
      worker.on("error", (error) => finish(error));
      worker.on("exit", (code) => {
        if (!settled) finish(new Error(`BIM worker exited without a result (code ${code})`));
      });
    });
  }
}

export const bimBackgroundRunner = new BimBackgroundRunner();
export const bimWorkerEntry = path.join(__dirname, `bim-processing.worker${path.extname(__filename)}`);
