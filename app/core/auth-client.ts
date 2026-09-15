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
  verificationEmail: "sent" | "retry_required";
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

interface FirebaseResponse {
  idToken?: string;
  email?: string;
  users?: Array<{ email?: string; emailVerified?: boolean }>;
  error?: { code?: number; message?: string };
}

export class AuthClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "AuthClientError";
  }
}

const DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 15_000;

function messageForAuthError(code: string, status: number): string {
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS_FORMAT: "邮箱格式无效，或密码未达到至少 10 位。",
    INVALID_CREDENTIALS: "邮箱或密码不正确。",
    EMAIL_NOT_VERIFIED: "账户尚未激活，请先完成 Firebase 验证邮件中的激活步骤。",
    ACCOUNT_EXISTS: "该邮箱已注册，请直接登录或使用“忘记密码”。",
    ACCOUNT_ALREADY_VERIFIED: "该账户已经完成邮箱验证，请直接登录。",
    VERIFICATION_EMAIL_FAILED: "账户已创建，但验证邮件本次未确认发送。请使用“重新发送验证邮件”，不要重复注册。",
    PASSWORD_RESET_FAILED: "密码重置邮件发送失败，请稍后重试。",
    FIREBASE_NOT_CONFIGURED: "Firebase Authentication 尚未配置，本地杯测不受影响。",
    FIREBASE_AUTH_DISABLED: "Firebase 邮箱/密码登录尚未启用。",
    AUTH_RATE_LIMITED: "认证请求过于频繁，请稍后重试。",
    USER_DISABLED: "该账户已被停用。",
    INVALID_EMAIL: "邮箱格式无效。",
    NETWORK_ERROR: "当前无法连接认证服务器，本地杯测仍可正常使用。",
    NETWORK_TIMEOUT: "服务器连接超时，请检查网络后重试；本地杯测仍可正常使用。"
  };
  return messages[code] ?? (status >= 500 ? "服务器暂时不可用，请稍后重试。" : "账户操作失败，请检查输入后重试。");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function mapFirebaseCode(raw: string | undefined): string {
  const code = (raw ?? "").split(" : ")[0].trim();
  const map: Record<string, string> = {
    EMAIL_EXISTS: "ACCOUNT_EXISTS",
    EMAIL_NOT_FOUND: "INVALID_CREDENTIALS",
    INVALID_PASSWORD: "INVALID_CREDENTIALS",
    INVALID_LOGIN_CREDENTIALS: "INVALID_CREDENTIALS",
    USER_DISABLED: "USER_DISABLED",
    OPERATION_NOT_ALLOWED: "FIREBASE_AUTH_DISABLED",
    TOO_MANY_ATTEMPTS_TRY_LATER: "AUTH_RATE_LIMITED",
    WEAK_PASSWORD: "INVALID_CREDENTIALS_FORMAT",
    INVALID_EMAIL: "INVALID_EMAIL",
    MISSING_PASSWORD: "INVALID_CREDENTIALS",
    INVALID_ID_TOKEN: "INVALID_CREDENTIALS",
    TOKEN_EXPIRED: "INVALID_CREDENTIALS"
  };
  return map[code] ?? "FIREBASE_AUTH_FAILED";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

export class CloudflareAuthClient {
  private registerInFlight?: { email: string; promise: Promise<RegistrationResult> };
  private loginInFlight?: { email: string; promise: Promise<AuthSession> };

  constructor(
    private readonly baseUrl: string,
    private readonly firebaseApiKey: string,
    private readonly sessionStore: AuthSessionStore,
    private readonly pendingStore?: PendingRegistrationStore,
    private readonly requestTimeoutMs = DEFAULT_AUTH_REQUEST_TIMEOUT_MS
  ) {}

  register(email: string, password: string): Promise<RegistrationResult> {
    const normalizedEmail = normalizeEmail(email);
    this.validateCredentials(normalizedEmail, password);
    if (this.registerInFlight?.email === normalizedEmail) return this.registerInFlight.promise;
    const promise = this.registerOnce(normalizedEmail, password).finally(() => {
      if (this.registerInFlight?.promise === promise) this.registerInFlight = undefined;
    });
    this.registerInFlight = { email: normalizedEmail, promise };
    return promise;
  }

  private async registerOnce(normalizedEmail: string, password: string): Promise<RegistrationResult> {
    let signup: FirebaseResponse;
    try {
      signup = await this.firebaseRequest("accounts:signUp", {
        email: normalizedEmail,
        password,
        returnSecureToken: true
      });
    } catch (error) {
      if (error instanceof AuthClientError && error.code === "ACCOUNT_EXISTS") {
        return this.recoverPendingRegistration(normalizedEmail, password, error);
      }
      throw error;
    }
    if (!signup.idToken) throw new AuthClientError("FIREBASE_AUTH_FAILED", 502, messageForAuthError("FIREBASE_AUTH_FAILED", 502));
    const registeredEmail = normalizeEmail(signup.email ?? normalizedEmail);
    await this.rememberPendingRegistration(registeredEmail);
    const verificationEmail = await this.trySendVerification(signup.idToken);
    return { status: "verification_required", email: registeredEmail, verificationEmail };
  }

  private async recoverPendingRegistration(
    normalizedEmail: string,
    password: string,
    accountExistsError: AuthClientError
  ): Promise<RegistrationResult> {
    try {
      const signin = await this.signInFirebase(normalizedEmail, password);
      const lookup = await this.firebaseRequest("accounts:lookup", { idToken: signin.idToken });
      if (lookup.users?.[0]?.emailVerified) {
        await this.pendingStore?.clear();
        throw new AuthClientError("ACCOUNT_ALREADY_VERIFIED", 409, messageForAuthError("ACCOUNT_ALREADY_VERIFIED", 409));
      }
      await this.rememberPendingRegistration(normalizedEmail);
      const verificationEmail = await this.trySendVerification(signin.idToken);
      return { status: "verification_required", email: normalizedEmail, verificationEmail };
    } catch (error) {
      if (error instanceof AuthClientError && error.code === "ACCOUNT_ALREADY_VERIFIED") throw error;
      if (error instanceof AuthClientError && error.code === "AUTH_RATE_LIMITED") {
        await this.rememberPendingRegistration(normalizedEmail);
        return { status: "verification_required", email: normalizedEmail, verificationEmail: "retry_required" };
      }
      throw accountExistsError;
    }
  }

  private async rememberPendingRegistration(email: string): Promise<void> {
    await this.pendingStore?.set({ email, createdAt: new Date().toISOString() });
  }

  private async trySendVerification(idToken: string): Promise<"sent" | "retry_required"> {
    try {
      await this.sendVerification(idToken);
      return "sent";
    } catch {
      // Firebase account creation is already committed. A mail-delivery/network
      // failure must not turn a successful signup into a duplicate-registration trap.
      return "retry_required";
    }
  }

  async resendVerification(email: string, password: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    this.validateCredentials(normalizedEmail, password);
    const signin = await this.signInFirebase(normalizedEmail, password);
    const lookup = await this.firebaseRequest("accounts:lookup", { idToken: signin.idToken });
    if (lookup.users?.[0]?.emailVerified) {
      await this.pendingStore?.clear();
      throw new AuthClientError("ACCOUNT_ALREADY_VERIFIED", 409, messageForAuthError("ACCOUNT_ALREADY_VERIFIED", 409));
    }
    await this.sendVerification(signin.idToken);
    await this.rememberPendingRegistration(normalizedEmail);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    if (!validEmail(normalizedEmail)) throw new AuthClientError("INVALID_EMAIL", 400, messageForAuthError("INVALID_EMAIL", 400));
    try {
      await this.firebaseRequest("accounts:sendOobCode", {
        requestType: "PASSWORD_RESET",
        email: normalizedEmail
      });
    } catch (error) {
      if (error instanceof AuthClientError && error.code === "INVALID_CREDENTIALS") return;
      throw error;
    }
  }

  login(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = normalizeEmail(email);
    this.validateCredentials(normalizedEmail, password);
    if (this.loginInFlight?.email === normalizedEmail) return this.loginInFlight.promise;
    const promise = this.loginOnce(normalizedEmail, password).finally(() => {
      if (this.loginInFlight?.promise === promise) this.loginInFlight = undefined;
    });
    this.loginInFlight = { email: normalizedEmail, promise };
    return promise;
  }

  private async loginOnce(normalizedEmail: string, password: string): Promise<AuthSession> {
    const signin = await this.signInFirebase(normalizedEmail, password);
    const response = await this.cloudRequest("/api/v1/auth/exchange", { idToken: signin.idToken });
    const body = response.body as Partial<AuthSession> & { ok?: boolean };
    if (!response.ok || body.ok !== true || !body.userId || !body.email || !body.token || !body.expiresAt) {
      this.throwCloudError(response.status, response.body);
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
        try {
          await this.fetchWithTimeout(`${this.baseUrl}/api/v1/auth/logout`, {
            method: "POST",
            headers: { authorization: `Bearer ${session.token}` }
          });
        } catch {
          // Logout must always clear the local session even when the network is unavailable.
        }
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

  private validateCredentials(email: string, password: string): void {
    if (!validEmail(email) || password.length < 10 || password.length > 256) {
      throw new AuthClientError("INVALID_CREDENTIALS_FORMAT", 400, messageForAuthError("INVALID_CREDENTIALS_FORMAT", 400));
    }
  }

  private async signInFirebase(email: string, password: string): Promise<{ idToken: string }> {
    const response = await this.firebaseRequest("accounts:signInWithPassword", {
      email,
      password,
      returnSecureToken: true
    });
    if (!response.idToken) throw new AuthClientError("FIREBASE_AUTH_FAILED", 502, messageForAuthError("FIREBASE_AUTH_FAILED", 502));
    return { idToken: response.idToken };
  }

  private async sendVerification(idToken: string): Promise<void> {
    try {
      await this.firebaseRequest("accounts:sendOobCode", {
        requestType: "VERIFY_EMAIL",
        idToken
      });
    } catch (error) {
      if (error instanceof AuthClientError && error.code === "FIREBASE_AUTH_FAILED") {
        throw new AuthClientError("VERIFICATION_EMAIL_FAILED", error.status, messageForAuthError("VERIFICATION_EMAIL_FAILED", error.status));
      }
      throw error;
    }
  }

  private async fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), Math.max(1, this.requestTimeoutMs));
    try {
      return await fetch(input, {
        ...init,
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  private async firebaseRequest(path: string, body: Record<string, unknown>): Promise<FirebaseResponse> {
    if (!this.firebaseApiKey) throw new AuthClientError("FIREBASE_NOT_CONFIGURED", 503, messageForAuthError("FIREBASE_NOT_CONFIGURED", 503));
    try {
      const response = await this.fetchWithTimeout(`https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(this.firebaseApiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(body)
      });
      let payload: FirebaseResponse = {};
      try { payload = await response.json() as FirebaseResponse; } catch { /* keep empty payload */ }
      if (!response.ok) {
        const mapped = mapFirebaseCode(payload.error?.message);
        throw new AuthClientError(mapped, response.status, messageForAuthError(mapped, response.status));
      }
      return payload;
    } catch (error) {
      if (error instanceof AuthClientError) throw error;
      if (isAbortError(error)) throw new AuthClientError("NETWORK_TIMEOUT", 0, messageForAuthError("NETWORK_TIMEOUT", 0));
      throw new AuthClientError("NETWORK_ERROR", 0, messageForAuthError("NETWORK_ERROR", 0));
    }
  }

  private async cloudRequest(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify(body)
      });
      let payload: Record<string, unknown> = {};
      try { payload = await response.json() as Record<string, unknown>; } catch { /* keep empty payload */ }
      return { ok: response.ok, status: response.status, body: payload };
    } catch (error) {
      if (isAbortError(error)) throw new AuthClientError("NETWORK_TIMEOUT", 0, messageForAuthError("NETWORK_TIMEOUT", 0));
      throw new AuthClientError("NETWORK_ERROR", 0, messageForAuthError("NETWORK_ERROR", 0));
    }
  }

  private throwCloudError(status: number, body: Record<string, unknown>): never {
    const code = typeof body.error === "string" ? body.error : "UNKNOWN";
    const retryAfterSeconds = Number(body.retryAfterSeconds);
    throw new AuthClientError(code, status, messageForAuthError(code, status), Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined);
  }
}
