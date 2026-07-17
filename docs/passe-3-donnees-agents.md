# MCP BATIXPRO — Passe 3 : Modèle de données et agents IA

> Suite de `passe-1-architecture.md` et `passe-2-contrats-tools.md`.
> Deux parties : **3.1** les nouvelles tables à créer dans PostgreSQL ; **3.2** les
> **5 assistants IA** (leur mission, leurs droits, leurs tools autorisés).
>
> **Comment lire.** Chaque partie a un encadré **« En clair »** pour le dirigeant.
> Rappels : les tables métier existent déjà (produits, ventes…), on n'ajoute que ce
> qui manque au MCP ; le tenant s'exprime en `account_code` + `shop_id` (pas de
> `tenant_id`) ; les écritures engageantes exigent une confirmation humaine.

---

# 3.1 Base de données — tables nouvelles

> **En clair.** Pour faire fonctionner l'IA en toute sécurité, il faut 4 nouveaux
> « carnets » dans la base : (1) un carnet des **connexions IA** (qui a le droit de
> brancher une IA et jusqu'où), (2) un carnet des **actions à confirmer** (quand
> l'IA veut créer une facture, on note la demande en attente de ton feu vert),
> (3) l'**historique des actions de l'IA** (qui a demandé quoi, quand, confirmé par
> qui), (4) un **compteur** pour éviter qu'une IA emballée sature le système.

### Stratégie d'isolation retenue (rappel)

Le code actuel n'utilise **pas** de global scope Eloquent ni de RLS PostgreSQL :
l'isolation se fait par **filtrage explicite** (`whereIn('shop_id', accessibleShopIds)`).
Les nouvelles tables suivent la **même stratégie** pour rester cohérentes : chaque
table porte `account_code` (compte propriétaire) et, quand pertinent, `shop_id`,
et **toute requête filtre explicitement** dessus.

Durcissement optionnel (recommandé à terme, hors périmètre immédiat) : activer la
**Row-Level Security PostgreSQL** sur ces 4 tables, avec une politique
`account_code = current_setting('app.account')`. C'est une seconde barrière qui
protège même en cas d'oubli de filtre applicatif. À décider en Phase 2 (roadmap) ;
non bloquant pour la Phase 1.

---

### Table 1 — `mcp_tokens` (jetons MCP par utilisateur)

Résout la limite identifiée en Passe 1 (les tokens Sanctum actuels sont réservés au
propriétaire et couvrent tout le compte). On **n'invente pas un nouveau système de
token** : Sanctum reste la source (`personal_access_tokens`). Cette table ajoute le
**contexte MCP** d'un token existant.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | bigint PK | |
| `personal_access_token_id` | bigint FK → `personal_access_tokens.id` (cascade delete) | le token Sanctum réel |
| `user_id` | bigint FK → `users.id` | porteur (contexte, l'autorité reste le token) |
| `account_code` | string, index | compte propriétaire (isolation) |
| `shop_scope` | jsonb null | boutiques autorisées ; `null` = toutes celles accessibles au user |
| `label` | string | nom lisible (« Assistant Commercial de Awa ») |
| `revoked_at` | timestamp null | révocation explicite |
| timestamps | | |

- **Relations** : `belongsTo` PersonalAccessToken, `belongsTo` User.
- **Index** : `account_code`, `personal_access_token_id` (unique).
- **Règles** : à l'émission, `abilities` du token dérivées des permissions du user
  (Passe 1) ; `expires_at` **obligatoire** (porté par `personal_access_tokens`,
  déjà indexé) ; **interdit pour `admin_platforme`**. Supprimer le token Sanctum
  supprime la ligne (cascade).

*(Alternative plus légère : ajouter directement des colonnes `is_mcp`, `shop_scope`
à `personal_access_tokens`. La table dédiée est préférée pour ne pas alourdir la
table Sanctum standard et garder la logique MCP isolée.)*

---

### Table 2 — `mcp_confirmations` (actions sensibles en attente)

Cœur de la contrainte C3 : une écriture engageante crée d'abord une confirmation
**en attente**, jamais exécutée par le seul modèle.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid PK | sert de `confirmation_id` renvoyé au modèle |
| `account_code` | string, index | isolation |
| `shop_id` | bigint FK → shops, index | boutille concernée |
| `requested_by_user_id` | bigint FK → users | qui a déclenché (via l'IA) |
| `tool` | string | ex. `sales_create` |
| `payload` | jsonb | arguments validés de l'action (source de vérité à l'exécution) |
| `summary` | jsonb | récapitulatif montré à l'humain (client, lignes, total serveur) |
| `status` | enum `pending`/`confirmed`/`rejected`/`expired`/`executed` | cycle de vie |
| `confirmed_by_user_id` | bigint FK null | qui a confirmé |
| `confirmed_at` | timestamp null | |
| `expires_at` | timestamp, index | validité courte (ex. +10 min) |
| `executed_at` | timestamp null | horodatage de l'exécution réelle |
| `result` | jsonb null | résultat (id créé, numéro…) ou erreur |
| timestamps | | |

**Cycle de vie** : `pending` → (humain) `confirmed` → Laravel exécute → `executed`
(ou `rejected` si refus ; `expired` si `expires_at` dépassé sans réponse). Une
confirmation `expired`/`executed`/`rejected` ne peut **jamais** être rejouée.

- **Index** : `(account_code, status)`, `expires_at` (purge des expirées).
- **Sécurité** : le `payload` fait foi à l'exécution — on **ne refait pas confiance
  au modèle** entre la demande et l'exécution ; totaux recalculés serveur au moment
  d'exécuter. `confirmed_by_user_id` doit avoir la permission requise pour ce tool.

---

### Table 3 — Audit des actions IA → **extension de `ActivityLog`** (pas de doublon)

`ActivityLog` porte déjà : `user_id`, `user_name`, `user_email`, `user_role`,
`shop_id`, `shop_name`, `account_code`, `action`, `description`, `subject_type`,
`subject_id`, `properties` (jsonb), `ip_address`, `user_agent`, `method`, `url`.
On **réutilise** cette table et on ajoute quelques colonnes nullables dédiées à l'IA :

| Colonne ajoutée | Type | Rôle |
|---|---|---|
| `channel` | string null (`web`/`mcp`) | distingue les actions IA des actions humaines |
| `mcp_token_label` | string null | quel « agent » / connexion IA |
| `mcp_tool` | string null | tool appelé |
| `request_id` | string null, index | corrélation MCP ↔ logs Laravel |
| `confirmation_id` | uuid null FK → mcp_confirmations | pour les écritures confirmées |

- Les **arguments** et le **résultat** vont dans `properties` (jsonb) déjà existant,
  **nettoyés des secrets** (jamais le token).
- Pour une écriture confirmée : `properties` porte `confirmed_by`, et
  `confirmation_id` relie à la trace de confirmation.
- **Champs journalisés (exigence Passe 1)** : qui (`user_id`), quel agent
  (`mcp_token_label`), quel tool (`mcp_tool`), quels arguments (`properties`), quel
  résultat (`properties`/`subject_id`), confirmée par qui (`confirmation_id` +
  `properties.confirmed_by`).

---

### Table 4 — `mcp_rate_counters` (quotas & limitation)

Rate limiting à 3 niveaux (Passe 1 §1.4). Deux implémentations possibles :

- **Recommandée** : compteurs en **cache Redis** (TTL par fenêtre) via le
  `RateLimiter` Laravel — pas de table, performant. La « table » est logique.
- **Si persistance/audit des quotas requis** : table `mcp_rate_counters`.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | bigint PK | |
| `account_code` | string, index | niveau compte |
| `user_id` | bigint null | niveau utilisateur/token |
| `scope` | string | `account` / `user` / `tool:<name>` |
| `window_start` | timestamp | début de fenêtre |
| `count` | int | appels dans la fenêtre |
| unique(`account_code`,`user_id`,`scope`,`window_start`) | | |

- **Autorité** : Laravel. Le MCP ne décide jamais seul d'un dépassement → `429`
  mappé `rate_limited` + `retry-after`. Écritures engageantes plafonnées plus bas
  que les lectures ; `analytics_*`/`finance_*` (coûteux) comptés à part.

---

# 3.2 Agents IA

> **En clair.** Un « agent », ce n'est pas un logiciel de plus. C'est une
> **configuration** : un rôle donné à l'IA (« tu es l'assistant commercial »), plus
> **la liste précise des outils qu'on l'autorise à utiliser**. Le même moteur
> d'IA + le même pont MCP servent tout le monde ; ce qui change d'un agent à
> l'autre, c'est **la casquette et le trousseau de clés**.

### Où s'exécutent les agents

Les agents sont des **configurations côté client**, pas des composants du serveur
MCP. Concrètement ils vivent dans le **composant qui héberge la conversation** :
- l'assistant IA déjà présent dans BATIXPRO (`AiChatController` / `AiChatService`),
  qui devient le principal hôte d'agents ;
- ou un client MCP externe (Claude Desktop, agent serveur) configuré avec le bon
  system prompt et le bon sous-ensemble de tools.

Le serveur MCP, lui, **annonce tous les tools** que le token autorise ; c'est la
**configuration de l'agent** qui restreint en plus à un sous-ensemble métier. Double
filet : même si un agent « oubliait » sa restriction, le token + Laravel bloquent
ce qui dépasse les droits réels de l'utilisateur.

**Garde-fou transverse** : quel que soit l'agent, aucune écriture engageante ne
s'exécute sans confirmation humaine (C3), et l'accès au MCP exige un abonnement
`growth`/`pro`/`enterprise` (`hasAiAssistant()`).

---

### Agent 1 — Directeur Général

- **Objectif** : vue d'ensemble, pilotage, recommandations stratégiques.
- **Rôle BATIXPRO** : `super_admin` (propriétaire du compte).
- **System prompt (extrait)** : « Tu es le conseiller de direction de {entreprise}.
  Tu analyses la performance globale (ventes, marge, trésorerie, stock) et proposes
  des décisions. Tu t'appuies uniquement sur les données renvoyées par les tools ;
  tu ne inventes aucun chiffre. Toute action qui engage l'entreprise (facture,
  paiement, commande) est proposée puis soumise à la confirmation de l'utilisateur ;
  tu ne la déclenches jamais seul. Réponds en {devise} de la boutique. »
- **Tools autorisés** : tous les `read` (`analytics_*`, `finance_*`, `sales_*`,
  `stock_*`, `customer_*`, `product_*`, `invoice_*`, `purchase_*`, `company_*`),
  **plus** les écritures engageantes (avec confirmation) : `invoice_create`,
  `invoice_mark_paid`, `purchase_create`, `purchase_receive`, `stock_adjust`,
  `quote_convert_to_invoice`, `company_update_settings`.
- **Écritures** : oui, toutes (toujours avec confirmation).
- **Exemples**
  1. *« Comment se porte mon business ce mois-ci ? »* → `analytics_dashboard`,
     `finance_margin`, `finance_cashflow`, `invoice_unpaid` → synthèse + 3 recommandations.
  2. *« Qui me doit de l'argent et depuis combien de temps ? »* → `invoice_unpaid`,
     `customer_history` → liste priorisée + proposition de relance.

---

### Agent 2 — Commercial

- **Objectif** : analyse des ventes, suivi clients, opportunités.
- **Rôle BATIXPRO** : `manager` / `admin` (commerce), sans accès finance.
- **System prompt (extrait)** : « Tu es l'assistant commercial. Tu analyses les
  ventes et les clients, tu identifies des opportunités et prépares devis et
  factures. Tu ne parles jamais de marge ni de bénéfice (hors de ton périmètre).
  Toute facture ou vente est proposée puis confirmée par l'utilisateur. »
- **Tools autorisés** : `sales_list`, `sales_get`, `sales_summary`, `customer_*`
  (search/get/history/create/update), `product_search`, `product_get`,
  `quote_*` (list/get/create/update/convert_to_invoice), `invoice_list`,
  `invoice_get`, `invoice_unpaid`, `invoice_create`, `invoice_mark_paid`,
  `analytics_top_products`, `analytics_top_customers`.
- **Écritures** : clients/devis (sans engagement) directement ; ventes/factures/
  conversion (**avec confirmation**).
- **Interdits** : `finance_*` (marge, trésorerie, dépenses), `purchase_*`,
  `stock_adjust`, `company_update_settings`.
- **Exemples**
  1. *« Crée un devis pour 100 sacs de ciment pour le client Kouassi. »* →
     `customer_search("Kouassi")`, `product_search("ciment")`, `quote_create(...)`.
  2. *« Quels clients n'ont rien acheté depuis 2 mois ? »* → `analytics_top_customers`,
     `customer_history` → liste + suggestion de relance.

---

### Agent 3 — Stock

- **Objectif** : prévention des ruptures, suggestions de réappro.
- **Rôle BATIXPRO** : `manager` / responsable stock.
- **System prompt (extrait)** : « Tu es l'assistant stock. Tu surveilles les
  niveaux, alertes de rupture et mouvements, et proposes des réapprovisionnements.
  Les ajustements de stock et les réceptions modifient les quantités réelles :
  tu les proposes, l'utilisateur confirme. Tu ne traites ni les prix de vente ni la
  finance. »
- **Tools autorisés** : `stock_movements`, `stock_level`, `stock_alerts`,
  `product_search`, `product_get`, `supplier_search`, `purchase_list`,
  `purchase_get`, `purchase_create`, `purchase_receive`, `stock_adjust`.
- **Écritures** : `purchase_create`, `purchase_receive`, `stock_adjust`
  (**toutes avec confirmation**).
- **Interdits** : `finance_*`, `sales_*` (au-delà d'un besoin de lecture),
  `invoice_*`, `customer_*` en écriture.
- **Exemples**
  1. *« Qu'est-ce qui va bientôt manquer ? »* → `stock_alerts`, `stock_level` →
     liste + proposition de `purchase_create` (à confirmer).
  2. *« On a reçu la commande du fournisseur X, mets à jour le stock. »* →
     `purchase_get`, puis `purchase_receive` (confirmation avant d'augmenter le stock).

---

### Agent 4 — Finance

- **Objectif** : rentabilité, trésorerie, détection d'anomalies.
- **Rôle BATIXPRO** : `super_admin` / comptable de confiance.
- **System prompt (extrait)** : « Tu es l'analyste financier. Tu calcules
  rentabilité, marge, trésorerie et suis les dépenses ; tu signales les anomalies
  (baisse de marge, dépense inhabituelle, impayés qui s'accumulent). Tu ne crées ni
  ventes ni commandes. Tu peux enregistrer une dépense après validation. »
- **Tools autorisés** : `finance_revenue`, `finance_margin`, `finance_cashflow`,
  `finance_expenses`, `finance_expense_create`, `analytics_dashboard`,
  `analytics_top_products`, `sales_summary`, `invoice_unpaid`, `invoice_list`.
- **Écritures** : `finance_expense_create` uniquement (confirmation selon seuil de
  montant, cf. 3.1) ; **aucune** vente/facture/commande.
- **Interdits** : `sales_create`, `invoice_create/mark_paid`, `purchase_*`,
  `stock_adjust`.
- **Exemples**
  1. *« Ma marge a-t-elle baissé ce trimestre ? »* → `finance_margin(by_product)` →
     comparaison + produits qui tirent la marge vers le bas.
  2. *« Enregistre une dépense carburant de 25 000. »* → `finance_expense_create`
     (validation si au-dessus du seuil).

---

### Agent 5 — Assistant Boutique (employés)

- **Objectif** : aide quotidienne aux employés au comptoir.
- **Rôle BATIXPRO** : `cashier` / `staff` / `caisse` / `employee`.
- **System prompt (extrait)** : « Tu aides l'employé au quotidien : trouver un
  produit, vérifier un prix ou un stock, retrouver un client, consulter une vente.
  Tu ne donnes **jamais** d'information financière (marge, bénéfice, trésorerie,
  dépenses). Tu ne réalises **aucune** action qui engage l'entreprise. Pour encaisser
  une vente, l'employé utilise la caisse habituelle. »
- **Tools autorisés (lecture + petites écritures sans engagement seulement)** :
  `product_search`, `product_get`, `stock_level`, `stock_alerts`, `customer_search`,
  `customer_get`, `customer_create`, `customer_update`, `sales_list`, `sales_get`,
  `quote_create`, `quote_get`, `quote_list`.
- **Écritures** : uniquement **sans engagement** (`customer_create/update`,
  `quote_create`). **Aucune** écriture avec confirmation.
- **Interdits (contrainte du prompt, respectée)** : **tout `finance_*`** et **toute
  écriture engageante** (`sales_create`, `invoice_*` write, `purchase_*` write,
  `stock_adjust`, `quote_convert_to_invoice`). Aucun écart proposé : la contrainte
  est saine (un employé ne doit ni voir la marge ni engager l'entreprise via l'IA).
- **Note** : même `quote_create` reste sans engagement (une proposition de prix
  n'encaisse rien) ; la conversion en facture, elle, est exclue.
- **Exemples**
  1. *« Il reste combien de tôles bac en stock ? »* → `product_search("tôle bac")`,
     `stock_level`.
  2. *« Le client Diallo, il a un numéro ? »* → `customer_search("Diallo")`,
     `customer_get`.

---

### Récapitulatif droits par agent

| Agent | `finance_*` | Écritures avec engagement | Rôle BATIXPRO |
|---|---|---|---|
| Directeur Général | ✅ | ✅ (avec confirmation) | super_admin |
| Commercial | ❌ | ventes/factures (confirmation) | manager/admin |
| Stock | ❌ | achats/réception/ajustement (confirmation) | manager |
| Finance | ✅ | dépense only (selon seuil) | super_admin/comptable |
| Assistant Boutique | ❌ | ❌ | cashier/staff/employee |

**Double garantie** : ce tableau décrit la *configuration* d'agent. La *vraie*
barrière reste le token (abilities dérivées des permissions) + Laravel : un agent
Commercial porté par un employé restreint n'obtiendra jamais plus que les droits de
cet employé.

---

✅ **Passe 3 complète.** Reste la **Passe 4** : 15 scénarios réels (dont ≥ 5 refus :
écriture non confirmée, accès inter-compte, employé demandant la marge, tool sans
permission, injection de prompt) + la roadmap en 3 phases avec critères de sortie
vérifiables.
