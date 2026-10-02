export type IndexProgress = { jobs: { pending: number; processing: number; ready: number; failed: number; cancelled: number } };

/** Sequential, bounded polling. A cancelled run cannot publish a late response. */
export function pollBimIndex<T extends IndexProgress>(options: {
  initial: T;
  load: (signal: AbortSignal) => Promise<T | null>;
  update: (value: T) => void;
  completed: () => void;
  exhausted: () => void;
  intervalMs?: number;
  maxAttempts?: number;
  maxDurationMs?: number;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  const stop = () => {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
    if (deadline !== undefined) clearTimeout(deadline);
  };
  const busy = (value: T) => value.jobs.pending + value.jobs.processing > 0;
  async function tick() {
    if (controller.signal.aborted) return;
    let next: T | null = null;
    try { next = await options.load(controller.signal); } catch { /* bounded retry */ }
    if (controller.signal.aborted) return;
    attempts++;
    if (next) {
      options.update(next);
      if (!busy(next)) {
        stop();
        // Reload even if another job failed: a successfully published model may coexist.
        options.completed();
        return;
      }
    }
    if (attempts >= (options.maxAttempts ?? 200)) { stop(); options.exhausted(); return; }
    timer = setTimeout(tick, options.intervalMs ?? 3000);
  }
  if (busy(options.initial)) {
    timer = setTimeout(tick, options.intervalMs ?? 3000);
    deadline = setTimeout(() => { stop(); options.exhausted(); }, options.maxDurationMs ?? 600000);
  }
  return stop;
}
