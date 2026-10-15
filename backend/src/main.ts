import { buildApp } from "./app";
import { Bus } from "./bus";
import { loadConfig } from "./config";

async function main() {
  const config = loadConfig();
  const bus = new Bus();
  const app = await buildApp({ config, bus });
  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
