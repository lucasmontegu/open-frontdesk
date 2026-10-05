import { randomUUID } from "node:crypto";
import type { MessagingProvider } from "@ofd/core";

export interface MinimalLogger {
  info(obj: object, msg?: string): void;
}

/** Local-dev provider: logs the message instead of sending it. */
export class ConsoleMessagingProvider implements MessagingProvider {
  readonly id = "console";
  readonly sent: Array<{ orgId: string; to: string; text: string; conversationId: string }> = [];

  constructor(
    private readonly logger: MinimalLogger = { info: (o, m) => console.log(m ?? "message", o) },
  ) {}

  async send(input: { orgId: string; to: string; text: string; conversationId: string }) {
    this.sent.push(input);
    this.logger.info(input, "[console messaging] would send WhatsApp message");
    return { providerMessageId: `console_${randomUUID()}` };
  }
}
