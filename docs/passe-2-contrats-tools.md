# MCP BATIXPRO — Passe 2 : Contrats de tools (domaines 1 à 5)

> Suite de `passe-1-architecture.md`. On définit ici, précisément, **ce que l'IA
> pourra demander** au logiciel, domaine par domaine.
> Cette passe couvre les **5 premiers domaines** : `customer_*`, `product_*`,
> `stock_*`, `sales_*`, `quote_*`. Les domaines 6 à 10 (factures, achats, finance,
> analytics, entreprise) feront l'objet d'une passe séparée.
>
> **Comment lire ce document.** Chaque domaine commence par un encadré **« En
> clair »** (français simple, pour le dirigeant). Suit le **contrat technique** de
> chaque tool (pour les développeurs) : nom, catégorie read/write, description,
> entrée, sortie, endpoint Laravel, permission, règles métier, erreurs.
>
> Rappels : **C2** aucun `account_id`/`user_id`/`tenant_id` en entrée, seul
> `shop_id` est admis et re-vérifié ; **C3** les écritures engageantes exigent une
> confirmation humaine hors modèle. Légende endpoint : ✅ existe déjà · ⚠️ à créer.

---

## Conventions communes

- **Entrée** : validée par JSON Schema côté MCP, puis par `FormRequest` côté Laravel.
- **Sortie** : format des `Resources` v1 existants. Les listes sont **paginées** :
  `{ data: [...], meta: { current_page, last_page, per_page, total } }`.
- **`shop_id`** : optionnel. Absent → toutes les boutiques accessibles au token.
  Fourni → doit appartenir au compte, sinon `403` (`ScopesToAccessibleShops`).
- **Erreurs communes** (voir enveloppe en fin de document) : `unauthorized` (401),
  `forbidden` (403), `not_found` (404), `validation_error` (422),
  `rate_limited` (429), `confirmation_required` (pour les écritures engageantes).

---

## Domaine 1 — `customer_*` (Clients)

> **En clair.** Ces outils laissent l'IA **retrouver un client**, **voir son
> historique et ce qu'il te doit**, et **créer ou modifier une fiche client**.
> Retrouver et lire = sans risque. Créer/modifier = une écriture, mais sans
> engagement financier, donc pas de confirmation obligatoire.

### `customer_search` — read
- **Description** : Recherche des clients par nom, téléphone ou e-mail. À utiliser
  pour retrouver un client avant une vente, un devis ou une consultation d'historique.
  Ne modifie rien.
- **Input** : `{ search?: string, is_active?: boolean, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, name, email, phone, address, is_active, total_purchases, created_at, updated_at }`
- **Endpoint** : `GET /api/v1/customers` ✅
- **Permission** : ability `customers:read` + module `customers` / view
- **Règles** : résultats limités aux boutiques accessibles ; `per_page` borné à 100.
- **Erreurs** : `unauthorized`, `forbidden`.

### `customer_get` — read
- **Description** : Récupère la fiche complète d'un client par son identifiant.
- **Input** : `{ customer_id: number }` (obligatoire)
- **Output** : un objet client (même forme que ci-dessus).
- **Endpoint** : `GET /api/v1/customers/{customer}` ✅
- **Permission** : `customers:read` + `customers` / view
- **Règles** : renvoie `404` si le client n'appartient pas au compte (ne pas
  divulguer son existence).
- **Erreurs** : `not_found`, `forbidden`.

### `customer_history` — read
- **Description** : Historique d'achat et solde dû d'un client (ventes passées,
  montant restant à payer / crédit). Pour analyser le comportement d'achat ou
  relancer une créance.
- **Input** : `{ customer_id: number, from?: string, to?: string }` (dates ISO 8601)
- **Output** : `{ customer: {...}, sales: [{ id, ticket_number, sale_date, total, remaining_amount, status }], totals: { purchased: number, outstanding: number } }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/customers/{customer}/history` (ability `customers:read`)
- **Permission** : `customers:read` + `customers` / view (+ `credits` / view pour le solde dû)
- **Règles** : n'agrège que les ventes des boutiques accessibles ; solde recalculé
  serveur, jamais fourni par le modèle.
- **Erreurs** : `not_found`, `forbidden`.

### `customer_create` — write (pas d'engagement → confirmation NON requise)
- **Description** : Crée une fiche client. Écriture simple (pas de conséquence
  financière). Vérifier d'abord avec `customer_search` qu'il n'existe pas déjà.
- **Input** : `{ name: string, phone?: string, email?: string, address?: string, notes?: string, shop_id: number }`
- **Output** : l'objet client créé + `201`.
- **Endpoint** : `POST /api/v1/customers` ✅
- **Permission** : `customers:write` + `customers` / create
- **Règles** : `shop_id` doit appartenir au compte ; e-mail unique par boutique si
  fourni ; `total_purchases` initialisé à 0 côté serveur (jamais accepté en entrée).
- **Erreurs** : `validation_error`, `forbidden`.

### `customer_update` — write (confirmation NON requise)
- **Description** : Modifie une fiche client existante (coordonnées, notes,
  activation). Ne touche pas aux montants d'achat.
- **Input** : `{ customer_id: number, name?, phone?, email?, address?, notes?, is_active? }`
- **Output** : l'objet client mis à jour.
- **Endpoint** : `PUT/PATCH /api/v1/customers/{customer}` ✅
- **Permission** : `customers:write` + `customers` / edit
- **Règles** : `404` si hors compte ; `total_purchases` non modifiable via ce tool.
- **Erreurs** : `not_found`, `validation_error`, `forbidden`.

---

## Domaine 2 — `product_*` (Produits / Catalogue)

> **En clair.** Ces outils laissent l'IA **consulter ton catalogue** (prix,
> catégories, référence) et **ajouter ou modifier un produit**. Attention : changer
> la quantité en stock d'un produit crée un mouvement de stock — c'est tracé.

### `product_search` — read
- **Description** : Recherche des produits par nom ou référence (SKU). Pour trouver
  un article avant une vente/un devis ou consulter son prix.
- **Input** : `{ search?: string, is_active?: boolean, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, name, sku, barcode, brand, purchase_price, selling_price, tax_rate, stock_quantity, min_stock_alert, unit, is_active, category }`
- **Endpoint** : `GET /api/v1/products` ✅
- **Permission** : `products:read` + `products` / view
- **Règles** : boutiques accessibles uniquement.
- **Erreurs** : `unauthorized`, `forbidden`.

### `product_get` — read
- **Description** : Fiche complète d'un produit par identifiant (prix d'achat/vente,
  stock, catégorie).
- **Input** : `{ product_id: number }`
- **Output** : un objet produit.
- **Endpoint** : `GET /api/v1/products/{product}` ✅
- **Permission** : `products:read` + `products` / view
- **Règles** : `404` si hors compte.
- **Erreurs** : `not_found`, `forbidden`.

### `product_create` — write (confirmation NON requise)
- **Description** : Crée un produit au catalogue. N'émet aucun document ; le stock
  initial éventuel génère un mouvement de stock tracé.
- **Input** : `{ name: string, selling_price: number, purchase_price: number, shop_id: number, category_id?, sku?, barcode?, brand?, description?, tax_rate?, stock_quantity?, min_stock_alert?, unit?, track_stock?, is_active? }`
- **Output** : l'objet produit créé + `201`.
- **Endpoint** : `POST /api/v1/products` ✅
- **Permission** : `products:write` + `products` / create
- **Règles** : `shop_id` du compte ; prix ≥ 0 ; `stock_quantity` initial passe par
  `StockMovementService` (traçabilité), jamais écrit en direct.
- **Erreurs** : `validation_error`, `forbidden`.

### `product_update` — write (confirmation NON requise, SAUF variation de stock)
- **Description** : Modifie un produit (prix, catégorie, seuil d'alerte, activation).
  **Modifier `stock_quantity` génère un mouvement de stock** : traiter ce cas
  comme une écriture de stock (voir domaine 3).
- **Input** : `{ product_id: number, name?, selling_price?, purchase_price?, tax_rate?, stock_quantity?, min_stock_alert?, unit?, category_id?, is_active? }`
- **Output** : l'objet produit mis à jour.
- **Endpoint** : `PUT/PATCH /api/v1/products/{product}` ✅
- **Permission** : `products:write` + `products` / edit (+ `stocks` / edit si `stock_quantity` change)
- **Règles** : `404` si hors compte ; toute variation de stock est enregistrée
  comme `adjustment` via `StockMovementService`.
- **Erreurs** : `not_found`, `validation_error`, `forbidden`.

---

## Domaine 3 — `stock_*` (Stock)

> **En clair.** Ces outils répondent à « combien il me reste ? », « qu'est-ce qui
> va bientôt manquer ? » et permettent d'**ajuster un stock** (casse, correction
> d'inventaire). Un ajustement de stock est un engagement (ça change tes quantités
> réelles) → **confirmation humaine requise**.

### `stock_movements` — read
- **Description** : Liste les mouvements de stock (entrées, sorties, ajustements)
  d'un produit ou d'une boutique. Pour comprendre l'évolution d'un stock.
- **Input** : `{ product_id?: number, type?: "in"|"out"|"adjustment", from?: string, to?: string, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, product, type, quantity, unit_cost, notes, movement_date }`
- **Endpoint** : `GET /api/v1/stock-movements` ✅
- **Permission** : `stock-movements:read` + `stocks` / view
- **Règles** : boutiques accessibles ; `product_id` re-vérifié appartenir au compte.
- **Erreurs** : `forbidden`.

### `stock_level` — read
- **Description** : Quantité actuellement disponible pour un ou plusieurs produits,
  avec indicateur de rupture (comparé au seuil d'alerte).
- **Input** : `{ product_id?: number, shop_id?: number, only_low_stock?: boolean }`
- **Output** : `[{ product_id, name, sku, stock_quantity, min_stock_alert, is_low: boolean }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/stock/levels` (ability `stock-movements:read`)
- **Permission** : `stock-movements:read` + `stocks` / view
- **Règles** : `is_low` calculé serveur (`stock_quantity <= min_stock_alert`).
- **Erreurs** : `forbidden`.

### `stock_alerts` — read
- **Description** : Liste des produits en rupture ou sous le seuil d'alerte, pour
  anticiper les commandes. Ne modifie rien.
- **Input** : `{ shop_id?: number }`
- **Output** : `[{ product_id, name, sku, stock_quantity, min_stock_alert }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/stock/alerts` (ability `stock-movements:read`)
- **Permission** : `stock-movements:read` + `stocks` / view
- **Erreurs** : `forbidden`.

### `stock_adjust` — write (**engagement stock → confirmation humaine requise**)
- **Description** : Ajuste la quantité d'un produit (correction d'inventaire, casse,
  perte). Modifie le stock réel : **à n'exécuter qu'après confirmation explicite de
  l'utilisateur**. Ce qui est présenté au confirmateur : produit, quantité avant →
  après, motif.
- **Input** : `{ product_id: number, new_quantity: number, reason: string, shop_id: number }`
- **Output** : `{ movement_id, product_id, previous_quantity, new_quantity, type: "adjustment" }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/stock/adjustments` (ability `stock-movements:write` **à ajouter**)
- **Permission** : `stock-movements:write` (nouvelle) + `stocks` / edit
- **Règles** : passe par `StockMovementService` (traçabilité) ; `product_id` du
  compte ; enregistre l'écart, pas la valeur absolue seule ; confirmation obligatoire.
- **Erreurs** : `confirmation_required`, `not_found`, `validation_error`, `forbidden`.

---

## Domaine 4 — `sales_*` (Ventes)

> **En clair.** Ces outils laissent l'IA **consulter les ventes** (chiffre du jour,
> tickets, performance) et **enregistrer une vente**. Enregistrer une vente encaisse
> de l'argent et sort du stock → **confirmation humaine requise**.

### `sales_list` — read
- **Description** : Liste les ventes sur une période, avec filtres (client, statut,
  moyen de paiement). Pour suivre l'activité commerciale.
- **Input** : `{ from?: string, to?: string, customer_id?: number, status?: string, payment_method?: string, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, ticket_number, sale_date, customer, payment_method, status, total, amount_paid, remaining_amount }`
- **Endpoint** : `GET /api/v1/sales` ✅
- **Permission** : `sales:read` + `sales` / view
- **Règles** : boutiques accessibles ; `customer_id` re-scopé au compte.
- **Erreurs** : `forbidden`.

### `sales_get` — read
- **Description** : Détail d'une vente (lignes, produits, totaux, paiement) par
  identifiant ou numéro de ticket.
- **Input** : `{ sale_id: number }`
- **Output** : la vente avec ses `items` `[{ product_id, product_name, sku, quantity, unit_price, total }]`.
- **Endpoint** : `GET /api/v1/sales/{sale}` ✅
- **Permission** : `sales:read` + `sales` / view
- **Règles** : `404` si hors compte.
- **Erreurs** : `not_found`, `forbidden`.

### `sales_summary` — read
- **Description** : Résumé chiffré des ventes sur une période (total encaissé,
  nombre de tickets, panier moyen). Pour « mes ventes du mois ». **Ne donne pas la
  marge** (réservé au domaine finance).
- **Input** : `{ from: string, to: string, shop_id?: number, group_by?: "day"|"week"|"month" }`
- **Output** : `{ total_sales: number, tickets: number, average_basket: number, series: [{ period, total, tickets }] }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/sales/summary` (ability `sales:read`)
- **Permission** : `sales:read` + `sales` / view
- **Règles** : agrégats calculés serveur, bornés aux boutiques accessibles.
- **Erreurs** : `forbidden`.

### `sales_create` — write (**engagement financier + sortie de stock → confirmation humaine requise**)
- **Description** : Enregistre une vente réelle : encaisse un paiement et décrémente
  le stock. Émet un ticket. **À n'exécuter qu'après confirmation explicite.** Pour un
  chiffrage sans engagement, utiliser `quote_create`. Ce qui est présenté au
  confirmateur : client, lignes (produit, quantité, prix), total recalculé serveur,
  moyen de paiement, montant reçu.
- **Input** :
  ```
  {
    customer_id?: number,                 // null = vente comptoir anonyme
    payment_method: "cash"|"card"|"transfer"|"check"|"mobile"|"multiple"|"credit",
    amount_paid: number,                  // >= 0
    discount_amount?: number,
    credit_due_date?: string,             // requis si payment_method = "credit"
    notes?: string,
    shop_id: number,
    items: [ { product_id: number, quantity: number, unit_price: number } ]  // >= 1 ligne
  }
  ```
- **Output** : `{ sale_id, ticket_number, total, amount_paid, remaining_amount, status }`
- **Endpoint** : `POST /api/v1/sales` ✅
- **Permission** : `sales:write` + `sales` / create
- **Règles (à garantir par Laravel, indépendamment du modèle)** :
  - **⚠️ correctif requis** : aujourd'hui `customer_id` et `items.*.product_id` sont
    validés par `exists:` **sans filtre boutique** → doivent être re-vérifiés comme
    appartenant à la boutique du compte, sinon fuite/erreur inter-compte ;
  - le **total est recalculé serveur** à partir des produits, jamais accepté du modèle ;
  - le **stock est vérifié** avant validation (rupture → refus) ;
  - `credit_due_date` obligatoire si `payment_method = credit` ;
  - `remaining_amount` = total − amount_paid, calculé serveur ;
  - confirmation humaine obligatoire (C3).
- **Erreurs** : `confirmation_required`, `customer_not_found`, `product_not_found`,
  `insufficient_stock`, `validation_error`, `forbidden`.

---

## Domaine 5 — `quote_*` (Devis)

> **En clair.** Un **devis** est une proposition de prix **sans engagement** : rien
> n'est encaissé, aucun stock ne bouge. L'IA peut donc **créer et modifier des
> devis librement**. En revanche, **transformer un devis en facture** est un
> engagement → confirmation humaine requise. ⚠️ Aucun endpoint devis n'existe encore
> côté API : tout ce domaine est **à construire** (Passe 3/roadmap).

### `quote_list` — read
- **Description** : Liste les devis (par client, statut, période).
- **Input** : `{ from?: string, to?: string, customer_id?: number, status?: string, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, quote_number, customer, quote_date, expiry_date, status, total }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/quotes` (ability `quotes:read` à ajouter)
- **Permission** : `quotes:read` + `quotes` / view
- **Erreurs** : `forbidden`.

### `quote_get` — read
- **Description** : Détail d'un devis avec ses lignes.
- **Input** : `{ quote_id: number }`
- **Output** : le devis + `items` `[{ product_id, description, quantity, unit_price, line_total, tax_rate }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/quotes/{quote}`
- **Permission** : `quotes:read` + `quotes` / view
- **Règles** : `404` si hors compte.
- **Erreurs** : `not_found`, `forbidden`.

### `quote_create` — write (pas d'engagement → confirmation NON requise)
- **Description** : Crée un devis (proposition de prix). N'encaisse rien, ne touche
  pas au stock. Sans engagement : peut être créé directement.
- **Input** :
  ```
  {
    customer_id: number,
    shop_id: number,
    expiry_date?: string,
    notes?: string,
    terms?: string,
    items: [ { product_id: number, quantity: number, unit_price?: number, description? } ]  // >= 1
  }
  ```
- **Output** : `{ quote_id, quote_number, total, status: "draft" }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/quotes` (ability `quotes:write`)
- **Permission** : `quotes:write` + `quotes` / create
- **Règles** : client et produits du compte ; total recalculé serveur ;
  `unit_price` par défaut = prix de vente du produit si non fourni ;
  statut initial `draft`.
- **Erreurs** : `customer_not_found`, `product_not_found`, `validation_error`, `forbidden`.

### `quote_update` — write (confirmation NON requise)
- **Description** : Modifie un devis non encore accepté (lignes, dates, conditions).
- **Input** : `{ quote_id: number, expiry_date?, notes?, terms?, items? }`
- **Output** : le devis mis à jour.
- **Endpoint** : ⚠️ à créer — `PUT/PATCH /api/v1/quotes/{quote}`
- **Permission** : `quotes:write` + `quotes` / edit
- **Règles** : refus si le devis est déjà `accepted` ou converti ; total recalculé.
- **Erreurs** : `not_found`, `quote_locked`, `validation_error`, `forbidden`.

### `quote_convert_to_invoice` — write (**engagement financier → confirmation humaine requise**)
- **Description** : Transforme un devis accepté en **facture** (document comptable
  réel). Engage l'entreprise : **confirmation explicite requise**. Ce qui est
  présenté au confirmateur : client, lignes, total, référence du devis d'origine.
- **Input** : `{ quote_id: number }`
- **Output** : `{ invoice_id, number, total, status, pdf_url }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/quotes/{quote}/convert` (abilities `quotes:write` + `invoices:write`)
- **Permission** : `quotes` / edit + `invoices` / create
- **Règles** : le devis doit exister et appartenir au compte ; total repris/recalculé
  serveur ; confirmation humaine obligatoire ; le devis passe `converted`.
- **Erreurs** : `confirmation_required`, `not_found`, `quote_not_acceptable`, `forbidden`.

---

## Récapitulatif : endpoints & abilities à créer (domaines 1-5)

| Domaine | Nouveaux endpoints | Nouvelles abilities |
|---|---|---|
| customer | `GET /customers/{id}/history` | — |
| stock | `GET /stock/levels`, `GET /stock/alerts`, `POST /stock/adjustments` | `stock-movements:write` |
| sales | `GET /sales/summary` | — |
| quote | `GET/POST /quotes`, `GET/PUT /quotes/{id}`, `POST /quotes/{id}/convert` | `quotes:read`, `quotes:write` |

À ajouter à `ApiTokenController::ABILITIES` : `stock-movements:write`, `quotes:read`,
`quotes:write` (+ à venir domaines 6-10 : `invoices:write`, `purchases:*`,
`finance:read`, `analytics:read`, `company:read`).

**Correctif de sécurité prioritaire** (existant) : dans `StoreSaleApiRequest` (et
tout futur `store` multi-lignes), remplacer `exists:customers,id` /
`exists:products,id` par une vérification **scopée à la boutique du compte**, sinon
un `product_id`/`customer_id` d'un autre compte passe la validation.

---

## Domaine 6 — `invoice_*` (Factures)

> **En clair.** Une **facture** est un document comptable réel (contrairement au
> devis). L'IA pourra **consulter les factures**, repérer les **impayées** et
> préparer des **relances**. Créer une facture ou l'encaisser = engagement →
> **confirmation humaine requise**. ⚠️ Côté code, seule la lecture des factures
> existe ; la création/encaissement est à construire. Note : une facture est
> `draft` ou `paid` (pas de paiement partiel comme sur les ventes) ; les
> encaissements de créances passent par le module créances (`CreditController`).

### `invoice_list` — read
- **Description** : Liste les factures (par client, statut, période).
- **Input** : `{ from?: string, to?: string, customer_id?: number, status?: "draft"|"paid"|"overdue", shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, invoice_number, invoice_date, due_date, customer, status, total }`
- **Endpoint** : `GET /api/v1/invoices` ✅
- **Permission** : `invoices:read` + `invoices` / view
- **Erreurs** : `forbidden`.

### `invoice_get` — read
- **Description** : Détail d'une facture avec ses lignes.
- **Input** : `{ invoice_id: number }`
- **Output** : la facture + `items` `[{ product_id, product_name, quantity, unit_price, total }]`
- **Endpoint** : `GET /api/v1/invoices/{invoice}` ✅
- **Permission** : `invoices:read` + `invoices` / view
- **Règles** : `404` si hors compte.
- **Erreurs** : `not_found`, `forbidden`.

### `invoice_unpaid` — read
- **Description** : Liste des factures impayées ou en retard, avec le montant dû et
  l'ancienneté. Pour préparer les relances. Ne modifie rien.
- **Input** : `{ shop_id?: number, overdue_only?: boolean }`
- **Output** : `[{ invoice_id, invoice_number, customer, total, due_date, days_overdue }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/invoices/unpaid` (ability `invoices:read`)
- **Permission** : `invoices:read` + `invoices` / view
- **Règles** : `days_overdue` calculé serveur.
- **Erreurs** : `forbidden`.

### `invoice_create` — write (**engagement financier → confirmation humaine requise**)
- **Description** : Crée une facture pour un client existant. Émet un document
  comptable réel : **à n'utiliser qu'après confirmation explicite**. Pour un
  chiffrage sans engagement, utiliser `quote_create`. Présenté au confirmateur :
  client, lignes, total recalculé serveur, échéance.
- **Input** : `{ customer_id: number, shop_id: number, due_date?: string, notes?: string, items: [{ product_id: number, quantity: number, unit_price?: number }] }`
- **Output** : `{ invoice_id, invoice_number, total, status, pdf_url }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/invoices` (ability `invoices:write` à ajouter)
- **Permission** : `invoices:write` + `invoices` / create
- **Règles** : client et produits du compte ; total recalculé serveur ; numéro de
  facture attribué serveur (préfixe `Shop.invoice_prefix`) ; confirmation obligatoire.
- **Erreurs** : `confirmation_required`, `customer_not_found`, `product_not_found`, `validation_error`, `forbidden`.

### `invoice_mark_paid` — write (**engagement financier → confirmation humaine requise**)
- **Description** : Enregistre l'encaissement d'une facture (passage à `paid`).
  **Confirmation explicite requise.** Présenté au confirmateur : facture, client,
  montant, moyen de paiement.
- **Input** : `{ invoice_id: number, payment_method: string, paid_at?: string }`
- **Output** : `{ invoice_id, status: "paid", paid_at }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/invoices/{invoice}/payment` (ability `invoices:write`)
- **Permission** : `invoices:write` + `invoices` / edit (+ `credits` selon le flux créances)
- **Règles** : `404` si hors compte ; refus si déjà `paid` ; confirmation obligatoire ;
  cohérence avec le module créances à préciser en implémentation.
- **Erreurs** : `confirmation_required`, `not_found`, `invoice_already_paid`, `forbidden`.

---

## Domaine 7 — `purchase_*` (Achats / Fournisseurs)

> **En clair.** Ces outils gèrent tes **fournisseurs** et tes **commandes
> fournisseurs**. Consulter = libre. Passer une commande fournisseur, et surtout
> **réceptionner la marchandise** (ce qui augmente ton stock), sont des engagements
> → **confirmation humaine requise**. ⚠️ Tout ce domaine est à construire côté API.
> Rappel : un fournisseur est rattaché à une ou plusieurs boutiques via la liaison
> `shop_supplier` (pas de `shop_id` direct) — le scoping se fait par cette liaison.

### `supplier_search` — read
- **Description** : Recherche des fournisseurs par nom ou société.
- **Input** : `{ search?: string, is_active?: boolean, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, name, company_name, email, phone, city, country, is_active }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/suppliers` (ability `purchases:read`)
- **Permission** : `purchases:read` + `suppliers` / view
- **Règles** : restreint aux fournisseurs liés aux boutiques accessibles
  (`whereHas('shops', …)`).
- **Erreurs** : `forbidden`.

### `purchase_list` — read
- **Description** : Liste les commandes fournisseurs (par fournisseur, statut, période).
- **Input** : `{ from?: string, to?: string, supplier_id?: number, status?: string, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, shop_id, reference, supplier, status, order_date, expected_date, total }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/purchases` (ability `purchases:read`)
- **Permission** : `purchases:read` + `purchases` / view
- **Erreurs** : `forbidden`.

### `purchase_get` — read
- **Description** : Détail d'une commande fournisseur avec ses lignes (quantités
  commandées / reçues).
- **Input** : `{ purchase_id: number }`
- **Output** : la commande + `items` `[{ product_id, product_name, quantity_ordered, quantity_received, unit_price, total }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/purchases/{purchase}`
- **Permission** : `purchases:read` + `purchases` / view
- **Règles** : `404` si hors compte.
- **Erreurs** : `not_found`, `forbidden`.

### `purchase_create` — write (**engagement → confirmation humaine requise**)
- **Description** : Crée une commande fournisseur (engagement d'achat). N'augmente
  PAS encore le stock (c'est la réception qui le fait). **Confirmation requise.**
  Présenté au confirmateur : fournisseur, lignes, total, date prévue.
- **Input** : `{ supplier_id: number, shop_id: number, expected_date?: string, notes?: string, items: [{ product_id: number, quantity: number, unit_price: number }] }`
- **Output** : `{ purchase_id, reference, total, status: "ordered" }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/purchases` (ability `purchases:write`)
- **Permission** : `purchases:write` + `purchases` / create
- **Règles** : fournisseur lié au compte ; produits du compte ; total recalculé serveur.
- **Erreurs** : `confirmation_required`, `supplier_not_found`, `product_not_found`, `validation_error`, `forbidden`.

### `purchase_receive` — write (**engagement stock → confirmation humaine requise**)
- **Description** : Réceptionne (tout ou partie d') une commande fournisseur :
  **augmente le stock** des produits reçus. **Confirmation explicite requise.**
  Présenté au confirmateur : commande, produits et quantités reçues.
- **Input** : `{ purchase_id: number, items: [{ product_id: number, quantity_received: number }] }`
- **Output** : `{ purchase_id, status: "received"|"partially_received", stock_movements: [{ product_id, quantity }] }`
- **Endpoint** : ⚠️ à créer — `POST /api/v1/purchases/{purchase}/receive` (abilities `purchases:write` + `stock-movements:write`)
- **Permission** : `purchases` / edit + `stocks` / edit
- **Règles** : chaque réception passe par `StockMovementService` (type `in`) ;
  `quantity_received` ≤ `quantity_ordered` restant ; confirmation obligatoire.
- **Erreurs** : `confirmation_required`, `not_found`, `over_receipt`, `forbidden`.

---

## Domaine 8 — `finance_*` (Finance)

> **En clair.** Ces outils donnent la **santé financière** : chiffre d'affaires,
> **marge et bénéfice**, trésorerie, dépenses. C'est de la lecture, mais **sensible**
> — un employé de boutique ne doit PAS y accéder (règle appliquée par les permissions
> et par le choix des tools donnés à chaque agent, Passe 3). ⚠️ À construire côté API.

### `finance_revenue` — read
- **Description** : Chiffre d'affaires sur une période (ventes encaissées), avec
  ventilation optionnelle par jour/semaine/mois ou par boutique.
- **Input** : `{ from: string, to: string, shop_id?: number, group_by?: "day"|"week"|"month" }`
- **Output** : `{ revenue: number, series: [{ period, revenue }] }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/finance/revenue` (ability `finance:read`)
- **Permission** : `finance:read` + `analytics` / view
- **Erreurs** : `forbidden`.

### `finance_margin` — read
- **Description** : Marge et bénéfice sur une période (CA − coût d'achat − dépenses).
  **Donnée sensible** : marge par produit/global. Réservé aux rôles de direction.
- **Input** : `{ from: string, to: string, shop_id?: number, by_product?: boolean }`
- **Output** : `{ revenue, cost_of_goods, gross_margin, expenses, net_profit, by_product?: [{ product_id, name, margin }] }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/finance/margin` (ability `finance:read`)
- **Permission** : `finance:read` + `analytics` / view
- **Règles** : calculs serveur à partir des prix d'achat réels ; jamais exposé à un
  token dépourvu de l'ability `finance:read`.
- **Erreurs** : `forbidden`.

### `finance_cashflow` — read
- **Description** : Aperçu de trésorerie sur une période : entrées (encaissements) −
  sorties (dépenses, achats payés).
- **Input** : `{ from: string, to: string, shop_id?: number }`
- **Output** : `{ inflows: number, outflows: number, net: number }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/finance/cashflow` (ability `finance:read`)
- **Permission** : `finance:read` + `analytics` / view
- **Erreurs** : `forbidden`.

### `finance_expenses` — read
- **Description** : Liste et total des dépenses sur une période, par catégorie.
- **Input** : `{ from?: string, to?: string, category?: string, shop_id?: number, per_page?: number }`
- **Output** : liste paginée de `{ id, title, amount, category, expense_date, payment_method }` + `{ total }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/finance/expenses` (ability `finance:read`)
- **Permission** : `finance:read` + `expenses` / view
- **Erreurs** : `forbidden`.

### `finance_expense_create` — write (confirmation NON requise par défaut)
- **Description** : Enregistre une dépense. Écriture financière mais sans document
  émis à un tiers ; la confirmation peut rester recommandée pour les montants élevés
  (seuil à définir en Passe 3).
- **Input** : `{ title: string, amount: number, category: string, shop_id: number, expense_date?: string, payment_method?: string, notes? }`
- **Output** : l'objet dépense créé + `201`.
- **Endpoint** : ⚠️ à créer — `POST /api/v1/finance/expenses` (ability `finance:write` à ajouter)
- **Permission** : `finance:write` + `expenses` / create
- **Règles** : `shop_id` du compte ; montant > 0.
- **Erreurs** : `validation_error`, `forbidden`.

---

## Domaine 9 — `analytics_*` (Statistiques & KPI)

> **En clair.** Ces outils donnent des **indicateurs et rapports** : meilleurs
> produits, meilleurs clients, tendances. Utile pour les recommandations de l'IA.
> Lecture seule. ⚠️ À construire (il existe un `AnalyticsController` côté web à
> exposer proprement en API v1).

### `analytics_dashboard` — read
- **Description** : Indicateurs clés d'une période : CA, nombre de ventes, panier
  moyen, nouveaux clients, produits en rupture. Vue de synthèse.
- **Input** : `{ from: string, to: string, shop_id?: number }`
- **Output** : `{ revenue, sales_count, average_basket, new_customers, low_stock_count }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/analytics/dashboard` (ability `analytics:read`)
- **Permission** : `analytics:read` + `analytics` / view
- **Note** : les KPI purement financiers (marge) restent dans `finance_*`.
- **Erreurs** : `forbidden`.

### `analytics_top_products` — read
- **Description** : Produits les plus vendus sur une période (quantité ou CA).
- **Input** : `{ from: string, to: string, metric?: "quantity"|"revenue", limit?: number, shop_id?: number }`
- **Output** : `[{ product_id, name, sku, quantity_sold, revenue }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/analytics/top-products` (ability `analytics:read`)
- **Permission** : `analytics:read` + `analytics` / view
- **Erreurs** : `forbidden`.

### `analytics_top_customers` — read
- **Description** : Meilleurs clients par volume d'achat sur une période.
- **Input** : `{ from: string, to: string, limit?: number, shop_id?: number }`
- **Output** : `[{ customer_id, name, total_purchases, orders }]`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/analytics/top-customers` (ability `analytics:read`)
- **Permission** : `analytics:read` + `analytics` / view
- **Erreurs** : `forbidden`.

---

## Domaine 10 — `company_*` (Entreprise / Configuration)

> **En clair.** Ces outils donnent le **contexte de l'entreprise** : les boutiques,
> la devise, le taux de taxe par défaut, les infos de la boutique. Ça aide l'IA à
> répondre juste (bonne devise, bon nom). Lecture surtout ; la modification des
> paramètres reste sensible et réservée au propriétaire.

### `company_context` — read
- **Description** : Contexte du compte connecté : boutiques accessibles, devise,
  taux de taxe par défaut, coordonnées. À appeler en début de conversation pour
  cadrer les réponses (devise, préfixes de facture…).
- **Input** : `{ }`
- **Output** : `{ account_code, shops: [{ id, name, city, currency, default_tax_rate, invoice_prefix }] }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/company/context` (ability `company:read`) — peut réutiliser `GET /api/v1/me`
- **Permission** : `company:read` (tout utilisateur authentifié du compte)
- **Règles** : ne renvoie que les boutiques accessibles au token.
- **Erreurs** : `unauthorized`.

### `company_shop_get` — read
- **Description** : Détail d'une boutique (coordonnées, devise, paramètres de facturation).
- **Input** : `{ shop_id: number }`
- **Output** : `{ id, name, address, city, country, phone, email, currency, default_tax_rate, invoice_prefix, invoice_footer }`
- **Endpoint** : ⚠️ à créer — `GET /api/v1/company/shops/{shop}` (ability `company:read`)
- **Permission** : `company:read` + `shops` / view
- **Règles** : `403`/`404` si la boutique n'appartient pas au compte.
- **Erreurs** : `not_found`, `forbidden`.

### `company_update_settings` — write (confirmation recommandée)
- **Description** : Modifie des paramètres non critiques d'une boutique (pied de
  facture, taux de taxe par défaut, coordonnées). **Réservé au propriétaire** ; les
  changements impactant la facturation méritent une confirmation.
- **Input** : `{ shop_id: number, default_tax_rate?: number, invoice_prefix?: string, invoice_footer?: string, phone?: string, email?: string, address? }`
- **Output** : la boutique mise à jour.
- **Endpoint** : ⚠️ à créer — `PUT /api/v1/company/shops/{shop}` (ability `company:write` à ajouter)
- **Permission** : `company:write` + `settings` / edit (rôle propriétaire)
- **Règles** : boutique du compte ; champs sensibles (devise) exclus de ce tool.
- **Erreurs** : `not_found`, `validation_error`, `forbidden`.

---

## Récapitulatif global : endpoints & abilities à créer (domaines 1-10)

| Domaine | Endpoints à créer | Abilities à ajouter |
|---|---|---|
| customer | `GET /customers/{id}/history` | — |
| stock | `GET /stock/levels`, `GET /stock/alerts`, `POST /stock/adjustments` | `stock-movements:write` |
| sales | `GET /sales/summary` | — |
| quote | `GET/POST /quotes`, `GET/PUT /quotes/{id}`, `POST /quotes/{id}/convert` | `quotes:read`, `quotes:write` |
| invoice | `GET /invoices/unpaid`, `POST /invoices`, `POST /invoices/{id}/payment` | `invoices:write` |
| purchase | `GET /suppliers`, `GET/POST /purchases`, `GET /purchases/{id}`, `POST /purchases/{id}/receive` | `purchases:read`, `purchases:write` |
| finance | `GET /finance/{revenue,margin,cashflow,expenses}`, `POST /finance/expenses` | `finance:read`, `finance:write` |
| analytics | `GET /analytics/{dashboard,top-products,top-customers}` | `analytics:read` |
| company | `GET /company/context`, `GET/PUT /company/shops/{id}` | `company:read`, `company:write` |

**Liste complète des abilities à ajouter à `ApiTokenController::ABILITIES`** :
`stock-movements:write`, `quotes:read`, `quotes:write`, `invoices:write`,
`purchases:read`, `purchases:write`, `finance:read`, `finance:write`,
`analytics:read`, `company:read`, `company:write`.

**Récap des tools par catégorie** : 22 tools `read` (exécution directe) · 6 écritures
sans engagement (`customer_create/update`, `product_create/update`, `quote_create/update`,
`finance_expense_create`) · 9 écritures **avec confirmation humaine** (`stock_adjust`,
`sales_create`, `quote_convert_to_invoice`, `invoice_create`, `invoice_mark_paid`,
`purchase_create`, `purchase_receive`, `company_update_settings`).

---

## Enveloppe d'erreur commune (rappel)

Toutes les réponses d'erreur v1 suivent une forme unique, mappée par le MCP en
erreur exploitable par le modèle **sans fuite d'information** :

```json
{ "error": { "code": "insufficient_stock",
             "message": "Stock insuffisant pour un ou plusieurs produits.",
             "details": { } } }
```

Codes normalisés : `unauthorized`, `forbidden`, `not_found`, `validation_error`,
`confirmation_required`, `rate_limited`, `subscription_required`,
`customer_not_found`, `product_not_found`, `supplier_not_found`,
`insufficient_stock`, `over_receipt`, `quote_locked`, `quote_not_acceptable`,
`invoice_already_paid`. Versionnement : préfixe `/api/v1` ; toute rupture de
contrat passe par `/api/v2`.

---

✅ **Passe 2 complète** : les 10 domaines sont contractualisés. Étape suivante
(Passe 3) : modèle de données des tables nouvelles (confirmations, audit IA, tokens
MCP, rate limiting) et définition des **5 agents IA** avec, pour chacun, la liste
explicite des tools autorisés parmi ceux ci-dessus.
