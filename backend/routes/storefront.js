function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function handlePublicStorefront(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/public\/stores\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== "GET") return json({error:"Method not allowed"},405);

  let slug;
  try {
    slug = decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return json({error:"Invalid store address"},400);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) {
    return json({error:"Store not found"},404);
  }

  try {
    const store = await env.DB.prepare(`
      SELECT
        s.id, s.name, s.slug, s.business_type, s.description,
        s.template_key, s.whatsapp_phone, s.customization_json
      FROM stores s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.slug = ?
        AND s.status = 'active'
        AND a.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM store_subscriptions ss
          WHERE ss.store_id = s.id
            AND ss.status = 'active'
            AND (ss.expires_at IS NULL OR ss.expires_at > CURRENT_TIMESTAMP)
        )
      LIMIT 1
    `).bind(slug).first();

    if (!store) return json({error:"Store is unavailable"},404);

    const [categoriesResult, productsResult, platformSettings, announcementsResult] = await Promise.all([
      env.DB.prepare(`
        SELECT id, parent_id, name, slug, description, sort_order
        FROM categories
        WHERE store_id = ?
        ORDER BY sort_order ASC, name COLLATE NOCASE ASC
      `).bind(store.id).all(),
      env.DB.prepare(`
        SELECT
          p.id, p.category_id, p.name, p.slug, p.description,
          p.product_type, p.base_price, p.compare_at_price,
          p.currency, p.sku, p.is_featured, p.stock_quantity,
          p.track_inventory
        FROM products p
        WHERE p.store_id = ?
          AND p.status = 'active'
          AND (
            p.track_inventory = 0
            OR p.stock_quantity > 0
            OR EXISTS (
              SELECT 1 FROM product_variants v
              WHERE v.product_id = p.id
                AND v.store_id = p.store_id
                AND v.status = 'active'
                AND v.stock_quantity > 0
            )
          )
        ORDER BY p.is_featured DESC, p.created_at DESC
        LIMIT 200
      `).bind(store.id).all(),
      env.DB.prepare("SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN (?,?,?)").bind("platform_footer_ar","platform_footer_en","platform_support_whatsapp").all(),
      env.DB.prepare("SELECT id,title_ar,title_en,message_ar,message_en,announcement_type FROM platform_announcements WHERE is_active=1 AND (starts_at IS NULL OR datetime(starts_at)<=CURRENT_TIMESTAMP) AND (ends_at IS NULL OR datetime(ends_at)>CURRENT_TIMESTAMP) ORDER BY created_at DESC LIMIT 10").bind().all()
    ]);

    const products = productsResult.results || [];
    const productIds = products.map(item => item.id);
    let variants = [];
    let productImages = [];
    if (productIds.length) {
      const placeholders = productIds.map(() => "?").join(",");
      const [variantResult, imageResult] = await Promise.all([
        env.DB.prepare(`
          SELECT id, product_id, name, price, stock_quantity, attributes_json
          FROM product_variants
          WHERE store_id = ?
            AND status = 'active'
            AND product_id IN (${placeholders})
          ORDER BY created_at ASC
        `).bind(store.id, ...productIds).all(),
        env.DB.prepare(`
          SELECT id, product_id, file_key, alt_text, sort_order
          FROM product_images
          WHERE store_id = ? AND product_id IN (${placeholders})
          ORDER BY sort_order ASC, created_at ASC
        `).bind(store.id, ...productIds).all()
      ]);
      variants = variantResult.results || [];
      productImages = imageResult.results || [];
    }

    const imagesByProduct = new Map();
    for (const image of productImages) {
      const list = imagesByProduct.get(image.product_id) || [];
      const expectedPrefix = "/media/" + store.id + "/";
      const isStoreMedia = typeof image.file_key === "string" && image.file_key.startsWith(expectedPrefix) &&
        /^\/media\/[a-zA-Z0-9_-]+\/[a-f0-9-]+\.(?:jpg|png|webp|gif)$/i.test(image.file_key);
      let isExternalHttps = false;
      try {
        const imageUrl = new URL(image.file_key);
        isExternalHttps = imageUrl.protocol === "https:" && !imageUrl.username && !imageUrl.password && image.file_key.length <= 2000;
      } catch {}
      if (isStoreMedia || isExternalHttps) {
        list.push({ id:image.id, url:image.file_key, alt_text:image.alt_text || "", sort_order:image.sort_order });
      }
      imagesByProduct.set(image.product_id, list);
    }

    const variantsByProduct = new Map();
    for (const variant of variants) {
      const list = variantsByProduct.get(variant.product_id) || [];
      let attributes = {};
      try { attributes = JSON.parse(variant.attributes_json || "{}"); } catch {}
      list.push({
        id:variant.id, name:variant.name, price:variant.price,
        stock_quantity:variant.stock_quantity, attributes
      });
      variantsByProduct.set(variant.product_id,list);
    }

    const orderSettings = await env.DB.prepare(`
      SELECT cash_on_delivery_enabled,shamcash_enabled,shamcash_recipient,shamcash_instructions
      FROM store_order_settings WHERE store_id=? LIMIT 1
    `).bind(store.id).first() || {
      cash_on_delivery_enabled:1,shamcash_enabled:0,
      shamcash_recipient:null,shamcash_instructions:null
    };

    return json({
      status:"ok",
      store: { ...store, customization: (() => { try { return JSON.parse(store.customization_json || "{}"); } catch { return {}; } })() },
      order_settings:orderSettings,
      platform_footer: Object.fromEntries((platformSettings.results || []).map(item => [item.setting_key, item.setting_value])),
      platform_support_whatsapp: (platformSettings.results || []).find(item => item.setting_key === "platform_support_whatsapp")?.setting_value || "",
      announcements: announcementsResult.results || [],
      categories:categoriesResult.results || [],
      products:products.map(product => ({
        ...product,
        images:imagesByProduct.get(product.id) || [],
        variants:variantsByProduct.get(product.id) || []
      }))
    });
  } catch {
    return json({error:"Unable to load this store"},500);
  }
}
