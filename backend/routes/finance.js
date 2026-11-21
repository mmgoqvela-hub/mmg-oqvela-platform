import {getAuthenticatedSession,validOrigin} from "../security/authentication.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
async function bodyOf(request){
  const raw=await request.text();
  if(raw.length>12000)return {error:"Request too large",status:413};
  try{const body=JSON.parse(raw);if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};return {body};}
  catch{return {error:"Invalid JSON",status:400};}
}
function validText(value,min,max){return typeof value==="string"&&value.trim().length>=min&&value.trim().length<=max;}
function validMoney(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>0&&n<=1e12&&Number.isInteger(n*100);
}
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
function dateValue(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+"T00:00:00Z"));}
export async function handleFinance(request,env){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/stores\/([^/]+)\/finance\/(expenses|cashbox(?:\/(?:movements|sessions))?)$/);
  if(!match)return null;
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  let storeId;try{storeId=decodeURIComponent(match[1]);}catch{return json({error:"Invalid store ID"},400);}
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session)return json({error:"Authentication required"},401);
  const access=await accessFor(env.DB,storeId,session.user_id);
  if(!access)return json({error:"Store not found"},404);
  if(access.store_status!=="active"||access.account_status!=="active")return json({error:"Store is unavailable"},403);
  const resource=match[2];

  if(resource==="expenses"){
    if(request.method==="GET"){
      if(!hasPermission(access,"finance.expenses.read"))return json({error:"Expense read permission required"},403);
      const currency=url.searchParams.get("currency");
      const from=url.searchParams.get("from"),to=url.searchParams.get("to");
      if(currency&&!["USD","SYP"].includes(currency))return json({error:"Invalid currency"},400);
      if((from&&!dateValue(from))||(to&&!dateValue(to))||(from&&to&&from>to))return json({error:"Invalid date range"},400);
      const rows=await env.DB.prepare(`
        SELECT id,expense_number,category,description,amount,currency,payment_method,
          payment_reference,cash_session_id,created_by,created_at
        FROM store_expenses
        WHERE store_id=? AND (? IS NULL OR currency=?)
          AND (? IS NULL OR date(created_at)>=?)
          AND (? IS NULL OR date(created_at)<=?)
        ORDER BY created_at DESC,rowid DESC LIMIT 250
      `).bind(storeId,currency,currency,from,from,to,to).all();
      return json({status:"ok",expenses:rows.results||[]});
    }
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    if(!hasPermission(access,"finance.expenses.manage"))return json({error:"Expense management permission required"},403);
    const parsed=await bodyOf(request);if(parsed.error)return json({error:parsed.error},parsed.status);
    const b=parsed.body,key=typeof b.idempotency_key==="string"?b.idempotency_key.trim():"";
    const category=typeof b.category==="string"?b.category.trim():"";
    const description=typeof b.description==="string"?b.description.trim():"";
    const amount=Number(b.amount),currency=b.currency,method=b.payment_method;
    const cashSessionId=typeof b.cash_session_id==="string"?b.cash_session_id.trim():"";
    const reference=typeof b.payment_reference==="string"?b.payment_reference.trim():"";
    if(!validText(key,16,120)||!validText(category,2,80)||!validText(description,2,500)||
      !validMoney(amount)||!["USD","SYP"].includes(currency)||
      !["cash","card","digital","shamcash","bank_transfer"].includes(method))
      return json({error:"Invalid expense details"},400);
    if(method==="cash"&&!cashSessionId)return json({error:"An open cash session is required for cash expenses"},400);
    if(method!=="cash"&&cashSessionId)return json({error:"Only cash expenses can be linked to a cash session"},400);
    if(["shamcash","bank_transfer"].includes(method)&&!validText(reference,3,160))
      return json({error:"A payment reference is required for this payment method"},400);
    const prior=await env.DB.prepare("SELECT id,expense_number,amount,currency,payment_method FROM store_expenses WHERE store_id=? AND idempotency_key=?")
      .bind(storeId,key).first();
    if(prior)return json({status:"ok",expense:prior,replayed:true});
    if(method==="cash"){
      const cashSession=await env.DB.prepare("SELECT id,currency,status FROM pos_cash_sessions WHERE id=? AND store_id=?")
        .bind(cashSessionId,storeId).first();
      if(!cashSession||cashSession.status!=="open"||cashSession.currency!==currency)
        return json({error:"An open cash session in the same currency is required"},409);
    }
    const id=crypto.randomUUID();
    const expenseNumber="EXP-"+Date.now().toString(36).toUpperCase()+"-"+crypto.randomUUID().slice(0,6).toUpperCase();
    try{
      await env.DB.prepare(`
        INSERT INTO store_expenses(id,store_id,expense_number,idempotency_key,category,description,
          amount,currency,payment_method,payment_reference,cash_session_id,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(id,storeId,expenseNumber,key,category,description,amount,currency,method,
        reference||null,cashSessionId||null,session.user_id).run();
    }catch(error){
      const priorAfter=await env.DB.prepare("SELECT id,expense_number,amount,currency,payment_method FROM store_expenses WHERE store_id=? AND idempotency_key=?")
        .bind(storeId,key).first();
      if(priorAfter)return json({status:"ok",expense:priorAfter,replayed:true});
      return json({error:"Expense was not recorded; verify the cash session and try again"},409);
    }
    return json({status:"ok",expense:{id,expense_number:expenseNumber,category,description,amount,currency,
      payment_method:method,payment_reference:reference||null,cash_session_id:cashSessionId||null}},201);
  }

  if(resource==="cashbox/sessions"){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(!hasPermission(access,"finance.cashbox.read")&&!hasPermission(access,"finance.cashbox.manage"))return json({error:"Cashbox read permission required"},403);
    const currency=url.searchParams.get("currency");
    if(currency&&!["USD","SYP"].includes(currency))return json({error:"Invalid currency"},400);
    const rows=await env.DB.prepare(`
      SELECT id,currency,opening_cash_amount,opened_at
      FROM pos_cash_sessions WHERE store_id=? AND status='open'
        AND (? IS NULL OR currency=?) ORDER BY opened_at DESC
    `).bind(storeId,currency,currency).all();
    return json({status:"ok",sessions:rows.results||[]});
  }

  if(resource==="cashbox/movements"){
    if(request.method==="GET"){
      if(!hasPermission(access,"finance.cashbox.read"))return json({error:"Cashbox read permission required"},403);
      const sessionId=url.searchParams.get("cash_session_id");
      if(!validText(sessionId,1,120))return json({error:"Cash session ID is required"},400);
      const rows=await env.DB.prepare(`
        SELECT id,cash_session_id,direction,movement_type,amount,currency,description,
          source_type,source_id,created_by,created_at
        FROM pos_cash_movements WHERE store_id=? AND cash_session_id=?
        ORDER BY created_at DESC,rowid DESC LIMIT 250
      `).bind(storeId,sessionId).all();
      return json({status:"ok",movements:rows.results||[]});
    }
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    if(!hasPermission(access,"finance.cashbox.manage"))return json({error:"Cashbox management permission required"},403);
    const parsed=await bodyOf(request);if(parsed.error)return json({error:parsed.error},parsed.status);
    const b=parsed.body,key=typeof b.idempotency_key==="string"?b.idempotency_key.trim():"";
    const sessionId=typeof b.cash_session_id==="string"?b.cash_session_id.trim():"";
    const direction=b.direction,amount=Number(b.amount),description=typeof b.description==="string"?b.description.trim():"";
    if(!validText(key,16,120)||!validText(sessionId,1,120)||!["in","out"].includes(direction)||
      !validMoney(amount)||!validText(description,2,500))
      return json({error:"Invalid cashbox movement details"},400);
    const prior=await env.DB.prepare("SELECT id,direction,movement_type,amount,currency FROM pos_cash_movements WHERE store_id=? AND idempotency_key=?")
      .bind(storeId,key).first();
    if(prior)return json({status:"ok",movement:prior,replayed:true});
    const cashSession=await env.DB.prepare("SELECT id,currency,status FROM pos_cash_sessions WHERE id=? AND store_id=?")
      .bind(sessionId,storeId).first();
    if(!cashSession||cashSession.status!=="open")return json({error:"Open cash session not found"},409);
    const id=crypto.randomUUID();
    try{
      await env.DB.prepare(`
        INSERT INTO pos_cash_movements(id,store_id,cash_session_id,direction,movement_type,amount,currency,
          description,source_type,source_id,idempotency_key,created_by)
        VALUES(?,?,?,?,?,?,?,?,'manual',NULL,?,?)
      `).bind(id,storeId,sessionId,direction,direction==="in"?"deposit":"withdrawal",amount,
        cashSession.currency,description,key,session.user_id).run();
    }catch{return json({error:"Cashbox movement was not recorded; the cash session may have closed"},409);}
    return json({status:"ok",movement:{id,cash_session_id:sessionId,direction,
      movement_type:direction==="in"?"deposit":"withdrawal",amount,currency:cashSession.currency,description}},201);
  }
  return json({error:"Not found"},404);
}
