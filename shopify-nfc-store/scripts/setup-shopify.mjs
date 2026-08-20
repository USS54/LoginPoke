#!/usr/bin/env node
/**
 * Configure une boutique Shopify de A a Z via l'Admin API GraphQL :
 *   1. cree les 3 produits NFC (prix, SKU, poids, SEO, images) ;
 *   2. cree la collection « Produits phares » et y range les 3 produits ;
 *   3. cree les 7 pages (FAQ, CGV, contact...) avec le bon gabarit de theme ;
 *   4. remplit les menus « main-menu » (en-tete) et « footer » (pied de page) ;
 *   5. publie produits et collection sur la Boutique en ligne.
 *
 * Aucune dependance : Node 18+ suffit (fetch natif).
 *
 * Usage :
 *   SHOPIFY_STORE_DOMAIN=ma-boutique.myshopify.com \
 *   SHOPIFY_ADMIN_TOKEN=shpat_xxx \
 *   node scripts/setup-shopify.mjs [--dry-run] [--force-update] [--skip-products]
 *
 * Permissions requises sur l'app privee (Admin > Applications > Developper des applications) :
 *   write_products, read_products,
 *   write_online_store_pages (ou write_content),
 *   write_online_store_navigation,
 *   write_publications, read_publications
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const FORCE_UPDATE = ARGS.has('--force-update');
const SKIP_PRODUCTS = ARGS.has('--skip-products');

const SHOP = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION_ENV = process.env.SHOPIFY_API_VERSION;

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

const log = (...a) => console.log(...a);
const step = (n, t) => log(`\n${c.b(`[${n}]`)} ${c.b(t)}`);

if (!DRY_RUN && (!SHOP || !TOKEN)) {
  console.error(
    c.err('\nIl manque les variables d\'environnement.\n') +
      '\n  SHOPIFY_STORE_DOMAIN  ex. ma-boutique.myshopify.com' +
      '\n  SHOPIFY_ADMIN_TOKEN   ex. shpat_xxxxxxxxxxxxxxxx\n' +
      '\nUtilisez --dry-run pour voir ce que le script ferait sans rien envoyer.\n'
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ donnees */

const pages = JSON.parse(readFileSync(join(ROOT, 'data', 'pages.json'), 'utf8'));

/** Lecture minimale de products.csv (gere les champs entre guillemets). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** Regroupe les lignes du CSV (1 produit + N lignes d'images) en objets produit. */
function productsFromCsv() {
  const rows = parseCsv(readFileSync(join(ROOT, 'data', 'products.csv'), 'utf8'));
  const byHandle = new Map();
  for (const r of rows) {
    if (r.Title) {
      byHandle.set(r.Handle, {
        handle: r.Handle,
        title: r.Title,
        descriptionHtml: r['Body (HTML)'],
        vendor: r.Vendor,
        productType: r.Type,
        tags: r.Tags.split(';').map((t) => t.trim()).filter(Boolean),
        sku: r['Variant SKU'],
        grams: Number(r['Variant Grams'] || 0),
        price: r['Variant Price'],
        compareAtPrice: r['Variant Compare At Price'] || null,
        seo: { title: r['SEO Title'], description: r['SEO Description'] },
        media: [],
      });
    }
    if (r['Image Src']) {
      byHandle.get(r.Handle)?.media.push({
        originalSource: r['Image Src'],
        alt: r['Image Alt Text'] || '',
        mediaContentType: 'IMAGE',
      });
    }
  }
  return [...byHandle.values()];
}

const COLLECTION = {
  handle: 'produits-phares',
  title: 'Produits phares',
  descriptionHtml:
    '<p>Trois supports, une seule technologie. Plaque pour les avis Google, carte pour votre mini-site, ' +
    'badge pour vous suivre partout. Sans abonnement.</p>',
};

/* --------------------------------------------------------------- transport */

let apiVersion = API_VERSION_ENV || '2026-01';

async function pickApiVersion() {
  if (API_VERSION_ENV || DRY_RUN) return;
  try {
    const res = await fetch(`https://${SHOP}/admin/api/api_versions.json`, {
      headers: { 'X-Shopify-Access-Token': TOKEN },
    });
    if (!res.ok) return;
    const { api_versions: versions = [] } = await res.json();
    const stable = versions
      .map((v) => v.handle)
      .filter((h) => /^\d{4}-\d{2}$/.test(h))
      .sort();
    if (stable.length) {
      apiVersion = stable[stable.length - 1];
      log(c.dim(`  version d'API detectee : ${apiVersion}`));
    }
  } catch {
    /* on garde la version par defaut */
  }
}

async function gql(query, variables = {}, { retries = 3 } = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (retries > 0) {
      const wait = (4 - retries) * 2000 + 1000;
      log(c.dim(`  ${res.status} — nouvelle tentative dans ${wait / 1000}s`));
      await new Promise((r) => setTimeout(r, wait));
      return gql(query, variables, { retries: retries - 1 });
    }
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${text.slice(0, 400)}`);

  const json = JSON.parse(text);
  if (json.errors) throw new Error(`GraphQL : ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json.data;
}

/** Leve une erreur lisible si la mutation renvoie des userErrors. */
function check(payload, label) {
  const errors = payload?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`${label} : ${errors.map((e) => `${(e.field || []).join('.')} ${e.message}`).join(' | ')}`);
  }
  return payload;
}

/* ------------------------------------------------------------------ requetes */

const Q_PAGE_BY_HANDLE = `query($q: String!) {
  pages(first: 1, query: $q) { nodes { id handle title } }
}`;

const M_PAGE_CREATE = `mutation($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle } userErrors { field message } }
}`;

const M_PAGE_UPDATE = `mutation($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) { page { id handle } userErrors { field message } }
}`;

const Q_PRODUCT_BY_HANDLE = `query($handle: String!) {
  productByHandle(handle: $handle) {
    id handle
    variants(first: 1) { nodes { id } }
  }
}`;

const M_PRODUCT_CREATE = `mutation($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product { id handle variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`;

const M_PRODUCT_CREATE_LEGACY = `mutation($input: ProductInput!) {
  productCreate(input: $input) {
    product { id handle variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`;

const M_VARIANTS_UPDATE = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id sku price }
    userErrors { field message }
  }
}`;

const M_MEDIA_CREATE = `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { alt }
    mediaUserErrors { field message }
  }
}`;

const Q_COLLECTION_BY_HANDLE = `query($handle: String!) {
  collectionByHandle(handle: $handle) { id handle }
}`;

const M_COLLECTION_CREATE = `mutation($input: CollectionInput!) {
  collectionCreate(input: $input) { collection { id handle } userErrors { field message } }
}`;

const M_COLLECTION_ADD = `mutation($id: ID!, $productIds: [ID!]!) {
  collectionAddProducts(id: $id, productIds: $productIds) {
    collection { id } userErrors { field message }
  }
}`;

const Q_MENUS = `query { menus(first: 50) { nodes { id handle title } } }`;

const M_MENU_UPDATE = `mutation($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
  menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
    menu { id handle } userErrors { field message }
  }
}`;

const M_MENU_CREATE = `mutation($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
  menuCreate(title: $title, handle: $handle, items: $items) {
    menu { id handle } userErrors { field message }
  }
}`;

const Q_PUBLICATIONS = `query { publications(first: 20) { nodes { id name } } }`;

const M_PUBLISH = `mutation($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) { userErrors { field message } }
}`;

/* -------------------------------------------------------------------- etapes */

async function ensureProducts() {
  const wanted = productsFromCsv();
  const result = new Map();

  for (const p of wanted) {
    const existing = await gql(Q_PRODUCT_BY_HANDLE, { handle: p.handle });
    if (existing.productByHandle && !FORCE_UPDATE) {
      log(`  ${c.warn('existe deja')} ${p.handle} ${c.dim('(--force-update pour re-creer les variantes)')}`);
      result.set(p.handle, existing.productByHandle.id);
      continue;
    }

    let product = existing.productByHandle;
    if (!product) {
      const input = {
        title: p.title,
        handle: p.handle,
        descriptionHtml: p.descriptionHtml,
        vendor: p.vendor,
        productType: p.productType,
        tags: p.tags,
        status: 'ACTIVE',
        seo: p.seo,
      };
      let data;
      try {
        data = check((await gql(M_PRODUCT_CREATE, { product: input })).productCreate, 'productCreate');
      } catch (e) {
        // Versions d'API anterieures a 2025-01 : l'argument s'appelle « input ».
        if (!/ProductCreateInput|Unknown argument|not defined/i.test(String(e))) throw e;
        data = check((await gql(M_PRODUCT_CREATE_LEGACY, { input })).productCreate, 'productCreate');
      }
      product = data.product;
      log(`  ${c.ok('cree')} ${p.handle}`);
    }

    const variantId = product.variants.nodes[0]?.id;
    if (variantId) {
      check(
        (
          await gql(M_VARIANTS_UPDATE, {
            productId: product.id,
            variants: [
              {
                id: variantId,
                price: p.price,
                compareAtPrice: p.compareAtPrice,
                inventoryPolicy: 'CONTINUE',
                inventoryItem: {
                  sku: p.sku,
                  tracked: false,
                  requiresShipping: true,
                  measurement: { weight: { value: p.grams, unit: 'GRAMS' } },
                },
              },
            ],
          })
        ).productVariantsBulkUpdate,
        'productVariantsBulkUpdate'
      );
      log(`    prix ${p.price} € ${p.compareAtPrice ? `(barre ${p.compareAtPrice} €) ` : ''}· SKU ${p.sku} · ${p.grams} g`);
    }

    if (p.media.length) {
      const media = await gql(M_MEDIA_CREATE, { productId: product.id, media: p.media });
      const errs = media.productCreateMedia.mediaUserErrors ?? [];
      if (errs.length) log(`    ${c.warn('images')} ${errs.map((e) => e.message).join(' | ')}`);
      else log(`    ${p.media.length} image(s) envoyee(s)`);
    }

    result.set(p.handle, product.id);
  }
  return result;
}

async function ensureCollection(productIds) {
  const found = await gql(Q_COLLECTION_BY_HANDLE, { handle: COLLECTION.handle });
  let id = found.collectionByHandle?.id;

  if (id) log(`  ${c.warn('existe deja')} ${COLLECTION.handle}`);
  else {
    const data = check(
      (await gql(M_COLLECTION_CREATE, { input: COLLECTION })).collectionCreate,
      'collectionCreate'
    );
    id = data.collection.id;
    log(`  ${c.ok('creee')} ${COLLECTION.handle}`);
  }

  if (productIds.length) {
    check((await gql(M_COLLECTION_ADD, { id, productIds })).collectionAddProducts, 'collectionAddProducts');
    log(`    ${productIds.length} produit(s) ajoute(s)`);
  }
  return id;
}

async function ensurePages() {
  const ids = new Map();
  for (const p of pages) {
    const found = await gql(Q_PAGE_BY_HANDLE, { q: `handle:${p.handle}` });
    const existing = found.pages.nodes[0];
    const payload = {
      title: p.title,
      handle: p.handle,
      body: p.body,
      isPublished: true,
      templateSuffix: p.suffix,
    };

    if (existing && !FORCE_UPDATE) {
      log(`  ${c.warn('existe deja')} /pages/${p.handle}`);
      ids.set(p.handle, existing.id);
      continue;
    }
    if (existing) {
      const data = check(
        (await gql(M_PAGE_UPDATE, { id: existing.id, page: payload })).pageUpdate,
        'pageUpdate'
      );
      ids.set(p.handle, data.page.id);
      log(`  ${c.ok('mise a jour')} /pages/${p.handle} ${c.dim(`(gabarit page.${p.suffix})`)}`);
    } else {
      const data = check((await gql(M_PAGE_CREATE, { page: payload })).pageCreate, 'pageCreate');
      ids.set(p.handle, data.page.id);
      log(`  ${c.ok('creee')} /pages/${p.handle} ${c.dim(`(gabarit page.${p.suffix})`)}`);
    }
  }
  return ids;
}

function buildMenus(productIds, collectionId, pageIds) {
  const page = (handle, title) => ({ title, type: 'PAGE', resourceId: pageIds.get(handle) });
  const product = (handle, title) => ({ title, type: 'PRODUCT', resourceId: productIds.get(handle) });

  const main = [
    { title: 'Accueil', type: 'FRONTPAGE' },
    {
      title: 'Boutique',
      type: 'COLLECTION',
      resourceId: collectionId,
      items: [
        product('plaques-avis-google-nfc', 'Plaque Avis Google NFC'),
        product('carte-de-visite-nfc', 'Carte de Visite NFC'),
        product('badge-nfc', 'Badge NFC'),
      ],
    },
    page('comment-ca-marche', 'Comment ça marche'),
    page('pourquoi-nous-choisir', 'Pourquoi nous choisir'),
    page('faq', 'FAQ'),
    page('contact', 'Contact'),
  ];

  const footer = [
    page('faq', 'FAQ'),
    page('contact', 'Contact'),
    page('cgv', 'Conditions générales de vente'),
    page('confidentialite', 'Politique de confidentialité'),
    page('mini-site-nfc', 'Mini-site NFC'),
  ];

  const clean = (items) =>
    items
      .filter((i) => i.type === 'FRONTPAGE' || i.resourceId)
      .map((i) => (i.items ? { ...i, items: clean(i.items) } : i));

  return { main: clean(main), footer: clean(footer) };
}

async function ensureMenus(items) {
  const { nodes } = (await gql(Q_MENUS)).menus;
  const targets = [
    { handle: 'main-menu', title: 'Menu principal', items: items.main },
    { handle: 'footer', title: 'Pied de page', items: items.footer },
  ];

  for (const t of targets) {
    const existing = nodes.find((m) => m.handle === t.handle);
    if (existing) {
      check(
        (await gql(M_MENU_UPDATE, { id: existing.id, title: t.title, handle: t.handle, items: t.items }))
          .menuUpdate,
        'menuUpdate'
      );
      log(`  ${c.ok('mis a jour')} ${t.handle} ${c.dim(`(${t.items.length} entrees)`)}`);
    } else {
      check((await gql(M_MENU_CREATE, { title: t.title, handle: t.handle, items: t.items })).menuCreate, 'menuCreate');
      log(`  ${c.ok('cree')} ${t.handle} ${c.dim(`(${t.items.length} entrees)`)}`);
    }
  }
}

async function publishAll(ids) {
  const { nodes } = (await gql(Q_PUBLICATIONS)).publications;
  const online = nodes.find((p) => /online store|boutique en ligne/i.test(p.name));
  if (!online) {
    log(`  ${c.warn('canal « Boutique en ligne » introuvable — publication a faire a la main')}`);
    return;
  }
  for (const id of ids) {
    const res = await gql(M_PUBLISH, { id, input: [{ publicationId: online.id }] });
    const errs = res.publishablePublish.userErrors ?? [];
    if (errs.length) log(`  ${c.warn('publication')} ${errs.map((e) => e.message).join(' | ')}`);
  }
  log(`  ${c.ok('publies')} ${ids.length} element(s) sur la Boutique en ligne`);
}

/* --------------------------------------------------------------------- main */

function dryRun() {
  log(c.b('\n=== MODE SIMULATION — aucun appel reseau ===\n'));
  const prods = productsFromCsv();
  log(c.b('Produits'));
  for (const p of prods) {
    log(`  ${p.handle}\n    ${p.title}\n    ${p.price} €${p.compareAtPrice ? ` (barre ${p.compareAtPrice} €)` : ''}` +
        ` · SKU ${p.sku} · ${p.grams} g · ${p.media.length} image(s) · tags: ${p.tags.join(', ')}`);
  }
  log(c.b('\nCollection'));
  log(`  ${COLLECTION.handle} — ${COLLECTION.title} (contiendra ${prods.length} produits)`);
  log(c.b('\nPages'));
  for (const p of pages) log(`  /pages/${p.handle}  ${c.dim(`gabarit page.${p.suffix}`)} — ${p.title}`);
  log(c.b('\nMenus'));
  log('  main-menu : Accueil · Boutique (3 produits) · Comment ça marche · Pourquoi nous choisir · FAQ · Contact');
  log('  footer    : FAQ · Contact · CGV · Confidentialité · Mini-site NFC');
  log(c.b('\nPublication'));
  log('  produits + collection publies sur le canal « Boutique en ligne »');
  log(c.dim('\nRelancez sans --dry-run avec SHOPIFY_STORE_DOMAIN et SHOPIFY_ADMIN_TOKEN pour appliquer.\n'));
}

async function main() {
  if (DRY_RUN) return dryRun();

  log(c.b(`\nConfiguration de ${SHOP}`));
  await pickApiVersion();

  let productIds = new Map();
  if (SKIP_PRODUCTS) {
    step(1, 'Produits — ignores (--skip-products)');
  } else {
    step(1, 'Produits');
    productIds = await ensureProducts();
  }

  step(2, 'Collection');
  const collectionId = await ensureCollection([...productIds.values()]);

  step(3, 'Pages');
  const pageIds = await ensurePages();

  step(4, 'Menus');
  await ensureMenus(buildMenus(productIds, collectionId, pageIds));

  step(5, 'Publication sur la Boutique en ligne');
  await publishAll([...productIds.values(), collectionId].filter(Boolean));

  log(c.ok(c.b('\n✓ Boutique configuree.')));
  log(`  Vitrine   https://${SHOP.replace('.myshopify.com', '')}.myshopify.com`);
  log(`  Admin     https://admin.shopify.com/store/${SHOP.replace('.myshopify.com', '')}\n`);
  log(c.dim('  Pensez a activer le theme importe (Boutique en ligne > Themes > Publier).\n'));
}

main().catch((e) => {
  console.error(c.err(`\n✗ ${e.message}\n`));
  process.exit(1);
});
