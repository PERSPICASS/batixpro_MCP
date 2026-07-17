# MCP BATIXPRO — Résumé technique (1 page)

Serveur **MCP unique** exposant l'ERP `batix_saas` (Laravel 12 + Sanctum + PostgreSQL)
à des assistants IA. Détail complet : `passe-1` → `passe-4`.

## En une phrase
Une **passerelle Node/TS sans métier** traduit des *tools* MCP en appels HTTP vers
l'**API v1 Laravel existante**, en transférant verbatim le token Sanctum du client.
Toute sécurité (tenant, permissions, écritures) reste côté Laravel.

## Contraintes cadres
- **C1** — 1 seul serveur MCP ; découpage par préfixe de tool ; chaque tool = 1 ability
  Sanctum + 1 module `UserPermission`. Pas de tool `auth_login`.
- **C2** — Tenant = **compte** (`Shop.user_id`) + **boutiques accessibles**
  (`accessibleShopsQuery()`). **Pas de `tenant_id`/`company_id`.** Aucun tool n'accepte
  `account_id`/`user_id`. Seul `shop_id` est admis, re-vérifié (403 sinon).
- **C3** — read (direct) vs write ; toute écriture engageante (vente, facture, paiement,
  réception, ajustement stock, conversion devis) → **confirmation humaine hors modèle**.

## Ce qui existe déjà (réutiliser, ne pas réinventer)
- API v1 `auth:sanctum` + abilities : `products:read/write`, `customers:read/write`,
  `sales:read/write`, `invoices:read`, `stock-movements:read` (`routes/api.php`,
  `Api/V1/*`, trait `ScopesToAccessibleShops`).
- Permissions custom `UserPermission::MODULES` (`can_view/create/edit/delete`) + rôles.
- Assistant IA + gating abonnement `hasAiAssistant()` (plans growth/pro/enterprise).
- Audit `ActivityLog` + `ActivityLogger`. Scoping = `whereIn('shop_id', …)` explicite
  (pas de global scope, pas de RLS).

## Stack MCP
Node/TypeScript + `@modelcontextprotocol/sdk`, transport **Streamable HTTP**, conteneur
derrière Traefik (`mcp.batixpro.com`), appelle l'API en interne (`http://app:80/api/v1`).
Aucun secret propre : la seule clé est le token porté par le client. Logs JSON + `X-Request-Id`.

## À construire
- **Tokens MCP par utilisateur** (table `mcp_tokens`) : abilities dérivées des permissions,
  `expires_at` obligatoire, **`admin_platforme` exclu** (voit tous les comptes → fuite).
- **Endpoints/abilities manquants** (cf. récap Passe 2) : quotes (`quotes:read/write`),
  `invoices:write`, purchases (`purchases:read/write`), `stock-movements:write`,
  finance (`finance:read/write`), `analytics:read`, company (`company:read/write`),
  + endpoints read : `/customers/{id}/history`, `/stock/levels|alerts`, `/sales/summary`,
  `/invoices/unpaid`, `/analytics/*`, `/company/context`.
- **Confirmations** (table `mcp_confirmations`, uuid, statut pending→confirmed→executed,
  `expires_at` ~10 min, payload = source de vérité, totaux recalculés serveur).
- **Audit IA** = extension `ActivityLog` (colonnes `channel`, `mcp_tool`, `request_id`,
  `confirmation_id`) — pas de table parallèle.
- **Rate limiting** 3 niveaux (user/compte/tool) via `RateLimiter` (Redis).

## ⚠️ Correctif sécurité prioritaire (existant)
`StoreSaleApiRequest` valide `customer_id`/`items.*.product_id` avec `exists:` **sans
scope boutique** → un id d'un autre compte passe la validation. Re-scoper à la boutique
du token avant toute écriture multi-lignes.

## Tools (~37) & agents
22 read · 6 write sans engagement · 9 write avec confirmation. 5 agents = configs client
(system prompt + sous-ensemble de tools), **pas** des composants du serveur MCP :
DG (finance + écritures), Commercial (ventes/factures, pas finance), Stock (achats/stock),
Finance (lecture + dépenses), **Assistant Boutique** (lecture + écritures sans engagement,
**aucun `finance_*`, aucune écriture engageante**). Le token reste la vraie barrière.

## Roadmap (critères de sortie bloquants)
1. **Socle read** : serveur MCP, tokens MCP, tools read customer/product/stock/sales, audit.
   → **Test d'isolation inter-comptes au vert dans le CI** (via appel de tool MCP).
2. **Écritures + agents** : confirmations, tools write, endpoints manquants, agents
   Commercial/Stock/Finance. → aucune écriture engageante sans confirmation valide ;
   pas de rejeu ; employé bloqué sur `finance_*`.
3. **Autonomie** : alertes/recommandations proactives (planificateur), prédictions.
   → toute action engageante issue d'une automatisation passe encore par confirmation humaine.

## Démarrer
Commencer Phase 1. Point d'entrée code côté Laravel : `routes/api.php`,
`app/Http/Controllers/Api/V1/`, `ApiTokenController::ABILITIES`, `app/Models/User.php`
(`accessibleShopsQuery`, `hasPermission`, `activeSubscription`).
