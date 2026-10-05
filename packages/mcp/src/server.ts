import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient, type ApiClientOptions, ApiError } from "./api-client.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

const failure = (e: unknown): ToolResult => {
  if (e instanceof ApiError) {
    const details = e.details !== undefined ? `\n${JSON.stringify(e.details, null, 2)}` : "";
    return {
      isError: true,
      content: [
        { type: "text", text: `API error ${e.status} (${e.code}): ${e.message}${details}` },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
  };
};

/** Maps an API call to a tool result: success becomes JSON text, an API error becomes an `isError` result the AI can read. */
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return failure(e);
  }
}

export type McpServerOptions = ApiClientOptions;

export function createMcpServer(opts: McpServerOptions): McpServer {
  const api = new ApiClient(opts);
  const server = new McpServer({ name: "openfrontdesk", version: "0.1.0" });
  const enc = encodeURIComponent;

  server.registerTool(
    "list_packs",
    {
      title: "List packs",
      description:
        "Lists the installed packs (ready-made bot templates with policies and test scenarios), e.g. cobranza-ar, ventas-ar, recepcion-ar.",
      annotations: { readOnlyHint: true },
    },
    () => run(() => api.request("GET", "/packs")),
  );

  server.registerTool(
    "create_bot_from_pack",
    {
      title: "Create bot from pack",
      description:
        "Creates a bot with a draft version configured from a pack. With publish=true it also runs the release evals and publishes the version; a version that fails the evals is rejected and the failures are returned. A bot needs a published version before missions can be created for it.",
      inputSchema: {
        name: z.string().min(1).describe("Name of the bot"),
        packId: z.string().min(1).describe("Pack id from list_packs"),
        publish: z
          .boolean()
          .optional()
          .describe("Run the evals and publish the draft version (default false)"),
      },
    },
    ({ name, packId, publish }) =>
      run(async () => {
        const bot = await api.request<{ id: string }>("POST", "/bots", { body: { name, packId } });
        if (!publish) return { bot };
        const detail = await api.request<{ versions: Array<{ id: string; version: number }> }>(
          "GET",
          `/bots/${enc(bot.id)}`,
        );
        const draft = detail.versions.at(-1);
        if (!draft) return { bot, published: false, note: "The bot has no version to publish" };
        const published = await api.request(
          "POST",
          `/bots/${enc(bot.id)}/versions/${enc(draft.id)}/publish`,
        );
        return { bot, published };
      }),
  );

  server.registerTool(
    "list_contacts",
    {
      title: "List contacts",
      description:
        "Lists the contacts of the organization, newest page first. Use `search` to filter by name or identity and `cursor` (from nextCursor) to get the next page.",
      inputSchema: {
        search: z.string().optional().describe("Text to search for"),
        limit: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional().describe("nextCursor of the previous page"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ search, limit, cursor }) =>
      run(() => api.request("GET", "/contacts", { query: { search, limit, cursor } })),
  );

  server.registerTool(
    "import_contacts_csv",
    {
      title: "Import contacts from CSV",
      description:
        "Imports contacts (and their debts, leads or appointments) from CSV text. The first line must be the header; common Spanish and English column names are recognized (nombre, telefono, email, dni, monto, vencimiento...).",
      inputSchema: {
        csv: z.string().min(1).describe("The CSV file content, header line included"),
      },
    },
    ({ csv }) => run(() => api.request("POST", "/contacts/import", { body: { csv } })),
  );

  server.registerTool(
    "create_mission",
    {
      title: "Create mission",
      description:
        'Creates a mission for a bot from a natural-language instruction (for example "Reprogramá los turnos de mañana"). The bot must have a published version. The mission is planned in the background: poll get_mission until its status is awaiting_approval, then call approve_mission.',
      inputSchema: {
        botId: z.string().min(1).describe("Bot id"),
        instruction: z.string().min(1).describe("What the bot should do, in natural language"),
      },
    },
    ({ botId, instruction }) =>
      run(() => api.request("POST", "/missions", { body: { botId, instruction } })),
  );

  server.registerTool(
    "approve_mission",
    {
      title: "Approve mission",
      description:
        "Approves a planned mission (status awaiting_approval) so the bot starts contacting people. Only approve after the person you work for has reviewed the plan from get_mission.",
      inputSchema: { missionId: z.string().min(1) },
    },
    ({ missionId }) => run(() => api.request("POST", `/missions/${enc(missionId)}/approve`)),
  );

  server.registerTool(
    "get_mission",
    {
      title: "Get mission",
      description:
        "Reads a mission: status, the plan (targets, channel strategy, estimate) and, when finished, the report.",
      inputSchema: { missionId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    ({ missionId }) => run(() => api.request("GET", `/missions/${enc(missionId)}`)),
  );

  return server;
}
