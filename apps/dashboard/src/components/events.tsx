import {
  ArrowRightLeftIcon,
  BrainIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  HandIcon,
  type LucideIcon,
  MessageCircleIcon,
  MessageSquareReplyIcon,
  PhoneIcon,
  PhoneOffIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldBanIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { t } from "@/i18n";
import type { EventDto } from "@/lib/api";
import { eventSummary, refusalRule } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusPill, type Tone } from "./common";

const icons: Record<string, LucideIcon> = {
  "conversation.started": PhoneIcon,
  "conversation.ended": PhoneOffIcon,
  "customer.message": MessageCircleIcon,
  "agent.message": MessageSquareReplyIcon,
  "guard.input_flagged": ShieldAlertIcon,
  "guard.output_blocked": ShieldAlertIcon,
  "tool.requested": WrenchIcon,
  "tool.permitted": CheckCircle2Icon,
  "tool.refused": ShieldBanIcon,
  "tool.completed": CheckCircle2Icon,
  "tool.failed": XCircleIcon,
  "transfer.requested": ArrowRightLeftIcon,
  "transfer.completed": ArrowRightLeftIcon,
  "takeover.started": HandIcon,
  "takeover.ended": HandIcon,
  "fact.extracted": BrainIcon,
  "mission.planned": SendIcon,
  "mission.approved": SendIcon,
  "mission.completed": SendIcon,
};

export function eventTone(type: string): Tone {
  if (type === "tool.refused" || type === "tool.failed" || type.startsWith("guard."))
    return "danger";
  if (type.startsWith("transfer.") || type.startsWith("takeover.")) return "warning";
  if (type === "tool.completed" || type === "tool.permitted" || type === "mission.completed")
    return "success";
  if (type.startsWith("mission.") || type === "fact.extracted") return "brand";
  return "neutral";
}

const iconTone: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-destructive",
  brand: "bg-brand-soft text-brand",
};

export const eventLabel = (type: string) => t.activity.types[type] ?? type;

/** One white rounded row per event; refusals show the rule that stopped them. */
export function EventRow({ e, showActor = true }: { e: EventDto; showActor?: boolean }) {
  const Icon = icons[e.type] ?? CircleDotIcon;
  const tone = eventTone(e.type);
  const rule = refusalRule(e);
  const summary = eventSummary(e);
  return (
    <li className="flex items-start gap-3 rounded-2xl bg-background p-3.5">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          iconTone[tone],
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="font-medium text-sm">{eventLabel(e.type)}</p>
          {e.type === "tool.refused" && <StatusPill tone="danger">{t.activity.refused}</StatusPill>}
        </div>
        {summary && (
          <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground text-sm">{summary}</p>
        )}
        {rule && (
          <p className="mt-1.5 inline-flex rounded-full bg-danger-soft px-2.5 py-0.5 font-medium text-destructive text-xs">
            {t.activity.refusedBy(rule)}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right text-muted-foreground text-xs">
        <p className="tabular-nums">{formatDateTime(e.occurredAt)}</p>
        {showActor && <p className="mt-0.5">{t.activity.actors[e.actorKind] ?? e.actorKind}</p>}
      </div>
    </li>
  );
}

export function EventList({ events, showActor }: { events: EventDto[]; showActor?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {events.map((e) => (
        <EventRow key={e.id} e={e} showActor={showActor} />
      ))}
    </ul>
  );
}

type ToolState = "input-available" | "output-available" | "output-error" | "output-denied";

interface ToolCall {
  kind: "tool";
  id: string;
  tool: string;
  input?: unknown;
  output?: unknown;
  state: ToolState;
  error?: string;
}

type Item = { kind: "event"; e: EventDto } | ToolCall;

/** Folds requested → permitted/refused → completed/failed into one card per tool call. */
export function foldConversation(events: EventDto[]): Item[] {
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const items: Item[] = [];
  const open = new Map<string, ToolCall>();
  for (const e of ordered) {
    if (!e.type.startsWith("tool.")) {
      items.push({ kind: "event", e });
      continue;
    }
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const tool = String(p.tool ?? "tool");
    let call = open.get(tool);
    if (!call || e.type === "tool.requested") {
      call = { kind: "tool", id: e.id, tool, state: "input-available" };
      open.set(tool, call);
      items.push(call);
    }
    if (e.type === "tool.requested") call.input = p.input;
    if (e.type === "tool.refused") {
      call.state = "output-denied";
      call.error = `${String(p.reason ?? "")} · ${t.activity.refusedBy(String(p.rule ?? ""))}`;
      open.delete(tool);
    }
    if (e.type === "tool.failed") {
      call.state = "output-error";
      call.error = String(p.error ?? "");
      open.delete(tool);
    }
    if (e.type === "tool.completed") {
      call.state = "output-available";
      call.output = p.output;
      open.delete(tool);
    }
  }
  return items;
}

/**
 * Replays a conversation from its event log as a chat: customer and bot messages as bubbles,
 * tool calls as collapsible AI Elements tool cards, everything else as a quiet system line.
 */
export function ConversationView({ events }: { events: EventDto[] }) {
  return (
    <Conversation className="max-h-[65vh] rounded-2xl bg-muted/50">
      <ConversationContent className="gap-4">
        {foldConversation(events).map((item) => {
          if (item.kind === "tool") {
            return (
              <Tool key={item.id} className="mb-0 rounded-2xl bg-background">
                <ToolHeader type="dynamic-tool" toolName={item.tool} state={item.state} />
                <ToolContent>
                  {item.input !== undefined && <ToolInput input={item.input} />}
                  <ToolOutput output={item.output as never} errorText={item.error} />
                </ToolContent>
              </Tool>
            );
          }
          const { e } = item;
          const p = (e.payload ?? {}) as Record<string, unknown>;
          if (e.type === "customer.message" || e.type === "agent.message") {
            return (
              <Message key={e.id} from={e.type === "customer.message" ? "user" : "assistant"}>
                <MessageContent className="group-[.is-assistant]:rounded-2xl group-[.is-assistant]:bg-background group-[.is-assistant]:px-4 group-[.is-assistant]:py-3 group-[.is-user]:rounded-2xl group-[.is-user]:bg-foreground group-[.is-user]:text-background">
                  <MessageResponse>{String(p.text ?? "")}</MessageResponse>
                </MessageContent>
                <span className="px-1 text-[11px] text-muted-foreground group-[.is-user]:text-right">
                  {formatDateTime(e.occurredAt)}
                </span>
              </Message>
            );
          }
          const summary = eventSummary(e);
          return (
            <p key={e.id} className="text-center text-muted-foreground text-xs">
              {eventLabel(e.type)}
              {summary ? ` · ${summary}` : ""} · {formatDateTime(e.occurredAt)}
            </p>
          );
        })}
      </ConversationContent>
    </Conversation>
  );
}
