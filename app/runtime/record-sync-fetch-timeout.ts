const RECORD_SYNC_REQUEST_TIMEOUT_MS = 8_000;

const nativeFetch = window.fetch.bind(window);

function requestUrl(input: RequestInfo | URL): URL | undefined {
  try {
    if (input instanceof Request) return new URL(input.url, window.location.href);
    if (input instanceof URL) return input;
    return new URL(String(input), window.location.href);
  } catch {
    return undefined;
  }
}

function isRecordSyncRequest(input: RequestInfo | URL): boolean {
  const url = requestUrl(input);
  return Boolean(url && (url.pathname === "/api/v1/records" || url.pathname.startsWith("/api/v1/records/")));
}

function hasCallerSignal(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.signal) return true;
  return input instanceof Request && Boolean(input.signal);
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (!isRecordSyncRequest(input) || hasCallerSignal(input, init)) return nativeFetch(input, init);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), RECORD_SYNC_REQUEST_TIMEOUT_MS);
  try {
    return await nativeFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("云端记录请求超时，请检查网络后重试");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};
