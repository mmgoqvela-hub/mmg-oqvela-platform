import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function bodyOf(request){
  const raw=await request.text();
  if(raw.length>12000)return {error:"Request too large",status:413};
  try{const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};return {body};}
  catch{return {error:"Invalid JSON",status:400};}
}
function validText(v,min,max){return typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max;}
function hasPermission(access,code){
  return ["owner","admin"].includes(access?.account_role)||String(access?.permissions||"").split(",").includes(code);
}
async function accessFor(db,storeId,userId){
  return db.prepare(`
    SELECT s.status AS store_status,a.status AS account_status,au.role AS account_role,
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
export async function handlePosVoids(request,env){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/stores\/([^/]+)\/pos\/sales\/([^/]+)\/void$/);
  if(!match)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  let storeId,saleId;
  try{storeId=decodeURIComponent(match[1]);saleId=decodeURIComponent(match[2]);}
  catch{return json({error:"Invalid store or sale ID"},400);}
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  const access=await accessFor(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")return json({error:"Store is unavailable"},403);
  if(!hasPermission(access,"pos.access"))return json({error:"Point-of-sale access permission required"},403);
  if(!hasPermission(access,"pos.sale.void"))return json({error:"POS sale void permission required"},403);
  const parsed=await bodyOf(request);if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body,key=typeof b.idempotency_key==="string"?b.idempotency_key.trim():"";
  const reason=typeof b.reason==="string"?b.reason.trim():"";
  if(!validText(key,16,120)||!validText(reason,3,500))return json({error:"A unique idempotency key and a reason are required"},400);
  const replay=await env.DB.prepare(`
    SELECT id,void_number,sale_id,refund_total,currency,status FROM pos_sale_voids
    WHERE store_id=? AND idempotency_key=?
  `).bind(storeId,key).first();
  if(replay){
    if(replay.sale_id!==saleId)return json({error:"This idempotency key was already used for another sale"},409);
    return json({status:"ok",void:replay,replayed:true});
  }
  const sale=await env.DB.prepare(`
    SELECT id,sale_number,cash_session_id,warehouse_id,currency,total,status
    FROM pos_sales WHERE id=? AND store_id=?
  `).bind(saleId,storeId).first();
  if(!sale)return json({error:"Sale not found"},404);
  if(sale.status!=="posted")return json({error:"Only a posted sale with no returns can be voided. Use the return workflow for returned or refunded sales."},409);
  const existingReturn=await env.DB.prepare("SELECT id FROM pos_sale_returns WHERE sale_id=? AND store_id=? AND status='posted' LIMIT 1")
    .bind(saleId,storeId).first();
  if(existingReturn)return json({error:"A sale with posted returns cannot be voided. Continue using the return workflow."},409);
  const items=await env.DB.prepare(`
    SELECT id,product_id,variant_id,quantity,currency FROM pos_sale_items
    WHERE sale_id=? AND store_id=? ORDER BY rowid
  `).bind(saleId,storeId).all();
  if(!items.results?.length)return json({error:"Sale items are missing; this sale cannot be safely voided"},409);
  const payments=await env.DB.prepare(`
    SELECT payment_method,amount,currency FROM pos_sale_payments
    WHERE sale_id=? AND store_id=? ORDER BY rowid
  `).bind(saleId,storeId).all();
  const paymentLines=[];
  for(const p of payments.results||[]){
    const method=p.payment_method==="cash"?"cash":p.payment_method==="card"?"card":"digital";
    const prior=paymentLines.find(x=>x.payment_method===method);
    if(prior)prior.amount=Math.round((prior.amount+Number(p.amount))*100)/100;
    else paymentLines.push({payment_method:method,amount:Number(p.amount),currency:p.currency});
  }
  const paid=paymentLines.reduce((sum,p)=>sum+Math.round(p.amount*100),0);
  if(paid!==Math.round(Number(sale.total)*100))return json({error:"Original payment ledger does not match the sale total; request an administrator review"},409);
  const voidId=crypto.randomUUID();
  const voidNumber="VOID-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,6).toUpperCase();
  const statements=[env.DB.prepare(`
    INSERT INTO pos_sale_voids(id,store_id,sale_id,void_number,idempotency_key,reason,currency,refund_total,created_by)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(voidId,storeId,saleId,voidNumber,key,reason,sale.currency,Number(sale.total),session.user_id)];
  for(const item of items.results){
    const voidItemId=crypto.randomUUID();
    statements.push(env.DB.prepare(`
      INSERT INTO pos_sale_void_items(id,void_id,sale_id,store_id,sale_item_id,product_id,variant_id,quantity,currency)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(voidItemId,voidId,saleId,storeId,item.id,item.product_id,item.variant_id,item.quantity,item.currency));
    const product=await env.DB.prepare("SELECT track_inventory FROM products WHERE id=? AND store_id=?")
      .bind(item.product_id,storeId).first();
    if(product?.track_inventory){
      const original=await env.DB.prepare("SELECT id,warehouse_id FROM inventory_movements WHERE store_id=? AND idempotency_key=? LIMIT 1")
        .bind(storeId,"pos-sale:"+saleId+":"+item.id).first();
      if(!original)return json({error:"Original stock movement is missing; this sale cannot safely restore inventory"},409);
      statements.push(env.DB.prepare(`
        INSERT INTO inventory_movements(id,store_id,product_id,variant_id,movement_type,quantity_change,
          reference_id,notes,created_by,warehouse_id,unit_code,movement_reason,source_type,source_id,
          idempotency_key,effective_at,posted_at,reversal_of_id)
        VALUES(?,?,?,?,'return',?,?,?,?,?,'unit','pos_void','pos_void',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)
      `).bind(crypto.randomUUID(),storeId,item.product_id,item.variant_id,item.quantity,saleId,
        "POS void "+voidNumber,session.user_id,original.warehouse_id,voidId,
        "pos-void:"+voidId+":"+item.id,original.id));
      if(item.variant_id){
        statements.push(env.DB.prepare("UPDATE product_variants SET stock_quantity=stock_quantity+? WHERE id=? AND product_id=? AND store_id=?")
          .bind(item.quantity,item.variant_id,item.product_id,storeId));
      }else{
        statements.push(env.DB.prepare("UPDATE products SET stock_quantity=stock_quantity+? WHERE id=? AND store_id=?")
          .bind(item.quantity,item.product_id,storeId));
      }
    }
  }
  for(const p of paymentLines){
    statements.push(env.DB.prepare(`
      INSERT INTO pos_sale_void_payments(id,void_id,sale_id,store_id,payment_method,amount,currency,created_by)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(),voidId,saleId,storeId,p.payment_method,p.amount,p.currency,session.user_id));
  }
  statements.push(env.DB.prepare("UPDATE pos_sale_voids SET status='posted',posted_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=? AND status='draft'")
    .bind(voidId,storeId));
  try{await env.DB.batch(statements);}
  catch(error){
    const prior=await env.DB.prepare("SELECT id,void_number,sale_id,refund_total,currency,status FROM pos_sale_voids WHERE store_id=? AND idempotency_key=?")
      .bind(storeId,key).first();
    if(prior)return json({status:"ok",void:prior,replayed:true});
    const message=String(error?.message||"");
    if(/POS void|stock|inventory/i.test(message))return json({error:"The sale changed or inventory could not be reversed. Refresh and review before retrying."},409);
    return json({error:"Void was not committed; no refund or stock change was recorded."},409);
  }
  return json({status:"ok",void:{id:voidId,void_number:voidNumber,sale_id:saleId,
    refund_total:Number(sale.total),currency:sale.currency,status:"posted",refund_payments:paymentLines}},201);
}
