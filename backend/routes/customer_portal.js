import { validOrigin } from "../security/authentication.js";

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Pragma":"no-cache"
  }});
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

async function readIdentity(request,db,storeId){
  const token=request.headers.get("X-Customer-Token")||
    (request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!/^[A-Za-z0-9_-]{40,100}$/.test(token))return null;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return db.prepare(`
    SELECT id,store_id,customer_phone_key,customer_name
    FROM store_customer_identities
    WHERE store_id=? AND access_token_hash=? AND revoked_at IS NULL
    LIMIT 1
  `).bind(storeId,hash).first();
}

export async function handlePublicCustomerPortal(request,env){
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/public\/stores\/([a-z0-9-]+)\/customer\/(orders|notifications)(?:\/([^/]+)\/read)?$/);
  if(!match)return null;
  const [,slug,resource,notificationId]=match;
  if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed"},405);
  if(request.method==="POST"&&!validOrigin(request))return json({error:"Invalid origin"},403);
  const store=await activeStore(env.DB,slug);
  if(!store)return json({error:"Store is unavailable"},404);
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
      if(!orders.length)return json({status:"ok",orders:[]});
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
      return json({status:"ok",store:{name:store.name},orders:orders.map(o=>({...o,
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
    return json({status:"ok",notifications:items.results||[],unread_count:count?.unread_count||0});
  }catch{
    return json({error:"Unable to load customer records"},500);
  }
}
