import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");
const isoDate = z.string().describe("Date ISO 8601, ex. 2026-07-01.");

export function registerSalesTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "sales_list",
    title: "Lister les ventes",
    description:
      "Liste les ventes réalisées sur une période, avec filtres (client, statut, moyen de "
      + "paiement). Pour suivre l'activité commerciale. Lecture seule. Ne donne pas la marge "
      + "(réservé au domaine finance).",
    inputSchema: {
      from: isoDate.optional().describe("Début de période (ISO 8601)."),
      to: isoDate.optional().describe("Fin de période (ISO 8601)."),
      customer_id: z.number().int().positive().optional().describe("Filtrer sur un client."),
      status: z.string().optional().describe("Filtrer sur un statut de vente."),
      payment_method: z.string().optional().describe("Filtrer sur un moyen de paiement."),
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Taille de page (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/sales", {
        from: args.from,
        to: args.to,
        customer_id: args.customer_id,
        status: args.status,
        payment_method: args.payment_method,
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });

  defineRead(server, ctx, {
    name: "sales_get",
    title: "Détail d'une vente",
    description:
      "Récupère le détail d'une vente (lignes, produits, totaux, paiement) par son "
      + "identifiant. Lecture seule.",
    inputSchema: {
      sale_id: z.number().int().positive().describe("Identifiant de la vente."),
    },
    run: (args, laravel) => laravel.get(`/sales/${args.sale_id as number}`),
  });
}
