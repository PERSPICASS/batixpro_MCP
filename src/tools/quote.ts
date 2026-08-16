import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, defineWrite, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");
const isoDate = z.string().describe("Date ISO 8601, ex. 2026-07-01.");

const quoteItem = z.object({
  product_id: z.number().int().positive()
    .describe("Identifiant du produit — à retrouver avec product_search, jamais à deviner."),
  quantity: z.number().int().min(1).describe("Quantité, entier positif."),
  unit_price: z.number().min(0)
    .describe("Prix unitaire HT. Par défaut celui du produit (product_get) ; ne l'invente pas."),
});

export function registerQuoteTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "quote_search",
    title: "Lister les devis",
    description:
      "Liste les devis de la boutique, du plus récent au plus ancien. Cherche par NUMÉRO "
      + "de devis ou par nom de client, et filtre sur le statut (draft, sent, accepted, "
      + "rejected). C'est par ici qu'on retrouve un devis dont on connaît le numéro — ne "
      + "devine JAMAIS un identifiant de devis. Lecture seule.",
    inputSchema: {
      search: z.string().optional()
        .describe("Numéro de devis (ex. QTE-202608-001) ou nom du client."),
      status: z.string().optional().describe("Filtrer sur un statut de devis."),
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Taille de page (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/quotes", {
        search: args.search,
        status: args.status,
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });

  defineRead(server, ctx, {
    name: "quote_get",
    title: "Détail d'un devis",
    description:
      "Récupère un devis par son identifiant : client, lignes, totaux, dates d'envoi et "
      + "d'acceptation. Lecture seule.",
    inputSchema: {
      quote_id: z.number().int().positive()
        .describe("Identifiant du devis, obtenu via quote_search — jamais deviné."),
      shop_id: shopId,
    },
    // shop_id doit être DÉCLARÉ pour être transmis : zod retire tout argument absent du
    // schéma, et le cloisonnement imposé par l'application se perdrait ici.
    run: (args, laravel) => laravel.get(`/quotes/${args.quote_id as number}`, { shop_id: args.shop_id }),
  });

  defineWrite(server, ctx, {
    name: "quote_update",
    title: "Modifier un devis (brouillon)",
    description:
      "Modifie un devis encore en BROUILLON : ajouter ou retirer des lignes, changer une "
      + "quantité, un prix, une date de validité. Les lignes fournies REMPLACENT les "
      + "précédentes — appelle d'abord quote_get pour récupérer les lignes existantes, puis "
      + "renvoie la liste complète, sinon tu effaceras ce que tu ne répètes pas. "
      + "Un devis déjà envoyé ou accepté ne peut plus être modifié : il engage le "
      + "commerçant vis-à-vis de son client. Dans ce cas, propose d'en créer un nouveau. "
      + "Récapitule la modification et obtiens l'accord de l'utilisateur avant d'appeler "
      + "ce tool.",
    inputSchema: {
      quote_id: z.number().int().positive().describe("Identifiant du devis à modifier."),
      customer_id: z.number().int().positive().optional()
        .describe("Nouveau client. À omettre pour conserver celui du devis."),
      quote_date: isoDate.describe("Date du devis (ISO 8601)."),
      expiry_date: isoDate
        .describe("Date de validité, STRICTEMENT postérieure à quote_date (ISO 8601)."),
      items: z.array(quoteItem).min(1)
        .describe("Liste COMPLÈTE des lignes après modification, pas seulement les ajouts."),
      notes: z.string().optional().describe("Note libre affichée sur le devis."),
      terms: z.string().optional().describe("Conditions commerciales affichées sur le devis."),
      shop_id: shopId,
    },
    run: (args, laravel) =>
      laravel.put(`/quotes/${args.quote_id as number}`, {
        customer_id: args.customer_id,
        quote_date: args.quote_date,
        expiry_date: args.expiry_date,
        items: args.items,
        notes: args.notes,
        terms: args.terms,
      }),
  });

  defineWrite(server, ctx, {
    name: "quote_create",
    title: "Créer un devis (brouillon)",
    description:
      "Crée un devis en BROUILLON pour un client de la boutique. Le devis n'est PAS envoyé "
      + "au client : l'utilisateur le relit puis l'envoie depuis l'application. "
      + "Les totaux et la TVA sont calculés par le serveur à partir du taux de chaque "
      + "produit — ne les fournis pas et ne les annonce pas avant la réponse. "
      + "Récapitule toujours la commande à l'utilisateur et obtiens son accord avant "
      + "d'appeler ce tool.",
    inputSchema: {
      customer_id: z.number().int().positive()
        .describe("Client du devis — à retrouver avec customer_search, jamais à deviner."),
      quote_date: isoDate.describe("Date du devis (ISO 8601). En général aujourd'hui."),
      expiry_date: isoDate
        .describe("Date de validité, STRICTEMENT postérieure à quote_date (ISO 8601)."),
      items: z.array(quoteItem).min(1).describe("Lignes du devis, au moins une."),
      notes: z.string().optional().describe("Note libre affichée sur le devis."),
      terms: z.string().optional().describe("Conditions commerciales affichées sur le devis."),
      shop_id: shopId,
    },
    run: (args, laravel) =>
      laravel.post("/quotes", {
        customer_id: args.customer_id,
        quote_date: args.quote_date,
        expiry_date: args.expiry_date,
        items: args.items,
        notes: args.notes,
        terms: args.terms,
        shop_id: args.shop_id,
      }),
  });
}
