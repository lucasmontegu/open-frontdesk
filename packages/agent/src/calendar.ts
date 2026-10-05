import { randomUUID } from "node:crypto";
import type { HoldStore } from "@ofd/core";

export interface Slot {
  /** Stable id: the provider decides, the in-memory one uses the start timestamp. */
  id: string;
  start: Date;
  end: Date;
}

export interface Booking {
  id: string;
  orgId: string;
  contactId: string;
  start: Date;
  end: Date;
  status: "booked" | "cancelled";
  /** What the appointment is for: "turno", "demo", ... */
  kind: string;
  note?: string;
}

/** The scheduling backend (Google Calendar, a clinic system, ...). Every method is scoped by orgId. */
export interface CalendarProvider {
  listFreeSlots(orgId: string, range: { from: Date; to: Date; limit?: number }): Promise<Slot[]>;
  getBooking(orgId: string, bookingId: string): Promise<Booking | null>;
  /** Rejects with an Error when the slot is no longer free. */
  book(orgId: string, input: { contactId: string; slotId: string; kind?: string; note?: string }): Promise<Booking>;
  reschedule(orgId: string, bookingId: string, newSlotId: string): Promise<Booking>;
  cancel(orgId: string, bookingId: string): Promise<Booking>;
}

/** Dev and test calendar. Slots are added by the caller; booking removes them from the free list. */
export class InMemoryCalendar implements CalendarProvider {
  private free = new Map<string, Map<string, Slot>>();
  private bookings = new Map<string, Booking>();
  private bookingSlot = new Map<string, Slot>();

  addSlots(orgId: string, slots: Array<{ start: Date; end: Date }>): Slot[] {
    const org = this.orgSlots(orgId);
    return slots.map((s) => {
      const slot: Slot = { id: s.start.toISOString(), start: s.start, end: s.end };
      org.set(slot.id, slot);
      return slot;
    });
  }

  async listFreeSlots(orgId: string, { from, to, limit }: { from: Date; to: Date; limit?: number }): Promise<Slot[]> {
    const slots = [...this.orgSlots(orgId).values()]
      .filter((s) => s.start >= from && s.start < to)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    return limit ? slots.slice(0, limit) : slots;
  }

  async getBooking(orgId: string, bookingId: string): Promise<Booking | null> {
    const b = this.bookings.get(bookingId);
    return b && b.orgId === orgId ? b : null;
  }

  async book(orgId: string, input: { contactId: string; slotId: string; kind?: string; note?: string }): Promise<Booking> {
    const slot = this.takeSlot(orgId, input.slotId);
    const booking: Booking = {
      id: randomUUID(),
      orgId,
      contactId: input.contactId,
      start: slot.start,
      end: slot.end,
      status: "booked",
      kind: input.kind ?? "turno",
      ...(input.note ? { note: input.note } : {}),
    };
    this.bookings.set(booking.id, booking);
    this.bookingSlot.set(booking.id, slot);
    return booking;
  }

  async reschedule(orgId: string, bookingId: string, newSlotId: string): Promise<Booking> {
    const current = await this.requireBooking(orgId, bookingId);
    const next = this.takeSlot(orgId, newSlotId);
    const old = this.bookingSlot.get(bookingId);
    if (old) this.orgSlots(orgId).set(old.id, old);
    const updated: Booking = { ...current, start: next.start, end: next.end };
    this.bookings.set(bookingId, updated);
    this.bookingSlot.set(bookingId, next);
    return updated;
  }

  async cancel(orgId: string, bookingId: string): Promise<Booking> {
    const current = await this.requireBooking(orgId, bookingId);
    const old = this.bookingSlot.get(bookingId);
    if (old) this.orgSlots(orgId).set(old.id, old);
    this.bookingSlot.delete(bookingId);
    const updated: Booking = { ...current, status: "cancelled" };
    this.bookings.set(bookingId, updated);
    return updated;
  }

  private orgSlots(orgId: string): Map<string, Slot> {
    let m = this.free.get(orgId);
    if (!m) this.free.set(orgId, (m = new Map()));
    return m;
  }

  private takeSlot(orgId: string, slotId: string): Slot {
    const org = this.orgSlots(orgId);
    const slot = org.get(slotId);
    if (!slot) throw new Error("El horario ya no está disponible");
    org.delete(slotId);
    return slot;
  }

  private async requireBooking(orgId: string, id: string): Promise<Booking> {
    const b = await this.getBooking(orgId, id);
    if (!b || b.status !== "booked") throw new Error("No se encontró el turno");
    return b;
  }
}

/** Dev and test HoldStore with the same contract as the Redis one. Re-holding by the same holder succeeds. */
export class InMemoryHoldStore implements HoldStore {
  private holds = new Map<string, { holder: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async tryHold(key: string, holder: string, ttlSeconds: number): Promise<boolean> {
    const cur = this.holds.get(key);
    if (cur && cur.expiresAt > this.now() && cur.holder !== holder) return false;
    this.holds.set(key, { holder, expiresAt: this.now() + ttlSeconds * 1000 });
    return true;
  }

  async release(key: string, holder: string): Promise<void> {
    if (this.holds.get(key)?.holder === holder) this.holds.delete(key);
  }
}

export const slotHoldKey = (orgId: string, slotId: string) => `slot:${orgId}:${slotId}`;

/**
 * Lists free slots and holds each one for `holder`, so two contacts are never offered the same slot.
 * Returns only the slots this holder actually got.
 */
export async function offerSlots(
  calendar: CalendarProvider,
  holds: HoldStore,
  orgId: string,
  holder: string,
  range: { from: Date; to: Date },
  count: number,
  ttlSeconds = 15 * 60,
): Promise<Slot[]> {
  const candidates = await calendar.listFreeSlots(orgId, range);
  const offered: Slot[] = [];
  for (const slot of candidates) {
    if (offered.length >= count) break;
    if (await holds.tryHold(slotHoldKey(orgId, slot.id), holder, ttlSeconds)) offered.push(slot);
  }
  return offered;
}
