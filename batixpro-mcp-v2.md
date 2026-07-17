# Prompt d'architecture — MCP BATIXPRO (v2)

Ce document contient **4 prompts à exécuter successivement**, pas un seul.
Chaque passe produit un livrable autonome et sert de contexte à la suivante.
N'exécute pas la passe N+1 avant d'avoir validé le livrable de la passe N.

---

## CONTEXTE COMMUN (à inclure au début de chaque passe)

Agis comme un architecte logiciel senior spécialisé en SaaS ERP, Model Context
Protocol (MCP), IA agentique et architectures multi-tenant.

BATIXPRO est un ERP SaaS de gestion pour les quincailleries et PME africaines.

Stack existante :
- Backend : Laravel 12 (PHP 8.2)
- Base de données : PostgreSQL
- Authentification : Laravel Sanctum (tokens à abilities)
- Frontend : React / Inertia (Next.js pour le site public/SEO)
- UI : Tailwind CSS
- Infrastructure : Docker + VPS Linux + Traefik

Domaines métier gérés : boutiques, dépôts, utilisateurs, rôles et permissions,
produits, catégories, stock, inventaire, ventes, retours, clients, créances,
fournisseurs, achats, devis, précommandes, factures (dont récurrentes),
paiements, dépenses, coûts fixes, abonnements, analytique, logs d'activité,
documents PDF.

Objectif : permettre à des assistants IA d'interroger l'ERP, d'analyser les
performances, de rédiger des documents et d'exécuter des opérations autorisées.

### ÉTAT RÉEL DU CODE (socle déjà en place — à réutiliser, pas à réinventer)

Le MCP se greffe sur un ERP déjà en production. Le concevoir « from scratch »
produirait une architecture fictive. Faits vérifiés dans le dépôt `batix_saas` :

- **Il n'existe PAS de `company_id` / `tenant_id`.** La frontière multi-tenant
  est le **compte** = le user propriétaire (`super_admin`), identifié par
  `Shop.user_id`. Un compte possède une ou plusieurs **boutiques** (`shops`).
  Le modèle `User` expose déjà : `accessibleShops()`, `accessibleShopsQuery()`,
  `accountCode()`, `hasPermission(module, action)`, `activeSubscription()`.
  Un `super_admin` voit toutes ses boutiques ; un employé, uniquement sa
  `shop_id` assignée.

- **Une API v1 existe déjà** (`routes/api.php`, `app/Http/Controllers/Api/V1/*`),
  sous `auth:sanctum`, avec séparation read/write par domaine via **abilities
  Sanctum**. Abilities actuellement définies (`ApiTokenController::ABILITIES`) :
  `products:read`, `products:write`, `customers:read`, `customers:write`,
  `sales:read`, `sales:write`, `invoices:read`, `stock-movements:read`.
  Le trait `Api\V1\Concerns\ScopesToAccessibleShops` implémente déjà le scoping :
  `shop_id` optionnel, vérifié contre `accessibleShopsQuery()`, sinon `abort(403)`.
  → Le MCP doit **mapper ses tools sur ces abilities/endpoints existants** et
  n'introduire de nouveaux endpoints/abilities que pour les domaines non couverts.

- **Limite actuelle des tokens** : `ApiTokenController::authorizeOwner()` réserve
  la création de tokens au `super_admin`, et un token couvre **tout le compte**,
  pas une boutique. Le prompt v2 exige des connexions MCP par utilisateur avec le
  périmètre de CET utilisateur : la passe 1 doit traiter explicitement cet écart
  (émission de tokens scopés par user/boutille, ou middleware équivalent).

- **Permissions = système custom (pas spatie/permission).** Modèle
  `UserPermission` par **module** avec `can_view / can_create / can_edit /
  can_delete`, + rôles. Modules canoniques (`UserPermission::MODULES`) :
  products, categories, customers, quotes, preorders, invoices,
  recurring_invoices, sales, sales_delete, sales_restore, returns,
  returned_inventory, credits, stocks, inventory, depots, suppliers, purchases,
  expenses, users, shops, analytics, activity_logs, settings.
  Rôles : `super_admin, admin_platforme, admin, manager, cashier, staff, caisse,
  employee`. Middleware : `CheckPermission`. `super_admin` et `admin_platforme`
  ont toutes les permissions. Le mapping permissions→tools (passe 1) s'appuie sur
  CES modules, pas sur une liste inventée.

- **Un assistant IA existe déjà** : `AiChatController` + `AiChatService`, scopé à
  `current_shop()` et **gated par abonnement** (`activeSubscription()->hasAiAssistant()`,
  plans Growth/Pro/Entreprise). Le MCP doit composer avec ce gating d'abonnement —
  dimension absente du reste de ce prompt, à intégrer en passe 1.

- **Audit déjà présent** : modèle `ActivityLog` + `ActivityLogger`. Le journal
  d'audit IA (passe 3) doit étendre/réutiliser cet existant, pas le dupliquer.

### Contraintes d'architecture NON NÉGOCIABLES

Ces trois règles cadrent toutes les passes. Toute proposition qui les viole doit
être écartée, et si tu penses qu'une règle est mauvaise, dis-le explicitement
au lieu de la contourner silencieusement.

**C1 — Un seul serveur MCP.**
BATIXPRO expose UN serveur MCP unique, pas un serveur par domaine métier. Un
serveur MCP est une unité de déploiement, de connexion et d'authentification :
en multiplier onze multiplierait les processus, les configurations client et les
canaux d'auth sans bénéfice. Le découpage métier se fait par **préfixe de nom de
tool** à l'intérieur de ce serveur unique : `customer_*`, `product_*`, `stock_*`,
`sales_*`, `quote_*`, `invoice_*`, `purchase_*`, `finance_*`, `analytics_*`,
`company_*`.
Chaque tool doit se rattacher à une **ability Sanctum** (existante ou à créer,
ex. `products:read`) et à un **module de permission** (`UserPermission::MODULES`,
ex. `products`) — voir « ÉTAT RÉEL DU CODE ». Ne pas inventer de nouveau système
d'autorisation parallèle à celui du code.
L'authentification n'est PAS un domaine de tools : c'est une préoccupation
transversale qui conditionne chaque appel. Il n'existe pas de tool `auth_login`.

**C2 — Le tenant (compte + boutiques) vient exclusivement du token.**
BATIXPRO n'a PAS de `company_id` / `tenant_id` : la frontière est le **compte**
(user propriétaire `super_admin`, via `Shop.user_id`) et l'ensemble des
**boutiques accessibles** au porteur du token (`accessibleShopsQuery()`).
Le compte, l'identité utilisateur, les rôles et les permissions sont dérivés du
token Sanctum et de rien d'autre. Aucun tool n'accepte `tenant_id`, `company_id`,
`account_id`, `user_id` ni `owner_id` en entrée, sous aucune forme. Un modèle qui
hallucine un identifiant, ou un utilisateur qui en suggère un en langage naturel,
ne doit pas pouvoir franchir la frontière entre deux comptes. Le filtrage est
appliqué côté Laravel (scoping `accessibleShopsQuery()` + `CheckPermission` +
politiques), jamais côté serveur MCP, et jamais laissé à l'appréciation du modèle.
Corollaire : `shop_id` (boutique) et `depot_id` PEUVENT être des paramètres —
c'est déjà le contrat de `ScopesToAccessibleShops` — mais toute valeur reçue est
vérifiée comme appartenant au compte du token avant usage, sinon `abort(403)`.

**C3 — Lecture et écriture sont deux catégories séparées.**
Chaque tool est classé dans exactement une catégorie, déclarée dans sa définition :
- `read` — aucun effet de bord, exécution directe.
- `write` — modifie l'état métier. Toute écriture qui crée un engagement
  financier, juridique ou de stock (facture, paiement, avoir, validation de devis,
  mouvement de stock, réception marchandise) exige une **confirmation humaine
  explicite avant exécution**, obtenue hors du modèle.
Le mécanisme de confirmation doit être décrit précisément : qui confirme, sur
quel canal, ce qui lui est montré, la durée de validité de la confirmation, et
ce qui se passe en cas de non-réponse. Un tool d'écriture ne doit jamais pouvoir
être déclenché par la seule sortie du modèle.
État actuel : côté API v1, seules les écritures `products:write`, `customers:write`
et `sales:write` existent. Toutes les autres écritures du prompt (devis, factures,
paiements, achats/réceptions, mouvements de stock manuels) exigent de **créer
l'endpoint Laravel ET l'ability Sanctum** correspondants — chaque tool `write` doit
donc préciser s'il s'appuie sur un endpoint existant ou à construire.

---

## PASSE 1 — Architecture générale, sécurité et stack

Produis un document d'architecture couvrant :

### 1.1 Architecture générale
- Schéma des composants : client IA → serveur MCP → API Laravel → PostgreSQL.
- Rôle exact du serveur MCP : traduction de tools en appels HTTP authentifiés.
  Il ne contient AUCUNE règle métier et AUCUN accès direct à la base.
- Transport MCP retenu (stdio / HTTP streamable) et justification pour un SaaS
  multi-tenant hébergé.
- Cycle de vie d'une connexion : d'où vient le token, comment il est associé à
  la session, comment une session expire.

### 1.2 Authentification et contexte
- Comment un token Sanctum est obtenu et fourni au serveur MCP (le serveur ne
  gère pas de login : il reçoit un token déjà émis).
- Comment `tenant_id`, `user_id`, rôles et permissions sont résolus à chaque
  appel, conformément à C2.
- Ce qui se passe si le token est absent, expiré ou révoqué en cours de session.

### 1.3 Permissions
- Mapping entre les rôles/permissions existants de BATIXPRO et les tools exposés.
- Où le contrôle est appliqué : Laravel (autorité), serveur MCP (filtrage de la
  liste de tools annoncée, jamais l'inverse).
- Comportement attendu quand un tool est appelé sans la permission requise :
  message d'erreur exploitable par le modèle, sans fuite d'information.

### 1.4 Sécurité
- Isolation inter-entreprises : mécanisme concret et test permettant de prouver
  qu'aucune requête ne peut la franchir.
- Validation des actions sensibles : détail du mécanisme exigé par C3.
- Audit : quelles actions IA sont journalisées, avec quels champs (qui, quel
  agent, quel tool, quels arguments, quel résultat, confirmée par qui).
- Rate limiting : par utilisateur, par tenant, par tool.
- Injection de prompt : que se passe-t-il si une donnée métier (nom de client,
  libellé de produit, note de facture) contient des instructions adressées au
  modèle ? Décris la mitigation.
- Injection SQL et validation des entrées côté Laravel.

### 1.5 Stack technique du MCP
- Langage et SDK MCP recommandés, avec justification au regard de l'équipe
  Laravel/React existante.
- Structure de dossiers du projet.
- Dockerfile et intégration au Docker Compose / Traefik existant.
- Déploiement sur VPS, variables d'environnement, secrets, healthcheck.
- Observabilité : logs structurés, corrélation avec les logs Laravel.

---

## PASSE 2 — Contrats de tools

Contexte : reprends le CONTEXTE COMMUN et le livrable de la passe 1.

Pour CHAQUE domaine ci-dessous, définis les tools du serveur MCP unique.
Traite les domaines dans cet ordre et arrête-toi après le domaine 5 si la
réponse devient trop longue — la suite fera l'objet d'une exécution séparée.

1. `customer_*` — recherche, création, modification, historique d'achat, dette,
   comportement d'achat.
2. `product_*` — catalogue, prix, catégories, recherche.
3. `stock_*` — quantité disponible, mouvements, alertes de rupture, inventaire.
4. `sales_*` — ventes réalisées, tickets, commandes, performance commerciale.
5. `quote_*` — création, modification, validation, conversion en facture.
6. `invoice_*` — création, paiement, impayés, relance.
7. `purchase_*` — fournisseurs, commandes fournisseurs, réception marchandises.
8. `finance_*` — chiffre d'affaires, marge, bénéfice, trésorerie, dépenses.
9. `analytics_*` — statistiques, rapports, KPI.
10. `company_*` — informations entreprise, configuration, paramètres.

Pour chaque tool, fournis exactement :

- **Nom** — préfixé par le domaine (C1).
- **Catégorie** — `read` ou `write` (C3). Si `write` avec engagement, indique
  « confirmation humaine requise » et ce qui est présenté au confirmateur.
- **Description** — la phrase que lira le modèle pour décider de l'appeler.
  Elle doit rendre les mauvais usages évidents, pas seulement les bons.
- **Schéma d'entrée JSON** — types, champs obligatoires, contraintes.
  Rappel C2 : aucun `tenant_id` / `company_id` / `user_id`.
- **Schéma de sortie JSON**.
- **Endpoint Laravel appelé** — méthode + chemin.
- **Permission requise**.
- **Règles métier** — invariants que Laravel doit garantir, indépendamment de
  ce que demande le modèle.
- **Erreurs** — cas d'échec et message renvoyé au modèle.

Exemple du niveau attendu :

```
Tool        : invoice_create
Catégorie   : write — engagement financier, confirmation humaine requise
Description : Crée une facture pour un client existant à partir d'une liste de
              produits. Émet un document comptable réel : à n'utiliser qu'après
              confirmation explicite de l'utilisateur. Pour un chiffrage sans
              engagement, utiliser quote_create.
Input       : {
                customer_id: number,          // obligatoire, doit exister
                lines: [
                  { product_id: number, quantity: number }  // quantity > 0
                ],
                due_date?: string             // ISO 8601
              }
Output      : { invoice_id: number, number: string, total: number,
                status: string, pdf_url: string }
Endpoint    : POST /api/v1/invoices
Permission  : invoice.create
Règles      : le client et tous les produits appartiennent au tenant du token ;
              le stock est vérifié avant émission ; le total est recalculé côté
              serveur et jamais accepté depuis l'entrée.
Erreurs     : customer_not_found, product_not_found, insufficient_stock,
              confirmation_required, forbidden.
```

Termine par une section **Endpoints API** : liste consolidée des routes Laravel
à créer ou exposer, format d'échange, enveloppe d'erreur commune, versionnement.

---

## PASSE 3 — Modèle de données et agents

Contexte : reprends le CONTEXTE COMMUN et les livrables des passes 1 et 2.

### 3.1 Base de données
Uniquement les tables NOUVELLES nécessaires au MCP (les tables métier existent
déjà) :
- journal d'audit des actions IA ;
- confirmations d'actions sensibles et leur cycle de vie ;
- sessions / jetons MCP ;
- quotas et compteurs de rate limiting.
Pour chacune : colonnes, relations, index, place du `tenant_id`, et la stratégie
d'isolation retenue (global scope, RLS PostgreSQL, ou les deux) avec justification.

### 3.2 Agents IA
Précise d'abord où s'exécutent les agents : ce sont des **configurations côté
client** (system prompt + sous-ensemble de tools autorisés), pas des composants
du serveur MCP. Décris le composant qui les héberge.

Puis, pour chacun des agents suivants :
- Agent Directeur Général — analyse globale, recommandations stratégiques.
- Agent Commercial — analyse des ventes, suivi clients, opportunités.
- Agent Stock — prévention des ruptures, suggestions de commandes.
- Agent Finance — rentabilité, trésorerie, détection d'anomalies.
- Agent Assistant Boutique — aide quotidienne aux employés.

Indique : objectif, system prompt, **liste explicite des tools autorisés**
(par nom, issus de la passe 2), tools d'écriture accessibles ou non, rôle
BATIXPRO correspondant, et 2 exemples de conversation.

Contrainte : l'Agent Assistant Boutique n'a accès à aucun tool `finance_*` ni à
aucun tool `write` avec engagement. Justifie tout écart que tu proposerais.

---

## PASSE 4 — Scénarios et roadmap

Contexte : reprends le CONTEXTE COMMUN et les livrables des passes 1 à 3.

### 4.1 Scénarios
15 scénarios réels. Pour chacun : la phrase de l'utilisateur, son rôle, l'agent
concerné, la séquence exacte de tools appelés avec leurs arguments, et la réponse
de l'IA.

Au moins 5 scénarios doivent être des cas d'échec ou de refus :
- une écriture avec engagement où l'utilisateur ne confirme pas ;
- un utilisateur qui demande des données d'une autre entreprise ;
- un employé de boutique qui demande la marge ;
- un tool appelé sans la permission requise ;
- une donnée métier contenant une tentative d'injection de prompt.

Exemples du niveau attendu pour les cas nominaux :
- « Donne-moi mes ventes du mois. »
- « Crée un devis pour 100 sacs de ciment pour le client Kouassi. »

### 4.2 Roadmap
- **Phase 1 — Socle** : serveur MCP unique, authentification, isolation tenant,
  audit, et les tools `read` des domaines customer / product / stock / sales.
  Critère de sortie : un test prouvant l'isolation inter-entreprises.
- **Phase 2 — Écritures et agents** : mécanisme de confirmation, tools `write`,
  agents Commercial / Stock / Finance.
- **Phase 3 — Autonomie** : recommandations, automatisations, prédictions.
  Précise, pour chaque automatisation, ce qui reste soumis à confirmation humaine.

Pour chaque phase : livrables, dépendances, critères de sortie vérifiables.

---

Le résultat attendu est un document d'architecture professionnel permettant à
une équipe technique de développer le MCP BATIXPRO.
