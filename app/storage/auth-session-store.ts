import type {
  AuthSession,
  AuthSessionStore,
  PendingRegistration,
  PendingRegistrationStore
} from "../core/auth-client";
import type { UserPreferencesRepository } from "./user-preferences-repository";

const AUTH_SESSION_KEY = "auth.session.v1";
const PENDING_REGISTRATION_KEY = "auth.pending-registration.v1";
const PENDING_REGISTRATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

export class LocalPendingRegistrationStore implements PendingRegistrationStore {
  constructor(
    private readonly preferences: UserPreferencesRepository,
    private readonly now: () => string
  ) {}

  async get(): Promise<PendingRegistration | undefined> {
    const pending = await this.preferences.get<PendingRegistration>(PENDING_REGISTRATION_KEY);
    if (!pending?.email || !pending.createdAt) return undefined;
    const age = Date.now() - Date.parse(pending.createdAt);
    if (!Number.isFinite(age) || age > PENDING_REGISTRATION_MAX_AGE_MS) {
      await this.clear();
      return undefined;
    }
    return pending;
  }

  set(value: PendingRegistration): Promise<void> {
    return this.preferences.set(PENDING_REGISTRATION_KEY, value, this.now());
  }

  clear(): Promise<void> {
    return this.preferences.remove(PENDING_REGISTRATION_KEY);
  }
}
