import { createTool } from "@mastra/core/tools";
import type { ToolCallContext, ToolDefinition, ToolGateway } from "@ofd/core";

export type GatewayToolContext = Omit<ToolCallContext, "traceId">;

/** What the model sees when the gateway refuses or fails a call. */
export function refusalMessage(reason: string): string {
  return `Acción no permitida: ${reason}. No la realizaste. Explicale al cliente, con tus palabras, que eso no lo podés hacer y ofrecele una alternativa o pasarlo con una persona.`;
}

/** Wraps one gateway tool as a Mastra tool. The handler never runs directly: every call goes through gateway.call. */
export function toMastraTool(def: ToolDefinition, gateway: ToolGateway, ctx: GatewayToolContext) {
  return createTool({
    id: def.name,
    description: def.description,
    inputSchema: def.inputSchema as never,
    execute: async (input: unknown) => {
      const res = await gateway.call(def.name, input, { ...ctx, traceId: null });
      if (res.ok) return res.output;
      if (res.refused)
        return {
          ok: false,
          refused: true,
          ruleId: res.ruleId,
          message: refusalMessage(res.reason),
        };
      return {
        ok: false,
        refused: false,
        message: `La herramienta falló: ${res.error}. Disculpate con el cliente y ofrecé reintentar o pasarlo con una persona.`,
      };
    },
  });
}

export function buildGatewayTools(
  gateway: ToolGateway,
  toolNames: string[],
  ctx: GatewayToolContext,
) {
  const tools: Record<string, ReturnType<typeof toMastraTool>> = {};
  for (const def of gateway.list(toolNames)) tools[def.name] = toMastraTool(def, gateway, ctx);
  return tools;
}
