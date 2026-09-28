import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { LaravelClient, isTokenValid } from "./laravel.js";
import { registerAllTools } from "./tools/index.js";
import type { Ctx } from "./tools/registry.js";

/**
 * Serveur MCP BATIXPRO — passerelle Streamable HTTP.
 *
 * Cycle de vie (cf. Passe 1 §1.1) : une session s'ouvre sur une requête `initialize`
 * portant un Bearer token ; les tools sont liés à CE token (C2) ; les requêtes
 * suivantes réutilisent la session via l'en-tête `mcp-session-id`. La passerelle ne
 * recalcule aucun contexte tenant — le token est transféré verbatim à Laravel.
 *
 * Les sessions restent nécessaires : le client de l'assistant IA du SaaS
 * (App\Services\Mcp\McpClient) exige un mcp-session-id. Elles sont donc bornées :
 * - le token est vérifié auprès de Laravel avant l'ouverture (401 sinon) ;
 * - chaque requête sur une session doit porter le MÊME token que son ouverture ;
 * - une session inactive expire (MCP_SESSION_IDLE_MS) et leur nombre est plafonné
 *   (MCP_MAX_SESSIONS) : McpClient n'envoie jamais de DELETE, sans cette borne les
 *   sessions s'accumuleraient jusqu'à épuiser la mémoire.
 */

interface Session {
  transport: StreamableHTTPServerTransport;
  tokenHash: Buffer;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

class PayloadTooLargeError extends Error {}

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] ?? "").trim() || null : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function jsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

/** Lit le corps en refusant tout ce qui dépasse `config.maxBodyBytes`. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
        req.pause();
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Protection DNS rebinding : l'en-tête Host doit viser un nom attendu. Le port est
 * ignoré pour qu'un même réglage couvre l'accès public (mcp.batixpro.com) et l'accès
 * interne entre conteneurs (batix-mcp:3000).
 */
function hostAllowed(req: IncomingMessage): boolean {
  if (config.allowedHosts.length === 0) return true;
  const host = (req.headers.host ?? "").toLowerCase();
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return config.allowedHosts.includes(hostname ?? "");
}

async function openSession(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  parsedBody: unknown,
): Promise<void> {
  if (sessions.size >= config.maxSessions) {
    logger.warn("mcp_session_limit_reached", { sessions: sessions.size });
    jsonRpcError(res, 503, -32000, "Serveur saturé, réessaie dans un instant.");
    return;
  }

  const requestId = randomUUID();
  if (!(await isTokenValid(token, requestId))) {
    logger.warn("mcp_token_rejected", { request_id: requestId });
    jsonRpcError(res, 401, -32001, "Token invalide, expiré ou révoqué.");
    return;
  }

  const ctx: Ctx = { laravel: new LaravelClient(token, requestId), requestId };
  const server = new McpServer({ name: "batixpro-mcp", version: "0.1.0" });
  registerAllTools(server, ctx);

  const tokenHash = hashToken(token);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { transport, tokenHash, lastSeen: Date.now() });
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
  const token = extractBearer(req);
  if (!token) {
    jsonRpcError(res, 401, -32001, "Token d'authentification manquant. Fournis un Bearer token.");
    return;
  }

  const sessionId = req.headers["mcp-session-id"];
  const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;

  // Requêtes sur une session établie (POST suivant, GET stream, DELETE) : même token
  // exigé qu'à l'ouverture, sinon un mcp-session-id intercepté suffirait à agir.
  if (existing) {
    if (!timingSafeEqual(existing.tokenHash, hashToken(token))) {
      logger.warn("mcp_session_token_mismatch", { session_id: sessionId });
      jsonRpcError(res, 403, -32001, "Ce token ne correspond pas à la session.");
      return;
    }
    existing.lastSeen = Date.now();

    if (req.method === "POST") {
      const parsed = await readJsonBody(req, res);
      if (parsed === BODY_REJECTED) return;
      await existing.transport.handleRequest(req, res, parsed);
      return;
    }
    await existing.transport.handleRequest(req, res);
    return;
  }

  if (req.method === "POST") {
    // Nouvelle session : la première requête doit être `initialize`.
    const parsed = await readJsonBody(req, res);
    if (parsed === BODY_REJECTED) return;

    if (isInitializeRequest(parsed)) {
      await openSession(req, res, token, parsed);
      return;
    }

    jsonRpcError(res, 400, -32000, "Session inconnue ou expirée. Ré-initialise la connexion.");
    return;
  }

  // GET/DELETE sans session valide.
  jsonRpcError(res, 400, -32000, "Session MCP requise.");
}

const BODY_REJECTED = Symbol("body_rejected");

/** Lit et décode le corps ; répond 413 et renvoie BODY_REJECTED s'il est trop gros. */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  try {
    const raw = await readBody(req);
    return raw ? safeJson(raw) : undefined;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      res.setHeader("Connection", "close");
      jsonRpcError(res, 413, -32000, "Requête trop volumineuse.");
      return BODY_REJECTED;
    }
    throw error;
  }
}

/** Ferme les sessions inactives depuis plus de MCP_SESSION_IDLE_MS. */
const sweeper = setInterval(() => {
  const limit = Date.now() - config.sessionIdleMs;
  for (const [sid, session] of sessions) {
    if (session.lastSeen < limit) {
      logger.info("mcp_session_expired", { session_id: sid });
      void session.transport.close();
      sessions.delete(sid);
    }
  }
}, 60_000);
sweeper.unref();

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
  sendJson(res, 200, { status: "ok", laravel_reachable: laravelReachable });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/health") {
    void handleHealth(res);
    return;
  }
  if (url.pathname === "/mcp") {
    if (!hostAllowed(req)) {
      logger.warn("mcp_host_rejected", { host: req.headers.host ?? null });
      jsonRpcError(res, 403, -32000, "Hôte non autorisé.");
      return;
    }
    void handleMcp(req, res).catch((error) => {
      logger.error("mcp_handler_error", { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Erreur interne du serveur MCP.");
    });
    return;
  }
  sendJson(res, 404, { error: { code: "not_found", message: "Route inconnue." } });
});

httpServer.listen(config.port, () => {
  logger.info("mcp_server_started", {
    port: config.port,
    laravel_api_url: config.laravelApiUrl,
    endpoint: "/mcp",
    host_check: config.allowedHosts.length > 0 ? config.allowedHosts : "disabled",
  });
});

/**
 * Arrêt propre : sur SIGTERM (docker stop, déploiement), on cesse d'accepter de
 * nouvelles connexions et on laisse finir les requêtes en cours, avec un plafond de
 * 10 s pour ne pas bloquer la bascule.
 */
function shutdown(signal: string): void {
  logger.info("mcp_server_stopping", { signal });
  httpServer.close(() => process.exit(0));
  httpServer.closeIdleConnections();
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
