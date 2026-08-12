export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Fetcher = <T>(path: string, options?: RequestInit) => Promise<T>;

export function createFetcher(initData: string | null): Fetcher {
  return async function fetcher<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    if (initData) headers["Authorization"] = `tma ${initData}`;

    const res = await fetch(path, { ...options, headers });
    const text = await res.text();
    if (!res.ok) {
      let body: { error?: string } = {};
      try {
        body = JSON.parse(text) as { error?: string };
      } catch {
        // тело ответа не является JSON — игнорируем
      }
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, "Invalid JSON response");
    }
  };
}
