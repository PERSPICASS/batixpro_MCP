import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");

export function registerCustomerTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "customer_search",
    title: "Rechercher des clients",
    description:
      "Recherche des clients par nom, téléphone ou e-mail. À utiliser pour retrouver un "
      + "client avant une vente, un devis ou la consultation de son historique. Lecture seule.",
    inputSchema: {
      search: z.string().optional().describe("Terme recherché (nom, téléphone ou e-mail)."),
      is_active: z.boolean().optional().describe("Filtrer sur les clients actifs."),
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Taille de page (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/customers", {
        search: args.search,
        is_active: args.is_active,
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });

  defineRead(server, ctx, {
    name: "customer_get",
    title: "Détail d'un client",
    description: "Récupère la fiche complète d'un client par son identifiant. Lecture seule.",
    inputSchema: {
      customer_id: z.number().int().positive().describe("Identifiant du client."),
    },
    run: (args, laravel) => laravel.get(`/customers/${args.customer_id as number}`),
  });
}
