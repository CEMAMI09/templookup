import "dotenv/config";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = createApp(config);

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "listening",
      port: config.port,
      crm: config.crmMode,
    }),
  );
  if (config.crmMode === "mock") {
    console.log(
      JSON.stringify({
        level: "warn",
        message: "CRM mock mode is active. Set COTO_PRIVATE_INTEGRATION_TOKEN to use COTO.",
      }),
    );
  }
});
