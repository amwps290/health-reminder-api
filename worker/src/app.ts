import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { requireAdmin } from "./core/auth";
import { AppError } from "./core/errors";
import type { AppContext } from "./core/types";
import { backupRoutes } from "./modules/backup";
import { eventRoutes } from "./modules/events";
import { injectionRoutes } from "./modules/injections";
import { medicalNoteRoutes } from "./modules/medical-notes";
import { medicationRoutes } from "./modules/medications";
import { pregnancyRoutes } from "./modules/pregnancy";
import { questionRoutes } from "./modules/questions";
import { protectedSessionRoutes, publicSessionRoutes } from "./modules/session";
import { systemRoutes } from "./modules/system";
import { weightRoutes } from "./modules/weights";

export const app = new Hono<AppContext>();

app.use("*", async (context, next) => {
  const requestId = context.req.header("CF-Ray") || crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-Id", requestId);
});

app.get("/", (context) =>
  context.json({ name: "health-reminder-api", version: "0.1.0" }),
);
app.get("/healthz", (context) => context.text("ok"));

app.route("/api/v1/auth", publicSessionRoutes);
app.use("/api/v1/*", requireAdmin);
app.route("/api/v1/auth", protectedSessionRoutes);
app.route("/api/v1/backup", backupRoutes);
app.route("/api/v1/medications", medicationRoutes);
app.route("/api/v1/events", eventRoutes);
app.route("/api/v1/injections", injectionRoutes);
app.route("/api/v1/medical-notes", medicalNoteRoutes);
app.route("/api/v1/questions", questionRoutes);
app.route("/api/v1/pregnancy", pregnancyRoutes);
app.route("/api/v1/weights", weightRoutes);
app.route("/api/v1", systemRoutes);

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "接口不存在",
        requestId: context.get("requestId"),
      },
    },
    404,
  ),
);

app.onError((error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  if (error instanceof AppError) {
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      },
      error.status as ContentfulStatusCode,
    );
  }
  if (error instanceof HTTPException) {
    return context.json(
      { error: { code: "HTTP_ERROR", message: error.message, requestId } },
      error.status,
    );
  }

  console.error(JSON.stringify({
    event: "request_failed",
    requestId,
    method: context.req.method,
    path: context.req.path,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? truncateLogValue(error.message) : String(error),
    cause: error instanceof Error ? getErrorCause(error) : null,
  }));
  return context.json(
    { error: { code: "INTERNAL_ERROR", message: "服务器内部错误", requestId } },
    500,
  );
});

function getErrorCause(error: Error): string | null {
  if (!("cause" in error) || error.cause == null) return null;
  return truncateLogValue(error.cause instanceof Error ? error.cause.message : String(error.cause));
}

function truncateLogValue(value: string, maximumLength = 1000): string {
  return value.length <= maximumLength ? value : `${value.slice(0, maximumLength)}...`;
}
