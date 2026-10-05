import { createRedis } from "@ofd/infra";

export type RedisClient = ReturnType<typeof createRedis>;

export interface ManagedRedis {
  client: RedisClient;
  quit(): Promise<void>;
}

export async function connectRedis(url: string): Promise<ManagedRedis> {
  const client = createRedis(url);
  return {
    client,
    quit: async () => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}
