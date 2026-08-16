import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./registry.js";
import { registerProductTools } from "./product.js";
import { registerCustomerTools } from "./customer.js";
import { registerSalesTools } from "./sales.js";
import { registerStockTools } from "./stock.js";
import { registerAnalyticsTools } from "./analytics.js";
import { registerQuoteTools } from "./quote.js";
import { registerInvoiceTools } from "./invoice.js";

/**
 * Enregistre l'ensemble des tools disponibles pour une session.
 *
 * Lecture : produit / client / vente / stock / analytics, et depuis l'ouverture des
 * modules documentaires, devis et facture.
 *
 * Écriture : la création d'un devis et celle d'une facture, toutes deux bornées au
 * BROUILLON par les contrôleurs v1 (voir defineWrite dans registry.ts). L'émission,
 * l'encaissement et l'annulation restent hors de portée d'un assistant.
 */
export function registerAllTools(server: McpServer, ctx: Ctx): void {
  registerProductTools(server, ctx);
  registerCustomerTools(server, ctx);
  registerSalesTools(server, ctx);
  registerStockTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerQuoteTools(server, ctx);
  registerInvoiceTools(server, ctx);
}
