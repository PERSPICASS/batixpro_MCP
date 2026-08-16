import { config } from "./config.js";
import { LaravelError } from "./errors.js";
import { logger } from "./logger.js";

/**
 * Client HTTP vers l'API Laravel v1. Transfère le token du client VERBATIM
 * (cf. C2 : la passerelle ne recalcule aucun contexte tenant) et propage un
 * request_id pour la corrélation des logs. Ne contient aucune règle métier.
 */
export class LaravelClient {
  constructor(
    private readonly token: string,
    private readonly requestId: string,
  ) {}

  async get(path: string, query: Record<string, unknown> = {}): Promise<unknown> {
    return this.request("GET", path, query);
  }

  /**
   * Écriture. Le corps part en JSON ; comme pour le GET, aucune règle métier n'est
   * appliquée ici : c'est Laravel qui valide, décide du statut du document et refuse
   * ce qui sort du périmètre du token.
   */
  async post(path: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", path, {}, payload);
  }

  /**
   * Modification. Comme le POST, la passerelle ne juge de rien : Laravel décide si le
   * document est encore modifiable (brouillon) et répond 409 sinon — un refus que le
   * modèle doit lire, pas contourner.
   */
  async put(path: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", path, {}, payload);
  }

  private async request(
    method: string,
    path: string,
    query: Record<string, unknown>,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = new URL(config.laravelApiUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.laravelTimeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "X-Request-Id": this.requestId,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startedAt;
      logger.info("laravel_call", {
        request_id: this.requestId,
        method,
        path,
        // shop_id et la liste des paramètres, pas leurs valeurs : le cloisonnement par
        // boutique est la garantie la plus facile à casser en silence (un paramètre
        // perdu en route élargit la recherche à tout le compte sans rien signaler),
        // alors que les termes de recherche peuvent contenir des noms de clients.
        shop_id: (query.shop_id ?? (payload?.shop_id as unknown)) ?? null,
        params: Object.keys(query).filter((k) => query[k] !== undefined && query[k] !== null),
        status: response.status,
        duration_ms: durationMs,
      });

      const bodyText = await response.text();
      const body = bodyText ? safeJson(bodyText) : null;

      if (!response.ok) {
        const code = extractCode(body);
        const message = extractMessage(body) ?? `Erreur ${response.status}`;
        throw new LaravelError(response.status, code, message, body);
      }

      return body;
    } catch (error) {
      if (error instanceof LaravelError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        logger.warn("laravel_timeout", { request_id: this.requestId, method, path });
        throw new LaravelError(504, "upstream_timeout", "L'API n'a pas répondu à temps.");
      }
      logger.error("laravel_network_error", {
        request_id: this.requestId,
        method,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new LaravelError(502, "upstream_unreachable", "API injoignable.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** L'enveloppe d'erreur commune est `{ error: { code, message } }` (cf. Passe 2). */
function extractCode(body: unknown): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
    return body.error.code;
  }
  return "";
}

function extractMessage(body: unknown): string | undefined {
  if (isRecord(body)) {
    if (isRecord(body.error) && typeof body.error.message === "string") return body.error.message;
    if (typeof body.message === "string") return body.message;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
