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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Détail des champs refusés par la validation Laravel (`{errors: {champ: [msg]}}`).
 *
 * Remonté au modèle pour les 422 UNIQUEMENT : depuis l'ouverture des tools d'écriture,
 * un « Données invalides. » nu laissait le modèle réessayer à l'aveugle. Ce que la
 * validation rejette est ce que le modèle vient lui-même d'envoyer — aucune donnée
 * d'un autre tenant ne transite par là.
 */
function validationFields(details: unknown): Record<string, string[]> | undefined {
  if (!isRecord(details) || !isRecord(details.errors)) return undefined;

  const fields: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(details.errors)) {
    if (Array.isArray(messages)) {
      fields[field] = messages.filter((m): m is string => typeof m === "string");
    }
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

/** Construit un résultat de tool en erreur, lisible par le modèle. */
export function toolError(error: unknown): CallToolResult {
  if (error instanceof LaravelError) {
    const fields = error.status === 422 ? validationFields(error.details) : undefined;

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: {
              code: error.code || codeForStatus(error.status),
              message: messageForStatus(error.status, error.message),
              ...(fields ? { fields } : {}),
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
