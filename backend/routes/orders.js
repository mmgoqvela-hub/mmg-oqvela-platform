import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";

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
    SELECT cash_on_delivery_enabled,shamcash_enabled,shamcash_recipient,shamcash_instructions
    FROM store_order_settings WHERE store_id=? LIMIT 1
  `).bind(storeId).first() || {
    cash_on_delivery_enabled:1,shamcash_enabled:1,
    shamcash_recipient:null,shamcash_instructions:null
  };
}
async function publicStore(db,slug){
  return db.prepare(`
    SELECT s.id,s.name,s.slug FROM stores s JOIN accounts a ON a.id=s.account_id
    WHERE s.slug=? AND s.status='active' AND a.status='active'
      AND EXISTS (SELECT 1 FROM store_subscriptions ss WHERE ss.store_id=s.id
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
  const email=b.customer_email==null||b.customer_email===""?null:typeof b.customer_email==="string"?b.customer_email.trim():undefined;
  const address=b.shipping_address==null||b.shipping_address===""?null:typeof b.shipping_address==="string"?b.shipping_address.trim():undefined;
  const notes=b.customer_notes==null||b.customer_notes===""?null:typeof b.customer_notes==="string"?b.customer_notes.trim():undefined;
  const method=b.payment_method;
  if(!validText(name,2,120)||!validText(phone,6,30)||
    (email!==null&&(!validText(email,5,254)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))||
    (address!==null&&(typeof address!=="string"||address.length>1000))||
    (notes!==null&&(typeof notes!=="string"||notes.length>1000))||
    !["cash_on_delivery","shamcash"].includes(method)||
    !Array.isArray(b.items)||b.items.length<1||b.items.length>30){
    return json({error:"Invalid order details"},400);
  }
  const settings=await loadSettings(env.DB,store.id);
  if(method==="cash_on_delivery"&&!settings.cash_on_delivery_enabled)return json({error:"Cash on delivery is unavailable"},400);
  if(method==="shamcash"&&(!settings.shamcash_enabled||!validText(settings.shamcash_recipient||"",2,160)))
    return json({error:"Sham Cash is not configured for this store"},400);
  const reference=method==="shamcash"?(typeof b.transaction_reference==="string"?b.transaction_reference.trim():""):null;
  const sender=method==="shamcash"?(typeof b.sender_name==="string"?b.sender_name.trim():""):null;
  if(method==="shamcash"&&(!validText(reference,3,120)||!validText(sender,2,120)))
    return json({error:"Sham Cash transaction number and sender name are required"},400);

  const items=[];
  const seen=new Set();
  let currency=null,subtotal=0;
  for(const input of b.items){
    const productId=typeof input?.product_id==="string"?input.product_id:"";
    const variantId=input?.variant_id==null||input.variant_id===""?null:input.variant_id;
    const quantity=input?.quantity;
    if(!productId||!Number.isInteger(quantity)||quantity<1||quantity>999||
      (variantId!==null&&typeof variantId!=="string"))return json({error:"Invalid order item"},400);
    const key=productId+":"+(variantId||"");
    if(seen.has(key))return json({error:"Duplicate order item"},400);
    seen.add(key);
    const product=await env.DB.prepare(`
      SELECT id,name,sku,base_price,currency,track_inventory,stock_quantity,status
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
    const price=Number(variant?.price??product.base_price);
    const lineCurrency=product.currency||"USD";
    if(currency!==null&&currency!==lineCurrency)return json({error:"All items in an order must use the same currency"},400);
    currency=lineCurrency;
    if(product.track_inventory&&Number(variant?.stock_quantity??product.stock_quantity)<quantity)
      return json({error:"Insufficient stock for "+product.name},409);
    const lineTotal=Math.round(price*quantity*100)/100;
    subtotal=Math.round((subtotal+lineTotal)*100)/100;
    items.push({id:crypto.randomUUID(),product_id:product.id,variant_id:variant?.id||null,
      product_name:product.name,variant_name:variant?.name||null,sku:product.sku||null,
      quantity,unit_price:price,line_total:lineTotal,currency:lineCurrency});
  }
  const orderId=crypto.randomUUID();
  const orderNumber="MMG-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,5).toUpperCase();
  const paymentStatus=method==="shamcash"?"pending":"unpaid";
  const statements=[env.DB.prepare(`
    INSERT INTO store_orders
      (id,store_id,order_number,customer_name,customer_phone,customer_email,shipping_address,customer_notes,
       payment_method,payment_status,order_status,transaction_reference,sender_name,subtotal,total,currency)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'pending',?,?,?,?,?)
  `).bind(orderId,store.id,orderNumber,name,phone,email,address,notes,method,paymentStatus,reference,sender,subtotal,subtotal,currency)];
  for(const item of items){
    statements.push(env.DB.prepare(`
      INSERT INTO store_order_items
        (id,order_id,store_id,product_id,variant_id,product_name,variant_name,sku,quantity,unit_price,line_total,currency)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(item.id,orderId,store.id,item.product_id,item.variant_id,item.product_name,item.variant_name,item.sku,item.quantity,item.unit_price,item.line_total,item.currency));
  }
  try{
    await env.DB.batch(statements);
    return json({status:"ok",message:"Order received",order:{
      id:orderId,order_number:orderNumber,store_name:store.name,payment_method:method,
      payment_status:paymentStatus,order_status:"pending",subtotal,total:subtotal,currency,
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
  const [totals,revenue,topProducts]=await Promise.all([
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
      SELECT i.product_id,i.product_name,SUM(i.quantity) AS units_sold,
        ROUND(SUM(i.line_total),2) AS paid_sales
      FROM store_order_items i
      JOIN store_orders o ON o.id=i.order_id AND o.store_id=i.store_id
      WHERE i.store_id=? AND o.payment_status='paid' AND o.order_status!='cancelled'
        AND o.created_at>=datetime('now',?)
      GROUP BY i.product_id,i.product_name
      ORDER BY units_sold DESC,i.product_name COLLATE NOCASE ASC LIMIT 5
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
    top_products:topProducts.results||[]
  };
}

export async function handleOrders(request,env){
  const url=new URL(request.url);
  const publicMatch=url.pathname.match(/^\/api\/public\/stores\/([a-z0-9-]+)\/orders$/);
  if(publicMatch)return createPublicOrder(request,env,publicMatch[1]);
  const settingsMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/orders\/settings$/);
  const reportsMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/reports$/);
  const orderMatch=url.pathname.match(/^\/api\/stores\/([^/]+)\/orders(?:\/([^/]+))?$/);
  if(!settingsMatch&&!orderMatch&&!reportsMatch)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  let storeId;
  try{storeId=decodeURIComponent((settingsMatch||orderMatch||reportsMatch)[1]);}catch{return json({error:"Invalid store ID"},400);}
  const access=await getAccess(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")return json({error:"Store is unavailable"},403);

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
    const recipient=typeof b.shamcash_recipient==="string"?b.shamcash_recipient.trim():"";
    const instructions=typeof b.shamcash_instructions==="string"?b.shamcash_instructions.trim():"";
    if(typeof cod!=="boolean"||typeof sham!=="boolean"||(!cod&&!sham)||
      recipient.length>160||instructions.length>2000||(sham&&!validText(recipient,2,160)))
      return json({error:"Enable at least one payment method and configure Sham Cash recipient details"},400);
    await env.DB.prepare(`
      INSERT INTO store_order_settings
        (store_id,cash_on_delivery_enabled,shamcash_enabled,shamcash_recipient,shamcash_instructions,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(store_id) DO UPDATE SET
        cash_on_delivery_enabled=excluded.cash_on_delivery_enabled,
        shamcash_enabled=excluded.shamcash_enabled,
        shamcash_recipient=excluded.shamcash_recipient,
        shamcash_instructions=excluded.shamcash_instructions,
        updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP
    `).bind(storeId,cod?1:0,sham?1:0,recipient||null,instructions||null,session.user_id).run();
    return json({status:"ok",message:"Checkout settings saved"});
  }

  if(!orderMatch[2]){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(!allowed(access,"orders.read"))return json({error:"Orders read permission required"},403);
    const result=await env.DB.prepare(`
      SELECT id,order_number,customer_name,customer_phone,customer_email,shipping_address,customer_notes,
        payment_method,payment_status,order_status,transaction_reference,sender_name,subtotal,total,currency,
        created_at,updated_at
      FROM store_orders WHERE store_id=? ORDER BY created_at DESC LIMIT 100
    `).bind(storeId).all();
    const orders=result.results||[];
    if(!orders.length)return json({status:"ok",orders:[]});
    const ids=orders.map(o=>o.id);
    const placeholders=ids.map(()=>"?").join(",");
    const [lines,events]=await Promise.all([
      env.DB.prepare(`
        SELECT order_id,id,product_id,variant_id,product_name,variant_name,sku,quantity,unit_price,line_total,currency
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
  const existing=await env.DB.prepare("SELECT id,order_status,payment_status,payment_method FROM store_orders WHERE id=? AND store_id=? LIMIT 1").bind(orderId,storeId).first();
  if(!existing)return json({error:"Order not found"},404);
  const parsed=await readBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body;
  const nextStatus=b.order_status??existing.order_status;
  const nextPayment=b.payment_status??existing.payment_status;
  const transitions={
    pending:["confirmed","cancelled"],
    confirmed:["processing","cancelled"],
    processing:["shipped","completed","cancelled"],
    shipped:["completed"],
    completed:[],
    cancelled:[]
  };
  if(!Object.hasOwn(transitions,nextStatus)||!["unpaid","pending","paid","rejected","refunded"].includes(nextPayment))
    return json({error:"Invalid order or payment status"},400);
  if(nextStatus!==existing.order_status&&!transitions[existing.order_status].includes(nextStatus))
    return json({error:"Invalid order status transition"},409);
  if(nextPayment!==existing.payment_status){
    const paymentTransitions={unpaid:["paid"],pending:["paid","rejected"],rejected:[],paid:["refunded"],refunded:[]};
    if(!paymentTransitions[existing.payment_status]?.includes(nextPayment))
      return json({error:"Invalid payment status transition"},409);
    if(nextPayment==="rejected"&&existing.payment_method!=="shamcash")
      return json({error:"Only Sham Cash payments can be rejected"},400);
  }
  if(nextStatus==="completed"&&nextPayment!=="paid")
    return json({error:"An order cannot be completed before payment is marked paid"},409);
  if(existing.payment_method==="shamcash"&&
    ["confirmed","processing","shipped","completed"].includes(nextStatus)&&nextPayment!=="paid")
    return json({error:"Verify the Sham Cash payment before processing this order"},409);
  if(nextPayment==="refunded"&&nextStatus!=="cancelled")
    return json({error:"A refunded order must be cancelled"},409);
  const result=await env.DB.prepare(`
    UPDATE store_orders SET order_status=?,payment_status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND store_id=? AND order_status=? AND payment_status=?
  `).bind(nextStatus,nextPayment,session.user_id,orderId,storeId,existing.order_status,existing.payment_status).run();
  if(!result.meta?.changes)return json({error:"Order changed; refresh and retry"},409);
  return json({status:"ok",order:{id:orderId,order_status:nextStatus,payment_status:nextPayment}});
}
