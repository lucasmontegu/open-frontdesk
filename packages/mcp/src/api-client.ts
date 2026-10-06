export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

/** An error response from the API, `{ error: { code, message } }`, or a transport failure. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thin JSON client for the OpenFrontDesk HTTP API. Routes are relative to `<baseUrl>/api`. */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetch ?? fetch;
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {}))
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (e) {
      throw new ApiError(
        0,
        "network_error",
        `Could not reach the API at ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) {
      const err = (
        json as { error?: { code?: string; message?: string; details?: unknown } } | null
      )?.error;
      throw new ApiError(
        res.status,
        err?.code ?? `http_${res.status}`,
        err?.message ?? `The API answered ${res.status}`,
        err?.details ?? json,
      );
    }
    return json as T;
  }
}
