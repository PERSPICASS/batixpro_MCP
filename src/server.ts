import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { LaravelClient, isTokenValid } from "./laravel.js";
import { registerAllTools } from "./tools/index.js";
import type { Ctx } from "./tools/registry.js";

/**
 * Serveur MCP BATIXPRO — passerelle Streamable HTTP, en mode SANS SESSION.
 *
 * Chaque requête POST porte son Bearer token et reçoit un serveur MCP neuf, lié à CE
 * token (C2) puis jeté à la fin de la réponse. La passerelle ne garde rien en mémoire
 * entre deux requêtes : pas de session à détourner ni à accumuler, et un redémarrage
 * ne coupe personne. Le token est transféré verbatim à Laravel, qui reste seul juge
 * du tenant et des permissions.
 *
 * À l'initialisation, le token est vérifié auprès de Laravel : un token invalide est
 * refusé tout de suite (401) plutôt qu'au premier appel de tool.
 */

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

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    // Sans session, il n'y a ni flux GET à rouvrir ni session à fermer par DELETE.
    sendJson(
      res,
      405,
      { jsonrpc: "2.0", error: { code: -32000, message: "Méthode non autorisée." }, id: null },
      { Allow: "POST" },
    );
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    jsonRpcError(res, 401, -32001, "Token d'authentification manquant. Fournis un Bearer token.");
    return;
  }

  let parsed: unknown;
  try {
    const raw = await readBody(req);
    parsed = raw ? safeJson(raw) : undefined;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      res.setHeader("Connection", "close");
      jsonRpcError(res, 413, -32000, "Requête trop volumineuse.");
      return;
    }
    throw error;
  }

  const requestId = randomUUID();

  if (isInitializeRequest(parsed) && !(await isTokenValid(token, requestId))) {
    logger.warn("mcp_token_rejected", { request_id: requestId });
    jsonRpcError(res, 401, -32001, "Token invalide, expiré ou révoqué.");
    return;
  }

  const ctx: Ctx = { laravel: new LaravelClient(token, requestId), requestId };
  const server = new McpServer({ name: "batixpro-mcp", version: "0.1.0" });
  registerAllTools(server, ctx);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, parsed);
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
