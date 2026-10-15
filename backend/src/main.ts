import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createServices } from "./services";

async function main() {
  const config = loadConfig();
  const services = createServices(config);
  const app = await buildApp(services);

  services.start();
  await app.listen({ port: config.PORT, host: config.HOST });
  services.log.info(`API on http://${config.HOST}:${config.PORT} · node ${config.RPC_URL}`);

  const shutdown = async () => {
    await app.close();
    await services.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
