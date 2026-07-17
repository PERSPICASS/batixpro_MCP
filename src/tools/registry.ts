import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import type { LaravelClient } from "../laravel.js";
import { toolError, toolOk } from "../errors.js";
import { logger } from "../logger.js";

/** Contexte d'exécution d'un appel de tool, dérivé de la requête MCP. */
export interface Ctx {
  laravel: LaravelClient;
  requestId: string;
}

/**
 * Enregistre un tool de LECTURE (aucun effet de bord). Le handler `run` appelle
 * l'API Laravel et renvoie des données ; les erreurs sont mappées sans fuite.
 * Les écritures suivront un helper distinct intégrant la confirmation humaine (C3).
 */
export function defineRead<Shape extends ZodRawShape>(
  server: McpServer,
  ctx: Ctx,
  def: {
    name: string;
    title: string;
    description: string;
    inputSchema: Shape;
    run: (args: Record<string, unknown>, laravel: LaravelClient) => Promise<unknown>;
  },
): void {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    // Cast localisé : les génériques de registerTool infèrent un type d'args précis
    // depuis le schéma zod ; on manipule les args de façon générique (déjà validés).
    (async (args: Record<string, unknown>) => {
      try {
        const data = await def.run(args ?? {}, ctx.laravel);
        return toolOk(data);
      } catch (error) {
        logger.warn("tool_error", {
          request_id: ctx.requestId,
          tool: def.name,
          error: error instanceof Error ? error.message : String(error),
        });
        return toolError(error);
      }
    }) as Parameters<McpServer["registerTool"]>[2],
  );
}
