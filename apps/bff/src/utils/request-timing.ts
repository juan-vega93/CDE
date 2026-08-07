import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

type TimingMetric = {
  name: string;
  durationMs: number;
  description?: string;
};

type RequestTimingContext = {
  requestId: string;
  startedAt: number;
  metrics: TimingMetric[];
};

const timingStore = new AsyncLocalStorage<RequestTimingContext>();

function sanitizeTimingToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 60);
}

function formatServerTimingMetric(metric: TimingMetric): string {
  const name = sanitizeTimingToken(metric.name);
  const duration = Math.max(0, metric.durationMs).toFixed(1);

  if (!metric.description) {
    return `${name};dur=${duration}`;
  }

  const description = metric.description.replace(/"/g, "'").slice(0, 80);
  return `${name};dur=${duration};desc="${description}"`;
}

export function recordTiming(
  name: string,
  durationMs: number,
  description?: string
): void {
  const context = timingStore.getStore();

  if (!context) return;

  context.metrics.push({
    name,
    durationMs,
    description
  });
}

export async function timedOperation<T>(
  name: string,
  operation: () => Promise<T>,
  description?: string
): Promise<T> {
  const startedAt = performance.now();

  try {
    return await operation();
  } finally {
    recordTiming(name, performance.now() - startedAt, description);
  }
}

export function requestTimingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const context: RequestTimingContext = {
    requestId: randomUUID(),
    startedAt: performance.now(),
    metrics: []
  };

  const originalEnd = res.end.bind(res) as typeof res.end;

  res.end = ((chunk?: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
    const totalDurationMs = performance.now() - context.startedAt;
    const allMetrics = [
      ...context.metrics,
      {
        name: "bff.total",
        durationMs: totalDurationMs
      }
    ];

    if (!res.headersSent) {
      res.setHeader(
        "Server-Timing",
        allMetrics.map(formatServerTimingMetric).join(", ")
      );
      res.setHeader("X-Request-Id", context.requestId);
      res.setHeader("X-Response-Time-Ms", totalDurationMs.toFixed(1));
    }

    const shouldLog =
      process.env.BFF_PERF_LOGS === "true" ||
      totalDurationMs >= Number(process.env.BFF_SLOW_REQUEST_MS || "1000");

    if (shouldLog) {
      console.info("[BFF_PERF]", {
        requestId: context.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        totalMs: Number(totalDurationMs.toFixed(1)),
        metrics: context.metrics.map((metric) => ({
          name: metric.name,
          ms: Number(metric.durationMs.toFixed(1)),
          description: metric.description
        }))
      });
    }

    return originalEnd(
      chunk as Parameters<typeof originalEnd>[0],
      encodingOrCallback as Parameters<typeof originalEnd>[1],
      callback as Parameters<typeof originalEnd>[2]
    );
  }) as typeof res.end;

  timingStore.run(context, next);
}
