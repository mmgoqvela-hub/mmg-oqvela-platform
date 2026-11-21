import { validOrigin } from "../security/authentication.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Pragma":"no-cache"
  }});
}
function normalizeCustomerPhone(value){return String(value||"").replace(/[\s()-]/g,"");}
function randomHex(bytes=32){return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,"0")).join("");}
async function sha256(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
async function passwordDigest(password,saltHex){
  const salt=new Uint8Array(saltHex.match(/.{2}/g).map(v=>parseInt(v,16)));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:210000,hash:"SHA-256"},key,256);
  return Array.from(new Uint8Array(bits),b=>b.toString(16).padStart(2,"0")).join("");
}
function constantTimeEqual(a,b){
  if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function readBody(request,max=10000){
  const raw=await request.text();
  if(raw.length>max)return {error:"Request too large",status:413};
  try{
    const body=JSON.parse(raw);
    if(!body||typeof body!=="object"||Array.isArray(body))return {error:"Invalid request body",status:400};
    return {body};
  }catch{return {error:"Invalid JSON",status:400};}
}
async function activeStore(db,slug){
  return db.prepare(`
    SELECT s.id,s.name,s.slug,s.whatsapp_phone FROM stores s
    JOIN accounts a ON a.id=s.account_id
    WHERE s.slug=? AND s.status='active' AND a.status='active'
      AND EXISTS (
        SELECT 1 FROM store_subscriptions ss
        WHERE (ss.store_id=s.id OR (ss.is_trial=1 AND ss.trial_account_id=s.account_id))
          AND ss.status='active'
          AND (ss.expires_at IS NULL OR ss.expires_at>CURRENT_TIMESTAMP)
      )
    LIMIT 1
  `).bind(slug).first();
}
function requestCustomerToken(request){
  return request.headers.get("X-Customer-Token")||
    (request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
}
async function readIdentity(request,db,storeId){
  const token=requestCustomerToken(request);
  if(!/^[a-f0-9]{64}$/i.test(token))return null;
  const hash=await sha256(token);
  const guest=await db.prepare(`
    SELECT id,store_id,customer_phone_key,customer_name,0 AS is_account
    FROM store_customer_identities
    WHERE store_id=? AND access_token_hash=? AND revoked_at IS NULL
    LIMIT 1
  `).bind(storeId,hash).first();
  if(guest)return guest;
  return db.prepare(`
    SELECT i.id,i.store_id,i.customer_phone_key,i.customer_name,1 AS is_account
    FROM store_customer_account_sessions cs
    JOIN store_customer_accounts a ON a.id=cs.account_id AND a.store_id=?
    JOIN store_customer_identities i ON i.id=a.customer_identity_id AND i.store_id=a.store_id
    WHERE cs.token_hash=? AND cs.revoked_at IS NULL AND cs.expires_at>CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(storeId,hash).first();
}
async function enforceCustomerAuthLimit(db,storeId,phoneKey){
  const phoneHash=await sha256(phoneKey);
  const row=await db.prepare(`
    INSERT INTO store_customer_auth_rate_limits(store_id,phone_hash,window_started_at,attempt_count)
    VALUES(?,?,CURRENT_TIMESTAMP,1)
    ON CONFLICT(store_id,phone_hash) DO UPDATE SET
      window_started_at=CASE WHEN window_started_at<=datetime('now','-10 minutes') THEN CURRENT_TIMESTAMP ELSE window_started_at END,
      attempt_count=CASE WHEN window_started_at<=datetime('now','-10 minutes') THEN 1 ELSE attempt_count+1 END
    WHERE window_started_at<=datetime('now','-10 minutes') OR attempt_count<5
    RETURNING attempt_count
  `).bind(storeId,phoneHash).first();
  return Boolean(row);
}
async function issueAccountSession(db,accountId,identityId){
  const token=randomHex(32),tokenHash=await sha256(token);
  await db.prepare(`
    INSERT INTO store_customer_account_sessions(id,account_id,token_hash,expires_at)
    VALUES(?,?,?,datetime('now','+30 days'))
  `).bind(crypto.randomUUID(),accountId,tokenHash).run();
  return {customer_access_token:token,customer_mode:"account",customer_identity_id:identityId};
}
async function handleCustomerAccount(request,env,store,action){
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(!validOrigin(request))return json({error:"Invalid origin"},403);
  const token=requestCustomerToken(request);
  if(action==="logout"){
    if(!/^[a-f0-9]{64}$/i.test(token))return json({error:"Customer session not found"},401);
    const result=await env.DB.prepare(`
      UPDATE store_customer_account_sessions SET revoked_at=CURRENT_TIMESTAMP
      WHERE token_hash=? AND revoked_at IS NULL
    `).bind(await sha256(token)).run();
    return result.meta?.changes?json({status:"ok"}):json({error:"Customer session not found"},404);
  }

  const parsed=await readBody(request);
  if(parsed.error)return json({error:parsed.error},parsed.status);
  const b=parsed.body;
  const phone=typeof b.customer_phone==="string"?b.customer_phone.trim():"";
  const phoneKey=normalizeCustomerPhone(phone);
  const password=typeof b.password==="string"?b.password:"";
  if(phoneKey.replace(/\D/g,"").length<6||phoneKey.length>30||password.length<10||password.length>128)
    return json({error:"Enter a valid phone number and a password of at least 10 characters"},400);
  if(!await enforceCustomerAuthLimit(env.DB,store.id,phoneKey))
    return json({error:"Too many attempts. Try again in 10 minutes."},429);

  if(action==="login"){
    const account=await env.DB.prepare(`
      SELECT id,customer_identity_id,password_salt,password_hash
      FROM store_customer_accounts
      WHERE store_id=? AND customer_phone_key=? LIMIT 1
    `).bind(store.id,phoneKey).first();
    if(!account)return json({error:"Phone number or password is incorrect"},401);
    const candidate=await passwordDigest(password,account.password_salt);
    if(!constantTimeEqual(candidate,account.password_hash))
      return json({error:"Phone number or password is incorrect"},401);
    try{return json({status:"ok",...(await issueAccountSession(env.DB,account.id,account.customer_identity_id))});}
    catch{return json({error:"Unable to start customer session"},500);}
  }

  if(action==="register"){
    const name=typeof b.customer_name==="string"?b.customer_name.trim():"";
    if(name.length<2||name.length>120)return json({error:"Enter your name"},400);
    const existing=await env.DB.prepare("SELECT id FROM store_customer_accounts WHERE store_id=? AND customer_phone_key=? LIMIT 1").bind(store.id,phoneKey).first();
    if(existing)return json({error:"An account already exists for this phone number. Please sign in."},409);
    let identity=null,identityInsert=null;
    const guestToken=typeof b.customer_access_token==="string"?b.customer_access_token.trim():token;
    if(guestToken){
      if(!/^[a-f0-9]{64}$/i.test(guestToken))return json({error:"Invalid guest QR code"},401);
      identity=await env.DB.prepare(`
        SELECT id,customer_phone_key FROM store_customer_identities
        WHERE store_id=? AND access_token_hash=? AND revoked_at IS NULL LIMIT 1
      `).bind(store.id,await sha256(guestToken)).first();
      if(!identity||identity.customer_phone_key!==phoneKey)
        return json({error:"The guest QR code does not match this phone number"},401);
    }else{
      const internalToken=randomHex(32);
      identity={id:crypto.randomUUID(),customer_phone_key:phoneKey};
      identityInsert=env.DB.prepare(`
        INSERT INTO store_customer_identities(id,store_id,customer_phone_key,customer_name,access_token_hash)
        VALUES(?,?,?,?,?)
      `).bind(identity.id,store.id,phoneKey,name,await sha256(internalToken));
    }
    const salt=randomHex(16),passwordHash=await passwordDigest(password,salt);
    const accountId=crypto.randomUUID(),sessionToken=randomHex(32),sessionHash=await sha256(sessionToken);
    const statements=[];
    if(identityInsert)statements.push(identityInsert);
    statements.push(env.DB.prepare(`
      UPDATE store_customer_identities SET customer_name=?,last_seen_at=CURRENT_TIMESTAMP
      WHERE id=? AND store_id=?
    `).bind(name,identity.id,store.id));
    statements.push(env.DB.prepare(`
      INSERT INTO store_customer_accounts(id,store_id,customer_identity_id,customer_phone_key,password_salt,password_hash)
      VALUES(?,?,?,?,?,?)
    `).bind(accountId,store.id,identity.id,phoneKey,salt,passwordHash));
    statements.push(env.DB.prepare(`
      INSERT INTO store_customer_account_sessions(id,account_id,token_hash,expires_at)
      VALUES(?,?,?,datetime('now','+30 days'))
    `).bind(crypto.randomUUID(),accountId,sessionHash));
    try{
      await env.DB.batch(statements);
      return json({status:"ok",customer_access_token:sessionToken,customer_mode:"account",customer_identity_id:identity.id},201);
    }catch(error){
      if(/unique/i.test(String(error?.message||"")))return json({error:"An account already exists for this phone number"},409);
      return json({error:"Unable to create customer account"},409);
    }
  }
  return json({error:"Not found"},404);
}

export async function handlePublicCustomerPortal(request,env){
  const url=new URL(request.url);
  const accountMatch=url.pathname.match(/^\/api\/public\/stores\/([a-z0-9-]+)\/customer\/account\/(register|login|logout)$/);
  const match=url.pathname.match(/^\/api\/public\/stores\/([a-z0-9-]+)\/customer\/(orders|notifications)(?:\/([^/]+)\/read)?$/);
  if(!match&&!accountMatch)return null;
  const slug=(match||accountMatch)[1];
  const store=await activeStore(env.DB,slug);
  if(!store)return json({error:"Store is unavailable"},404);
  if(accountMatch)return handleCustomerAccount(request,env,store,accountMatch[2]);
  const [, ,resource,notificationId]=match;
  if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed"},405);
  if(request.method==="POST"&&!validOrigin(request))return json({error:"Invalid origin"},403);
  const identity=await readIdentity(request,env.DB,store.id);
  if(!identity)return json({error:"Customer access token is invalid or has been revoked"},401);

  try{
    if(resource==="orders"){
      if(request.method!=="GET")return json({error:"Method not allowed"},405);
      const rows=await env.DB.prepare(`
        SELECT id,order_number,customer_name,customer_phone,customer_email,customer_notes,shipping_address,
          store_phone_snapshot,payment_method,customer_payment_method,payment_status,order_status,
          customer_decision,rejection_reason,subtotal,delivery_fee,total,currency,
          fulfillment_method,created_at,updated_at,accepted_at,rejected_at,
          delivered_at,payment_collected_at
        FROM store_orders
        WHERE store_id=? AND customer_identity_id=?
        ORDER BY created_at DESC LIMIT 100
      `).bind(store.id,identity.id).all();
      const orders=rows.results||[];
      if(!orders.length)return json({status:"ok",customer_mode:identity.is_account?"account":"guest",store:{name:store.name,whatsapp_phone:store.whatsapp_phone},orders:[]});
      const ids=orders.map(o=>o.id),placeholders=ids.map(()=>"?").join(",");
      const [items,events]=await Promise.all([
        env.DB.prepare(`
          SELECT order_id,product_name,variant_name,quantity,sale_unit,unit_price,line_total,currency
          FROM store_order_items
          WHERE store_id=? AND order_id IN (${placeholders})
          ORDER BY created_at ASC
        `).bind(store.id,...ids).all(),
        env.DB.prepare(`
          SELECT order_id,from_decision,to_decision,rejection_reason,created_at
          FROM store_order_decision_events
          WHERE store_id=? AND order_id IN (${placeholders})
          ORDER BY created_at ASC
        `).bind(store.id,...ids).all()
      ]);
      const byOrder=new Map(),byEvent=new Map();
      for(const item of items.results||[]){const list=byOrder.get(item.order_id)||[];list.push(item);byOrder.set(item.order_id,list);}
      for(const event of events.results||[]){const list=byEvent.get(event.order_id)||[];list.push(event);byEvent.set(event.order_id,list);}
      return json({status:"ok",customer_mode:identity.is_account?"account":"guest",store:{name:store.name,whatsapp_phone:store.whatsapp_phone},orders:orders.map(o=>({...o,
        items:byOrder.get(o.id)||[],decision_history:byEvent.get(o.id)||[]
      }))});
    }

    if(notificationId){
      if(request.method!=="POST")return json({error:"Method not allowed"},405);
      let id;
      try{id=decodeURIComponent(notificationId)}catch{return json({error:"Invalid notification ID"},400)}
      const result=await env.DB.prepare(`
        UPDATE store_customer_notifications SET read_at=CURRENT_TIMESTAMP
        WHERE id=? AND store_id=? AND customer_identity_id=? AND read_at IS NULL
      `).bind(id,store.id,identity.id).run();
      if(!result.meta?.changes){
        const exists=await env.DB.prepare(`
          SELECT id FROM store_customer_notifications
          WHERE id=? AND store_id=? AND customer_identity_id=?
        `).bind(id,store.id,identity.id).first();
        if(!exists)return json({error:"Notification not found"},404);
      }
      return json({status:"ok"});
    }

    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    const [items,count]=await Promise.all([
      env.DB.prepare(`
        SELECT id,order_id,notification_type,title,message,read_at,created_at
        FROM store_customer_notifications
        WHERE store_id=? AND customer_identity_id=?
        ORDER BY created_at DESC,id DESC LIMIT 50
      `).bind(store.id,identity.id).all(),
      env.DB.prepare(`
        SELECT COUNT(*) AS unread_count
        FROM store_customer_notifications
        WHERE store_id=? AND customer_identity_id=? AND read_at IS NULL
      `).bind(store.id,identity.id).first()
    ]);
    return json({status:"ok",customer_mode:identity.is_account?"account":"guest",notifications:items.results||[],unread_count:count?.unread_count||0});
  }catch{
    return json({error:"Unable to load customer records"},500);
  }
}
