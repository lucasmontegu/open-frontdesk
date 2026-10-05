import type { Action, Actor, Resource } from "@ofd/core";
import type { Container } from "../container.js";

export type UserActor = Extract<Actor, { kind: "user" }>;

export interface AppEnv {
  Variables: {
    requestId: string;
    actor: UserActor;
  };
}

/** What every route module receives. */
export type { Container };
export type Permission = [Resource, Action];
