# BATIXPRO MCP

Serveur **MCP unique** de BATIXPRO : une passerelle Node/TypeScript qui expose l'ERP
`batix_saas` (API Laravel v1) à des assistants IA, via le transport **Streamable HTTP**.

La passerelle ne contient **aucune règle métier** et **aucun accès base** : elle traduit
des *tools* MCP en appels HTTP authentifiés vers Laravel, en transférant le token
Sanctum du client **verbatim**. Toute la sécurité (tenant, permissions, écritures) vit
côté Laravel. Voir `docs/` pour l'architecture complète (passes 1 à 4).

## État — socle en lecture + documents en brouillon

Tools de **lecture** (aucun effet de bord) :

| Tool | Endpoint Laravel |
|---|---|
| `product_search`, `product_get` | `GET /products`, `/products/{id}` |
| `customer_search`, `customer_get` | `GET /customers`, `/customers/{id}` |
| `sales_list`, `sales_get` | `GET /sales`, `/sales/{id}` |
| `sales_summary`, `top_products` | `GET /analytics/sales-summary`, `/analytics/top-products` |
| `stock_movements`, `stock_alerts` | `GET /stock-movements`, `/alerts` |
| `quote_search`, `quote_get` | `GET /quotes`, `/quotes/{id}` |
| `invoice_search`, `invoice_get` | `GET /invoices`, `/invoices/{id}` |

Tools d'**écriture** (`defineWrite`) :

| Tool | Endpoint Laravel | Garde |
|---|---|---|
| `quote_create` | `POST /quotes` | Devis créé en `draft`, jamais envoyé |
| `invoice_create` | `POST /invoices` | Facture créée en `draft`, jamais émise |

La garde n'est pas dans la passerelle : les contrôleurs v1 **forcent** le statut
brouillon et ignorent tout statut envoyé par l'appelant. Un brouillon ne déstocke pas,
ne part pas au client et se supprime dans l'application — c'est ce qui rend l'écriture
acceptable sans dialogue de confirmation dans le transport. Émettre, encaisser et
annuler restent des gestes humains, sans tool correspondant.

À venir : tokens MCP par utilisateur, domaines achats / finance / entreprise.

## Prérequis

- Node.js ≥ 20
- L'API `batix_saas` accessible (variable `LARAVEL_API_URL`)
- Un token Sanctum valide — créé depuis BATIXPRO (Settings → API Tokens). Abilities
  selon les tools voulus : `products:read`, `customers:read`, `sales:read`,
  `stock-movements:read`, `quotes:read`, `invoices:read`, et pour la création de
  brouillons `quotes:write`, `invoices:write`.

## Installation

```bash
npm install
cp .env.example .env   # ajuster LARAVEL_API_URL
```

## Lancer

```bash
npm run build && npm start      # production
npm run dev                     # développement (rechargement à chaud)
```

Endpoints :
- `POST /mcp` — endpoint MCP (Streamable HTTP). Requiert `Authorization: Bearer <token>`.
- `GET /health` — santé du process + joignabilité de l'API Laravel.

## Authentification

Chaque connexion MCP porte un Bearer token dans l'en-tête `Authorization`. Le token est
capturé à l'ouverture de session (`initialize`) et transféré tel quel à Laravel à chaque
appel. Sans token → `401`. Token expiré/révoqué → Laravel répond `401`, la session tombe.

> Note Phase 1 : on réutilise les tokens Sanctum existants (créés par le `super_admin`).
> Les **tokens MCP par utilisateur** (abilities dérivées des permissions, exclusion du
> rôle `admin_platforme`) sont un livrable de la Phase 2.

## Structure

```
src/
  config.ts        # env (aucun secret ; la clé est le token du client)
  logger.ts        # logs JSON + request_id (corrélation avec Laravel)
  errors.ts        # mapping HTTP Laravel → erreurs MCP sans fuite
  laravel.ts       # client HTTP v1 (transfert du token + X-Request-Id)
  tools/
    registry.ts    # helper d'enregistrement des tools de lecture
    product.ts customer.ts sales.ts stock.ts
    index.ts       # enregistre tous les tools d'une session
  server.ts        # serveur HTTP + gestion de session MCP
```

## Vérifier rapidement

Sans backend, on peut déjà valider le protocole (refus sans token, liste des tools,
erreur propre quand l'API est injoignable) :

```bash
npm run build && PORT=3111 node dist/server.js &
curl -s http://localhost:3111/health
# → {"status":"ok","sessions":0,"laravel_reachable":false}
```

Test de bout en bout avec un vrai token : pointer `LARAVEL_API_URL` sur l'API en marche,
puis connecter un client MCP (ou Claude Desktop) avec l'en-tête Authorization.
