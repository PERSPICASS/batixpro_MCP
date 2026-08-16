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
      "Recherche des produits du catalogue par nom, MARQUE ou référence (SKU). À utiliser "
      + "pour trouver un article et consulter son prix ou son stock avant une vente ou un "
      + "devis. Les mots sont cherchés séparément et la casse comme les accents sont "
      + "ignorés : « pistolet 600w tolsen » retrouve « Pistolet à peinture électrique 600W » "
      + "de marque Tolsen. Donne des mots-clés distinctifs, jamais une phrase entière — "
      + "« de », « chez » ou « avec » ne correspondent à rien et feraient échouer la "
      + "recherche. Lecture seule, ne modifie rien.",
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
      shop_id: shopId,
    },
    // shop_id doit être DÉCLARÉ pour être transmis : zod retire tout argument absent du
    // schéma, si bien que le cloisonnement imposé par l'application se perdait ici en
    // silence. Sans lui, Laravel autorise la lecture dans toute boutique du compte.
    run: (args, laravel) => laravel.get(`/products/${args.product_id as number}`, { shop_id: args.shop_id }),
  });
}
