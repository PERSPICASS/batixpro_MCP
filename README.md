# BATIXPRO MCP

Serveur **MCP unique** de BATIXPRO : une passerelle Node/TypeScript qui expose l'ERP
`batix_saas` (API Laravel v1) à des assistants IA, via le transport **Streamable HTTP**.

La passerelle ne contient **aucune règle métier** et **aucun accès base** : elle traduit
des *tools* MCP en appels HTTP authentifiés vers Laravel, en transférant le token
Sanctum du client **verbatim**. Toute la sécurité (tenant, permissions, écritures) vit
côté Laravel. Voir `docs/` pour l'architecture complète (passes 1 à 4).

## État — Phase 1 (socle en lecture)

Tools disponibles (lecture seule, endpoints v1 déjà existants) :

| Tool | Endpoint Laravel |
|---|---|
| `product_search`, `product_get` | `GET /products`, `/products/{id}` |
| `customer_search`, `customer_get` | `GET /customers`, `/customers/{id}` |
| `sales_list`, `sales_get` | `GET /sales`, `/sales/{id}` |
| `stock_movements` | `GET /stock-movements` |

À venir (Phase 2) : tokens MCP par utilisateur, écritures avec confirmation humaine,
domaines devis / factures / achats / finance / analytics / entreprise.

## Prérequis

- Node.js ≥ 20
- L'API `batix_saas` accessible (variable `LARAVEL_API_URL`)
- Un token Sanctum valide (abilities `products:read`, `customers:read`, `sales:read`,
  `stock-movements:read`) — créé depuis BATIXPRO (Settings → API Tokens).

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
