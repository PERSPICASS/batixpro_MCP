import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./registry.js";
import { registerProductTools } from "./product.js";
import { registerCustomerTools } from "./customer.js";
import { registerSalesTools } from "./sales.js";
import { registerStockTools } from "./stock.js";

/**
 * Enregistre l'ensemble des tools disponibles pour une session.
 * Phase 1 : lecture des domaines produit / client / vente / stock (endpoints v1 existants).
 * Les tools d'écriture (avec confirmation humaine) et les domaines restants
 * viendront en Phase 2.
 */
export function registerAllTools(server: McpServer, ctx: Ctx): void {
  registerProductTools(server, ctx);
  registerCustomerTools(server, ctx);
  registerSalesTools(server, ctx);
  registerStockTools(server, ctx);
}
