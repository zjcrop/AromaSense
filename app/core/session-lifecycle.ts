import { TAXONOMY_VERSION } from "../../shared/protocol/aromasense-v1";

export type SessionStatus = "draft" | "active" | "completed" | "archived";

export interface CuppingSession {
  sessionId: string;
  title?: string;
  status: SessionStatus;
  taxonomyVersion: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateSessionInput {
  sessionId: string;
  title?: string;
  now: string;
  taxonomyVersion?: string;
}

function normalizeTitle(title: string | undefined): string | undefined {
  const normalized = title?.trim();
  return normalized ? normalized : undefined;
}

export function createSession(input: CreateSessionInput): CuppingSession {
  if (!input.sessionId.trim()) {
    throw new Error("SESSION_ID_REQUIRED");
  }

  return {
    sessionId: input.sessionId,
    title: normalizeTitle(input.title),
    status: "draft",
    taxonomyVersion: input.taxonomyVersion ?? TAXONOMY_VERSION,
    createdAt: input.now,
    updatedAt: input.now
  };
}

export function renameSession(session: CuppingSession, title: string | undefined, now: string): CuppingSession {
  if (session.status === "archived") {
    throw new Error("ARCHIVED_SESSION_IS_READ_ONLY");
  }

  return {
    ...session,
    title: normalizeTitle(title),
    updatedAt: now
  };
}

export function activateSession(session: CuppingSession, now: string): CuppingSession {
  if (session.status === "active") {
    return session;
  }
  if (session.status !== "draft") {
    throw new Error(`INVALID_SESSION_TRANSITION:${session.status}->active`);
  }

  return {
    ...session,
    status: "active",
    updatedAt: now
  };
}

export function completeSession(session: CuppingSession, now: string): CuppingSession {
  if (session.status === "completed") {
    return session;
  }
  if (session.status !== "active") {
    throw new Error(`INVALID_SESSION_TRANSITION:${session.status}->completed`);
  }

  return {
    ...session,
    status: "completed",
    completedAt: now,
    updatedAt: now
  };
}

export function archiveSession(session: CuppingSession, now: string): CuppingSession {
  if (session.status === "archived") {
    return session;
  }
  if (session.status !== "completed") {
    throw new Error(`INVALID_SESSION_TRANSITION:${session.status}->archived`);
  }

  return {
    ...session,
    status: "archived",
    updatedAt: now
  };
}

export function canEditSession(session: CuppingSession): boolean {
  return session.status === "draft" || session.status === "active";
}
