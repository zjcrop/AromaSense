// Build-time reads only. Keep timeouts active until the response body is complete.
export async function fetchBuildBytes(url, timeoutMs = 15000) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const error = new Error(`${url} -> HTTP ${response.status}`);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error.retryable === false || attempt === 3) throw new Error(`Build resource unavailable: ${url}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, 400 * attempt));
    }
  }
}
