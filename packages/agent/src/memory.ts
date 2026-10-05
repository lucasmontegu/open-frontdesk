import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

export interface CreateMemoryOptions {
  connectionString: string;
}

/**
 * Conversation memory in the shared Postgres, schema `mastra`.
 * Scope every call with `memoryScope(contactId, conversationId)`.
 */
export function createMemory({ connectionString }: CreateMemoryOptions): Memory {
  return new Memory({
    storage: new PostgresStore({ id: "ofd-memory", connectionString, schemaName: "mastra" }),
    options: {
      lastMessages: 20,
      workingMemory: {
        enabled: true,
        scope: "resource",
        template: `# Datos del cliente
- Nombre preferido:
- Preferencias de contacto (canal, horario):
- Situación actual:
- Compromisos asumidos:
`,
      },
    },
  });
}

/** resourceId = contactId (remembered across channels), threadId = conversationId. */
export function memoryScope(contactId: string, conversationId: string) {
  return { resource: contactId, thread: conversationId };
}
