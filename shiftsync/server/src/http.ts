import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import type { ErrorCode } from "../../src/domain/contract";

const STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHORIZED: 401,
  EMAIL_NOT_CONFIRMED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT_DETECTED: 409,
  VERSION_CONFLICT: 409,
  DUPLICATE_EVENT: 409,
  STALE_SUGGESTION: 409,
  REQUEST_IN_PROGRESS: 409,
  NO_FEASIBLE_SLOT: 422,
  GOOGLE_NOT_CONNECTED: 409,
  GOOGLE_NOT_CONFIGURED: 503,
  SYNC_FAILED: 502,
  EMAIL_SEND_FAILED: 502,
  AI_SERVICE_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    status?: number,
  ) {
    super(message);
    this.status = status ?? STATUS[code] ?? 500;
  }
}
export const fail = (
  code: ErrorCode,
  message: string,
  details?: unknown,
): never => {
  throw new AppError(code, message, details);
};

/** Validates input with a schema, reporting only field paths and messages. */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      "VALIDATION_ERROR",
      "Some details are missing or invalid.",
      result.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  return result.data;
}

export type Logger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
};
// Logs are one JSON line each. Callers pass only identifiers, codes and
// timings: never tokens, email addresses, schedules or message contents.
export function createLogger(
  write: (line: string) => void = console.log,
): Logger {
  const at =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) =>
      write(
        JSON.stringify({
          time: new Date().toISOString(),
          level,
          message,
          ...fields,
        }),
      );
  return { info: at("info"), warn: at("warn"), error: at("error") };
}
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

export function requestLog(log: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.on("finish", () =>
      log.info("request", {
        requestId: req.requestId,
        method: req.method,
        // Route pattern, not the URL, so IDs and query values stay out.
        route:
          (req.route?.path as string | undefined) ??
          req.path.split("/").slice(0, 3).join("/"),
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1000000n),
      }),
    );
    next();
  };
}

export function errorHandler(log: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    let appError: AppError;
    const raw = error as { type?: string; status?: number };
    if (error instanceof AppError) appError = error;
    else if (raw?.type === "entity.parse.failed")
      appError = new AppError(
        "VALIDATION_ERROR",
        "The request body is not valid JSON.",
      );
    else if (raw?.type === "entity.too.large")
      appError = new AppError(
        "VALIDATION_ERROR",
        "The request is too large.",
        undefined,
        413,
      );
    else {
      log.error("unhandled", {
        requestId: req.requestId,
        name: (error as Error)?.name,
        message: String((error as Error)?.message ?? error).slice(0, 300),
      });
      appError = new AppError(
        "INTERNAL_ERROR",
        "Something went wrong on our side. Please try again.",
      );
    }
    if (appError.status >= 500 && appError.code !== "INTERNAL_ERROR")
      log.warn("dependency_error", {
        requestId: req.requestId,
        code: appError.code,
      });
    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        requestId: req.requestId,
        ...(appError.details === undefined
          ? {}
          : { details: appError.details }),
      },
    });
  };
}

/** Fixed-window limiter keyed by user (when signed in) or client address. */
export function rateLimit(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.baseUrl}${req.route?.path ?? req.path}:${req.ctx?.user.id ?? req.ip}`;
    const time = now();
    const entry = hits.get(key);
    if (!entry || entry.reset <= time) {
      if (hits.size > 10000) hits.clear();
      hits.set(key, { count: 1, reset: time + windowMs });
      return next();
    }
    if (++entry.count > limit)
      return next(
        new AppError(
          "RATE_LIMITED",
          "Too many requests. Please wait a moment and try again.",
        ),
      );
    next();
  };
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.get("Idempotency-Key")?.trim();
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new AppError(
      "VALIDATION_ERROR",
      "An Idempotency-Key header (8-128 letters, digits, - or _) is required.",
    );
  return key;
}
