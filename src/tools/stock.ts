import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");

export function registerStockTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "stock_movements",
    title: "Lister les mouvements de stock",
    description:
      "Liste les mouvements de stock (entrées, sorties, ajustements) d'un produit ou d'une "
      + "boutique, pour comprendre l'évolution d'un stock. Lecture seule.",
    inputSchema: {
      product_id: z.number().int().positive().optional().describe("Filtrer sur un produit."),
      type: z.enum(["in", "out", "adjustment"]).optional().describe("Type de mouvement."),
      from: z.string().optional().describe("Début de période (ISO 8601)."),
      to: z.string().optional().describe("Fin de période (ISO 8601)."),
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Taille de page (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/stock-movements", {
        product_id: args.product_id,
        type: args.type,
        from: args.from,
        to: args.to,
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });
}
