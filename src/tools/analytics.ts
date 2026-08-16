import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");

const days = z.number().int().min(1).max(365).optional()
  .describe("Fenêtre d'analyse en jours (défaut : 30).");

export function registerAnalyticsTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "sales_summary",
    title: "Synthèse des ventes (KPIs)",
    description:
      "Renvoie les indicateurs de ventes sur une période : chiffre d'affaires total, "
      + "nombre de ventes et panier moyen. À utiliser pour répondre aux questions de "
      + "performance commerciale. Lecture seule.",
    inputSchema: {
      days,
      shop_id: shopId,
    },
    run: (args, laravel) =>
      laravel.get("/analytics/sales-summary", {
        days: args.days,
        shop_id: args.shop_id,
      }),
  });

  defineRead(server, ctx, {
    name: "top_products",
    title: "Meilleurs produits par chiffre d'affaires",
    description:
      "Renvoie les produits ayant généré le plus de chiffre d'affaires sur une période. "
      + "À utiliser pour identifier les best-sellers. Lecture seule.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).optional().describe("Nombre de produits (défaut : 10)."),
      days,
      shop_id: shopId,
    },
    run: (args, laravel) =>
      laravel.get("/analytics/top-products", {
        limit: args.limit,
        days: args.days,
        shop_id: args.shop_id,
      }),
  });

  defineRead(server, ctx, {
    name: "stock_alerts",
    title: "Alertes actives",
    description:
      "Liste les alertes non lues d'une boutique (ruptures de stock, crédits en retard, "
      + "précommandes prêtes…). À utiliser pour signaler ce qui requiert une action. Lecture seule.",
    inputSchema: {
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Nombre d'alertes (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/alerts", {
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });
}
