export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorOptions {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
}

export async function requestJson<T>(
  doFetch: FetchLike,
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<T | null> {
  const res = await doFetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
      ...init.headers,
    },
  });
  if (res.status === 204) return null;
  if (!res.ok)
    throw new Error(
      `${init.method ?? "GET"} ${url} failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  return (await res.json()) as T;
}
