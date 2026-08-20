# Boutique Shopify NFC — clé en main

Boutique complète pour vendre des plaques, cartes et badges NFC : thème Shopify prêt à importer,
catalogue produits, 7 pages, menus et collection.

**Chemin le plus court : 3 étapes, environ 5 minutes.**

```
1. Importer  dist/nfc-store-theme.zip   dans Shopify, puis le publier
2. Créer un jeton Admin API             (voir § 2 ci-dessous)
3. node scripts/setup-shopify.mjs       → produits, pages, menus, collection
```

---

## Contenu du dossier

| Fichier / dossier | Rôle |
|---|---|
| `dist/nfc-store-theme.zip` | **Le thème à importer.** Dawn 16.0.0 + design de marque + page d'accueil complète. 1 Mo. |
| `theme/` | Le code source du thème (à modifier si vous voulez retoucher le code). |
| `scripts/build-theme.sh` | Regénère le ZIP après une modification de `theme/`. |
| `scripts/setup-shopify.mjs` | **Le script tout-en-un** : crée produits, collection, pages, menus, et publie. |
| `data/products.csv` | Les 3 produits au format d'import Shopify (voie manuelle, si vous n'utilisez pas le script). |
| `data/pages.csv` | Les 7 pages au format Matrixify (voie manuelle). |
| `data/pages.json` | Source de vérité des pages, lue par le script. |
| `pages/*.html` | Le corps HTML de chaque page, à copier-coller dans l'admin en dernier recours. |

---

## 1. Importer et publier le thème

1. Admin Shopify → **Boutique en ligne** → **Thèmes**.
2. **Ajouter un thème** → **Importer un fichier ZIP** → choisir `dist/nfc-store-theme.zip`.
3. Une fois importé : **⋯** → **Publier**.

La page d'accueil s'affiche immédiatement avec tous ses textes, ses visuels placeholder et une barre
de navigation fonctionnelle — même avant la création des produits et des pages.

## 2. Créer un jeton Admin API

1. Admin Shopify → **Paramètres** → **Applications et canaux de vente** → **Développer des applications**.
2. **Créer une application** → nommez-la par exemple « Setup NFC ».
3. Onglet **Configuration** → **Admin API** → cochez ces autorisations :

   ```
   write_products              read_products
   write_online_store_pages    write_online_store_navigation
   write_publications          read_publications
   ```

   *(si `write_online_store_pages` n'apparaît pas, prenez `write_content`)*
4. **Enregistrer** → onglet **Identifiants API** → **Installer l'application**.
5. Copiez le **jeton d'accès Admin API** (commence par `shpat_`). Il ne s'affiche qu'une fois.

## 3. Lancer le script

Node 18 ou plus récent, aucune dépendance à installer.

```bash
cd shopify-nfc-store

# Vérifier ce qui va être créé, sans rien envoyer :
node scripts/setup-shopify.mjs --dry-run

# Appliquer :
SHOPIFY_STORE_DOMAIN=ma-boutique.myshopify.com \
SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxx \
node scripts/setup-shopify.mjs
```

Le script crée, dans l'ordre :

- **3 produits** — prix, prix barré, SKU, poids, tags, SEO et images ;
- **la collection** « Produits phares » contenant les 3 produits ;
- **7 pages** avec le bon gabarit de thème ;
- **les menus** `main-menu` (en-tête) et `footer` (pied de page) ;
- **la publication** des produits et de la collection sur le canal Boutique en ligne.

Il est **idempotent** : relancé, il ne duplique rien. Utilisez `--force-update` pour écraser
le contenu existant, `--skip-products` pour ne traiter que les pages et les menus.

---

## Voie manuelle (sans script)

Si vous préférez tout faire depuis l'admin :

| Élément | Où | Fichier |
|---|---|---|
| Produits | Produits → Importer | `data/products.csv` |
| Pages | Nécessite l'app **Matrixify** → Import | `data/pages.csv` |
| Pages (sans app) | Boutique en ligne → Pages → Ajouter, puis coller en mode `</>` | `pages/*.html` |
| Menus | Boutique en ligne → Navigation | voir le tableau ci-dessous |

Gabarits de page à sélectionner après création manuelle (champ « Modèle de thème ») :

| Page | Gabarit |
|---|---|
| comment-ca-marche, pourquoi-nous-choisir, faq, cgv, confidentialite | `page.nfc` |
| contact | `page.contact` |
| mini-site-nfc | `page.mini-site` |

Menus à recréer à la main :

- **main-menu** — Accueil `/` · Boutique `/collections/produits-phares` · Comment ça marche
  `/pages/comment-ca-marche` · Pourquoi nous choisir `/pages/pourquoi-nous-choisir` · FAQ `/pages/faq` ·
  Contact `/pages/contact`
- **footer** — FAQ · Contact · CGV `/pages/cgv` · Confidentialité `/pages/confidentialite` ·
  Mini-site NFC `/pages/mini-site-nfc`

> Le thème embarque une barre de navigation propre (section « Navigation rapide », sous l'en-tête)
> dont les liens sont écrits en dur. La boutique reste donc navigable même si les menus Shopify
> ne sont pas configurés.

---

## À personnaliser avant d'ouvrir

### Textes à remplacer

| Marqueur | Où le trouver |
|---|---|
| `[NOM_MARQUE]` | `data/products.csv` (colonne Vendor) · `data/pages.json` · pied de page du thème |
| `contact@exemple.fr` | pages contact / CGV / confidentialité · pied de page |
| `+33 X XX XX XX XX` | page contact · pied de page |
| `[ADRESSE]`, `[SIRET]`, `[N° TVA]` | pages CGV et confidentialité |
| `[NOM_DU_MEDIATEUR]`, `[DATE]` | page CGV |

Le plus simple : lancer le script d'abord, puis corriger ces mentions directement dans l'admin
Shopify (Pages, et Boutique en ligne → Thèmes → Personnaliser → Pied de page).

### Visuels à remplacer

Tous les visuels livrés sont des **placeholders**. La boutique fonctionne, mais n'est pas
commercialisable en l'état.

| Visuel | Dimensions | Où le remplacer |
|---|---|---|
| Hero page d'accueil | 1920 × 1080 | Personnaliser → section **Hero NFC** → Image de fond |
| Photos produits (×3) | 1200 × 1200 | Produits → chaque produit → Médias |
| Photos en situation | 1200 × 800 | idem (2ᵉ et 3ᵉ image de chaque produit) |
| Capture du tableau de bord | 1200 × 800 | 3ᵉ image de la Plaque Avis Google |
| Icônes (NFC, QR, sans abonnement, dashboard, Europe) | 64 × 64 | `theme/assets/nfc-icon-*.svg`, puis regénérer le ZIP |

Les images produits pointent vers `placehold.co` : Shopify les télécharge et les héberge à l'import,
il n'y a donc **aucune dépendance externe** une fois la boutique en ligne.

### Réglages Shopify restants

Ces points ne relèvent ni du thème ni de l'API, ils se règlent dans l'admin :

- **Paiements** — Paramètres → Paiements (activer Shopify Payments ou un autre fournisseur).
- **Livraison** — Paramètres → Livraison (créer un tarif « offert dès 3 plaques »).
- **Taxes** — Paramètres → Taxes et droits de douane.
- **Langue** — Paramètres → Langues : le thème est livré en français par défaut.
- **Devise** — Paramètres → Général : le thème affiche les prix dans la devise de la boutique ;
  le CSV est libellé en euros.
- **Suivi des stocks** — le script crée les produits sans suivi de stock (vente toujours possible).
  L'import CSV, lui, initialise 100 unités avec survente autorisée.

---

## Design

| Élément | Valeur |
|---|---|
| Thème de base | Dawn 16.0.0 (MIT, `Shopify/dawn`) |
| Bleu primaire | `#2563EB` |
| Gris foncé | `#1E293B` |
| Vert accent | `#10B981` |
| Fonds | `#FFFFFF` et `#F8FAFC` |
| Titres | Poppins |
| Corps | Inter |

Les couleurs vivent dans `theme/config/settings_data.json` (jeux de couleurs `scheme-1` à `scheme-5`),
le reste du style de marque dans `theme/assets/nfc-custom.css`. Les polices sont chargées depuis
Google Fonts en tête de ce fichier ; pour supprimer cette requête externe, retirez le `@import` et les
deux variables `--font-*-family`, le thème reprendra la police native Shopify.

### Sections sur mesure ajoutées à Dawn

| Section | Fichier |
|---|---|
| Hero NFC | `theme/sections/nfc-hero.liquid` |
| Bandeau réassurance | `theme/sections/nfc-trust-badges.liquid` |
| Arguments NFC (étapes numérotées ou icônes) | `theme/sections/nfc-features.liquid` |
| Produits phares NFC | `theme/sections/nfc-product-highlights.liquid` |
| Témoignages NFC | `theme/sections/nfc-testimonials.liquid` |
| Navigation rapide | `theme/sections/nfc-quick-nav.liquid` |

La FAQ et le bloc CTA final utilisent les sections natives de Dawn (`collapsible-content`, `rich-text`),
et sont donc modifiables directement dans l'éditeur de thème.

Après toute modification de `theme/`, régénérez le ZIP :

```bash
./scripts/build-theme.sh
```

---

## Structure de la page d'accueil

1. Hero — « Récoltez des avis Google sans demander. »
2. Bandeau — Sans abonnement · Installé en 10 secondes · Livraison offerte dès 3 plaques
3. Comment ça marche — 3 étapes numérotées
4. Pourquoi nous choisir — 4 arguments avec icônes
5. Produits phares — 3 cartes avec badges Meilleure vente / Nouveau / Populaire
6. Témoignages — Sophie (Lyon) et Marc (Bordeaux)
7. FAQ — 5 questions dépliables
8. CTA final — « Vos clients sont devant vous. Transformez ça en résultat. »

Chaque section reste éditable dans **Personnaliser**, sans toucher au code.

---

## Points d'attention

- **Les CGV et la politique de confidentialité sont des modèles génériques.** Ils citent le droit
  français mais doivent être relus par un juriste et complétés avec vos informations réelles avant
  toute mise en vente.
- **Les témoignages sont fictifs.** Remplacez-les par de vrais avis clients : publier de faux
  témoignages est une pratique commerciale trompeuse.
- **Les mentions « Fabriqué en Europe », « garantie 2 ans » et « livraison 24-48 h »** doivent
  correspondre à votre réalité fournisseur.

## Liens utiles

- Thème Dawn — https://github.com/Shopify/dawn
- Format du CSV produits Shopify — https://help.shopify.com/fr/manual/products/import-export/using-csv
- Admin API GraphQL — https://shopify.dev/docs/api/admin-graphql
- Matrixify (import de pages) — https://apps.shopify.com/excel-export-import
