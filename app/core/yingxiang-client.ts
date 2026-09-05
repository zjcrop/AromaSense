import type { YingxiangEventPolicy } from "./yingxiang-event";

export interface YingxiangRemoteEvent {
  schemaVersion: "yingxiang-event/0.1";
  eventId: string;
  eventRevision: number;
  title: string;
  status: "draft" | "published" | "active" | "completed" | "cancelled";
  policy: YingxiangEventPolicy;
  createdAt: string;
  updatedAt: string;
}

export interface YingxiangInviteResult {
  inviteId: string;
  eventId: string;
  eventRevision: number;
  token: string;
  expiresAt: string;
  maxUses: number | null;
  share: { deepLink: string; webUrl?: string };
}

export interface YingxiangInvitePreview {
  event: YingxiangRemoteEvent;
  invite: { inviteId: string; assignedName?: string; expiresAt: string; remainingUses: number | null };
}

export interface YingxiangJoinedPrincipal {
  schemaVersion: "yingxiang-principal/0.1";
  participantId: string;
  eventId: string;
  identityKind: "guest" | "account";
  accountUserId?: string;
  displayName: string;
  accountDisplayNameHidden: true;
  status: "active";
  boundAt: string;
}

export class YingxiangClientError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) {
    super(message || code);
    this.name = "YingxiangClientError";
  }
}

export class YingxiangClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => Promise<string | undefined>
  ) {}

  async createEvent(input: { title: string; policy: YingxiangEventPolicy; publish?: boolean }): Promise<YingxiangRemoteEvent> {
    const response = await this.request("/api/v1/yingxiang/events", { method: "POST", body: input, auth: true });
    return this.requireObject(response, "event") as unknown as YingxiangRemoteEvent;
  }

  async createInvite(eventId: string, input: { assignedName?: string; expiresAt?: string; maxUses?: number | null } = {}): Promise<YingxiangInviteResult> {
    return await this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/invites`, {
      method: "POST", body: input, auth: true
    }) as unknown as YingxiangInviteResult;
  }

  async previewInvite(token: string): Promise<YingxiangInvitePreview> {
    const response = await this.request(`/api/v1/yingxiang/invites/${encodeURIComponent(token)}`, { method: "GET" });
    return {
      event: this.requireObject(response, "event") as unknown as YingxiangRemoteEvent,
      invite: this.requireObject(response, "invite") as unknown as YingxiangInvitePreview["invite"]
    };
  }

  async joinInvite(token: string, input: { displayName?: string; nameSource?: "custom" | "account" }): Promise<{ principal: YingxiangJoinedPrincipal; event: YingxiangRemoteEvent }> {
    const response = await this.request(`/api/v1/yingxiang/invites/${encodeURIComponent(token)}/join`, {
      method: "POST", body: input, optionalAuth: true
    });
    return {
      principal: this.requireObject(response, "principal") as unknown as YingxiangJoinedPrincipal,
      event: this.requireObject(response, "event") as unknown as YingxiangRemoteEvent
    };
  }

  async setAccountDisplayName(displayName: string): Promise<string> {
    const response = await this.request("/api/v1/yingxiang/account-display-name", {
      method: "POST", body: { displayName }, auth: true
    });
    const value = response.displayName;
    if (typeof value !== "string" || !value.trim()) throw new YingxiangClientError("INVALID_SERVER_RESPONSE", 200);
    return value;
  }

  async createCalibrationGroup(eventId: string, input: { canonicalSampleId: string; eventSampleIds: readonly string[]; revealPolicy?: "after_event" | "organizer_only" }): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/calibration-groups`, {
      method: "POST", body: { ...input, eventSampleIds: [...input.eventSampleIds] }, auth: true
    });
  }

  async completeEvent(eventId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/complete`, { method: "POST", body: {}, auth: true });
  }

  private async request(path: string, options: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    auth?: boolean;
    optionalAuth?: boolean;
  }): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body) headers["content-type"] = "application/json";
    if (options.auth || options.optionalAuth) {
      const token = await this.token();
      if (options.auth && !token) throw new YingxiangClientError("UNAUTHORIZED", 401, "迎香发布功能需要先登录账户。");
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl).href, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch {
      throw new YingxiangClientError("NETWORK_ERROR", 0, "当前无法连接迎香服务。杯测本地记录仍可继续使用。");
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new YingxiangClientError("INVALID_SERVER_RESPONSE", response.status, "迎香服务返回了无法解析的数据。"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new YingxiangClientError("INVALID_SERVER_RESPONSE", response.status);
    const value = payload as Record<string, unknown>;
    if (!response.ok || value.ok === false) {
      const code = typeof value.error === "string" ? value.error : `HTTP_${response.status}`;
      throw new YingxiangClientError(code, response.status, messageForYingxiangError(code));
    }
    return value;
  }

  private requireObject(value: Record<string, unknown>, key: string): Record<string, unknown> {
    const candidate = value[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new YingxiangClientError("INVALID_SERVER_RESPONSE", 200);
    return candidate as Record<string, unknown>;
  }
}

function messageForYingxiangError(code: string): string {
  const messages: Record<string, string> = {
    UNAUTHORIZED: "迎香发布功能需要先登录账户。",
    YINGXIANG_EVENT_NOT_FOUND: "未找到该迎香活动，或当前账户没有管理权限。",
    YINGXIANG_EVENT_NOT_SHAREABLE: "当前活动尚未发布或已经结束，不能生成邀请。",
    YINGXIANG_INVITE_NOT_FOUND: "邀请无效或不存在。",
    YINGXIANG_INVITE_REVOKED: "该邀请已被撤销。",
    YINGXIANG_INVITE_EXPIRED: "该邀请已经过期。",
    YINGXIANG_INVITE_EXHAUSTED: "该邀请的可用次数已经用完。",
    YINGXIANG_INVITE_STALE_REVISION: "活动已更新，这个旧邀请已失效。",
    YINGXIANG_EVENT_NOT_JOINABLE: "当前活动不能再加入。",
    YINGXIANG_PARTICIPANT_NAME_INVALID: "参与名称不符合主办方设定的规则。",
    YINGXIANG_PARTICIPANT_NAME_CONFLICT: "该参与名称在本次活动中已经被使用。",
    YINGXIANG_ACCOUNT_REQUIRED_FOR_ACCOUNT_NAME: "选择个人账户名称参与时必须先登录。",
    YINGXIANG_ACCOUNT_NAME_NOT_ALLOWED: "主办方不允许使用个人账户名称参与。",
    YINGXIANG_ACCOUNT_NAME_UNAVAILABLE: "当前账户还没有设置可用于迎香的显示名称。",
    YINGXIANG_ACCOUNT_NAME_POLICY_MISMATCH: "个人账户显示名称不符合本次活动的命名规则。",
    YINGXIANG_ACCOUNT_NAME_INVALID: "账户显示名称必须为 1–64 个字符。",
    YINGXIANG_ASSIGNED_NAME_REQUIRED: "该活动要求主办方为邀请指定参与名称。",
    NETWORK_ERROR: "当前无法连接迎香服务。"
  };
  return messages[code] ?? "迎香操作失败，请检查活动状态和输入内容。";
}
