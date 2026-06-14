import * as vscode from "vscode";

// Client del backend. L'auth e a cookie di sessione (koa-session):
// i Set-Cookie ricevuti al login vengono persistiti nel globalState.
export class Api {
  private cookies: string;

  constructor(private context: vscode.ExtensionContext) {
    this.cookies = context.globalState.get("waitingads.cookies", "");
  }

  get baseUrl(): string {
    return vscode.workspace.getConfiguration("waitingads").get("apiUrl", "http://localhost:4100");
  }

  get isConnected(): boolean {
    return this.cookies.length > 0;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const response = await fetch(this.baseUrl + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookies ? { cookie: this.cookies } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      this.cookies = setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
      await this.context.globalState.update("waitingads.cookies", this.cookies);
    }
    return response;
  }

  async devLogin(email: string): Promise<boolean> {
    const response = await this.request("POST", "/auth/dev", { email });
    return response.ok;
  }

  async me(): Promise<any | null> {
    const response = await this.request("GET", "/me");
    return response.ok ? response.json() : null;
  }

  async startSession(deviceId: string): Promise<string | null> {
    const response = await this.request("POST", "/session/start", { device_id: deviceId });
    if (!response.ok) return null;
    const data = (await response.json()) as { session_id: string };
    return data.session_id;
  }

  async heartbeat(sessionId: string): Promise<{ earning: boolean } | null> {
    const response = await this.request("POST", "/session/heartbeat", { session_id: sessionId });
    return response.ok ? ((await response.json()) as { earning: boolean }) : null;
  }

  async thinkingStart(sessionId: string): Promise<boolean> {
    const response = await this.request("POST", "/me/thinking-start", { session_id: sessionId });
    return response.ok;
  }

  async thinkingStop(sessionId: string): Promise<boolean> {
    const response = await this.request("POST", "/me/thinking-stop", { session_id: sessionId });
    return response.ok;
  }

  async nextAd(sessionId: string): Promise<any | null> {
    const response = await this.request("GET", `/ad/next?session_id=${encodeURIComponent(sessionId)}`);
    if (response.status !== 200) return null;
    return response.json();
  }

  async impression(adRequestId: string, eventUuid?: string): Promise<any | null> {
    const body: Record<string, unknown> = { ad_request_id: adRequestId };
    if (eventUuid) body.event_uuid = eventUuid;
    const response = await this.request("POST", "/impression", body);
    return response.ok ? response.json() : null;
  }

  async click(adRequestId: string, eventUuid?: string): Promise<void> {
    const body: Record<string, unknown> = { ad_request_id: adRequestId };
    if (eventUuid) body.event_uuid = eventUuid;
    await this.request("POST", "/click", body);
  }

  // Killswitch globale: l'estensione lo poll-a. Ritorna null su errore/offline
  // (il chiamante adotta la postura "offline" → freeze, non ripristina).
  async killswitch(): Promise<{ killed: boolean; reason: string } | null> {
    try {
      const response = await this.request("GET", "/killswitch");
      if (!response.ok) return null;
      return (await response.json()) as { killed: boolean; reason: string };
    } catch {
      return null;
    }
  }

  // Telemetria di salute (best-effort, mai blocca nulla).
  async telemetry(event: string, ccVersion?: string, detail?: string): Promise<void> {
    try {
      await this.request("POST", "/telemetry", { event, cc_version: ccVersion, detail });
    } catch {
      /* best-effort */
    }
  }
}
