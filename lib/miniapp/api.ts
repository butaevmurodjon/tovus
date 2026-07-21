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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  };
}
