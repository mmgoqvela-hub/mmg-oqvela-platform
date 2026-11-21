import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";
import { calculateTierPriceMinorUnits, selectPricingTier } from "../finance/tier_pricing.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function readBody(request,max=20000){
  const raw=await request.text();
  if(raw.length>max)return {error:"Request too large",status:413};
  try{
    const body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};
    return {body};
  }catch{return {error:"Invalid JSON",status:400};}
}
function validText(value,min,max){return typeof value==="string"&&value.trim().length>=min&&value.trim().length<=max;}
function normalizeCustomerPhone(value){return String(value||"").replace(/[\\s()-]/g,"");}
async function hashCustomerToken(token){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function createCustomerToken(){
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
}
async function getAccess(db,storeId,userId){
  return db.prepare(`
    SELECT s.id,s.status AS store_status,a.status AS account_status,
      au.role AS account_role,
      COALESCE(GROUP_CONCAT(DISTINCT p.code),'') AS permissions
    FROM stores s JOIN accounts a ON a.id=s.account_id
    JOIN account_users au ON au.account_id=s.account_id
    LEFT JOIN store_members sm ON sm.store_id=s.id AND sm.user_id=au.user_id AND sm.status='active'
    LEFT JOIN member_roles mr ON mr.store_member_id=sm.id
    LEFT JOIN roles r ON r.id=mr.role_id AND r.store_id=s.id
    LEFT JOIN role_permissions rp ON rp.role_id=r.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    WHERE s.id=? AND au.user_id=? AND au.status='active' AND a.status='active'
      AND (au.role IN ('owner','admin') OR sm.id IS NOT NULL)
    GROUP BY s.id,a.status,au.role LIMIT 1
  `).bind(storeId,userId).first();
}
function allowed(access,code){
  return ["owner","admin"].includes(access?.account_role)||
    String(access?.permissions||"").split(",").includes(code);
}
async function loadSettings(db,storeId){
  return await db.prepare(`
    SELECT cash_on_delivery_enabled,shamcash_enabled,shamcash_recipient,shamcash_instructions,
      pickup_enabled,delivery_enabled,delivery_fee
    FROM store_order_settings WHERE store_id=? LIMIT 1
  `).bind(storeId).first() || {
    cash_on_delivery_enabled:1,shamcash_enabled:0,
    shamcash_recipient:null,shamcash_instructions:null,
    pickup_enabled:1,delivery_enabled:1,delivery_fee:0
  };
}
async function publicStore(db,slug){
  return db.prepare(`
    SELECT s.id,s.name,s.slug,s.whatsapp_phone FROM stores s JOIN accounts a ON a.id=s.account_id
    WHERE s.slug=? AND s.status='active' AND a.status='active'
      AND EXISTS (SELECT 1 FROM store_subscriptions ss
        WHERE (ss.store_id=s.id OR (ss.is_trial=1 AND ss.trial_account_id=s.account_id))
          AND ss.status='active' AND (ss.expires_at IS NULL OR ss.expires_at>CURRENT_TIMESTAMP))
    LIMIT 1
  `).bind(slug).first();
}
async function enforcePublicCheckoutLimit(db,request,storeId){
  // Cloudflare supplies this header at the edge; only its hash is persisted.
  const address=request.headers.get("CF-Connecting-IP")||"unknown";
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(address));
  const ipHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  const result=await db.prepare(`
    INSERT INTO public_checkout_rate_limits(store_id,ip_hash,window_started_at,request_count)
    VALUES(?,?,CURRENT_TIMESTAMP,1)
    ON CONFLICT(store_id,ip_hash) DO UPDATE SET
      window_started_at=CASE
        WHEN window_started_at<=datetime('now','-10 minutes') THEN CURRENT_TIMESTAMP
        ELSE window_started_at END,
      request_count=CASE
        WHEN window_started_at<=datetime('now','-10 minutes') THEN 1
        ELSE request_count+1 END
    WHERE window_started_at<=datetime('now','-10 minutes') OR request_count<5
    RETURNING request_count
  `).bind(storeId,ipHash).first();
  return Boolean(result);
}

async function createPublicOrder(request,env,slug){
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  const store=await publicStore(env.DB,slug);
  if(!store)return json({error:"Store is unavailable"},404);
  if(!await enforcePublicCheckoutLimit(env.DB,request,store.id))
    return json({error:"Too many checkout attempts. Please try again in 10 minutes."},429);
  const parsed=await readBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body;
  const name=typeof b.customer_name==="string"?b.customer_name.trim():"";
  const phone=typeof b.customer_phone==="string"?b.customer_phone.trim():"";
  const phoneKey=normalizeCustomerPhone(phone);
  const email=b.customer_email==null||b.customer_email===""?null:typeof b.customer_email==="string"?b.customer_email.trim():undefined;
  const address=b.shipping_address==null||b.shipping_address===""?null:typeof b.shipping_address==="string"?b.shipping_address.trim():undefined;
  const notes=b.customer_notes==null||b.customer_notes===""?null:typeof b.customer_notes==="string"?b.customer_notes.trim():undefined;
  const method=b.payment_method;
  const fulfillment=b.fulfillment_method;
  if(!validText(name,2,120)||!validText(phone,6,30)||
    (email!==null&&(!validText(email,5,254)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))||
    (address!==null&&(typeof address!=="string"||address.length>1000))||
    (notes!==null&&(typeof notes!=="string"||notes.length>1000))||
    !["cash_on_delivery","shamcash"].includes(method)||
    !["pickup","delivery"].includes(fulfillment)||
    !Array.isArray(b.items)||b.items.length<1||b.items.length>30){
    return json({error:"Invalid order details"},400);
  }
  const settings=await loadSettings(env.DB,store.id);
  if(fulfillment==="pickup"&&!settings.pickup_enabled)return json({error:"Store pickup is unavailable"},400);
  if(fulfillment==="delivery"&&!settings.delivery_enabled)return json({error:"Delivery is unavailable"},400);
  if(!validText(address||"",5,1000))return json({error:"A customer address or location is required"},400);
  if(method==="cash_on_delivery"&&!settings.cash_on_delivery_enabled)return json({error:"Cash on delivery is unavailable"},400);
  if(method==="shamcash"&&(!settings.shamcash_enabled||!validText(settings.shamcash_recipient||"",2,160)))
    return json({error:"Sham Cash is not configured for this store"},400);
  // Payment is collected only when the order is handed to the customer.
  // The selected method is stored separately; no transfer details are requested at checkout.
  const reference=null;
  const sender=null;
  if(phoneKey.length<6||phoneKey.length>30)return json({error:"Invalid customer phone number"},400);
  const suppliedCustomerToken=typeof b.customer_access_token==="string"?b.customer_access_token.trim():"";
  let customerIdentityId=null,customerAccessToken=suppliedCustomerToken,customerIdentityInsert=null;
  if(suppliedCustomerToken){
    if(!/^[a-f0-9]{64}$/i.test(suppliedCustomerToken))return json({error:"Invalid customer QR code"},401);
    const tokenHash=await hashCustomerToken(suppliedCustomerToken);
    const identity=await env.DB.prepare(`
      SELECT id,customer_phone_key FROM store_customer_identities
      WHERE store_id=? AND access_token_hash=? AND revoked_at IS NULL LIMIT 1
    `).bind(store.id,tokenHash).first();
    if(!identity||identity.customer_phone_key!==phoneKey)
      return json({error:"The saved customer QR does not match this phone number. Use the correct QR or start a new guest identity."},401);
    customerIdentityId=identity.id;
  }else{
    customerAccessToken=createCustomerToken();
    customerIdentityId=crypto.randomUUID();
    const tokenHash=await hashCustomerToken(customerAccessToken);
    customerIdentityInsert=env.DB.prepare(`
      INSERT INTO store_customer_identities
        (id,store_id,customer_phone_key,customer_name,access_token_hash)
      VALUES (?,?,?,?,?)
    `).bind(customerIdentityId,store.id,phoneKey,name,tokenHash);
  }

  const pricingSettings=await env.DB.prepare("SELECT pricing_mode,rounding_increment_minor_units FROM store_pricing_settings WHERE store_id=?").bind(store.id).first();
  const pricingMode=pricingSettings?.pricing_mode||"manual";
  const globalTiers=pricingMode==="cost_plus_margin"
    ? (await env.DB.prepare("SELECT tier_code,min_quantity,profit_margin_bps,is_enabled FROM store_pricing_tiers WHERE store_id=?").bind(store.id).all()).results||[]
    : [];
  const items=[];
  const seen=new Set();
  let currency=null,subtotal=0;
  for(const input of b.items){
    const productId=typeof input?.product_id==="string"?input.product_id:"";
    const variantId=input?.variant_id==null||input.variant_id===""?null:input.variant_id;
    const quantity=input?.quantity;
    if(!productId||!Number.isInteger(quantity)||quantity<1||quantity>1000000||
      (variantId!==null&&typeof variantId!=="string"))return json({error:"Invalid order item"},400);
    const key=productId+":"+(variantId||"");
    if(seen.has(key))return json({error:"Duplicate order item"},400);
    seen.add(key);
    const product=await env.DB.prepare(`
      SELECT id,name,sku,base_price,currency,track_inventory,stock_quantity,status,sale_unit
      FROM products WHERE id=? AND store_id=? LIMIT 1
    `).bind(productId,store.id).first();
    if(!product||product.status!=="active")return json({error:"A selected product is unavailable"},409);
    let variant=null;
    if(variantId){
      variant=await env.DB.prepare(`
        SELECT id,name,price,stock_quantity,status FROM product_variants
        WHERE id=? AND product_id=? AND store_id=? LIMIT 1
      `).bind(variantId,productId,store.id).first();
      if(!variant||variant.status!=="active")return json({error:"A selected product option is unavailable"},409);
    }else{
      const hasVariants=await env.DB.prepare("SELECT id FROM product_variants WHERE product_id=? AND store_id=? AND status='active' LIMIT 1").bind(productId,store.id).first();
      if(hasVariants)return json({error:"Choose an option for each product"},400);
    }
    const saleUnit=product.sale_unit||"piece";
    if(saleUnit==="piece"&&quantity>999)return json({error:"Invalid piece quantity"},400);
    if(saleUnit==="kg"&&(quantity<50||quantity%50!==0))return json({error:"Weight must be in 50 gram increments and at least 50 grams"},400);
    let price=Number(variant?.price??product.base_price);
    const lineCurrency=product.currency||"USD";
    let pricingSnapshot={pricing_mode:"manual",pricing_tier_code:null,cost_version_id:null,cost_currency:null,cost_minor_units:null,profit_margin_bps:null,rounding_increment_minor_units:null};
    if(pricingMode==="cost_plus_margin"){
      if(lineCurrency!=="USD")return json({error:"Automatic cost-plus pricing is currently available only for USD products"},409);
      const overrideRows=await env.DB.prepare(`
        SELECT tier_code,profit_margin_bps,min_quantity,is_enabled
        FROM product_tier_margin_overrides
        WHERE store_id=? AND product_id=? AND (variant_id=? OR variant_id IS NULL)
        ORDER BY CASE WHEN variant_id IS NULL THEN 1 ELSE 0 END
      `).bind(store.id,product.id,variant?.id||null).all();
      const overrideByTier=new Map();
      for(const row of overrideRows.results||[])if(!overrideByTier.has(row.tier_code))overrideByTier.set(row.tier_code,row);
      const resolvedTiers=globalTiers.map(tier=>{
        const override=overrideByTier.get(tier.tier_code);
        return override?{...tier,min_quantity:override.min_quantity??tier.min_quantity,
          profit_margin_bps:override.profit_margin_bps,is_enabled:override.is_enabled}:tier;
      });
      let selected;
      try{selected=selectPricingTier(saleUnit==="kg"?quantity/1000:quantity,resolvedTiers);}catch{
        return json({error:"No valid automatic price is configured for "+product.name},409);
      }
      const cost=await env.DB.prepare(`
        SELECT id,cost_minor_units FROM product_cost_versions
        WHERE store_id=? AND product_id=? AND
          ((? IS NOT NULL AND variant_id=?) OR variant_id IS NULL)
        ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END,effective_at DESC,created_at DESC LIMIT 1
      `).bind(store.id,product.id,variant?.id||null,variant?.id||null,variant?.id||null).first();
      if(!cost)return json({error:"A USD purchase cost is required before selling "+product.name+" with automatic pricing"},409);
      try{
        const unitMinor=calculateTierPriceMinorUnits(cost.cost_minor_units,selected.profit_margin_bps,pricingSettings.rounding_increment_minor_units||1);
        price=unitMinor/100;
        pricingSnapshot={pricing_mode:"cost_plus_margin",pricing_tier_code:selected.tier_code,
          cost_version_id:cost.id,cost_currency:"USD",cost_minor_units:cost.cost_minor_units,
          profit_margin_bps:selected.profit_margin_bps,rounding_increment_minor_units:pricingSettings.rounding_increment_minor_units||1};
      }catch{return json({error:"Unable to calculate the configured selling price"},409);}
    }
    if(currency!==null&&currency!==lineCurrency)return json({error:"All items in an order must use the same currency"},400);
    currency=lineCurrency;
    if(product.track_inventory&&Number(variant?.stock_quantity??product.stock_quantity)<quantity)
      return json({error:"Insufficient stock for "+product.name},409);
    const lineTotal=Math.round(price*(saleUnit==="kg"?quantity/1000:quantity)*100)/100;
    subtotal=Math.round((subtotal+lineTotal)*100)/100;
    items.push({id:crypto.randomUUID(),product_id:product.id,variant_id:variant?.id||null,
      product_name:product.name,variant_name:variant?.name||null,sku:product.sku||null,
      quantity,sale_unit:saleUnit,unit_price:price,line_total:lineTotal,currency:lineCurrency,...pricingSnapshot});
  }
  const orderId=crypto.randomUUID();
  const orderNumber="MMG-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,5).toUpperCase();
  const paymentStatus="unpaid";
  const deliveryFee=fulfillment==="delivery"?Math.max(0,Number(settings.delivery_fee)||0):0;
  const total=Math.round((subtotal+deliveryFee)*100)/100;
  const statements=[];
  if(customerIdentityInsert)statements.push(customerIdentityInsert);
  else statements.push(env.DB.prepare("UPDATE store_customer_identities SET last_seen_at=CURRENT_TIMESTAMP,customer_name=? WHERE id=? AND store_id=?").bind(name,customerIdentityId,store.id));
  statements.push(env.DB.prepare(`
    INSERT INTO store_orders
      (id,store_id,order_number,customer_name,customer_phone,customer_email,shipping_address,customer_notes,
       payment_method,payment_status,order_status,transaction_reference,sender_name,subtotal,total,currency,
       fulfillment_method,delivery_fee,customer_identity_id,customer_payment_method,store_phone_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,'unpaid','pending',NULL,NULL,?,?,?,?,?,?,?,?)
  `).bind(orderId,store.id,orderNumber,name,phone,email,address,notes,"cash_on_delivery",subtotal,total,currency,
    fulfillment,deliveryFee,customerIdentityId,method,store.whatsapp_phone||null));
  for(const item of items){
    statements.push(env.DB.prepare(`
      INSERT INTO store_order_items
        (id,order_id,store_id,product_id,variant_id,product_name,variant_name,sku,quantity,unit_price,line_total,currency,
         pricing_mode,pricing_tier_code,cost_version_id,cost_currency,cost_minor_units,profit_margin_bps,rounding_increment_minor_units,sale_unit)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(item.id,orderId,store.id,item.product_id,item.variant_id,item.product_name,item.variant_name,item.sku,item.quantity,item.unit_price,item.line_total,item.currency,
      item.pricing_mode,item.pricing_tier_code,item.cost_version_id,item.cost_currency,item.cost_minor_units,item.profit_margin_bps,item.rounding_increment_minor_units,item.sale_unit));
  }
  try{
    await env.DB.batch(statements);
    return json({status:"ok",message:"Order received",order:{
      id:orderId,order_number:orderNumber,store_name:store.name,payment_method:method,
      payment_status:paymentStatus,order_status:"pending",customer_decision:"pending",
      subtotal,delivery_fee:deliveryFee,total,currency,fulfillment_method:fulfillment,
      customer_access_token:customerAccessToken,
      shamcash:method==="shamcash"?{recipient:settings.shamcash_recipient,instructions:settings.shamcash_instructions||null}:null
    }},201);
  }catch(error){
    const message=String(error?.message||"");
    if(/stock|variant/i.test(message))return json({error:"Stock changed while placing the order. Please refresh your cart and try again."},409);
    if(/unique|transaction_reference/i.test(message))return json({error:"This Sham Cash transaction number was already used for this store."},409);
    return json({error:"Unable to place order"},409);
  }
}

async function loadStoreReport(db,storeId,period){
  const modifier=period==="7d"?"-7 days":period==="90d"?"-90 days":"-30 days";
  const [totals,revenue,dailyRevenue,profit,topProducts]=await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS total_orders,
        SUM(CASE WHEN order_status='completed' THEN 1 ELSE 0 END) AS completed_orders,
        SUM(CASE WHEN order_status IN ('pending','confirmed','processing','shipped') THEN 1 ELSE 0 END) AS open_orders,
        SUM(CASE WHEN order_status='cancelled' THEN 1 ELSE 0 END) AS cancelled_orders
      FROM store_orders WHERE store_id=? AND created_at>=datetime('now',?)
    `).bind(storeId,modifier).first(),
    db.prepare(`
      SELECT currency,COUNT(*) AS paid_orders,ROUND(SUM(total),2) AS paid_revenue
      FROM store_orders
      WHERE store_id=? AND payment_status='paid' AND order_status!='cancelled'
        AND created_at>=datetime('now',?)
      GROUP BY currency ORDER BY currency
    `).bind(storeId,modifier).all(),
    db.prepare(`
      SELECT date(created_at) AS report_date,currency,COUNT(*) AS paid_orders,
        ROUND(SUM(total),2) AS paid_revenue
      FROM store_orders
      WHERE store_id=? AND payment_status='paid' AND order_status!='cancelled'
        AND created_at>=datetime('now',?)
      GROUP BY date(created_at),currency
      ORDER BY report_date DESC,currency
    `).bind(storeId,modifier).all(),
    db.prepare(`
      SELECT SUM(CASE WHEN pricing_mode='cost_plus_margin' AND cost_minor_units IS NOT NULL THEN 1 ELSE 0 END) AS costed_lines,
        COUNT(DISTINCT CASE WHEN pricing_mode='cost_plus_margin' AND cost_minor_units IS NOT NULL THEN order_id END) AS costed_orders,
        SUM(CASE WHEN pricing_mode!='cost_plus_margin' OR cost_minor_units IS NULL THEN 1 ELSE 0 END) AS uncosted_lines,
        ROUND(SUM(CASE WHEN pricing_mode='cost_plus_margin' AND cost_minor_units IS NOT NULL THEN line_total ELSE 0 END),2) AS costed_revenue,
        ROUND(SUM(CASE WHEN pricing_mode='cost_plus_margin' AND cost_minor_units IS NOT NULL
          THEN line_total-(cost_minor_units/100.0)*(CASE WHEN sale_unit='kg' THEN quantity/1000.0 ELSE quantity END)
          ELSE 0 END),2) AS estimated_gross_profit
      FROM store_order_items
      WHERE store_id=? AND created_at>=datetime('now',?)
        AND order_id IN (SELECT id FROM store_orders WHERE store_id=? AND payment_status='paid'
          AND order_status!='cancelled' AND created_at>=datetime('now',?))
    `).bind(storeId,modifier,storeId,modifier).first(),
    db.prepare(`
      SELECT i.product_id,i.product_name,i.sale_unit,
        SUM(i.quantity) AS quantity_base_units,
        CASE WHEN i.sale_unit='kg' THEN ROUND(SUM(i.quantity)/1000.0,3)
          ELSE SUM(i.quantity) END AS display_quantity,
        ROUND(SUM(i.line_total),2) AS paid_sales
      FROM store_order_items i
      JOIN store_orders o ON o.id=i.order_id AND o.store_id=i.store_id
      WHERE i.store_id=? AND o.payment_status='paid' AND o.order_status!='cancelled'
        AND o.created_at>=datetime('now',?)
      GROUP BY i.product_id,i.product_name,i.sale_unit
      ORDER BY paid_sales DESC,i.product_name COLLATE NOCASE ASC LIMIT 5
    `).bind(storeId,modifier).all()
  ]);
  return {
    period,
    totals:{
      total_orders:totals?.total_orders||0,
      completed_orders:totals?.completed_orders||0,
      open_orders:totals?.open_orders||0,
      cancelled_orders:totals?.cancelled_orders||0
    },
    paid_revenue:revenue.results||[],
    daily_revenue:dailyRevenue.results||[],
    profit:profit||{costed_lines:0,costed_orders:0,uncosted_lines:0,costed_revenue:0,estimated_gross_profit:0},
    top_products:topProducts.results||[]
  };
}

export async function handleOrders(request,env){
  const url=new URL(request.url);
  const publicMatch=url.pathname.match(/^\/api\/public\/stores\/([a-z0-9-]+)\/orders$/);
  if(publicMatch)return createPublicOrder(request,env,publicMatch[1]);
  const settingsMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/orders\/settings$/);
  const reportsMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/reports$/);
  const customersMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/customers(?:\/([^/]+))?$/);
  const notificationsMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/notifications(?:\/([^/]+)\/read)?$/);
  const orderMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/orders(?:\/([^/]+))?$/);
  if(!settingsMatch&&!orderMatch&&!reportsMatch&&!customersMatch&&!notificationsMatch)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  let storeId;
  try{storeId=decodeURIComponent((settingsMatch||orderMatch||reportsMatch||customersMatch||notificationsMatch)[1]);}catch{return json({error:"Invalid store ID"},400);}
  const access=await getAccess(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")return json({error:"Store is unavailable"},403);

  if(notificationsMatch){
    if(!allowed(access,"orders.read"))return json({error:"Orders read permission required"},403);
    if(notificationsMatch[2]){
      if(request.method!=="POST")return json({error:"Method not allowed"},405);
      let notificationId;
      try{notificationId=decodeURIComponent(notificationsMatch[2]);}catch{return json({error:"Invalid notification ID"},400);}
      const result=await env.DB.prepare(`
        UPDATE user_notifications SET read_at=CURRENT_TIMESTAMP
        WHERE id=? AND user_id=? AND notification_type='store_order'
          AND EXISTS (SELECT 1 FROM store_orders o
            WHERE o.id=user_notifications.entity_id AND o.store_id=?)
          AND read_at IS NULL
      `).bind(notificationId,session.user_id,storeId).run();
      if(!result.meta?.changes){
        const exists=await env.DB.prepare(`
          SELECT n.id FROM user_notifications n
          JOIN store_orders o ON o.id=n.entity_id AND o.store_id=?
          WHERE n.id=? AND n.user_id=? AND n.notification_type='store_order'
        `).bind(storeId,notificationId,session.user_id).first();
        if(!exists)return json({error:"Notification not found"},404);
      }
      return json({status:"ok"});
    }
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    const [items,count]=await Promise.all([
      env.DB.prepare(`
        SELECT n.id,n.notification_type,n.title,n.message,n.entity_type,n.entity_id,n.read_at,n.created_at
        FROM user_notifications n
        JOIN store_orders o ON o.id=n.entity_id AND o.store_id=?
        WHERE n.user_id=? AND n.entity_type='store_order'
        ORDER BY n.created_at DESC,n.id DESC LIMIT 50
      `).bind(storeId,session.user_id).all(),
      env.DB.prepare(`
        SELECT COUNT(*) AS unread_count
        FROM user_notifications n
        JOIN store_orders o ON o.id=n.entity_id AND o.store_id=?
        WHERE n.user_id=? AND n.entity_type='store_order' AND n.read_at IS NULL
      `).bind(storeId,session.user_id).first()
    ]);
    return json({status:"ok",notifications:items.results||[],unread_count:count?.unread_count||0});
  }

  if(customersMatch){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(!allowed(access,"orders.read"))return json({error:"Orders read permission required"},403);
    const normalizePhone=value=>String(value||"").replace(/[\s()-]/g,"");
    if(!customersMatch[2]){
      const result=await env.DB.prepare(`
        SELECT MIN(customer_name) AS customer_name,
          MIN(customer_phone) AS customer_phone,
          REPLACE(REPLACE(REPLACE(REPLACE(customer_phone,' ',''),'-',''),'(',''),')','') AS phone_key,
          COUNT(*) AS orders_count,
          ROUND(SUM(total),2) AS total_orders_value,
          MAX(created_at) AS last_order_at,
          SUM(CASE WHEN order_status IN ('pending','confirmed','processing','shipped') THEN 1 ELSE 0 END) AS open_orders
        FROM store_orders WHERE store_id=?
        GROUP BY REPLACE(REPLACE(REPLACE(REPLACE(customer_phone,' ',''),'-',''),'(',''),')','')
        ORDER BY last_order_at DESC LIMIT 300
      `).bind(storeId).all();
      return json({status:"ok",customers:(result.results||[]).map(row=>({...row,phone_key:normalizePhone(row.phone_key)}))});
    }
    let phoneKey;
    try{phoneKey=normalizePhone(decodeURIComponent(customersMatch[2]));}catch{return json({error:"Invalid phone"},400);}
    if(phoneKey.length<6||phoneKey.length>30)return json({error:"Invalid phone"},400);
    const result=await env.DB.prepare(`
      SELECT id,order_number,customer_name,customer_phone,customer_email,shipping_address,customer_notes,
        payment_method,customer_payment_method,payment_status,order_status,customer_decision,rejection_reason,
        transaction_reference,payment_reference,payment_sender_name,sender_name,subtotal,total,currency,
        fulfillment_method,delivery_fee,store_phone_snapshot,created_at,updated_at,accepted_at,rejected_at,
        delivered_at,payment_collected_at
      FROM store_orders WHERE store_id=?
        AND REPLACE(REPLACE(REPLACE(REPLACE(customer_phone,' ',''),'-',''),'(',''),')','')=?
      ORDER BY created_at DESC LIMIT 300
    `).bind(storeId,phoneKey).all();
    const orders=result.results||[];
    if(!orders.length)return json({status:"ok",orders:[]});
    const ids=orders.map(order=>order.id),placeholders=ids.map(()=>"?").join(",");
    const [lines,events]=await Promise.all([
      env.DB.prepare(`SELECT order_id,id,product_name,variant_name,quantity,unit_price,line_total,currency,sale_unit
        FROM store_order_items WHERE store_id=? AND order_id IN (${placeholders}) ORDER BY created_at ASC`).bind(storeId,...ids).all(),
      env.DB.prepare(`SELECT order_id,event_type,from_value,to_value,created_at
        FROM store_order_events WHERE store_id=? AND order_id IN (${placeholders}) ORDER BY created_at ASC`).bind(storeId,...ids).all()
    ]);
    const byOrder=new Map(),byEvent=new Map();
    for(const line of lines.results||[]){const list=byOrder.get(line.order_id)||[];list.push(line);byOrder.set(line.order_id,list);}
    for(const event of events.results||[]){const list=byEvent.get(event.order_id)||[];list.push(event);byEvent.set(event.order_id,list);}
    return json({status:"ok",orders:orders.map(order=>({...order,items:byOrder.get(order.id)||[],events:byEvent.get(order.id)||[]}))});
  }

  if(reportsMatch){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(!allowed(access,"orders.read"))return json({error:"Orders read permission required"},403);
    const period=url.searchParams.get("period")||"30d";
    if(!["7d","30d","90d"].includes(period))return json({error:"Invalid report period"},400);
    return json({status:"ok",report:await loadStoreReport(env.DB,storeId,period)});
  }

  if(settingsMatch){
    if(request.method==="GET"){
      if(!allowed(access,"orders.read"))return json({error:"Orders read permission required"},403);
      return json({status:"ok",settings:await loadSettings(env.DB,storeId)});
    }
    if(request.method!=="PUT")return json({error:"Method not allowed"},405);
    if(!["owner","admin"].includes(access.account_role))return json({error:"Only store owners and admins can configure checkout"},403);
    const parsed=await readBody(request);
    if(parsed.error)return json({error:parsed.error},parsed.status);
    const b=parsed.body;
    const cod=b.cash_on_delivery_enabled,sham=b.shamcash_enabled;
    const pickup=b.pickup_enabled,delivery=b.delivery_enabled;
    const deliveryFee=Number(b.delivery_fee);
    const recipient=typeof b.shamcash_recipient==="string"?b.shamcash_recipient.trim():"";
    const instructions=typeof b.shamcash_instructions==="string"?b.shamcash_instructions.trim():"";
    if(typeof cod!=="boolean"||typeof sham!=="boolean"||(!cod&&!sham)||
      typeof pickup!=="boolean"||typeof delivery!=="boolean"||(!pickup&&!delivery)||
      !Number.isFinite(deliveryFee)||deliveryFee<0||deliveryFee>100000000||
      recipient.length>160||instructions.length>2000||(sham&&!validText(recipient,2,160)))
      return json({error:"Enable at least one payment method and configure Sham Cash recipient details"},400);
    await env.DB.prepare(`
      INSERT INTO store_order_settings
        (store_id,cash_on_delivery_enabled,shamcash_enabled,shamcash_recipient,shamcash_instructions,
         pickup_enabled,delivery_enabled,delivery_fee,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(store_id) DO UPDATE SET
        cash_on_delivery_enabled=excluded.cash_on_delivery_enabled,
        shamcash_enabled=excluded.shamcash_enabled,
        shamcash_recipient=excluded.shamcash_recipient,
        shamcash_instructions=excluded.shamcash_instructions,
        pickup_enabled=excluded.pickup_enabled,delivery_enabled=excluded.delivery_enabled,
        delivery_fee=excluded.delivery_fee,
        updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
    `).bind(storeId,cod?1:0,sham?1:0,recipient||null,instructions||null,pickup?1:0,delivery?1:0,deliveryFee,session.user_id).run();
    return json({status:"ok",message:"Checkout settings saved"});
  }

  if(!orderMatch[2]){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(!allowed(access,"orders.read"))return json({error:"Orders read permission required"},403);
    const result=await env.DB.prepare(`
      SELECT id,order_number,customer_name,customer_phone,customer_email,shipping_address,customer_notes,
        payment_method,customer_payment_method,payment_status,order_status,customer_decision,rejection_reason,
        transaction_reference,payment_reference,payment_sender_name,sender_name,subtotal,total,currency,
        fulfillment_method,delivery_fee,store_phone_snapshot,
        created_at,updated_at,accepted_at,rejected_at,delivered_at,payment_collected_at
      FROM store_orders WHERE store_id=? ORDER BY created_at DESC LIMIT 100
    `).bind(storeId).all();
    const orders=result.results||[];
    if(!orders.length)return json({status:"ok",orders:[]});
    const ids=orders.map(o=>o.id);
    const placeholders=ids.map(()=>"?").join(",");
    const [lines,events]=await Promise.all([
      env.DB.prepare(`
        SELECT order_id,id,product_id,variant_id,product_name,variant_name,sku,quantity,unit_price,line_total,currency,sale_unit
        FROM store_order_items WHERE store_id=? AND order_id IN (${placeholders})
        ORDER BY created_at ASC
      `).bind(storeId,...ids).all(),
      env.DB.prepare(`
        SELECT order_id,event_type,from_value,to_value,created_at
        FROM store_order_events WHERE store_id=? AND order_id IN (${placeholders})
        ORDER BY created_at ASC
      `).bind(storeId,...ids).all()
    ]);
    const grouped=new Map();
    for(const line of lines.results||[]){const group=grouped.get(line.order_id)||[];group.push(line);grouped.set(line.order_id,group);}
    const eventGroups=new Map();
    for(const event of events.results||[]){const group=eventGroups.get(event.order_id)||[];group.push(event);eventGroups.set(event.order_id,group);}
    return json({status:"ok",orders:orders.map(order=>({...order,items:grouped.get(order.id)||[],events:eventGroups.get(order.id)||[]}))});
  }

  if(request.method!=="PATCH")return json({error:"Method not allowed"},405);
  if(!allowed(access,"orders.manage"))return json({error:"Orders manage permission required"},403);
  const orderId=decodeURIComponent(orderMatch[2]);
  const existing=await env.DB.prepare("SELECT id,order_status,payment_status,payment_method,customer_payment_method,customer_decision FROM store_orders WHERE id=? AND store_id=? LIMIT 1").bind(orderId,storeId).first();
  if(!existing)return json({error:"Order not found"},404);
  const parsed=await readBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body;

  if(b.customer_decision!==undefined){
    const decision=b.customer_decision;
    const reason=typeof b.rejection_reason==="string"?b.rejection_reason.trim():"";
    if(!["accepted","rejected"].includes(decision))return json({error:"Invalid customer decision"},400);
    if(decision==="rejected"&&!validText(reason,3,1000))
      return json({error:"Choose or enter a reason for rejecting the order"},400);
    if(existing.order_status==="completed")return json({error:"A completed order cannot be changed"},409);
    if(existing.customer_decision===decision&&
      (decision!=="rejected"||reason===String(b.rejection_reason||"").trim()))
      return json({status:"ok",order:{id:orderId,customer_decision:decision,order_status:existing.order_status}});
    const nextOrderStatus=decision==="accepted"&&existing.order_status==="pending"?"confirmed":existing.order_status;
    try{
      const result=await env.DB.prepare(`
        UPDATE store_orders
        SET customer_decision=?,rejection_reason=?,accepted_at=CASE WHEN ?='accepted' THEN CURRENT_TIMESTAMP ELSE accepted_at END,
          rejected_at=CASE WHEN ?='rejected' THEN CURRENT_TIMESTAMP ELSE rejected_at END,
          order_status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND store_id=? AND customer_decision=? AND order_status=?
      `).bind(decision,decision==="rejected"?reason:null,decision,decision,nextOrderStatus,
        session.user_id,orderId,storeId,existing.customer_decision,existing.order_status).run();
      if(!result.meta?.changes)return json({error:"Order changed; refresh and retry"},409);
      return json({status:"ok",order:{id:orderId,customer_decision:decision,
        rejection_reason:decision==="rejected"?reason:null,order_status:nextOrderStatus}});
    }catch(error){
      const message=String(error?.message||"");
      if(/stock/i.test(message))return json({error:"The available stock is no longer sufficient to accept this order."},409);
      return json({error:"Unable to update the order decision"},409);
    }
  }

  if(b.complete_delivery===true){
    if(existing.customer_decision!=="accepted"||existing.order_status==="completed")
      return json({error:"Only an accepted, not-yet-completed order can be handed over"},409);
    const reference=typeof b.payment_reference==="string"?b.payment_reference.trim():"";
    const sender=typeof b.payment_sender_name==="string"?b.payment_sender_name.trim():"";
    if(existing.customer_payment_method==="shamcash"&&
      (!validText(reference,3,120)||!validText(sender,2,120)))
      return json({error:"Enter the Sham Cash transaction number and sender name after verifying receipt"},400);
    if(!["cash_on_delivery","shamcash"].includes(existing.customer_payment_method))
      return json({error:"Invalid selected payment method"},409);
    const result=await env.DB.prepare(`
      UPDATE store_orders
      SET order_status='completed',payment_status='paid',
        delivered_at=CURRENT_TIMESTAMP,payment_collected_at=CURRENT_TIMESTAMP,
        payment_collected_by=?,payment_reference=?,payment_sender_name=?,
        updated_by=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND store_id=? AND customer_decision='accepted'
        AND order_status!='completed' AND payment_status IN ('unpaid','pending')
    `).bind(session.user_id,
      existing.customer_payment_method==="shamcash"?reference:null,
      existing.customer_payment_method==="shamcash"?sender:null,
      session.user_id,orderId,storeId).run();
    if(!result.meta?.changes)return json({error:"Order changed; refresh and retry"},409);
    return json({status:"ok",order:{id:orderId,order_status:"completed",
      payment_status:"paid",payment_method:existing.customer_payment_method}});
  }

  return json({error:"Use a customer decision or confirm delivery and collection"},400);
}
