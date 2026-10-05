import { describe, expect, it } from "vitest";
import { createAuth } from "./auth.js";
import { migrateAuth } from "./migrate.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://ofd:ofd@localhost:5432/ofd";
const config = {
  databaseUrl,
  secret: "test-secret-test-secret-test-secret",
  baseURL: "http://localhost:3000",
};

describe("auth", () => {
  it("migrates, signs up and creates an organization owned by the creator", async () => {
    await migrateAuth(config);
    const auth = createAuth(config);
    const email = `owner-${crypto.randomUUID()}@example.com`;
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "una-clave-segura-123", name: "Dueña" },
      returnHeaders: true,
    });
    const cookie = signUp.headers.get("set-cookie") ?? "";
    const org = await auth.api.createOrganization({
      body: { name: "Clínica Test", slug: `clinica-${crypto.randomUUID().slice(0, 8)}` },
      headers: new Headers({ cookie }),
    });
    expect(org?.members?.[0]?.role).toBe("owner");
  });
});
