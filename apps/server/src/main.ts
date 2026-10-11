import { createApp } from "./app";
import { loadConfig } from "./config";
import { log } from "./log";
import { createServices } from "./services";
import { Worker } from "./worker";

const config = loadConfig();
const services = await createServices(config);

let server: ReturnType<typeof Bun.serve> | null = null;
if (config.ROLE !== "worker") {
  const app = createApp(services);
  // SSE streams are long-lived; Bun's default idle timeout would cut them.
  server = Bun.serve({ port: config.PORT, fetch: app.fetch, idleTimeout: 0 });
  log.info("api listening", { port: server.port, database: services.database.kind });
}

const worker = config.ROLE !== "api" ? new Worker(services) : null;
await worker?.start(config.WORKER_CONCURRENCY);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { signal });
  server?.stop();
  await worker?.stop();
  await services.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
