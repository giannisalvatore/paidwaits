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

  async nextAd(sessionId: string): Promise<any | null> {
    const response = await this.request("GET", `/ad/next?session_id=${encodeURIComponent(sessionId)}`);
    if (response.status !== 200) return null;
    return response.json();
  }

  async impression(adRequestId: string): Promise<any | null> {
    const response = await this.request("POST", "/impression", { ad_request_id: adRequestId });
    return response.ok ? response.json() : null;
  }

  async click(adRequestId: string): Promise<void> {
    await this.request("POST", "/click", { ad_request_id: adRequestId });
  }
}
