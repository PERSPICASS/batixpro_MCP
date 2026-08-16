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
 * Pour les écritures, voir defineWrite plus bas.
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

/**
 * Enregistre un tool d'ÉCRITURE.
 *
 * Deux garde-fous, et aucun des deux ne vit ici :
 *
 * 1. Le périmètre est tenu par Laravel. La passerelle ne décide de rien : le token
 *    doit porter l'ability `:write`, et les contrôleurs v1 forcent eux-mêmes le
 *    statut « brouillon » des documents créés. Un tool qui tenterait d'émettre une
 *    facture se ferait simplement ignorer sur ce champ.
 * 2. La relecture est humaine. Un brouillon n'engage rien : il ne déstocke pas, ne
 *    part pas au client, et se supprime dans l'application. C'est ce qui rend
 *    l'écriture acceptable sans dialogue de confirmation dans le transport MCP —
 *    le point de contrôle est le passage du brouillon au document émis, qui reste
 *    hors de portée de l'assistant.
 *
 * `destructiveHint: false` dit exactement cela au client MCP : ces tools ajoutent,
 * ils n'écrasent ni ne détruisent rien d'existant.
 */
export function defineWrite<Shape extends ZodRawShape>(
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (async (args: Record<string, unknown>) => {
      try {
        const data = await def.run(args ?? {}, ctx.laravel);

        // Tracé au niveau info, contrairement aux lectures : une écriture doit
        // laisser une trace côté passerelle même quand tout se passe bien.
        logger.info("tool_write", { request_id: ctx.requestId, tool: def.name });

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
