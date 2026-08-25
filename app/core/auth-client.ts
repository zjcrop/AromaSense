export interface AuthSession {
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
}

export interface PendingRegistration {
  email: string;
  createdAt: string;
}

export interface RegistrationResult {
  status: "verification_required";
  email: string;
}

export interface AuthSessionStore {
  get(): Promise<AuthSession | undefined>;
  set(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export interface PendingRegistrationStore {
  get(): Promise<PendingRegistration | undefined>;
  set(value: PendingRegistration): Promise<void>;
  clear(): Promise<void>;
}

export class AuthClientError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthClientError";
  }
}

function messageForAuthError(code: string, status: number): string {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS_FORMAT: "邮箱格式无效，或密码未达到至少 10 位。",
    INVALID_CREDENTIALS: "邮箱或密码不正确。",
    EMAIL_NOT_VERIFIED: "账户尚未激活，请先查阅注册邮箱并完成验证。",
    ACCOUNT_EXISTS: "该邮箱已注册。如果账户已经激活，请直接登录。",
    ACCOUNT_PENDING_VERIFICATION: "该邮箱已提交注册但尚未激活，可以重新发送验证邮件。",
    ACCOUNT_ALREADY_VERIFIED: "该账户已经完成邮箱验证，请直接登录。",
    VERIFICATION_RATE_LIMITED: "验证邮件刚刚发送，请稍后再试。",
    VERIFICATION_EMAIL_FAILED: "验证邮件发送失败，请稍后重试。",
    EMAIL_SERVICE_NOT_CONFIGURED: "云端验证邮件服务尚未配置，本地杯测不受影响。",
    INVALID_EMAIL: "邮箱格式无效。"
  };
  return messages[code] ?? (status >= 500 ? "服务器暂时不可用，请稍后重试。" : "账户操作失败，请检查输入后重试。");
}

export class CloudflareAuthClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sessionStore: AuthSessionStore,
    private readonly pendingStore?: PendingRegistrationStore
  ) {}

  async register(email: string, password: string): Promise<RegistrationResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const response = await this.request("/api/v1/auth/register", { email: normalizedEmail, password });
    const body = response.body as { ok?: boolean; status?: string; email?: string };
    if (!response.ok || body.ok !== true || body.status !== "verification_required" || !body.email) {
      this.throwAuthError(response.status, response.body);
    }
    const result = { status: "verification_required" as const, email: body.email! };
    await this.pendingStore?.set({ email: result.email, createdAt: new Date().toISOString() });
    return result;
  }

  async resendVerification(email: string): Promise<void> {
    const response = await this.request("/api/v1/auth/resend-verification", { email: email.trim().toLowerCase() });
    const body = response.body as { ok?: boolean };
    if (!response.ok || body.ok !== true) this.throwAuthError(response.status, response.body);
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const response = await this.request("/api/v1/auth/login", { email: normalizedEmail, password });
    const body = response.body as Partial<AuthSession> & { ok?: boolean };
    if (!response.ok || body.ok !== true || !body.userId || !body.email || !body.token || !body.expiresAt) {
      this.throwAuthError(response.status, response.body);
    }
    const session: AuthSession = {
      userId: body.userId!,
      email: body.email!,
      token: body.token!,
      expiresAt: body.expiresAt!
    };
    await this.sessionStore.set(session);
    const pending = await this.pendingStore?.get();
    if (pending?.email === normalizedEmail) await this.pendingStore?.clear();
    return session;
  }

  async logout(): Promise<void> {
    const session = await this.sessionStore.get();
    try {
      if (session) {
        await fetch(`${this.baseUrl}/api/v1/auth/logout`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.token}` }
        });
      }
    } finally {
      await this.sessionStore.clear();
    }
  }

  async current(): Promise<AuthSession | undefined> {
    const session = await this.sessionStore.get();
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.sessionStore.clear();
      return undefined;
    }
    return session;
  }

  pendingRegistration(): Promise<PendingRegistration | undefined> {
    return this.pendingStore?.get() ?? Promise.resolve(undefined);
  }

  private async request(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      let payload: Record<string, unknown> = {};
      try { payload = await response.json() as Record<string, unknown>; } catch { /* keep empty payload */ }
      return { ok: response.ok, status: response.status, body: payload };
    } catch (error) {
      throw new AuthClientError("NETWORK_ERROR", 0, error instanceof Error && error.name === "AbortError" ? "服务器连接超时，请稍后重试。" : "当前无法连接服务器，本地杯测仍可正常使用。");
    }
  }

  private throwAuthError(status: number, body: Record<string, unknown>): never {
    const code = typeof body.error === "string" ? body.error : "UNKNOWN";
    const retryAfterSeconds = Number(body.retryAfterSeconds);
    throw new AuthClientError(code, status, messageForAuthError(code, status), Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined);
  }
}
