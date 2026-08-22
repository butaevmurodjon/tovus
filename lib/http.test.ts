import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./http";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves with the response when fetch completes before the timeout", async () => {
    const response = new Response("ok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await fetchWithTimeout("https://example.com", {}, 1000);

    expect(result).toBe(response);
  });

  it("aborts the request once the timeout elapses (regression)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchWithTimeout("https://example.com", {}, 1000);
    const assertion = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("clears the timer even when fetch rejects for a non-abort reason (regression)", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearTimeout");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(fetchWithTimeout("https://example.com", {}, 1000)).rejects.toThrow("network down");

    expect(clearSpy).toHaveBeenCalled();
  });

  it("passes through the init options alongside the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTimeout("https://example.com", { method: "POST", headers: { "X-Test": "1" } }, 1000);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ method: "POST", headers: { "X-Test": "1" }, signal: expect.any(AbortSignal) })
    );
  });
});
