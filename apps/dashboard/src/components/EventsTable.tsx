import { t } from "../i18n";
import type { EventDto } from "../lib/api";
import { eventSummary, refusalRule } from "../lib/events";
import { formatDateTime } from "../lib/format";
import { Badge, Table, Td, Th } from "./ui";

/** Refused tool calls get a red row, a badge and the rule that refused them. */
export function EventsTable({ events, showActor = true }: { events: EventDto[]; showActor?: boolean }) {
  return (
    <Table caption={t.activity.title}>
      <thead>
        <tr>
          <Th>{t.activity.when}</Th>
          <Th>{t.activity.event}</Th>
          <Th>{t.activity.detail}</Th>
          {showActor && <Th>{t.activity.actor}</Th>}
        </tr>
      </thead>
      <tbody>
        {events.map((e) => {
          const rule = refusalRule(e);
          const refused = e.type === "tool.refused";
          return (
            <tr key={e.id} className={refused ? "bg-danger-bg/60" : undefined}>
              <Td className="whitespace-nowrap text-muted">{formatDateTime(e.occurredAt)}</Td>
              <Td className="whitespace-nowrap">
                <span className="font-mono text-xs">{e.type}</span>{" "}
                {refused && <Badge tone="danger">{t.activity.refused}</Badge>}
              </Td>
              <Td>
                <span className="break-words">{eventSummary(e)}</span>
                {rule && <div className="mt-1 text-xs font-medium text-danger">{t.activity.refusedBy(rule)}</div>}
              </Td>
              {showActor && <Td className="whitespace-nowrap text-muted">{t.activity.actors[e.actorKind] ?? e.actorKind}</Td>}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
