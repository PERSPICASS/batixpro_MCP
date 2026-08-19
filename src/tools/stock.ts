import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");

export function registerStockTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "stock_low_products",
    title: "Lister les produits en stock bas",
    description:
      "Liste exhaustive et paginée de l'ÉTAT ACTUEL des produits actifs dont le stock "
      + "est inférieur ou égal à leur seuil d'alerte. Contrairement à stock_alerts, ce "
      + "tool ne dépend pas des notifications lues ou non lues : meta.total donne le "
      + "nombre exact de produits concernés. Pour restituer toute la liste, parcours les "
      + "pages de 1 à meta.last_page sans demander à l'utilisateur de fournir un export. "
      + "Lecture seule.",
    inputSchema: {
      shop_id: shopId,
      page: z.number().int().min(1).optional().describe("Page à lire (défaut : 1)."),
      per_page: z.number().int().min(1).max(100).optional()
        .describe("Produits par page (défaut et maximum : 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/stock/low-products", {
        shop_id: args.shop_id,
        page: args.page,
        per_page: args.per_page,
      }),
  });

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
