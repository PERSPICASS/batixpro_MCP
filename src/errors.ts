/**
 * Erreurs et leur traduction en résultats MCP exploitables par le modèle,
 * SANS fuite d'information (cf. Passe 1 §1.3 / §1.4).
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Erreur remontée par l'API Laravel, porteuse du statut HTTP et d'un code normalisé. */
export class LaravelError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "LaravelError";
  }
}

/** Signale au serveur qu'aucun token n'a été fourni : la session doit être refusée. */
export class UnauthorizedError extends Error {
  constructor(message = "Token d'authentification manquant.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Messages génériques par statut — volontairement peu bavards. */
function messageForStatus(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return "Session expirée ou non authentifiée. Reconnecte-toi.";
    case 403:
      return "Action non autorisée pour ce compte.";
    case 404:
      return "Ressource introuvable.";
    case 422:
      return "Données invalides.";
    case 429:
      return "Trop d'appels : réessaie dans un instant.";
    default:
      return fallback;
  }
}

function codeForStatus(status: number): string {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    default:
      return "upstream_error";
  }
}

/** Construit un résultat de tool en erreur, lisible par le modèle. */
export function toolError(error: unknown): CallToolResult {
  if (error instanceof LaravelError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: error.code || codeForStatus(error.status),
              message: messageForStatus(error.status, error.message),
            },
          }),
        },
      ],
    };
  }

  // Erreur inattendue (réseau, timeout…) : ne pas divulguer la stack au modèle.
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: { code: "internal_error", message: "Le service est momentanément indisponible." },
        }),
      },
    ],
  };
}

/** Construit un résultat de tool en succès à partir de données JSON. */
export function toolOk(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}
