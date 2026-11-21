import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";
import { calculateTierPriceMinorUnits, selectPricingTier } from "../finance/tier_pricing.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function readBody(request){
  const raw=await request.text();
  if(raw.length>16000)return {error:"Request too large",status:413};
  try{
    const body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};
    return {body};
  }catch{return {error:"Invalid JSON",status:400};}
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
    SELECT id,name,sku,base_price,currency,track_inventory,stock_quantity,status
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
  if(product.track_inventory&&Number(variant?.stock_quantity??product.stock_quantity)<quantity)
    return {error:"Insufficient stock",status:409};
  const currency=product.currency||"USD";
  let unitPrice=Number(variant?.price??product.base_price);
  let appliedTier="retail";
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
      selected=selectPricingTier(quantity,resolved.filter(t=>t.tier_code===tierCode));
    }catch{
      return {error:"The selected tier is disabled, below its minimum quantity, or has no configured margin",status:409};
    }
    const cost=await db.prepare(`
      SELECT id,cost_minor_units FROM product_cost_versions
      WHERE store_id=? AND product_id=? AND
        ((? IS NOT NULL AND variant_id=?) OR variant_id IS NULL)
      ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END,effective_at DESC,created_at DESC LIMIT 1
    `).bind(storeId,productId,variant?.id||null,variant?.id||null,variant?.id||null).first();
    if(!cost)return {error:"A USD purchase cost is required before this item can be sold with automatic pricing",status:409};
    try{
      unitPrice=calculateTierPriceMinorUnits(cost.cost_minor_units,selected.profit_margin_bps,
        pricingSettings.rounding_increment_minor_units||1)/100;
    }catch{return {error:"Unable to calculate the configured selling price",status:409};}
    appliedTier=selected.tier_code;
  }else if(tierCode!=="retail"){
    return {error:"Wholesale tiers require automatic cost-plus pricing to be enabled and configured",status:409};
  }
  if(!Number.isFinite(unitPrice)||unitPrice<0)return {error:"Invalid selling price",status:409};
  const lineTotal=Math.round(unitPrice*quantity*100)/100;
  return {line:{
    product_id:product.id,variant_id:variant?.id||null,
    product_name:product.name,variant_name:variant?.name||null,sku:product.sku||null,
    quantity,currency,tier_code:appliedTier,unit_price:unitPrice,line_total:lineTotal
  }};
}

export async function handlePos(request,env){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/stores\/([^/]+)\/pos\/quote$/);
  if(!match)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  let storeId;
  try{storeId=decodeURIComponent(match[1]);}catch{return json({error:"Invalid store ID"},400);}
  const access=await getAccess(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")
    return json({error:"Store is unavailable"},403);
  if(!hasPermission(access,"pos.access"))return json({error:"Point-of-sale access permission required"},403);
  const parsed=await readBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  if(!Array.isArray(parsed.body.items)||parsed.body.items.length<1||parsed.body.items.length>50)
    return json({error:"Provide between 1 and 50 sale items"},400);
  const settings=await env.DB.prepare(
    "SELECT pricing_mode,rounding_increment_minor_units FROM store_pricing_settings WHERE store_id=?"
  ).bind(storeId).first();
  const tiers=settings?.pricing_mode==="cost_plus_margin"
    ?(await env.DB.prepare("SELECT tier_code,min_quantity,profit_margin_bps,is_enabled FROM store_pricing_tiers WHERE store_id=?").bind(storeId).all()).results||[]
    :[];
  const seen=new Set(),lines=[];
  let currency=null,total=0;
  for(const input of parsed.body.items){
    const key=String(input?.product_id||"")+":"+(input?.variant_id||"");
    if(seen.has(key))return json({error:"Duplicate product lines must be combined before quoting"},400);
    seen.add(key);
    const result=await quoteLine(env.DB,storeId,access,settings,tiers,input);
    if(result.error)return json({error:result.error},result.status);
    if(currency!==null&&currency!==result.line.currency)
      return json({error:"A POS receipt cannot mix currencies; create separate sales for each currency"},400);
    currency=result.line.currency;
    total=Math.round((total+result.line.line_total)*100)/100;
    lines.push(result.line);
  }
  return json({status:"ok",quote:{currency,total,items:lines,expires_in_seconds:60,
    note:"Indicative quote only. Stock, permissions and prices must be revalidated during final sale posting."}});
}
