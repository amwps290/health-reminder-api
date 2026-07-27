import { app } from "./app";
import type { Env } from "./core/types";
import { runScheduler } from "./scheduler/run";

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, context: ExecutionContext): void {
    context.waitUntil(runScheduler(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
