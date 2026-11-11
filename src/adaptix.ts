#!/usr/bin/env node

// AdaptixC2 v1.2 REST client — read-only surface.
//
// Every call is an authenticated HTTP(S) request to the teamserver's REST
// control plane (Gin + JWT). Nothing here drives the Qt GUI, opens the
// WebSocket sync channel, or shells out to a console. The read-only tools use
// the REST endpoints, which is enough for recon and completed-task output
// (GET /agent/task/list).

import http from "node:http";
import https from "node:https";
import fs from "node:fs";

export interface AdaptixConfig {
  endpoint: string;   // teamserver base URL incl. the profile path, e.g. https://127.0.0.1:4321/endpoint
  username: string;
  password: string;
  version: string;    // target server version; sent as the login `version` claim (pins v1.2)
  ca?: string;        // PEM bundle to trust (the teamserver's self-signed server.rsa.crt)
  insecureTls: boolean; // debug only: accept any certificate
}

export class AdaptixApiError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "AdaptixApiError";
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  message?: string;
}

export class AdaptixClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private readonly isHttps: boolean;
  private readonly agent: http.Agent;

  constructor(private cfg: AdaptixConfig) {
    this.isHttps = new URL(cfg.endpoint).protocol === "https:";
    if (this.isHttps) {
      const opts: https.AgentOptions = {};
      if (cfg.ca) opts.ca = fs.readFileSync(cfg.ca);
      if (cfg.insecureTls) opts.rejectUnauthorized = false;
      this.agent = new https.Agent(opts);
    } else {
      this.agent = new http.Agent();
    }
  }

  get base(): string {
    return this.cfg.endpoint.replace(/\/+$/, "");
  }

  private request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (auth) {
        if (!this.accessToken) {
          return reject(new AdaptixApiError("not authenticated; call login() first"));
        }
        headers.Authorization = `Bearer ${this.accessToken}`;
      }
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      if (payload) headers["Content-Length"] = String(payload.length);

      const url = new URL(this.base + path);
      const options = { method, headers, agent: this.agent } as http.RequestOptions;
      const mod = (this.isHttps ? (https as unknown as typeof http) : http) as typeof http;
      const req = mod.request(url, options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = text;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              /* not JSON — e.g. the teamserver's default error page */
            }
          }
          if (res.statusCode !== undefined && res.statusCode >= 400) {
            const msg =
              typeof parsed === "object" && parsed !== null && "message" in parsed
                ? String((parsed as { message?: unknown }).message)
                : `HTTP ${res.statusCode}`;
            return reject(new AdaptixApiError(msg, res.statusCode, parsed));
          }
          resolve(parsed as T);
        });
      });
      req.on("error", (err) => reject(new AdaptixApiError(err.message)));
      if (payload) req.write(payload);
      req.end();
    });
  }

  async login(): Promise<void> {
    const res = await this.request<TokenResponse>(
      "POST",
      "/login",
      { username: this.cfg.username, password: this.cfg.password, version: this.cfg.version },
      false,
    );
    if (!res.access_token) {
      throw new AdaptixApiError(`login failed: ${res.message ?? "no access_token in response"}`);
    }
    this.accessToken = res.access_token;
    this.refreshToken = res.refresh_token ?? null; // reserved for the refresh flow
  }

  agentList(): Promise<unknown> {
    return this.request("GET", "/agent/list");
  }

  listenerList(): Promise<unknown> {
    return this.request("GET", "/listener/list");
  }

  taskList(agentId: string, limit: number, offset: number): Promise<unknown> {
    return this.request(
      "GET",
      `/agent/task/list?agent_id=${encodeURIComponent(agentId)}&limit=${limit}&offset=${offset}`,
    );
  }

  targetsList(): Promise<unknown> {
    return this.request("GET", "/targets/list");
  }

  credsList(): Promise<unknown> {
    return this.request("GET", "/creds/list");
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdaptixConfig {
  const endpoint = env.ADAPTIX_ENDPOINT?.trim();
  if (!endpoint) {
    throw new Error("ADAPTIX_ENDPOINT is required (e.g. https://127.0.0.1:4321/endpoint)");
  }
  const password = env.ADAPTIX_PASSWORD ?? "";
  if (!password) {
    throw new Error("ADAPTIX_PASSWORD is required");
  }
  return {
    endpoint,
    username: env.ADAPTIX_USERNAME?.trim() || "operator",
    password,
    version: env.ADAPTIX_VERSION?.trim() || "v1.2",
    ca: env.ADAPTIX_CA?.trim() || undefined,
    insecureTls: env.ADAPTIX_TLS_INSECURE === "1",
  };
}
