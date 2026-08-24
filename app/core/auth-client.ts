export interface AuthSession {
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
}

export interface AuthSessionStore {
  get(): Promise<AuthSession | undefined>;
  set(session: AuthSession): Promise<void>;
  clear(): Promise<void>;
}

export class CloudflareAuthClient {
  constructor(
    private readonly baseUrl: string,
    private readonly sessionStore: AuthSessionStore
  ) {}

  async register(email: string, password: string): Promise<AuthSession> {
    return this.authenticate("register", email, password);
  }

  async login(email: string, password: string): Promise<AuthSession> {
    return this.authenticate("login", email, password);
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

  private async authenticate(kind: "register" | "login", email: string, password: string): Promise<AuthSession> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/${kind}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const body = await response.json() as Partial<AuthSession> & { ok?: boolean; error?: string };
    if (!response.ok || body.ok !== true || !body.userId || !body.email || !body.token || !body.expiresAt) {
      throw new Error(`AUTH_${response.status}:${body.error ?? "UNKNOWN"}`);
    }
    const session: AuthSession = {
      userId: body.userId,
      email: body.email,
      token: body.token,
      expiresAt: body.expiresAt
    };
    await this.sessionStore.set(session);
    return session;
  }
}
