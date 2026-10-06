import type {
  BotRepository,
  Clock,
  ContactFactRepository,
  ContactRepository,
  ConversationRepository,
  EventStore,
  KnowledgeSearch,
  MissionRepository,
  ObligationRepository,
  OrgSettingsRepository,
  PolicyRepository,
  PortfolioRepository,
  ProfileLoader,
} from "@ofd/core";
import type { Db } from "./client.js";
import { PgBotRepository } from "./repos/bots.js";
import { PgContactRepository } from "./repos/contacts.js";
import {
  PgContactFactRepository,
  PgObligationRepository,
  PgPortfolioRepository,
  PgProfileLoader,
} from "./repos/crm.js";
import { EvalRunRepository } from "./repos/eval-runs.js";
import {
  PgConversationRepository,
  PgEventStore,
  PgMissionRepository,
  PgPolicyRepository,
} from "./repos/interactions.js";
import { type Embed, PgKnowledgeSearch } from "./repos/knowledge.js";
import { PgOrgSettingsRepository } from "./repos/settings.js";

export interface Repositories {
  contacts: ContactRepository;
  portfolios: PortfolioRepository;
  obligations: ObligationRepository;
  facts: ContactFactRepository;
  profiles: ProfileLoader;
  bots: BotRepository;
  events: EventStore;
  conversations: ConversationRepository;
  policies: PolicyRepository;
  missions: MissionRepository;
  knowledge: KnowledgeSearch;
  evalRuns: EvalRunRepository;
  settings: OrgSettingsRepository;
}

export function createRepositories(
  db: Db,
  opts: { embed?: Embed; clock?: Clock } = {},
): Repositories {
  const contacts = new PgContactRepository(db);
  const obligations = new PgObligationRepository(db);
  const facts = new PgContactFactRepository(db);
  return {
    contacts,
    portfolios: new PgPortfolioRepository(db),
    obligations,
    facts,
    profiles: new PgProfileLoader(db, contacts, obligations, facts),
    bots: new PgBotRepository(db),
    events: new PgEventStore(db),
    conversations: new PgConversationRepository(db, opts.clock),
    policies: new PgPolicyRepository(db),
    missions: new PgMissionRepository(db),
    knowledge: new PgKnowledgeSearch(db, opts.embed),
    evalRuns: new EvalRunRepository(db),
    settings: new PgOrgSettingsRepository(db),
  };
}
