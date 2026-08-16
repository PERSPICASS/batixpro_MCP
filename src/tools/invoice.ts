import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineRead, defineWrite, type Ctx } from "./registry.js";

const shopId = z.number().int().positive().optional()
  .describe("Boutique à cibler. Absent = toutes les boutiques accessibles au token. Vérifié côté Laravel.");
const isoDate = z.string().describe("Date ISO 8601, ex. 2026-07-01.");

const invoiceItem = z.object({
  product_id: z.number().int().positive().optional()
    .describe("Produit du catalogue — à retrouver avec product_search. Absent pour une ligne libre."),
  product_name: z.string()
    .describe("Libellé de la ligne tel qu'il apparaîtra sur la facture. Obligatoire."),
  description: z.string().optional().describe("Précision affichée sous le libellé."),
  quantity: z.number().int().min(1).describe("Quantité, entier positif."),
  unit_price: z.number().min(0)
    .describe("Prix unitaire HT. Par défaut celui du produit (product_get) ; ne l'invente pas."),
  tax_rate: z.number().min(0).max(100).optional()
    .describe("Taux de TVA en %. Absent = taux du produit, sinon celui de la boutique. À laisser vide dans le doute."),
});

export function registerInvoiceTools(server: McpServer, ctx: Ctx): void {
  defineRead(server, ctx, {
    name: "invoice_search",
    title: "Lister les factures",
    description:
      "Liste les factures de la boutique, de la plus récente à la plus ancienne. Cherche "
      + "par NUMÉRO de facture ou par nom de client, et filtre sur le statut (draft, sent, "
      + "paid, cancelled). C'est par ici qu'on retrouve une facture dont on connaît le "
      + "numéro — ne devine JAMAIS un identifiant. Lecture seule.",
    inputSchema: {
      search: z.string().optional()
        .describe("Numéro de facture (ex. INV-2026080001) ou nom du client."),
      status: z.string().optional().describe("Filtrer sur un statut de facture."),
      shop_id: shopId,
      per_page: z.number().int().min(1).max(100).optional().describe("Taille de page (max 100)."),
    },
    run: (args, laravel) =>
      laravel.get("/invoices", {
        search: args.search,
        status: args.status,
        shop_id: args.shop_id,
        per_page: args.per_page,
      }),
  });

  defineRead(server, ctx, {
    name: "invoice_get",
    title: "Détail d'une facture",
    description:
      "Récupère une facture par son identifiant : client, lignes, totaux, statut, "
      + "échéance et moyen de paiement. Lecture seule.",
    inputSchema: {
      invoice_id: z.number().int().positive()
        .describe("Identifiant de la facture, obtenu via invoice_search — jamais deviné."),
      shop_id: shopId,
    },
    run: (args, laravel) => laravel.get(`/invoices/${args.invoice_id as number}`, { shop_id: args.shop_id }),
  });

  defineWrite(server, ctx, {
    name: "invoice_update",
    title: "Modifier une facture (brouillon)",
    description:
      "Modifie une facture encore en BROUILLON : ajouter ou retirer des lignes, changer "
      + "une quantité, un prix, une échéance. Les lignes fournies REMPLACENT les "
      + "précédentes — appelle d'abord invoice_get pour récupérer les lignes existantes, "
      + "puis renvoie la liste complète, sinon tu effaceras ce que tu ne répètes pas. "
      + "Une facture émise, payée ou annulée ne peut plus être modifiée : c'est une pièce "
      + "comptable, qui se corrige par une annulation ou un avoir depuis l'application. "
      + "Récapitule la modification et obtiens l'accord de l'utilisateur avant d'appeler "
      + "ce tool.",
    inputSchema: {
      invoice_id: z.number().int().positive().describe("Identifiant de la facture à modifier."),
      customer_id: z.number().int().positive().optional()
        .describe("Nouveau client. À omettre pour conserver celui de la facture."),
      invoice_date: isoDate.describe("Date de la facture (ISO 8601)."),
      due_date: isoDate.optional()
        .describe("Échéance de paiement, au plus tôt le jour de la facture (ISO 8601)."),
      payment_method: z.enum(["cash", "card", "transfer", "check", "mobile"]).optional()
        .describe("Moyen de paiement prévu."),
      discount_amount: z.number().min(0).optional().describe("Remise globale en valeur."),
      items: z.array(invoiceItem).min(1)
        .describe("Liste COMPLÈTE des lignes après modification, pas seulement les ajouts."),
      notes: z.string().optional().describe("Note libre affichée sur la facture."),
      shop_id: shopId,
    },
    run: (args, laravel) =>
      laravel.put(`/invoices/${args.invoice_id as number}`, {
        customer_id: args.customer_id,
        invoice_date: args.invoice_date,
        due_date: args.due_date,
        payment_method: args.payment_method,
        discount_amount: args.discount_amount,
        items: args.items,
        notes: args.notes,
      }),
  });

  defineWrite(server, ctx, {
    name: "invoice_create",
    title: "Créer une facture (brouillon)",
    description:
      "Crée une facture en BROUILLON pour un client de la boutique. Le brouillon "
      + "n'engage rien : il ne sort pas la marchandise du stock, ne part pas au client, "
      + "et c'est l'utilisateur qui l'émet depuis l'application. Tu ne peux PAS émettre, "
      + "envoyer, encaisser ni annuler une facture. "
      + "Les totaux et la TVA sont calculés par le serveur — ne les annonce pas avant la "
      + "réponse. Récapitule toujours la facture à l'utilisateur et obtiens son accord "
      + "avant d'appeler ce tool.",
    inputSchema: {
      customer_id: z.number().int().positive()
        .describe("Client de la facture — à retrouver avec customer_search, jamais à deviner."),
      invoice_date: isoDate.describe("Date de la facture (ISO 8601). En général aujourd'hui."),
      due_date: isoDate.optional()
        .describe("Échéance de paiement, au plus tôt le jour de la facture (ISO 8601)."),
      payment_method: z.enum(["cash", "card", "transfer", "check", "mobile"]).optional()
        .describe("Moyen de paiement prévu."),
      discount_amount: z.number().min(0).optional().describe("Remise globale en valeur."),
      items: z.array(invoiceItem).min(1).describe("Lignes de la facture, au moins une."),
      notes: z.string().optional().describe("Note libre affichée sur la facture."),
      shop_id: shopId,
    },
    run: (args, laravel) =>
      laravel.post("/invoices", {
        customer_id: args.customer_id,
        invoice_date: args.invoice_date,
        due_date: args.due_date,
        payment_method: args.payment_method,
        discount_amount: args.discount_amount,
        items: args.items,
        notes: args.notes,
        shop_id: args.shop_id,
      }),
  });
}
