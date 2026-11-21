import { getAuthenticatedSession, validOrigin } from "../security/authentication.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function bodyOf(request){
  const raw=await request.text();
  if(raw.length>24000)return {error:"Request too large",status:413};
  try{const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};return {body};}
  catch{return {error:"Invalid JSON",status:400};}
}
function hasPermission(access,code){
  return ["owner","admin"].includes(access?.account_role)||
    String(access?.permissions||"").split(",").includes(code);
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
function validText(v,min,max){return typeof v==="string"&&v.trim().length>=min&&v.trim().length<=max;}
function validMoney(v){const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1e12&&Math.abs(n*100-Math.round(n*100))<1e-7;}
export async function handlePosReturns(request,env){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/stores\/([^/]+)\/pos\/sales\/([^/]+)\/returns$/);
  if(!match)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  let storeId,saleId;
  try{storeId=decodeURIComponent(match[1]);saleId=decodeURIComponent(match[2]);}
  catch{return json({error:"Invalid store or sale ID"},400);}
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  const access=await accessFor(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")return json({error:"Store is unavailable"},403);
  if(!hasPermission(access,"pos.access"))return json({error:"Point-of-sale access permission required"},403);
  if(request.method==="GET"){
    const sale=await env.DB.prepare("SELECT id FROM pos_sales WHERE id=? AND store_id=? AND status!='draft'").bind(saleId,storeId).first();
    if(!sale)return json({error:"Sale not found"},404);
    const rows=await env.DB.prepare(`
      SELECT r.id,r.return_number,r.reason,r.currency,r.refund_total,r.status,r.created_at,r.posted_at,
        (SELECT COUNT(*) FROM pos_sale_return_items i WHERE i.return_id=r.id AND i.store_id=r.store_id) AS item_count
      FROM pos_sale_returns r WHERE r.sale_id=? AND r.store_id=? AND r.status='posted'
      ORDER BY r.created_at DESC,r.rowid DESC
    `).bind(saleId,storeId).all();
    const returns=[];
    for(const row of rows.results||[]){
      const [items,payments]=await Promise.all([
        env.DB.prepare(`
          SELECT ri.sale_item_id,ri.quantity,ri.restock,si.product_name,si.variant_name
          FROM pos_sale_return_items ri JOIN pos_sale_items si
            ON si.id=ri.sale_item_id AND si.sale_id=ri.sale_id AND si.store_id=ri.store_id
          WHERE ri.return_id=? AND ri.store_id=? ORDER BY ri.rowid
        `).bind(row.id,storeId).all(),
        env.DB.prepare(`
          SELECT payment_method,amount,currency,reference
          FROM pos_sale_refund_payments WHERE return_id=? AND store_id=? ORDER BY rowid
        `).bind(row.id,storeId).all()
      ]);
      returns.push({...row,items:items.results||[],payments:payments.results||[]});
    }
    return json({status:"ok",returns});
  }
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(!hasPermission(access,"pos.sale.return"))return json({error:"POS return permission required"},403);
  const parsed=await bodyOf(request);if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body;
  const key=typeof b.idempotency_key==="string"?b.idempotency_key.trim():"";
  const reason=typeof b.reason==="string"?b.reason.trim():"";
  if(!validText(key,16,120)||!validText(reason,3,500))return json({error:"A unique idempotency key and a reason are required"},400);
  const replay=await env.DB.prepare("SELECT id,return_number,refund_total,currency,status FROM pos_sale_returns WHERE store_id=? AND idempotency_key=?")
    .bind(storeId,key).first();
  if(replay)return json({status:"ok",return:replay,replayed:true});
  const sale=await env.DB.prepare("SELECT id,sale_number,currency,subtotal,total,status,warehouse_id FROM pos_sales WHERE id=? AND store_id=? AND status IN ('posted','partially_refunded')")
    .bind(saleId,storeId).first();
  if(!sale)return json({error:"Sale not found or already fully refunded"},404);
  if(!Array.isArray(b.items)||b.items.length<1||b.items.length>50)return json({error:"Provide at least one returned sale item"},400);
  const refundTotal=Number(b.refund_total);
  if(!validMoney(refundTotal)||refundTotal<=0)return json({error:"Refund total must be greater than zero"},400);
  if(!Array.isArray(b.refund_payments)||(refundTotal>0&&b.refund_payments.length<1)||b.refund_payments.length>5)
    return json({error:"Refund payment lines must reconcile with the refund total"},400);
  let paid=0;
  for(const p of b.refund_payments){
    if(!["cash","card","digital"].includes(p?.payment_method)||!validMoney(p?.amount)||Number(p.amount)<=0||
      (p.reference!=null&&String(p.reference).length>120))return json({error:"Invalid refund payment line"},400);
    paid+=Math.round(Number(p.amount)*100);
  }
  if(paid!==Math.round(refundTotal*100))return json({error:"Refund payment amounts must equal the refund total"},400);
  const refunded=await env.DB.prepare("SELECT COALESCE(SUM(refund_total),0) AS amount FROM pos_sale_returns WHERE sale_id=? AND store_id=? AND status='posted'")
    .bind(saleId,storeId).first();
  if(Math.round((Number(refunded?.amount||0)+refundTotal)*100)>Math.round(Number(sale.total)*100))
    return json({error:"Cumulative refunds cannot exceed the original sale total"},409);
  const saleItems=await env.DB.prepare(`
    SELECT id,product_id,variant_id,quantity,line_total,currency,sale_unit FROM pos_sale_items
    WHERE sale_id=? AND store_id=?
  `).bind(saleId,storeId).all();
  const itemMap=new Map((saleItems.results||[]).map(item=>[item.id,item]));
  const unique=new Set(),statements=[];let returnValueLimit=0;
  const returnId=crypto.randomUUID();
  const returnNumber="RET-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,6).toUpperCase();
  statements.push(env.DB.prepare(`
    INSERT INTO pos_sale_returns(id,store_id,sale_id,return_number,idempotency_key,reason,currency,refund_total,created_by)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).bind(returnId,storeId,saleId,returnNumber,key,reason,sale.currency,refundTotal,session.user_id));
  const normalized=[];
  for(const input of b.items){
    const saleItemId=typeof input?.sale_item_id==="string"?input.sale_item_id:"";
    const item=itemMap.get(saleItemId);
    const quantity=input?.quantity;
    const restock=input?.restock!==false;
    if(!item||unique.has(saleItemId)||!Number.isInteger(quantity)||quantity<1||quantity>999)
      return json({error:"Invalid or duplicate returned sale item"},400);
    unique.add(saleItemId);
    returnValueLimit+=Number(item.line_total)*quantity/Number(item.quantity)*(Number(sale.subtotal)>0?Number(sale.total)/Number(sale.subtotal):0);
    const previously=await env.DB.prepare(`
      SELECT COALESCE(SUM(ri.quantity),0) AS quantity
      FROM pos_sale_return_items ri JOIN pos_sale_returns r
        ON r.id=ri.return_id AND r.store_id=ri.store_id
      WHERE ri.sale_item_id=? AND ri.store_id=? AND r.status='posted'
    `).bind(saleItemId,storeId).first();
    if(quantity+Number(previously?.quantity||0)>item.quantity)
      return json({error:"Returned quantity exceeds the remaining sold quantity"},409);
    const returnItemId=crypto.randomUUID();
    statements.push(env.DB.prepare(`
      INSERT INTO pos_sale_return_items(id,return_id,sale_id,store_id,sale_item_id,product_id,variant_id,quantity,restock,currency,sale_unit)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).bind(returnItemId,returnId,saleId,storeId,saleItemId,item.product_id,item.variant_id,quantity,restock?1:0,item.currency,item.sale_unit||\"piece\"));
    if(restock){
      const original=await env.DB.prepare("SELECT id,warehouse_id FROM inventory_movements WHERE store_id=? AND idempotency_key=? LIMIT 1")
        .bind(storeId,"pos-sale:"+saleId+":"+saleItemId).first();
      const product=await env.DB.prepare("SELECT track_inventory FROM products WHERE id=? AND store_id=?")
        .bind(item.product_id,storeId).first();
      if(product?.track_inventory){
        if(!original)return json({error:"Original stock movement is missing; this return cannot safely restock the item"},409);
        const variant=item.variant_id;
        statements.push(env.DB.prepare(`
          INSERT INTO inventory_movements(id,store_id,product_id,variant_id,movement_type,quantity_change,
            reference_id,notes,created_by,warehouse_id,unit_code,movement_reason,source_type,source_id,
            idempotency_key,effective_at,posted_at,reversal_of_id)
          VALUES(?,?,?,?, 'return',?,?,?,?,?,?,'pos_return','pos_return',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)
        `).bind(crypto.randomUUID(),storeId,item.product_id,variant,quantity*(item.sale_unit==="kg"?50:1),saleId,
          "POS return "+returnNumber,session.user_id,original.warehouse_id,item.sale_unit==="kg"?"g":"piece",returnId,
          "pos-return:"+returnId+":"+returnItemId,original.id));
        if(variant){
          statements.push(env.DB.prepare("UPDATE product_variants SET stock_quantity=stock_quantity+? WHERE id=? AND product_id=? AND store_id=?")
            .bind(quantity*(item.sale_unit==="kg"?50:1),variant,item.product_id,storeId));
        }else{
          statements.push(env.DB.prepare("UPDATE products SET stock_quantity=stock_quantity+? WHERE id=? AND store_id=?")
            .bind(quantity*(item.sale_unit==="kg"?50:1),item.product_id,storeId));
        }
      }
    }
    normalized.push({sale_item_id:saleItemId,quantity,restock});
  }
  if(refundTotal>Math.round(returnValueLimit*100)/100+0.000001)
    return json({error:"Refund exceeds the value of the returned sale items"},409);
  for(const p of b.refund_payments||[]){
    statements.push(env.DB.prepare(`
      INSERT INTO pos_sale_refund_payments(id,return_id,sale_id,store_id,payment_method,amount,currency,reference,created_by)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(),returnId,saleId,storeId,p.payment_method,Number(p.amount),sale.currency,
      p.reference==null?null:String(p.reference).trim()||null,session.user_id));
  }
  statements.push(env.DB.prepare("UPDATE pos_sale_returns SET status='posted',posted_at=CURRENT_TIMESTAMP WHERE id=? AND store_id=? AND status='draft'")
    .bind(returnId,storeId));
  try{await env.DB.batch(statements);}
  catch(error){
    const prior=await env.DB.prepare("SELECT id,return_number,refund_total,currency,status FROM pos_sale_returns WHERE store_id=? AND idempotency_key=?")
      .bind(storeId,key).first();
    if(prior)return json({status:"ok",return:prior,replayed:true});
    const message=String(error?.message||"");
    if(/Returned quantity|excessive inventory reversal|Insufficient warehouse stock/i.test(message))
      return json({error:"Return quantity or available stock changed. Refresh the sale and try again."},409);
    return json({error:"Return was not committed; no refund or stock change was recorded."},409);
  }
  return json({status:"ok",return:{id:returnId,return_number:returnNumber,sale_id:saleId,
    refund_total:refundTotal,currency:sale.currency,status:"posted",items:normalized}},201);
}
