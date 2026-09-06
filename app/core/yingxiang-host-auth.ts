export interface YingxiangHostSession {
  accountId: string;
  accountName: string;
  token: string;
  expiresAt: string;
}

export class YingxiangHostAuthError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) {
    super(message || code);
    this.name = "YingxiangHostAuthError";
  }
}

const MESSAGES: Record<string, string> = {
  YINGXIANG_HOST_ACCOUNT_NAME_INVALID: "迎香账号名称需为 2–32 个字符。",
  YINGXIANG_HOST_DEVICE_SECRET_INVALID: "本设备的迎香凭据无效，请重新创建账号。",
  YINGXIANG_HOST_ACCOUNT_EXISTS: "这个迎香账号名称已经存在。若它属于本设备，请直接登录。",
  YINGXIANG_HOST_ACCOUNT_NOT_FOUND: "没有找到这个迎香账号。首次使用可在本设备创建。",
  YINGXIANG_HOST_DEVICE_MISMATCH: "这个迎香账号不是在本设备创建的，当前版本不能跨设备直接登录。",
  YINGXIANG_HOST_ACCOUNT_CREATE_FAILED: "迎香账号创建失败。",
  YINGXIANG_HOST_UNAUTHORIZED: "迎香主办方会话已失效，请重新输入迎香账号登录。",
  NETWORK_ERROR: "当前无法连接迎香服务。"
};

export class YingxiangHostAuthClient {
  constructor(private readonly baseUrl: string) {}

  register(accountName: string, deviceSecret: string): Promise<YingxiangHostSession> {
    return this.sessionRequest("/api/v1/yingxiang/host/register", { accountName, deviceSecret });
  }

  login(accountName: string, deviceSecret: string): Promise<YingxiangHostSession> {
    return this.sessionRequest("/api/v1/yingxiang/host/login", { accountName, deviceSecret });
  }

  async logout(token: string): Promise<void> {
    try {
      await fetch(new URL("/api/v1/yingxiang/host/logout", this.baseUrl).href, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      // The UI still discards the in-memory host token. Server tokens expire quickly even if logout is offline.
    }
  }

  private async sessionRequest(path: string, body: Record<string, unknown>): Promise<YingxiangHostSession> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl).href, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });
    } catch {
      throw new YingxiangHostAuthError("NETWORK_ERROR", 0, MESSAGES.NETWORK_ERROR);
    }
    let value: Record<string, unknown>;
    try {
      const parsed = await response.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      value = parsed as Record<string, unknown>;
    } catch {
      throw new YingxiangHostAuthError("INVALID_SERVER_RESPONSE", response.status, "迎香服务返回了无法解析的数据。");
    }
    if (!response.ok || value.ok === false) {
      const code = typeof value.error === "string" ? value.error : `HTTP_${response.status}`;
      throw new YingxiangHostAuthError(code, response.status, MESSAGES[code] ?? "迎香账号操作失败。");
    }
    const accountId = String(value.accountId ?? "").trim();
    const accountName = String(value.accountName ?? "").trim();
    const token = String(value.token ?? "").trim();
    const expiresAt = String(value.expiresAt ?? "").trim();
    if (!accountId || !accountName || !/^[a-f0-9]{64}$/iu.test(token) || !Number.isFinite(Date.parse(expiresAt))) {
      throw new YingxiangHostAuthError("INVALID_SERVER_RESPONSE", response.status, "迎香服务返回的账号会话无效。");
    }
    return { accountId, accountName, token, expiresAt };
  }
}

export function createYingxiangDeviceSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function yingxiangCredentialKey(accountName: string): string {
  const normalized = accountName.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const bytes = new TextEncoder().encode(normalized);
  let key = "";
  for (const byte of bytes) key += byte.toString(16).padStart(2, "0");
  return `yingxiang.host.device.v1.${key}`;
}
