import { randomBytes } from "node:crypto";

export type AppConfig = {
  nodeEnv: "development" | "production" | "test";
  port: number;
  sessionSecret: string;
  trustProxy: boolean;
  staffFile: string;
  crmMode: "live" | "mock";
  coto: {
    baseUrl: string;
    locationId: string;
    version: string;
    token: string;
    appBaseUrl: string;
    npiFieldId: string;
    titleFieldId: string;
  };
};

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  const token = clean(process.env.COTO_PRIVATE_INTEGRATION_TOKEN);
  const usableToken = token.length > 0 && token !== "replace_with_your_token";
  const forceMock = process.env.COTO_USE_MOCK === "true";
  const sessionFromEnv = clean(process.env.SESSION_SECRET);
  const sessionSecret =
    sessionFromEnv && sessionFromEnv !== "replace_with_a_long_random_string"
      ? sessionFromEnv
      : nodeEnv === "production"
        ? ""
        : randomBytes(32).toString("hex");

  const crmMode: AppConfig["crmMode"] =
    nodeEnv === "production" ? "live" : forceMock || !usableToken ? "mock" : "live";

  const config: AppConfig = {
    nodeEnv: nodeEnv === "production" || nodeEnv === "test" ? nodeEnv : "development",
    port: Number(process.env.PORT ?? 3001),
    sessionSecret,
    trustProxy: process.env.TRUST_PROXY === "true",
    staffFile: clean(process.env.STAFF_FILE) || "data/staff.json",
    crmMode,
    coto: {
      baseUrl: clean(process.env.COTO_API_BASE_URL) || "https://services.leadconnectorhq.com",
      locationId: clean(process.env.COTO_LOCATION_ID) || "7WK4Pl3TZvOBAwTB2gOR",
      version: clean(process.env.COTO_API_VERSION) || "2021-07-28",
      token: usableToken ? token : "",
      appBaseUrl: (clean(process.env.COTO_APP_BASE_URL) || "https://crm.coto.services").replace(
        /\/$/,
        "",
      ),
      npiFieldId: clean(process.env.COTO_FIELD_NPI),
      titleFieldId: clean(process.env.COTO_FIELD_TITLE),
    },
  };

  if (config.nodeEnv === "production") {
    if (forceMock || !usableToken) {
      throw new Error("COTO_PRIVATE_INTEGRATION_TOKEN is required in production. Mock mode is disabled.");
    }
    if (config.sessionSecret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production.");
    }
  }

  return config;
}
