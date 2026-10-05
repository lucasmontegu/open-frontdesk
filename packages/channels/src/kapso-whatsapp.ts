import type { MessagingProvider } from "@ofd/core";

export interface KapsoOptions {
  baseUrl: string;
  apiKey: string;
  /** The WhatsApp business phone number id configured in Kapso. */
  phoneNumberId: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Sends WhatsApp text messages through Kapso's WhatsApp Cloud API proxy. */
export class KapsoWhatsAppProvider implements MessagingProvider {
  readonly id = "kapso";
  private readonly doFetch: NonNullable<KapsoOptions["fetch"]>;

  constructor(private readonly opts: KapsoOptions) {
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  async send(input: {
    orgId: string;
    to: string;
    text: string;
    conversationId: string;
  }): Promise<{ providerMessageId: string }> {
    // TODO verify against vendor API: Kapso path, version segment and X-API-Key auth header.
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/meta/whatsapp/v24.0/${this.opts.phoneNumberId}/messages`;
    const res = await this.doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.opts.apiKey },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        // WhatsApp expects digits without the leading "+".
        to: input.to.replace(/^\+/, ""),
        type: "text",
        text: { body: input.text },
      }),
    });
    if (!res.ok)
      throw new Error(`Kapso send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { messages?: Array<{ id: string }> };
    const id = body.messages?.[0]?.id;
    if (!id) throw new Error("Kapso send failed: response has no message id");
    return { providerMessageId: id };
  }
}
