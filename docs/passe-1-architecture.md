# MCP BATIXPRO — Passe 1 : Architecture générale, sécurité et stack

> Livrable de la Passe 1 du prompt `batixpro-mcp-v2.md`.
> Ancré sur le code réel de `batix_saas` (Laravel 12, Sanctum, API v1 existante).
> Rappel des contraintes : **C1** un seul serveur MCP (découpage par préfixe de
> tool, chaque tool rattaché à une ability Sanctum + un module de permission) ;
> **C2** le tenant (compte + boutiques accessibles) vient exclusivement du token ;
> **C3** read/write séparés, confirmation humaine sur les écritures engageantes.

---

## 0. Ce sur quoi on se greffe (rappel synthétique)

| Élément | État réel dans `batix_saas` | Conséquence pour le MCP |
|---|---|---|
| Multi-tenant | Pas de `tenant_id`. Compte = user `super_admin` (`Shop.user_id`) + ses boutiques. | Le MCP ne connaît que « compte + boutiques accessibles ». |
| Scoping | `User::accessibleShopsQuery()` + `whereIn('shop_id', …)` **explicite par controller** (pas de global scope). | L'isolation vit dans l'API Laravel, pas dans le MCP. |
| API | API v1 sous `auth:sanctum` + abilities (`products:read`, `sales:write`…). Resources JSON + pagination. | Le MCP appelle ces endpoints, ne parle jamais à PostgreSQL. |
| Tokens | Sanctum PAT. Création réservée au `super_admin` (`ApiTokenController::authorizeOwner`), portée = compte entier, `expiration => null`. | À étendre : tokens MCP par utilisateur, scopés, expirants. |
| Permissions | `UserPermission` par module (`can_view/create/edit/delete`) + rôles. `super_admin` / `admin_platforme` = tout. | Mapping tool→(ability, module, action). |
| Rôle piège | `admin_platforme` → `accessibleShopsQuery()` = `Shop::query()` (TOUS les comptes). | **Interdit au MCP** (voir §1.2 et §1.4). |
| IA existante | `AiChatController` + `AiChatService`, gated `activeSubscription()->hasAiAssistant()` (Growth/Pro/Entreprise). | Le MCP hérite du gating abonnement. |
| Audit | `ActivityLog` + `ActivityLogger`. | Étendre, ne pas dupliquer. |

---

## 1.1 Architecture générale

### Schéma des composants

```
┌────────────────────┐   MCP (Streamable HTTP)   ┌──────────────────────┐
│  Client IA          │  ─────────────────────▶   │  Serveur MCP BATIXPRO │
│  (Claude Desktop,    │   Authorization: Bearer   │  (Node/TypeScript)     │
│   agent, app maison) │      <PAT Sanctum MCP>    │  = passerelle pure     │
└────────────────────┘  ◀─────────────────────    └───────────┬──────────┘
                                                                │ HTTP/JSON
                                                                │ Authorization: Bearer
                                                                │ (même token transféré)
                                                                ▼
                                                    ┌──────────────────────┐
                                                    │  API Laravel v1        │
                                                    │  auth:sanctum          │
                                                    │  abilities + scoping   │
                                                    │  + CheckPermission      │
                                                    └───────────┬──────────┘
                                                                │ Eloquent (whereIn shop_id)
                                                                ▼
                                                    ┌──────────────────────┐
                                                    │  PostgreSQL            │
                                                    └──────────────────────┘
```

### Rôle exact du serveur MCP

Le serveur MCP est une **passerelle de traduction** `tool MCP → appel HTTP
authentifié vers l'API Laravel v1`. Il ne contient :

- **aucune règle métier** (totaux, stock, droits : recalculés/vérifiés par Laravel) ;
- **aucun accès direct à PostgreSQL** ;
- **aucune logique d'autorisation qui fasse autorité** — au mieux il *masque* des
  tools (filtrage de la liste annoncée, §1.3), jamais il n'*accorde* un accès.

Sa seule intelligence propre : exposer le catalogue de tools, valider la forme des
entrées (JSON Schema), transférer le token, mapper les réponses/erreurs Laravel en
réponses MCP, et orchestrer le protocole de confirmation des écritures (C3).

Principe directeur : **si le serveur MCP disparaît, aucune garantie de sécurité ne
tombe.** Un attaquant qui appellerait l'API v1 directement, avec le même token,
obtiendrait exactement les mêmes droits. Le MCP n'est pas une frontière de
sécurité ; il est un adaptateur de protocole.

### Transport retenu : Streamable HTTP (pas stdio)

| Critère | stdio | **Streamable HTTP (retenu)** |
|---|---|---|
| Déploiement | 1 process par client, local | 1 service hébergé, multi-clients |
| Multi-tenant hébergé | inadapté (pas d'auth réseau) | adapté (Bearer par requête) |
| Intégration Traefik/VPS | non | oui (route HTTPS existante) |
| Clients distants | non | oui |

Justification : BATIXPRO est un SaaS hébergé multi-compte. stdio suppose un
process serveur lancé localement par chaque client — impossible à opérer de façon
centralisée et à authentifier par réseau. **Streamable HTTP** permet un service
unique derrière Traefik (`mcp.batixpro.com`), une session authentifiée par token
porté dans l'en-tête HTTP, et des connexions distantes (agents serveur, app web).

### Cycle de vie d'une connexion

1. **Émission du token** (hors MCP) : l'utilisateur crée un *token MCP* depuis
   BATIXPRO (extension de `ApiTokenController`, §1.2). Le token est un PAT Sanctum
   avec des abilities dérivées de ses permissions et une expiration obligatoire.
2. **Ouverture de session MCP** : le client se connecte à l'endpoint Streamable
   HTTP avec `Authorization: Bearer <token>`. Le serveur MCP vérifie *la présence*
   du token, ouvre une session, et — pour construire la liste de tools annoncée —
   appelle une fois `GET /api/v1/me` (nouvel endpoint, §1.2) pour récupérer
   compte, rôle, abilities, permissions et statut d'abonnement.
3. **Appels de tools** : chaque `tools/call` est traduit en appel HTTP v1 portant
   le **même** token. Le contexte tenant n'est jamais recalculé côté MCP.
4. **Expiration / révocation** : le token porte une `expires_at`. À toute réponse
   `401` de Laravel (token expiré, révoqué, ou supprimé via l'écran Tokens), le
   serveur MCP **termine la session** et renvoie au client une erreur MCP
   `unauthorized` invitant à se reconnecter. Aucun cache de droits ne survit à un
   401 (voir §1.2, révocation).

---

## 1.2 Authentification et contexte

### Le MCP ne fait pas de login

Il n'existe pas de tool `auth_login` (C1). Le serveur MCP **reçoit** un token déjà
émis ; il ne le fabrique jamais, ne stocke pas de mot de passe, ne parle pas à
`routes/auth.php`. Toute la chaîne d'identité reste dans Laravel/Sanctum.

### Émission d'un token MCP (extension à construire)

Le code actuel (`ApiTokenController::authorizeOwner`) réserve les tokens au
`super_admin` et leur donne le compte entier. C'est insuffisant : le MCP doit
donner à **chaque utilisateur** un accès au périmètre de **cet** utilisateur.

Proposition (livrée en détail Passe 3, principe ici) :

- Nouvel écran / endpoint « Connexion IA » émettant un **token MCP par
  utilisateur**, via `createToken($name, $abilities, $expiresAt)`.
- **Abilities dérivées des permissions** de l'utilisateur au moment de l'émission :
  pour chaque module où `can_view` → `<domaine>:read` ; `can_create/edit` →
  `<domaine>:write`. Un employé sans le module `invoices` n'obtient pas
  `invoices:read`.
- **Expiration obligatoire** (`sanctum.expiration` est `null` aujourd'hui : on ne
  s'appuie pas dessus, on passe un `expiresAt` explicite, ex. 90 j max, cf. le
  champ `expires_in_days` déjà présent).
- **Exclusion de `admin_platforme`** : ce rôle voit tous les comptes
  (`accessibleShopsQuery()` = `Shop::query()`). Un token MCP ne doit **jamais**
  être émis pour ce rôle, et l'API v1 doit refuser un token MCP porté par un
  `admin_platforme` (garde explicite). Le support plateforme passe par d'autres
  outils, hors MCP tenant.
- **Gating abonnement** : l'émission d'un token MCP exige
  `activeSubscription()?->hasAiAssistant()` (plans Growth/Pro/Entreprise), comme
  l'assistant IA existant. Sinon, refus explicite à l'émission.

### Résolution du contexte à chaque appel (C2)

Rien n'est recalculé côté MCP. À chaque appel v1, Laravel résout :

- **utilisateur** : `Auth::user()` via `auth:sanctum` ;
- **compte + boutiques** : `accessibleShopsQuery()` (déjà en place) ;
- **abilities** : middleware `abilities:<x>` sur la route ;
- **permission fine** : `CheckPermission` / `hasPermission($module, $action)` ;
- **boutique ciblée** : `shop_id` optionnel, validé par `ScopesToAccessibleShops`
  (`abort(403)` si hors périmètre).

Aucun tool n'accepte `account_id`, `user_id`, `tenant_id`, `company_id`,
`owner_id`. Seuls `shop_id` / `depot_id` sont admis, et toujours re-vérifiés.

### `GET /api/v1/me` (nouvel endpoint léger)

Pour que le serveur MCP construise la liste de tools et affiche un contexte au
client sans deviner. Retourne : `account_code`, `role`, boutiques accessibles
(`id`, `name`), `abilities` du token, modules autorisés, `subscription` (plan,
`has_ai_assistant`, statut/période de grâce). Aucune donnée sensible d'un autre
compte. Read pur.

### Token absent, expiré ou révoqué

| Situation | Comportement |
|---|---|
| Pas d'`Authorization` | Le MCP refuse l'ouverture de session (`unauthorized`), aucun tool listé. |
| Token expiré (`expires_at` passé) | Laravel répond `401` → le MCP termine la session. |
| Token révoqué (supprimé dans l'écran Tokens) | Prochain appel `401` → session terminée. Pas de cache de droits > la durée d'un appel. |
| Ability manquante pour le tool appelé | Laravel `403` (voir §1.3). |
| Permission module manquante | Laravel `403` via `CheckPermission`. |
| Abonnement tombé sous le gating | Laravel `403 subscription_required` ; le MCP relaie sans exposer d'autre compte. |

---

## 1.3 Permissions

### Double contrôle : ability (token) ET permission (utilisateur)

Un appel v1 passe **deux** portes, toutes deux côté Laravel :

1. **Ability Sanctum** portée par le token (`middleware('abilities:products:read')`).
   Borne ce que *ce token* peut faire, indépendamment de qui le porte.
2. **Permission module** de l'utilisateur (`CheckPermission` /
   `hasPermission($module, $action)`). Borne ce que *cet utilisateur* peut faire.

L'accès n'est accordé que si **les deux** passent. Un token large porté par un
utilisateur restreint reste restreint ; un utilisateur large avec un token étroit
reste étroit. C'est la propriété qu'on veut : le MCP ne peut pas élargir les droits.

### Mapping tool → ability → module/action

| Préfixe tool | Ability Sanctum | Module `UserPermission` | Endpoints v1 |
|---|---|---|---|
| `product_*` (read) | `products:read` | `products` / view | ✅ existe |
| `product_*` (write) | `products:write` | `products` / create,edit | ✅ existe |
| `customer_*` (read) | `customers:read` | `customers` / view | ✅ existe |
| `customer_*` (write) | `customers:write` | `customers` / create,edit | ✅ existe |
| `sales_*` (read) | `sales:read` | `sales` / view | ✅ existe |
| `sales_*` (write) | `sales:write` | `sales` / create | ✅ existe |
| `stock_*` (read) | `stock-movements:read` | `stocks` / view | ✅ existe (read) |
| `invoice_*` (read) | `invoices:read` | `invoices` / view | ✅ existe (read) |
| `quote_*` | `quotes:read` / `:write` | `quotes` | ⚠️ à créer |
| `invoice_*` (write) | `invoices:write` | `invoices` / create | ⚠️ à créer |
| `purchase_*` | `purchases:read` / `:write` | `purchases`, `suppliers` | ⚠️ à créer |
| `finance_*` | `finance:read` | `expenses`, `analytics` | ⚠️ à créer |
| `analytics_*` | `analytics:read` | `analytics` / view | ⚠️ à créer |
| `company_*` | `company:read` | `settings`, `shops` | ⚠️ à créer |

`⚠️` = ability + endpoint à ajouter (Passe 2). Les nouvelles abilities doivent être
ajoutées à `ApiTokenController::ABILITIES`.

### Où le contrôle est appliqué

- **Autorité = Laravel.** Ability + `CheckPermission` + scoping `shop_id`.
- **Serveur MCP = filtrage d'affichage seulement.** À l'ouverture de session, via
  `GET /api/v1/me`, il **retire de la liste annoncée** les tools dont l'ability ou
  le module manque. C'est de l'ergonomie (le modèle ne voit pas ce qu'il ne peut
  pas faire), **jamais** une décision de sécurité : même si un tool masqué était
  appelé, Laravel le refuserait. Le MCP ne fait jamais l'inverse (annoncer plus
  que ce que Laravel autorise).

### Appel sans la permission requise

Réponse `403` mappée en erreur MCP exploitable par le modèle, **sans fuite** :
message générique `« Action non autorisée pour ce compte. »`, sans révéler le nom
d'un autre utilisateur, l'existence d'une ressource d'un autre compte, ni la
raison exacte au-delà de « permission/ability manquante ». Les `show` d'un objet
hors périmètre renvoient **404** (comportement déjà en place : ne pas divulguer
l'existence), pas 403.

---

## 1.4 Sécurité

### Isolation inter-comptes — mécanisme et preuve

**Mécanisme** (déjà en place, à ne pas contourner) : chaque controller v1 filtre
par `whereIn('shop_id', $this->resolveShopIds($request))` ; `resolveShopIds`
n'autorise un `shop_id` que s'il est dans `accessibleShopsQuery()`, sinon
`abort(403)`. Les accès unitaires (`show`) vérifient l'appartenance et renvoient
`404` sinon.

**Test de preuve** (critère de sortie Phase 1) : soit deux comptes A et B, une
ressource `R_B` du compte B. Avec un token MCP du compte A :
- `GET /api/v1/products` ne contient jamais une ligne de B ;
- `GET /api/v1/products/{R_B}` → `404` ;
- `POST /api/v1/products` avec `shop_id` d'une boutique de B → `403` ;
- même chose exercée **via un appel de tool MCP** (`product_search`, `product_get`)
  → mêmes codes, prouvant que la passerelle n'ouvre aucune brèche.
Test automatisé (Pest/PHPUnit) ajouté au CI ; il échoue = build rouge.

**Garde `admin_platforme`** : refuser l'émission ET l'usage d'un token MCP porté
par ce rôle (il traverse tous les comptes). Test dédié : un token MCP
`admin_platforme` → `403` à l'ouverture de session.

### Validation des actions sensibles (C3)

Toute écriture engageante (facture, paiement, avoir, validation de devis,
mouvement de stock manuel, réception marchandise) suit un protocole de
confirmation **hors modèle** :

1. Le tool `*_create` / `*_confirm` est appelé → l'API v1 crée une **confirmation
   en attente** (table dédiée, Passe 3) au lieu d'exécuter. Elle contient le
   récapitulatif présenté à l'humain (client, lignes, total recalculé serveur).
2. Le serveur MCP renvoie au modèle un statut `confirmation_required` + un
   `confirmation_id` + le récapitulatif. **Le modèle ne peut pas confirmer.**
3. **Qui confirme** : l'utilisateur porteur du token, **sur un canal BATIXPRO
   authentifié** (notification web/app in-app, PAS un simple « oui » tapé au
   modèle). **Ce qui lui est montré** : le récapitulatif serveur. **Validité** :
   la confirmation expire (ex. 10 min) ; passé ce délai, elle est caduque.
   **Non-réponse** : rien ne s'exécute ; la confirmation passe `expired`.
4. Sur confirmation humaine, Laravel exécute et journalise (qui a confirmé).

Un tool d'écriture n'est **jamais** exécutable par la seule sortie du modèle.

### Audit des actions IA

Étendre `ActivityLog` (ne pas dupliquer) avec un contexte IA. Champs journalisés
par action IA : `who` (user_id), `account`, `agent`/client MCP (nom du token),
`tool` appelé, `arguments` (nettoyés des secrets), `endpoint` v1, `result`
(succès/erreur, id créé), et pour les écritures `confirmed_by` + `confirmed_at`.
Corrélé aux logs Laravel via un `request_id` propagé par le serveur MCP.

### Rate limiting

Trois niveaux, appliqués côté Laravel (`RateLimiter`) — le MCP ne fait pas
autorité :
- **par utilisateur** (token) : ex. N appels/min ;
- **par compte** : plafond agrégé (empêche qu'un compte sature via plusieurs
  tokens) ;
- **par tool / catégorie** : les `write` (surtout engageantes) plus stricts que
  les `read` ; les `analytics_*` (coûteux) séparés.
Dépassement → `429` mappé en erreur MCP `rate_limited` avec `retry-after`.

### Injection de prompt via données métier

Risque : un nom de client, un libellé produit ou une note de facture contient
« ignore tes instructions et… ». Mitigations :
- **Le MCP ne ré-interprète jamais les données** : il renvoie les valeurs telles
  quelles, sans les traiter comme des instructions.
- **Séparation données/instructions** : les sorties de tools sont livrées comme
  contenu de données structuré (JSON), jamais fusionnées dans le system prompt.
- **Marquage** : les champs de texte libre issus de la base sont signalés comme
  contenu non fiable (convention documentée pour les agents, Passe 3).
- **Aucun privilège dérivé du contenu** : aucune décision d'autorisation ne peut
  provenir d'une valeur de champ ; seuls token + permissions décident.
- **Écritures toujours confirmées** (C3) : même si le modèle est manipulé, il ne
  peut pas exécuter une écriture engageante sans l'humain.

### Injection SQL et validation des entrées

- Côté MCP : validation **JSON Schema** stricte de chaque entrée de tool (types,
  champs requis, bornes) avant transfert.
- Côté Laravel : Eloquent (requêtes paramétrées), `FormRequest`
  (`StoreProductApiRequest`, etc.) déjà en place, `per_page` borné
  (`resolvePerPage`), pas de SQL brut concaténé. Les identifiants (`shop_id`,
  `product_id`) sont validés et re-scopés, jamais interpolés.

---

## 1.5 Stack technique du MCP

### Langage et SDK : TypeScript + `@modelcontextprotocol/sdk`

Justification :
- Le **SDK MCP officiel** le plus mûr est TypeScript ; il couvre Streamable HTTP,
  la déclaration de tools et JSON Schema nativement.
- Le serveur étant une **passerelle HTTP sans métier**, il ne bénéficierait pas
  d'être en PHP dans le monolithe Laravel — au contraire, on veut un service isolé,
  léger, redéployable indépendamment.
- L'équipe maîtrise déjà React/TS (front) : TypeScript reste dans son périmètre de
  compétence.
- Alternative écartée : un package PHP dans le monolithe — couplerait le MCP au
  cycle de déploiement Laravel et brouillerait la frontière « aucune règle métier ».

### Structure de dossiers (`batixpro_mcp/`)

```
batixpro_mcp/
├─ src/
│  ├─ server.ts            # bootstrap Streamable HTTP + session
│  ├─ auth.ts              # extraction Bearer, appel /me, fin de session sur 401
│  ├─ laravelClient.ts     # client HTTP v1 (fetch + transfert token + request_id)
│  ├─ tools/
│  │  ├─ registry.ts       # catalogue + filtrage via /me (abilities/modules)
│  │  ├─ product.ts        # product_* → endpoints v1
│  │  ├─ customer.ts
│  │  ├─ sales.ts
│  │  └─ …                 # un fichier par préfixe de domaine (C1)
│  ├─ confirmation.ts      # protocole C3 (confirmation_required)
│  ├─ errors.ts            # mapping HTTP Laravel → erreurs MCP
│  └─ schemas/             # JSON Schemas d'entrée par tool
├─ test/                   # tests d'isolation & de mapping
├─ Dockerfile
├─ .env.example
└─ docs/                   # livrables des 4 passes
```

### Dockerfile et intégration Compose / Traefik

Le projet cible réutilise le pattern existant (`docker-compose.prod.yml`, réseau
externe `web`, Traefik avec `certresolver=le`). On ajoute un service :

```yaml
# extrait à intégrer au compose de prod
mcp:
  build: ./batixpro_mcp
  container_name: batix_prod_mcp
  restart: unless-stopped
  environment:
    - LARAVEL_API_URL=http://app:80/api/v1   # réseau interne, pas d'aller-retour public
    - NODE_ENV=production
  networks: [web, prod_internal]
  labels:
    - traefik.enable=true
    - traefik.docker.network=web
    - traefik.http.routers.batix_mcp.rule=Host(`mcp.batixpro.com`)
    - traefik.http.routers.batix_mcp.entrypoints=websecure
    - traefik.http.routers.batix_mcp.tls=true
    - traefik.http.routers.batix_mcp.tls.certresolver=le
    - traefik.http.services.batix_mcp.loadbalancer.server.port=3000
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 30s
    timeout: 5s
    retries: 3
```

Le MCP appelle l'API **sur le réseau interne** (`http://app:80`), pas via l'URL
publique : moins de latence, surface réduite.

### Déploiement, variables, secrets, healthcheck

- **Variables** : `LARAVEL_API_URL` (interne), `PORT=3000`, `NODE_ENV`,
  `RATE_LIMIT_*` (indicatif ; l'autorité reste Laravel), `LOG_LEVEL`. **Aucun
  secret Laravel ni clé DB** dans le MCP — il n'a pas de secret propre : la seule
  « clé » est le token porté par le client, jamais stocké.
- **Secrets** : néant côté MCP (propriété voulue). Traefik/TLS gérés comme
  l'existant.
- **Healthcheck** : `GET /health` (statut process + capacité à joindre
  `LARAVEL_API_URL`), branché sur Traefik/Compose.

### Observabilité

- **Logs structurés JSON** : un `request_id` généré par le MCP à chaque
  `tools/call`, propagé en en-tête vers Laravel (`X-Request-Id`) et journalisé des
  deux côtés → corrélation MCP ↔ logs Laravel ↔ `ActivityLog`.
- Champs de log MCP : `request_id`, `session`, nom du token (agent), `tool`,
  endpoint v1 appelé, statut HTTP, durée, code d'erreur mappé. **Jamais** le token
  en clair, jamais le contenu métier sensible.
- Compatible avec l'outillage existant (Sentry est déjà présent côté Laravel via
  `SentryContext`).

---

## Ce que la Passe 1 laisse ouvert (à traiter aux passes suivantes)

- **Passe 2** : contrats précis des tools par domaine ; création des endpoints +
  abilities manquants (`quotes`, `invoices:write`, `purchases`, `finance`,
  `analytics`, `company`) ; enveloppe d'erreur v1 consolidée.
- **Passe 3** : tables nouvelles (confirmations d'écriture + cycle de vie, audit IA
  étendu, tokens MCP par utilisateur, compteurs de rate limiting) ; définition des
  5 agents et de leurs sous-ensembles de tools ; mécanique d'émission des tokens
  MCP scopés.
- **Passe 4** : 15 scénarios (dont ≥ 5 refus, incluant tentative cross-compte,
  employé demandant la marge, écriture non confirmée, injection de prompt) ;
  roadmap avec critères de sortie vérifiables (le test d'isolation ci-dessus étant
  le critère de sortie de la Phase 1).

### Décisions à valider avant la Passe 2

1. Émission de tokens MCP **par utilisateur** avec abilities dérivées des
   permissions + expiration obligatoire, et exclusion stricte d'`admin_platforme`.
2. Gating d'accès au MCP par abonnement (`hasAiAssistant`), aligné sur
   l'assistant IA existant.
3. Confirmation des écritures engageantes **sur canal BATIXPRO in-app**, pas par
   un « oui » adressé au modèle.
