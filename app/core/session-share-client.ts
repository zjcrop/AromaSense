import type { CuppingRecordSnapshot } from "./session-record-service";

export interface ShareResult {
  shareToken: string;
  shareUrl: string;
  createdAt: string;
}

export class SessionShareClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokenProvider: () => Promise<string | undefined>
  ) {}

  async create(snapshot: CuppingRecordSnapshot): Promise<ShareResult> {
    const token = await this.tokenProvider();
    if (!token) throw new Error("LOGIN_REQUIRED_FOR_SHARE");
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/v1/share`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId: snapshot.session.sessionId, payload: snapshot })
    });
    const body = await response.json() as Partial<ShareResult> & { error?: string };
    if (!response.ok || !body.shareUrl || !body.shareToken || !body.createdAt) {
      throw new Error(body.error || `SHARE_CREATE_FAILED_${response.status}`);
    }
    return { shareToken: body.shareToken, shareUrl: body.shareUrl, createdAt: body.createdAt };
  }
}
