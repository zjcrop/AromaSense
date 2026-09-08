import type { SubmissionBundle } from "./submission-bundle";
import type { CalibrationMapping, CollectedResult, YingxiangResults } from "../../shared/yingxiang-results";
import type { YingxiangEventManifest, YingxiangEventPolicy } from "./yingxiang-event";

export interface YingxiangRemoteEvent {
  schemaVersion: "yingxiang-event/0.1";
  eventId: string;
  eventRevision: number;
  title: string;
  status: "draft" | "published" | "active" | "completed" | "cancelled";
  policy: YingxiangEventPolicy;
  manifest: YingxiangEventManifest;
  createdAt: string;
  updatedAt: string;
}
export interface YingxiangInviteResult {
  inviteId: string; eventId: string; eventRevision: number; token: string; expiresAt: string; maxUses: number | null;
  share: { deepLink: string; webUrl?: string };
}
export interface YingxiangInvitePreview {
  event: YingxiangRemoteEvent;
  invite: {
    inviteId: string;
    assignedName?: string;
    automaticName?: boolean;
    namePrefix?: string;
    expiresAt: string;
    remainingUses: number | null;
  };
}
export interface YingxiangJoinedPrincipal {
  schemaVersion: "yingxiang-principal/0.1";
  participantId: string; eventId: string; identityKind: "guest" | "account"; accountUserId?: string;
  displayName: string; accountDisplayNameHidden: true; status: "active"; boundAt: string;
}

export class YingxiangClientError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) {
    super(message || code); this.name = "YingxiangClientError";
  }
}

export class YingxiangClient {
  constructor(private readonly baseUrl: string, private readonly token: () => Promise<string | undefined>) {}

  async createEvent(input: { title: string; policy: YingxiangEventPolicy; manifest: YingxiangEventManifest; publish?: boolean }): Promise<YingxiangRemoteEvent> {
    const response = await this.request("/api/v1/yingxiang/events", { method: "POST", body: input, auth: true });
    return this.requireObject(response, "event") as unknown as YingxiangRemoteEvent;
  }
  async createInvite(eventId: string, input: { assignedName?: string; expiresAt?: string; maxUses?: number | null } = {}): Promise<YingxiangInviteResult> {
    return await this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/invites`, { method: "POST", body: input, auth: true }) as unknown as YingxiangInviteResult;
  }
  async previewInvite(token: string): Promise<YingxiangInvitePreview> {
    const response = await this.request(`/api/v1/yingxiang/invites/${encodeURIComponent(token)}`, { method: "GET" });
    return { event: this.requireObject(response, "event") as unknown as YingxiangRemoteEvent, invite: this.requireObject(response, "invite") as unknown as YingxiangInvitePreview["invite"] };
  }
  async joinInvite(token: string, input: { joinRequestId: string; displayName?: string; nameSource?: "custom" | "account" }): Promise<{ principal: YingxiangJoinedPrincipal; event: YingxiangRemoteEvent; replayed: boolean; accessToken?: string }> {
    const response = await this.request(`/api/v1/yingxiang/invites/${encodeURIComponent(token)}/join`, { method: "POST", body: input, optionalAuth: true });
    return {
      principal: this.requireObject(response, "principal") as unknown as YingxiangJoinedPrincipal,
      event: this.requireObject(response, "event") as unknown as YingxiangRemoteEvent,
      replayed: response.replayed === true,
      accessToken: typeof response.accessToken === "string" ? response.accessToken : undefined
    };
  }
  async setAccountDisplayName(displayName: string): Promise<string> {
    const response = await this.request("/api/v1/yingxiang/account-display-name", { method: "POST", body: { displayName }, auth: true });
    const value = response.displayName;
    if (typeof value !== "string" || !value.trim()) throw new YingxiangClientError("INVALID_SERVER_RESPONSE", 200);
    return value;
  }
  async createCalibrationGroup(eventId: string, input: { canonicalSampleId: string; eventSampleIds: readonly string[]; revealPolicy?: "after_event" | "organizer_only" }): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/calibration-groups`, { method: "POST", body: { ...input, eventSampleIds: [...input.eventSampleIds] }, auth: true });
  }
  async completeEvent(eventId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/complete`, { method: "POST", body: {}, auth: true });
  }
  async cancelEvent(eventId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/cancel`, { method: "POST", body: {}, auth: true });
  }
  async deleteEvent(eventId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/delete`, { method: "POST", body: {}, auth: true });
  }

  async listEvents(): Promise<YingxiangRemoteEvent[]> {
    const r = await this.request("/api/v1/yingxiang/events", { method: "GET", auth: true });
    if (!Array.isArray(r.events)) throw new YingxiangClientError("INVALID_SERVER_RESPONSE", 200);
    return r.events as YingxiangRemoteEvent[];
  }
  async dashboard(eventId: string): Promise<YingxiangDashboard> {
    return await this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/dashboard`, { method: "GET", auth: true }) as unknown as YingxiangDashboard;
  }
  async republish(eventId: string, input: { expectedRevision: number; title: string; policy: YingxiangEventPolicy; manifest: YingxiangEventManifest }): Promise<YingxiangRemoteEvent> {
    return this.requireObject(await this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/republish`, { method: "POST", body: input, auth: true }), "event") as unknown as YingxiangRemoteEvent;
  }
  releaseParticipant(eventId: string, participantId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}/release`, { method: "POST", body: {}, auth: true });
  }
  revokeInvite(eventId: string, inviteId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/events/${encodeURIComponent(eventId)}/invites/${encodeURIComponent(inviteId)}/revoke`, { method: "POST", body: {}, auth: true });
  }
  async participantStatus(participantId: string, accessToken: string): Promise<YingxiangParticipantStatus> {
    return await this.request(`/api/v1/yingxiang/participants/${encodeURIComponent(participantId)}/status`, { method: "GET", accessToken }) as unknown as YingxiangParticipantStatus;
  }
  sendProgress(participantId: string, accessToken: string, input: { sessionId: string; sequence: number; completedSamples: number; totalSamples: number }): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/participants/${encodeURIComponent(participantId)}/progress`, { method: "POST", body: input, accessToken });
  }
  async submit(participantId: string, accessToken: string, bundle: SubmissionBundle): Promise<{ revision: number; contentHash: string }> {
    const ack = await this.request(`/api/v1/yingxiang/participants/${encodeURIComponent(participantId)}/submissions`, { method: "POST", body: { bundle }, accessToken });
    if (ack.revision !== bundle.revision || ack.contentHash !== bundle.contentHash) throw new YingxiangClientError("YINGXIANG_ACK_MISMATCH",200);
    return { revision: bundle.revision, contentHash: bundle.contentHash };
  }
  leave(participantId: string, accessToken: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/yingxiang/participants/${encodeURIComponent(participantId)}/leave`, { method: "POST", body: {}, accessToken });
  }

  private async request(path: string, options: { method: "GET" | "POST"; body?: Record<string, unknown>; auth?: boolean; optionalAuth?: boolean; accessToken?: string }): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.body) headers["content-type"] = "application/json";
    if (options.auth || options.optionalAuth) {
      const token = await this.token();
      if (options.auth && !token) throw new YingxiangClientError("UNAUTHORIZED", 401, "迎香功能需要先登录对应账户。");
      if (token) headers.authorization = `Bearer ${token}`;
    }
    if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`;
    let response: Response;
    try { response = await fetch(new URL(path, this.baseUrl).href, { method: options.method, headers, body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(15000) }); }
    catch { throw new YingxiangClientError("NETWORK_ERROR", 0, "当前无法连接迎香服务。杯测本地记录仍可继续使用。"); }
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
    UNAUTHORIZED: "当前账户会话无效，请重新登录。",
    YINGXIANG_EVENT_PAYLOAD_INVALID: "活动信息、参与规则或样品列表不完整。",
    YINGXIANG_EVENT_NOT_FOUND: "未找到该迎香活动，或当前迎香账号没有管理权限。",
    YINGXIANG_EVENT_NOT_SHAREABLE: "当前活动尚未发布或已经结束，不能生成邀请。",
    YINGXIANG_EVENT_CONTRACT_CORRUPT: "活动数据契约损坏，已停止继续操作。",
    YINGXIANG_EVENT_ALREADY_COMPLETED: "活动已经结束，不能再取消；已完成结果会继续保留。",
    YINGXIANG_EVENT_DELETE_REQUIRES_CANCEL: "进行中的活动需要先取消，确认释放参与者后才能删除。",
    YINGXIANG_INVITE_NOT_FOUND: "邀请无效或不存在。",
    YINGXIANG_INVITE_REVOKED: "该邀请已被撤销。",
    YINGXIANG_INVITE_EXPIRED: "该邀请已经过期。",
    YINGXIANG_INVITE_EXHAUSTED: "该邀请的可用次数已经用完。",
    YINGXIANG_INVITE_STALE_REVISION: "活动已更新，这个旧邀请已失效。",
    YINGXIANG_EVENT_NOT_JOINABLE: "当前活动不能再加入。",
    YINGXIANG_JOIN_REQUEST_ID_INVALID: "加入请求标识无效，请重新打开邀请。",
    YINGXIANG_JOIN_IDEMPOTENCY_CONFLICT: "该加入请求与之前记录不一致，已停止重复写入。",
    YINGXIANG_PARTICIPANT_NAME_INVALID: "参与名称不符合主办方设定的规则。",
    YINGXIANG_PARTICIPANT_NAME_CONFLICT: "该参与名称在本次活动中已经被使用。",
    YINGXIANG_PARTICIPANT_NAME_POLICY_MISMATCH: "自动生成的参与名称超出当前命名规则，请缩短名称前缀。",
    YINGXIANG_ACCOUNT_REQUIRED_FOR_ACCOUNT_NAME: "选择个人账户名称参与时必须先登录香迹账户。",
    YINGXIANG_ACCOUNT_NAME_NOT_ALLOWED: "主办方不允许使用个人账户名称参与。",
    YINGXIANG_ACCOUNT_NAME_UNAVAILABLE: "当前香迹账户还没有设置可用于活动的显示名称。",
    YINGXIANG_ACCOUNT_NAME_POLICY_MISMATCH: "个人账户显示名称不符合本次活动的命名规则。",
    YINGXIANG_ACCOUNT_NAME_INVALID: "账户显示名称必须为 1–64 个字符。",
    YINGXIANG_ASSIGNED_NAME_REQUIRED: "旧版邀请缺少主办方分配名称，请重新生成邀请。",
    YINGXIANG_CALIBRATION_INVALID: "校准设置引用了无效或重复的活动样品。",
    YINGXIANG_CALIBRATION_SLOT_ASSIGNED: "这些样品编号已归入另一重复样品组。",
    YINGXIANG_EVENT_STRUCTURE_LOCKED: "已有参与者，样品和身份规则已锁定；仍可修改活动名称。",
    YINGXIANG_EVENT_REVISION_CONFLICT: "活动已被更新，请刷新后再修改。",
    YINGXIANG_PARTICIPANT_RELEASED: "活动已结束或参与身份已释放，本地记录已保留。",
    YINGXIANG_SESSION_CONFLICT: "此参与身份已绑定另一份杯测记录。",
    YINGXIANG_SUBMISSION_CONFLICT: "相同提交版本已有不同内容，已停止覆盖。",
    YINGXIANG_SUBMISSION_INVALID: "杯测结果格式或样品绑定不符合活动要求。",
    YINGXIANG_SUBMISSION_HASH_MISMATCH: "结果校验未通过，请重新提交本地记录。",
    YINGXIANG_FINAL_SCORES_REQUIRED: "所有样品确认最终评分后才能提交。",
    NETWORK_ERROR: "当前无法连接迎香服务。"
  };
  return messages[code] ?? "迎香操作失败，请检查活动状态和输入内容。";
}

export interface YingxiangParticipantStatus {
  event: YingxiangRemoteEvent;
  participant: { participantId: string; displayName: string; status: "active" | "released"; releasedAt?: string };
  ack: { revision: number; contentHash: string; receivedAt: string } | null;
}
export interface YingxiangDashboard {
  event: YingxiangRemoteEvent;
  participants: Array<{ participantId: string; displayName: string; status: string; joinedAt: string; releasedAt: string | null; completedSamples: number | null; totalSamples: number | null; progressAt: string | null; submissionRevision: number | null; receivedAt: string | null }>;
  invites: Array<{ inviteId: string; assignedName: string | null; expiresAt: string; maxUses: number | null; useCount: number; revokedAt: string | null; eventRevision: number }>;
  groups: CalibrationMapping[];
  results: YingxiangResults;
  submissions: CollectedResult[];
}
