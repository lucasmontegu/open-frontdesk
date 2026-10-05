import { betterAuth, type BetterAuthOptions } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { organization } from "better-auth/plugins";
import { Pool } from "pg";
import { ac, roles } from "./access.js";

export interface AuthConfig {
  databaseUrl: string;
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
}

export function authOptions(config: AuthConfig, pool = new Pool({ connectionString: config.databaseUrl })) {
  return {
    database: pool,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: config.trustedOrigins ?? [],
    emailAndPassword: { enabled: true },
    plugins: [
      organization({ ac, roles, creatorRole: "owner" }),
      // Organization-owned keys for machine clients (the MCP server, integrations).
      apiKey({ references: "organization", defaultPrefix: "ofd_" }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(config: AuthConfig) {
  return betterAuth(authOptions(config));
}

export type Auth = ReturnType<typeof createAuth>;
