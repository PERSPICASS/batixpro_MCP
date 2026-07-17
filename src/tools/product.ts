import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");

export function registerProductTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "product_search",
    title: "Rechercher des produits",
    description:
      "Recherche des produits du catalogue par nom ou référence (SKU). À utiliser pour "
      + "trouver un article et consulter son prix ou son stock avant une vente ou un devis. "
      + "Lecture seule, ne modifie rien.",
    inputSchema: {
      search: z.string().optional().describe("Terme recherché (nom ou SKU)."),
      is_active: z.boolean().optional().describe("Filtrer sur les produits actifs."),
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Taille de page (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/products", {
        search: args.search,
        is_active: args.is_active,
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });

  defineRead(server, ctx, {
    name: "product_get",
    title: "Détail d'un produit",
    description:
      "Récupère la fiche complète d'un produit par son identifiant (prix d'achat/vente, "
      + "stock, catégorie). Lecture seule.",
    inputSchema: {
      product_id: z.number().int().positive().describe("Identifiant du produit."),
    },
    run: (args, laravel) => laravel.get(`/products/${args.product_id as number}`),
  });
}
