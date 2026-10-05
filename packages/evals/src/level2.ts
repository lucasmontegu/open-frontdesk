import { Agent } from "@mastra/core/agent";
import { OrgId, type EventType, type InteractionEvent, type ToolCallContext, type ToolEffect, type ToolGateway } from "@ofd/core";
import { createBuiltinTools, createFrontDeskAgent, type GatewayToolContext } from "@ofd/agent";
import { createToolGateway } from "@ofd/gateway";
import { checkAssertionOverEvents } from "./assertions.js";
import type { AssertionCheck, ConversationOptions, LevelResult, ScenarioInput } from "./types.js";
import { createWorld, type World } from "./world.js";

export const DEFAULT_MAX_TURNS = 8;
const END_MARKER = "[FIN]";
const isStageDirection = (t: string) => /^\(.*\)$/.test(t.trim());

type Msg = { role: "user"; content: string } | { role: "assistant"; content: string };
type FrontDeskAgent = ReturnType<typeof createFrontDeskAgent>;

const customerInstructions = (persona: string, goal: string) =>
  [
    "Estás simulando a un cliente en una conversación con el asistente virtual de una empresa argentina. Hablás en español rioplatense.",
    `Tu personaje: ${persona}`,
    `Tu objetivo: ${goal}`,
    "Respondé solo con lo que diría el cliente, en una o dos frases, como en un chat. Nunca actúes como el asistente ni des explicaciones.",
    `Si tu objetivo ya se cumplió o la conversación terminó, respondé exactamente: ${END_MARKER}`,
  ].join("\n");

/** The simulated customer is a plain Mastra Agent: no tools, no guards. */
function createCustomerAgent(_frontDesk: FrontDeskAgent, model: ConversationOptions["model"], persona: string, goal: string): FrontDeskAgent {
  return new Agent({
    id: "simulated-customer",
    name: "Cliente simulado",
    instructions: customerInstructions(persona, goal),
    model: model as ConstructorParameters<typeof Agent>[0]["model"],
  }) as unknown as FrontDeskAgent;
}

/** The customer sees the conversation with the roles swapped. */
function customerView(history: Msg[]): Msg[] {
  const flipped = history.map<Msg>((m) => ({ role: m.role === "user" ? "assistant" : "user", content: m.content.replace(/^\[Sistema\] /, "") }));
  return flipped[0]?.role === "assistant" ? [{ role: "user", content: "Empezá la conversación." }, ...flipped] : flipped;
}

export async function runConversationLevel(input: ScenarioInput): Promise<LevelResult> {
  const { scenario, botVersion, orgId } = input;
  const options = input.conversation;
  if (!options) throw new Error("runConversationLevel needs `conversation` options");
  const config = botVersion.config;

  const world = await createWorld(orgId, scenario);
  const catalog = createBuiltinTools(world.deps);
  const effects = new Map<string, ToolEffect>(catalog.map((t) => [t.name, t.effect]));
  const gateway: ToolGateway = createToolGateway({
    tools: catalog,
    policies: async () => input.policies,
    events: world.events,
    contacts: async (org, id) => {
      const c = await world.contacts.get(org, id);
      return c ? { doNotCall: c.doNotCall, attributes: c.attributes } : null;
    },
    clock: world.clock,
  });

  const outbound = scenario.turns.some(isStageDirection);
  const toolContext: GatewayToolContext = {
    orgId,
    actor: { kind: "bot", id: botVersion.botId, orgId: OrgId.parse(orgId), botVersionId: botVersion.id },
    conversationId: world.conversationId,
    contactId: world.contactId,
    botVersionId: botVersion.id,
    autonomy: config.autonomy,
    initiator: outbound ? "mission" : "inbound",
  } satisfies Omit<ToolCallContext, "traceId">;

  const agent = createFrontDeskAgent({
    botVersion,
    gateway,
    toolContext,
    profile: await world.profile(),
    model: options.botModel ?? config.model,
    events: world.events,
  });
  const customer = createCustomerAgent(agent, options.model, scenario.persona, scenario.goal);

  const record = (type: EventType, payload: unknown, actor: "bot" | "customer") =>
    world.events.append({
      orgId,
      type,
      payload,
      conversationId: world.conversationId,
      botVersionId: botVersion.id,
      contactId: world.contactId,
      actorKind: actor,
      actorId: actor === "bot" ? botVersion.botId : world.contactId,
      traceId: null,
    } as never);

  const transcript: string[] = [];
  const history: Msg[] = [];
  await record("conversation.started", { channel: "web", contactId: world.contactId, direction: outbound ? "outbound" : "inbound" }, "bot");

  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  for (let turn = 0; turn < maxTurns; turn++) {
    let said: string;
    const scripted = scenario.turns[turn];
    if (scripted !== undefined) {
      said = scripted.trim();
    } else {
      const reply = await customer.generate(customerView(history));
      said = reply.text.trim();
      if (!said || said.includes(END_MARKER)) break;
    }

    if (isStageDirection(said)) {
      // A stage direction is not something the customer says: the bot starts an outbound contact.
      history.push({ role: "user", content: `[Sistema] Iniciá el contacto saliente con el cliente. ${said}` });
    } else {
      history.push({ role: "user", content: said });
      transcript.push(`Cliente: ${said}`);
      await record("customer.message", { text: said }, "customer");
    }

    const answer = (await agent.generate(history, { maxSteps: 10 })).text.trim();
    history.push({ role: "assistant", content: answer || "(sin respuesta)" });
    if (answer) {
      transcript.push(`Agente: ${answer}`);
      await record("agent.message", { text: answer }, "bot");
    }
  }

  const events: InteractionEvent[] = await world.events.listByConversation(orgId, world.conversationId);
  const checks: AssertionCheck[] = scenario.assertions.map((assertion) => {
    const reason = checkAssertionOverEvents(assertion, events, effects);
    return reason === null ? { assertion, status: "passed" } : { assertion, status: "failed", reason };
  });
  return { passed: checks.every((c) => c.status === "passed"), checks, errors: [], transcript };
}

/** A crashed simulation (no API key, provider error) fails the scenario instead of aborting the whole gate. */
export async function runConversationLevelSafe(input: ScenarioInput): Promise<LevelResult> {
  try {
    return await runConversationLevel(input);
  } catch (e) {
    const reason = `la simulación falló: ${e instanceof Error ? e.message : String(e)}`;
    return { passed: false, checks: input.scenario.assertions.map((assertion) => ({ assertion, status: "failed" as const, reason })), errors: [reason] };
  }
}

export type { World };
