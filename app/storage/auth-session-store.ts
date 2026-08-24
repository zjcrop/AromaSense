import type { AuthSession, AuthSessionStore } from "../core/auth-client";
import type { UserPreferencesRepository } from "./user-preferences-repository";

const AUTH_SESSION_KEY = "auth.session.v1";

export class LocalAuthSessionStore implements AuthSessionStore {
  constructor(
    private readonly preferences: UserPreferencesRepository,
    private readonly now: () => string
  ) {}

  get(): Promise<AuthSession | undefined> {
    return this.preferences.get<AuthSession>(AUTH_SESSION_KEY);
  }

  set(session: AuthSession): Promise<void> {
    return this.preferences.set(AUTH_SESSION_KEY, session, this.now());
  }

  clear(): Promise<void> {
    return this.preferences.remove(AUTH_SESSION_KEY);
  }
}
