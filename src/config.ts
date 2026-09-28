/**
 * Configuration du serveur MCP, lue depuis l'environnement.
 * Aucun secret ici : la seule « clé » est le token porté par chaque requête client.
 */

// Node 20+ : charge un fichier .env s'il existe, sans dépendance externe.
try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env — on se contente des variables d'environnement réelles.
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

export const config = {
  /** Base de l'API Laravel v1, ex. http://app:80/api/v1 */
  laravelApiUrl: required("LARAVEL_API_URL", "http://localhost:8000/api/v1").replace(/\/+$/, ""),
  port: Number(process.env.PORT ?? 3000),
  logLevel: (process.env.LOG_LEVEL ?? "info") as "debug" | "info" | "warn" | "error",
  laravelTimeoutMs: Number(process.env.LARAVEL_TIMEOUT_MS ?? 15000),
  /** Nombre maximal de sessions MCP ouvertes simultanément. */
  maxSessions: Number(process.env.MCP_MAX_SESSIONS ?? 500),
  /** Durée d'inactivité (ms) au-delà de laquelle une session est fermée. */
  sessionIdleMs: Number(process.env.MCP_SESSION_IDLE_MS ?? 30 * 60 * 1000),
  /** Taille maximale d'un corps de requête MCP (octets). */
  maxBodyBytes: Number(process.env.MCP_MAX_BODY_BYTES ?? 1_048_576),
  /**
   * Noms d'hôte acceptés dans l'en-tête Host (protection DNS rebinding), séparés par
   * des virgules, port ignoré. Vide = contrôle désactivé (développement local).
   */
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== ""),
} as const;
