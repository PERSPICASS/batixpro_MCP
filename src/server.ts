import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { LaravelClient } from "./laravel.js";
import { registerAllTools } from "./tools/index.js";
import type { Ctx } from "./tools/registry.js";

/**
 * Serveur MCP BATIXPRO — passerelle Streamable HTTP.
 *
 * Cycle de vie (cf. Passe 1 §1.1) : une session s'ouvre sur une requête `initialize`
 * portant un Bearer token ; les tools sont liés à CE token (C2) ; les requêtes
 * suivantes réutilisent la session via l'en-tête `mcp-session-id`. La passerelle ne
 * recalcule aucun contexte tenant — le token est transféré verbatim à Laravel.
 */

interface Session {
  transport: StreamableHTTPServerTransport;
}

const sessions = new Map<string, Session>();

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] ?? "").trim() || null : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function openSession(req: IncomingMessage, res: ServerResponse, parsedBody: unknown): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    jsonRpcError(res, 401, -32001, "Token d'authentification manquant. Fournis un Bearer token.");
    return;
  }

  const requestId = randomUUID();
  const ctx: Ctx = { laravel: new LaravelClient(token, requestId), requestId };

  const server = new McpServer({ name: "batixpro-mcp", version: "0.1.0" });
  registerAllTools(server, ctx);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport });
      logger.info("mcp_session_opened", { session_id: sessionId });
    },
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && sessions.delete(sid)) {
      logger.info("mcp_session_closed", { session_id: sid });
    }
    void server.close();
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers["mcp-session-id"];
  const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

  // Requêtes sur une session établie (POST suivant, GET stream, DELETE) : on route.
  if (existing) {
    await existing.transport.handleRequest(req, res);
    return;
  }

  if (req.method === "POST") {
    // Nouvelle session : la première requête doit être `initialize`.
    const raw = await readBody(req);
    const parsed = raw ? safeJson(raw) : undefined;

    if (isInitializeRequest(parsed)) {
      await openSession(req, res, parsed);
      return;
    }

    jsonRpcError(res, 400, -32000, "Session inconnue ou expirée. Ré-initialise la connexion.");
    return;
  }

  // GET/DELETE sans session valide.
  jsonRpcError(res, 400, -32000, "Session MCP requise.");
}

async function handleHealth(res: ServerResponse): Promise<void> {
  // Santé du process + capacité à joindre l'API Laravel (endpoint /up de Laravel).
  const base = config.laravelApiUrl.replace(/\/api\/v1$/, "");
  let laravelReachable = false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(base + "/up", { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);
    laravelReachable = response !== null;
  } catch {
    laravelReachable = false;
  }
  sendJson(res, 200, { status: "ok", sessions: sessions.size, laravel_reachable: laravelReachable });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    void handleHealth(res);
    return;
  }
  if (url.pathname === "/mcp") {
    void handleMcp(req, res).catch((error) => {
      logger.error("mcp_handler_error", { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Erreur interne du serveur MCP.");
    });
    return;
  }
  sendJson(res, 404, { error: { code: "not_found", message: "Route inconnue." } });
});

httpServer.listen(config.port, () => {
  logger.info("mcp_server_started", { port: config.port, laravel_api_url: config.laravelApiUrl, endpoint: "/mcp" });
});
