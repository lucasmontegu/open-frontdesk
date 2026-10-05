/** Creates a payment link (Mercado Pago, etc.) for an amount. */
export interface PaymentLinkProvider {
  create(input: {
    orgId: string;
    contactId: string;
    obligationId: string;
    amount: number;
    currency: string;
  }): Promise<{ url: string }>;
}

/** Org-level limits for collections. get_payment_options never returns anything outside them. */
export interface PaymentPolicy {
  /** Highest discount (percent) for paying in full. 0 means no discount. */
  maxDiscountPercent: number;
  /** Highest number of interest-free installments. 1 means no installments. */
  maxInstallments: number;
  /** Furthest date (days from today) a promise to pay may be set. */
  maxPromiseDays: number;
}

export const DEFAULT_PAYMENT_POLICY: PaymentPolicy = {
  maxDiscountPercent: 0,
  maxInstallments: 1,
  maxPromiseDays: 30,
};

/** Payload of every `mission.contact` job: one target of a mission, or a callback the customer asked for. */
export interface MissionContactJob {
  orgId: string;
  /** Null for a callback scheduled during a conversation. */
  missionId: string | null;
  botId: string | null;
  contactId: string;
  channel: "whatsapp" | "voice";
  offer: Record<string, unknown>;
  reason?: string;
}
