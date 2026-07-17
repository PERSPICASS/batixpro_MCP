Agis comme un architecte logiciel senior spécialisé en SaaS ERP, Model Context Protocol (MCP), IA Agentique et architectures multi-tenant.

Tu dois concevoir le MCP officiel de BATIXPRO.

CONTEXTE :

BATIXPRO est un ERP SaaS de gestion pour les quincailleries et PME africaines.

Technologies actuelles :
- Backend : Laravel 12
- Base de données : PostgreSQL
- Authentification : Laravel Sanctum
- Frontend : React / Next.js
- UI : Tailwind CSS
- Infrastructure : Docker + VPS Linux + Traefik

BATIXPRO gère actuellement :
- Entreprises
- Boutiques
- Dépôts
- Utilisateurs
- Rôles et permissions
- Produits
- Catégories
- Stock
- Inventaire
- Ventes
- Clients
- Fournisseurs
- Achats
- Devis
- Factures
- Paiements
- Crédit client
- Dépenses
- Rapports
- Statistiques
- Tableau de bord
- Notifications
- Documents PDF


OBJECTIF :

Créer un MCP BATIXPRO permettant à des assistants IA d'interagir avec l'ERP.

L'IA doit pouvoir :
- comprendre les données métier ;
- répondre aux questions des dirigeants ;
- analyser les performances ;
- créer des documents ;
- effectuer des opérations autorisées ;
- automatiser les tâches répétitives ;
- proposer des recommandations.


CONÇOIS UNE ARCHITECTURE MCP COMPLÈTE AVEC :

1. ARCHITECTURE GÉNÉRALE

Décris :
- architecture du MCP BATIXPRO ;
- organisation des services ;
- communication entre MCP et Laravel API ;
- gestion du contexte utilisateur ;
- gestion multi-entreprise (multi-tenant) ;
- sécurité ;
- authentification ;
- permissions.


2. DÉCOUPAGE DES MCP MÉTIERS

Créer les MCP suivants :

MCP Auth
- authentification
- utilisateur connecté
- rôles
- permissions

MCP Entreprise
- informations entreprise
- configuration
- paramètres

MCP Client
- rechercher un client
- créer/modifier client
- historique achat
- dette client
- comportement client

MCP Produit
- catalogue produits
- prix
- catégories
- recherche produit

MCP Stock
- quantité disponible
- mouvements de stock
- alertes rupture
- inventaire

MCP Vente
- ventes réalisées
- tickets
- commandes
- performances commerciales

MCP Devis
- création devis
- modification
- validation
- conversion en facture

MCP Facturation
- création facture
- paiement
- facture impayée
- relance

MCP Achat
- fournisseurs
- commandes fournisseurs
- réception marchandises

MCP Finance
- chiffre d'affaires
- marge
- bénéfice
- trésorerie
- dépenses

MCP Analytics
- statistiques
- rapports
- indicateurs KPI


3. POUR CHAQUE MCP

Définis :

- Les ressources MCP exposées
- Les tools disponibles
- Les paramètres JSON
- Les réponses JSON
- Les règles métier
- Les permissions nécessaires

Exemple :

Tool :
create_invoice

Input :
{
 customer_id: number,
 products: [
   {
     product_id:number,
     quantity:number
   }
 ]
}

Output :
{
 invoice_id:number,
 status:string,
 pdf_url:string
}


4. CRÉER LES AGENTS IA BATIXPRO

Conçois :

Agent Directeur Général IA :
- analyse globale de l'entreprise
- recommandations stratégiques

Agent Commercial IA :
- analyse ventes
- suivi clients
- opportunités commerciales

Agent Stock IA :
- prévention rupture
- suggestions commandes

Agent Finance IA :
- analyse rentabilité
- trésorerie
- anomalies

Agent Assistant Boutique IA :
- aide quotidienne aux employés


Pour chaque agent indique :
- objectif
- MCP utilisés
- outils accessibles
- exemples de conversations.


5. BASE DE DONNÉES

Propose :
- tables nécessaires
- relations
- index
- gestion tenant_id
- stratégie d'isolation des données.


6. API ENTRE BATIXPRO ET MCP

Décris :
- endpoints nécessaires
- authentification API
- format des échanges
- gestion des erreurs
- logs.


7. SÉCURITÉ

Inclure :
- isolation des entreprises
- contrôle accès données
- validation actions sensibles
- audit des actions IA
- limitation des appels
- protection contre les injections.


8. STACK TECHNIQUE DU MCP

Propose :
- langage recommandé
- framework MCP
- architecture projet
- structure des dossiers
- Dockerisation
- déploiement sur VPS.


9. EXEMPLES RÉELS D'UTILISATION

Créer au moins 15 scénarios :

Exemple :

Utilisateur :
"Donne-moi mes ventes du mois"

L'IA :
- appelle MCP Analytics
- récupère les données
- analyse
- répond.


Utilisateur :
"Crée un devis pour 100 sacs de ciment pour le client Kouassi"

L'IA :
- recherche client
- recherche produit
- calcule montant
- crée devis.


10. ROADMAP DE DÉVELOPPEMENT

Créer une roadmap :

Phase 1 :
MCP Core BATIXPRO
- Auth
- Clients
- Produits
- Stock
- Ventes

Phase 2 :
Agents IA métier
- Finance
- Commercial
- Stock

Phase 3 :
IA autonome
- recommandations
- automatisations
- prédictions.


Le résultat attendu doit être un document d'architecture professionnel permettant à une équipe technique de développer le MCP BATIXPRO.