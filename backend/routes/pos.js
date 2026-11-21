import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";
import { calculateTierPriceMinorUnits, selectPricingTier } from "../finance/tier_pricing.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function readBody(request){
  const raw=await request.text();
  if(raw.length>24000)return {error:"Request too large",status:413};
  try{
    const body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};
    return {body};
  }catch{return {error:"Invalid JSON",status:400};}
}
function validText(value,min,max){return typeof value==="string"&&value.trim().length>=min&&value.trim().length<=max;}
function moneyMinor(value){return Math.round(Number(value)*100);}
function validMoney(value){const amount=Number(value);return Number.isFinite(amount)&&amount>=0&&Math.abs(amount*100-Math.round(amount*100))<1e-7;}
function publicPosLine(line){
  const {cost_version_id,cost_currency,cost_minor_units,profit_margin_bps,rounding_increment_minor_units,...safe}=line;
  return safe;
}
async function getAccess(db,storeId,userId){
  return db.prepare(`
    SELECT s.id,s.status AS store_status,a.status AS account_status,au.role AS account_role,
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
function hasPermission(access,code){
  return ["owner","admin"].includes(access?.account_role)||
    String(access?.permissions||"").split(",").includes(code);
}
function tierPermission(code){
  if(code==="retail")return null;
  if(code==="wholesale")return "pos.wholesale";
  if(code==="bulk_wholesale")return "pos.bulk_wholesale";
  return false;
}
async function quoteLine(db,storeId,access,pricingSettings,globalTiers,input){
  const productId=typeof input?.product_id==="string"?input.product_id:"";
  const variantId=input?.variant_id==null||input.variant_id===""?null:input.variant_id;
  const quantity=input?.quantity;
  const tierCode=input?.tier_code||"retail";
  if(!productId||(variantId!==null&&typeof variantId!=="string")||
    !Number.isInteger(quantity)||quantity<1||quantity>999||
    !["retail","wholesale","bulk_wholesale"].includes(tierCode)){
    return {error:"Invalid point-of-sale line",status:400};
  }
  const needed=tierPermission(tierCode);
  if(needed===false||(needed&&!hasPermission(access,needed)))
    return {error:"You are not allowed to apply the selected pricing tier",status:403};
  const product=await db.prepare(`
    SELECT id,name,sku,base_price,currency,track_inventory,stock_quantity,status,sale_unit
    FROM products WHERE id=? AND store_id=? LIMIT 1
  `).bind(productId,storeId).first();
  if(!product||product.status!=="active")return {error:"Product is unavailable",status:409};
  let variant=null;
  if(variantId){
    variant=await db.prepare(`
      SELECT id,name,price,stock_quantity,status FROM product_variants
      WHERE id=? AND product_id=? AND store_id=? LIMIT 1
    `).bind(variantId,productId,storeId).first();
    if(!variant||variant.status!=="active")return {error:"Product option is unavailable",status:409};
  }else{
    const hasVariants=await db.prepare("SELECT id FROM product_variants WHERE product_id=? AND store_id=? AND status='active' LIMIT 1").bind(productId,storeId).first();
    if(hasVariants)return {error:"Choose a product option before pricing",status:400};
  }
  const saleUnit=product.sale_unit==="kg"?"kg":"piece";
  const stockUnits=quantity*(saleUnit==="kg"?50:1);
  if(product.track_inventory&&Number(variant?.stock_quantity??product.stock_quantity)<stockUnits)
    return {error:"Insufficient stock",status:409};
  const currency=product.currency||"USD";
  let unitPrice=Number(variant?.price??product.base_price);
  let appliedTier=null;
  let pricingSnapshot={pricing_mode:"manual",pricing_tier_code:null,cost_version_id:null,cost_currency:null,
    cost_minor_units:null,profit_margin_bps:null,rounding_increment_minor_units:null};
  if(pricingSettings?.pricing_mode==="cost_plus_margin"){
    if(currency!=="USD")return {error:"Automatic cost-plus pricing is currently available only for USD products",status:409};
    const overrides=await db.prepare(`
      SELECT tier_code,profit_margin_bps,min_quantity,is_enabled,variant_id
      FROM product_tier_margin_overrides
      WHERE store_id=? AND product_id=? AND (variant_id=? OR variant_id IS NULL)
      ORDER BY CASE WHEN variant_id IS NULL THEN 1 ELSE 0 END
    `).bind(storeId,productId,variant?.id||null).all();
    const byTier=new Map();
    for(const row of overrides.results||[])if(!byTier.has(row.tier_code))byTier.set(row.tier_code,row);
    const resolved=globalTiers.map(tier=>{
      const override=byTier.get(tier.tier_code);
      return override?{...tier,min_quantity:override.min_quantity??tier.min_quantity,
        profit_margin_bps:override.profit_margin_bps,is_enabled:override.is_enabled}:tier;
    });
    let selected;
    try{
      selected=selectPricingTier(saleUnit==="kg"?quantity*0.05:quantity,resolved.filter(t=>t.tier_code===tierCode));
    }catch{return {error:"The selected tier is disabled, below its minimum quantity, or has no configured margin",status:409};}
    const cost=await db.prepare(`
      SELECT id,cost_minor_units FROM product_cost_versions
      WHERE store_id=? AND product_id=? AND
        ((? IS NOT NULL AND variant_id=?) OR variant_id IS NULL)
      ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END,effective_at DESC,created_at DESC LIMIT 1
    `).bind(storeId,productId,variant?.id||null,variant?.id||null,variant?.id||null).first();
    if(!cost)return {error:"A USD purchase cost is required before this item can be sold with automatic pricing",status:409};
    const increment=pricingSettings.rounding_increment_minor_units||1;
    try{unitPrice=calculateTierPriceMinorUnits(cost.cost_minor_units,selected.profit_margin_bps,increment)/100;}
    catch{return {error:"Unable to calculate the configured selling price",status:409};}
    appliedTier=selected.tier_code;
    pricingSnapshot={pricing_mode:"cost_plus_margin",pricing_tier_code:selected.tier_code,
      cost_version_id:cost.id,cost_currency:"USD",cost_minor_units:cost.cost_minor_units,
      profit_margin_bps:selected.profit_margin_bps,rounding_increment_minor_units:increment};
  }else if(tierCode!=="retail"){
    return {error:"Wholesale tiers require automatic cost-plus pricing to be enabled and configured",status:409};
  }
  if(!Number.isFinite(unitPrice)||unitPrice<0)return {error:"Invalid selling price",status:409};
  const lineTotal=Math.round(unitPrice*quantity*(saleUnit==="kg"?0.05:1)*100)/100;
  return {line:{product_id:product.id,variant_id:variant?.id||null,product_name:product.name,sale_unit:saleUnit,
    variant_name:variant?.name||null,sku:product.sku||null,quantity,currency,
    tier_code:appliedTier||"retail",unit_price:unitPrice,line_total:lineTotal,...pricingSnapshot}};
}
async function loadPricing(db,storeId){
  const settings=await db.prepare("SELECT pricing_mode,rounding_increment_minor_units FROM store_pricing_settings WHERE store_id=?").bind(storeId).first();
  const tiers=settings?.pricing_mode==="cost_plus_margin"
    ?(await db.prepare("SELECT tier_code,min_quantity,profit_margin_bps,is_enabled FROM store_pricing_tiers WHERE store_id=?").bind(storeId).all()).results||[]
    :[];
  return {settings,tiers};
}
async function quoteItems(db,storeId,access,items){
  if(!Array.isArray(items)||items.length<1||items.length>50)return {error:"Provide between 1 and 50 sale items",status:400};
  const {settings,tiers}=await loadPricing(db,storeId);
  const seen=new Set(),lines=[];
  let currency=null,total=0;
  for(const input of items){
    const key=String(input?.product_id||"")+":"+(input?.variant_id||"");
    if(seen.has(key))return {error:"Duplicate product lines must be combined before quoting",status:400};
    seen.add(key);
    const result=await quoteLine(db,storeId,access,settings,tiers,{...input,
      quantity:input?.quantity});
    if(result.error)return result;
    if(currency!==null&&currency!==result.line.currency)return {error:"A POS sale cannot mix currencies; create separate sales for each currency",status:400};
    currency=result.line.currency;
    total=Math.round((total+result.line.line_total)*100)/100;
    lines.push(result.line);
  }
  return {lines,currency,total};
}
async function currentSession(db,storeId,currency){
  return db.prepare(`
    SELECT cs.id,cs.store_id,cs.warehouse_id,cs.currency,cs.status,cs.opening_cash_amount,
      cs.opened_at,cs.opened_by,w.name AS warehouse_name
    FROM pos_cash_sessions cs JOIN inventory_warehouses w
      ON w.id=cs.warehouse_id AND w.store_id=cs.store_id
    WHERE cs.store_id=? AND cs.status='open' AND (? IS NULL OR cs.currency=?)
    ORDER BY cs.opened_at DESC LIMIT 1
  `).bind(storeId,currency||null,currency||null).first();
}
async function openCashSession(request,env,storeId,session,access){
  const parsed=await readBody(request);if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body,currency=b.currency;
  const opening=Number(b.opening_cash_amount);
  const notes=b.opening_notes==null?"":String(b.opening_notes);
  if(!["USD","SYP"].includes(currency)||!Number.isFinite(opening)||opening<0||opening>1e12||
    !validMoney(opening)||notes.length>500)
    return json({error:"Invalid cash session details"},400);
  const warehouseId=typeof b.warehouse_id==="string"&&b.warehouse_id?b.warehouse_id:null;
  const warehouse=warehouseId
    ?await env.DB.prepare("SELECT id FROM inventory_warehouses WHERE id=? AND store_id=? AND status='active'").bind(warehouseId,storeId).first()
    :await env.DB.prepare("SELECT id FROM inventory_warehouses WHERE store_id=? AND is_default=1 AND status='active'").bind(storeId).first();
  if(!warehouse)return json({error:"Active store warehouse not found"},404);
  const id=crypto.randomUUID();
  try{
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO pos_cash_sessions(id,store_id,warehouse_id,currency,opening_cash_amount,opening_notes,opened_by)
        VALUES(?,?,?,?,?,?,?)`).bind(id,storeId,warehouse.id,currency,opening,notes.trim()||null,session.user_id),
      env.DB.prepare(`INSERT INTO pos_cash_session_events(id,session_id,store_id,actor_user_id,event_type,details_json)
        VALUES(?,?,?,?,'opened',?)`).bind(crypto.randomUUID(),id,storeId,session.user_id,JSON.stringify({currency,opening_cash_amount:opening,warehouse_id:warehouse.id}))
    ]);
  }catch{return json({error:"An open cash session already exists for this store and currency, or the session could not be opened"},409);}
  return json({status:"ok",session:await currentSession(env.DB,storeId,currency)},201);
}
async function closeCashSession(request,env,storeId,session,access,sessionId){
  if(!hasPermission(access,"pos.cash_session.close"))return json({error:"Cash-session closing permission required"},403);
  const parsed=await readBody(request);if(parsed.error)return json({error:parsed.error},parsed.status);
  const counted=Number(parsed.body.closing_cash_amount);
  const notes=parsed.body.closing_notes==null?"":String(parsed.body.closing_notes);
  if(!Number.isFinite(counted)||counted<0||counted>1e12||!validMoney(counted)||notes.length>500)
    return json({error:"Invalid closing cash amount"},400);
  const row=await env.DB.prepare("SELECT id,currency,opening_cash_amount FROM pos_cash_sessions WHERE id=? AND store_id=? AND status='open'").bind(sessionId,storeId).first();
  if(!row)return json({error:"Open cash session not found"},404);
  const totals=await env.DB.prepare(`
    SELECT
      COALESCE((SELECT SUM(p.amount)
        FROM pos_sale_payments p JOIN pos_sales s ON s.id=p.sale_id AND s.store_id=p.store_id
        WHERE p.cash_session_id=? AND p.store_id=? AND p.payment_method='cash'
          AND s.status IN ('posted','partially_refunded','refunded','voided')),0) AS cash_received,
      COALESCE((SELECT SUM(vp.amount)
        FROM pos_sale_void_payments vp
        JOIN pos_sale_voids v ON v.id=vp.void_id AND v.store_id=vp.store_id
        JOIN pos_sales s ON s.id=v.sale_id AND s.store_id=v.store_id
        WHERE s.cash_session_id=? AND s.store_id=? AND vp.payment_method='cash'
          AND v.status='posted'),0) AS cash_void_refunded,
      COALESCE((SELECT SUM(rp.amount)
        FROM pos_sale_refund_payments rp
        JOIN pos_sale_returns r ON r.id=rp.return_id AND r.store_id=rp.store_id
        JOIN pos_sales s ON s.id=r.sale_id AND s.store_id=r.store_id
        WHERE s.cash_session_id=? AND s.store_id=? AND rp.payment_method='cash'
          AND r.status='posted'),0) AS cash_refunded
  `).bind(sessionId,storeId,sessionId,storeId,sessionId,storeId).first();
  const expected=Math.round((Number(row.opening_cash_amount)+Number(totals?.cash_received||0)-Number(totals?.cash_refunded||0)-Number(totals?.cash_void_refunded||0))*100)/100;
  const difference=Math.round((counted-expected)*100)/100;
  const result=await env.DB.prepare(`
    UPDATE pos_cash_sessions SET status='closed',closing_cash_amount=?,expected_cash_amount=?,
      cash_difference=?,closing_notes=?,closed_by=?,closed_at=CURRENT_TIMESTAMP
    WHERE id=? AND store_id=? AND status='open'
  `).bind(counted,expected,difference,notes.trim()||null,session.user_id,sessionId,storeId).run();
  if(!(result.meta?.changes>0))return json({error:"Cash session was already closed"},409);
  return json({status:"ok",session:{id:sessionId,currency:row.currency,closing_cash_amount:counted,
    expected_cash_amount:expected,cash_difference:difference,status:"closed"}});
}
async function createSale(request,env,storeId,session,access){
  const parsed=await readBody(request);if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body;
  const key=typeof b.idempotency_key==="string"?b.idempotency_key.trim():"";
  if(!validText(key,16,120))return json({error:"A unique idempotency key is required"},400);
  const prior=await env.DB.prepare("SELECT id,sale_number,total,currency,status FROM pos_sales WHERE store_id=? AND idempotency_key=?")
    .bind(storeId,key).first();
  if(prior)return json({status:"ok",sale:prior,replayed:true});
  const sessionId=typeof b.cash_session_id==="string"?b.cash_session_id:"";
  const cashSession=await env.DB.prepare("SELECT id,warehouse_id,currency,status FROM pos_cash_sessions WHERE id=? AND store_id=?")
    .bind(sessionId,storeId).first();
  if(!cashSession||cashSession.status!=="open")return json({error:"Open cash session required before posting a sale"},409);
  const quote=await quoteItems(env.DB,storeId,access,b.items);
  if(quote.error)return json({error:quote.error},quote.status);
  if(quote.currency!==cashSession.currency)return json({error:"Sale currency must match the active cash session"},409);
  const discount=Number(b.discount_amount||0);
  const discountReason=typeof b.discount_reason==="string"?b.discount_reason.trim():"";
  if(!Number.isFinite(discount)||discount<0||discount>quote.total||!Number.isInteger(moneyMinor(discount)))
    return json({error:"Invalid discount amount"},400);
  if(discount>0&&(!hasPermission(access,"pos.sale.discount")||!validText(discountReason,3,300)))
    return json({error:"Discount permission and a reason of at least 3 characters are required"},403);
  if(discount===0&&discountReason)return json({error:"A discount reason is only accepted with a discount"},400);
  const total=Math.round((quote.total-discount)*100)/100;
  const payments=b.payments;
  if(!Array.isArray(payments)||payments.length<1||payments.length>5)
    return json({error:"Provide one to five payment lines"},400);
  let paidMinor=0;
  for(const payment of payments){
    const amount=Number(payment?.amount);
    if(!["cash","card","digital","shamcash"].includes(payment?.payment_method)||
      !Number.isFinite(amount)||amount<=0||!validMoney(amount))
      return json({error:"Invalid payment line"},400);
    if(payment.payment_method==="shamcash"){
      if(!validText(payment.transaction_reference,3,120)||!validText(payment.sender_name,2,120))
        return json({error:"Sham Cash payments require a transaction number and sender name"},400);
    }else if(payment.transaction_reference||payment.sender_name){
      return json({error:"Transaction number and sender name are only accepted for Sham Cash payments"},400);
    }
    paidMinor+=moneyMinor(amount);
  }
  if(paidMinor!==moneyMinor(total))return json({error:"Payment amounts must exactly equal the sale total"},400);
  const customerName=b.customer_name==null?"":String(b.customer_name).trim();
  const customerPhone=b.customer_phone==null?"":String(b.customer_phone).trim();
  if(customerName.length>120||customerPhone.length>30)return json({error:"Customer details are too long"},400);
  const id=crypto.randomUUID();
  const saleNumber="POS-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,6).toUpperCase();
  const statements=[env.DB.prepare(`
    INSERT INTO pos_sales(id,store_id,cash_session_id,warehouse_id,sale_number,idempotency_key,
      customer_name,customer_phone,currency,subtotal,discount_amount,discount_reason,total,status,payment_status,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'draft','paid',?)
  `).bind(id,storeId,cashSession.id,cashSession.warehouse_id,saleNumber,key,
    customerName||null,customerPhone||null,quote.currency,quote.total,discount,discount?discountReason:null,total,session.user_id)];
  for(const item of quote.lines){
    statements.push(env.DB.prepare(`
      INSERT INTO pos_sale_items(id,sale_id,store_id,product_id,variant_id,product_name,variant_name,sku,
        quantity,unit_price,line_total,currency,pricing_mode,pricing_tier_code,cost_version_id,cost_currency,
        cost_minor_units,profit_margin_bps,rounding_increment_minor_units,sale_unit)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(),id,storeId,item.product_id,item.variant_id,item.product_name,item.variant_name,item.sku,
      item.quantity,item.unit_price,item.line_total,item.currency,item.pricing_mode,item.pricing_tier_code,
      item.cost_version_id,item.cost_currency,item.cost_minor_units,item.profit_margin_bps,item.rounding_increment_minor_units,item.sale_unit));
  }
  for(const payment of payments){
    statements.push(env.DB.prepare(`
      INSERT INTO pos_sale_payments(id,sale_id,store_id,cash_session_id,payment_method,amount,currency,
        transaction_reference,sender_name,received_by)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(),id,storeId,cashSession.id,payment.payment_method,Number(payment.amount),
      quote.currency,payment.payment_method==="shamcash"?payment.transaction_reference.trim():null,
      payment.payment_method==="shamcash"?payment.sender_name.trim():null,session.user_id));
  }
  statements.push(env.DB.prepare(
    "UPDATE pos_sales SET status='posted' WHERE id=? AND store_id=? AND status='draft'"
  ).bind(id,storeId));
  try{await env.DB.batch(statements);}
  catch(error){
    const replay=await env.DB.prepare("SELECT id,sale_number,total,currency,status FROM pos_sales WHERE store_id=? AND idempotency_key=?")
      .bind(storeId,key).first();
    if(replay)return json({status:"ok",sale:replay,replayed:true});
    const message=String(error?.message||"");
    if(/stock|warehouse/i.test(message))return json({error:"Stock changed or is insufficient. Refresh the cart and try again."},409);
    if(/shamcash|unique/i.test(message))return json({error:"This Sham Cash transaction number has already been used in this store."},409);
    return json({error:"Sale could not be posted; no sale or stock change was committed."},409);
  }
  return json({status:"ok",sale:{id,sale_number:saleNumber,currency:quote.currency,subtotal:quote.total,
    discount_amount:discount,total,status:"posted",payment_status:"paid"},items:quote.lines.map(publicPosLine)},201);
}
async function listSales(env,storeId,url){
  const rawLimit=Number(url.searchParams.get("limit")||50);
  const limit=Number.isInteger(rawLimit)?Math.min(100,Math.max(1,rawLimit)):50;
  const status=url.searchParams.get("status");
  const currency=url.searchParams.get("currency");
  const from=url.searchParams.get("from");
  const to=url.searchParams.get("to");
  if(status&&!["posted","voided","partially_refunded","refunded"].includes(status))
    return json({error:"Invalid sale status filter"},400);
  if(currency&&!["USD","SYP"].includes(currency))return json({error:"Invalid currency filter"},400);
  if(from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))return json({error:"Invalid start date"},400);
  if(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))return json({error:"Invalid end date"},400);
  const rows=await env.DB.prepare(`
    SELECT s.id,s.sale_number,s.customer_name,s.customer_phone,s.currency,s.subtotal,
      s.discount_amount,s.total,s.status,s.payment_status,s.created_at,
      COUNT(DISTINCT i.id) AS item_count,
      COALESCE(SUM(i.quantity),0) AS unit_count
    FROM pos_sales s LEFT JOIN pos_sale_items i ON i.sale_id=s.id AND i.store_id=s.store_id
    WHERE s.store_id=? AND s.status!='draft'
      AND (? IS NULL OR s.status=?) AND (? IS NULL OR s.currency=?)
      AND (? IS NULL OR date(s.created_at)>=date(?))
      AND (? IS NULL OR date(s.created_at)<=date(?))
    GROUP BY s.id
    ORDER BY s.created_at DESC,s.rowid DESC LIMIT ?
  `).bind(storeId,status||null,status||null,currency||null,currency||null,
    from||null,from||null,to||null,to||null,limit).all();
  return json({status:"ok",sales:rows.results||[],limit});
}
async function getSale(env,storeId,saleId){
  const sale=await env.DB.prepare(`
    SELECT id,sale_number,customer_name,customer_phone,currency,subtotal,discount_amount,
      discount_reason,total,status,payment_status,created_at,created_by
    FROM pos_sales WHERE id=? AND store_id=? AND status!='draft' LIMIT 1
  `).bind(saleId,storeId).first();
  if(!sale)return json({error:"Sale not found"},404);
  const [items,payments,events]=await Promise.all([
    env.DB.prepare(`SELECT id,product_id,variant_id,product_name,variant_name,sku,quantity,sale_unit,
      unit_price,line_total,currency,pricing_mode,pricing_tier_code
      FROM pos_sale_items WHERE sale_id=? AND store_id=? ORDER BY rowid`).bind(saleId,storeId).all(),
    env.DB.prepare(`SELECT payment_method,amount,currency,transaction_reference,sender_name,created_at
      FROM pos_sale_payments WHERE sale_id=? AND store_id=? ORDER BY created_at,rowid`).bind(saleId,storeId).all(),
    env.DB.prepare(`SELECT event_type,details_json,created_at FROM pos_sale_events
      WHERE sale_id=? AND store_id=? ORDER BY created_at,rowid`).bind(saleId,storeId).all()
  ]);
  return json({status:"ok",sale,items:items.results||[],payments:payments.results||[],
    events:(events.results||[]).map(event=>({...event,details:JSON.parse(event.details_json||"{}")}))});
}
export async function handlePos(request,env){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/stores\/([^/]+)\/pos\/(quote|sales(?:\/[^/]+)?|cash-sessions(?:\/[^/]+)?)$/);
  if(!match)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  let storeId;
  try{storeId=decodeURIComponent(match[1]);}catch{return json({error:"Invalid store ID"},400);}
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  const access=await getAccess(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")return json({error:"Store is unavailable"},403);
  if(!hasPermission(access,"pos.access"))return json({error:"Point-of-sale access permission required"},403);
  const resource=match[2];
  if(resource==="quote"){
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    const parsed=await readBody(request);if(parsed.error)return json({error:parsed.error},parsed.status);
    const quote=await quoteItems(env.DB,storeId,access,parsed.body.items);
    if(quote.error)return json({error:quote.error},quote.status);
    return json({status:"ok",quote:{currency:quote.currency,total:quote.total,items:quote.lines.map(publicPosLine),
      note:"Indicative quote only. Stock, permissions and prices are revalidated during final sale posting."}});
  }
  if(resource==="sales"){
    if(request.method==="GET")return listSales(env,storeId,url);
    if(request.method==="POST")return createSale(request,env,storeId,session,access);
    return json({error:"Method not allowed"},405);
  }
  const saleMatch=resource.match(/^sales\/([^/]+)$/);
  if(saleMatch){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    let saleId;try{saleId=decodeURIComponent(saleMatch[1]);}catch{return json({error:"Invalid sale ID"},400);}
    return getSale(env,storeId,saleId);
  }
  if(resource==="cash-sessions"){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    const currency=url.searchParams.get("currency");
    if(currency&&!["USD","SYP"].includes(currency))return json({error:"Invalid currency"},400);
    return json({status:"ok",session:await currentSession(env.DB,storeId,currency)});
  }
  if(resource==="cash-sessions/open"){
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    return openCashSession(request,env,storeId,session,access);
  }
  const closeMatch=resource.match(/^cash-sessions\/([^/]+)$/);
  if(closeMatch){
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    let sessionId;try{sessionId=decodeURIComponent(closeMatch[1]);}catch{return json({error:"Invalid session ID"},400);}
    return closeCashSession(request,env,storeId,session,access,sessionId);
  }
  return json({error:"Not found"},404);
}
