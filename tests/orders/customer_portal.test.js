import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import { handlePublicCustomerPortal } from "../../backend/routes/customer_portal.js";

const TOKEN="a".repeat(64);
function request(path,method="GET",body,token=TOKEN){
  const headers={Origin:"https://example.com","Content-Type":"application/json"};
  if(token)headers["X-Customer-Token"]=token;
  return new Request("https://example.com"+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
}
function db(options={}){
  const calls=[];
  return {
    calls,
    async batch(statements){calls.push(...statements.map(statement=>({sql:statement.sql,values:statement.values})));return statements.map(()=>({meta:{changes:1}}));},
    prepare(sql){
      return {sql,bind(...values){return {
        sql,values,
        async first(){
          calls.push({sql,values});
          if(sql.includes("FROM stores s"))return options.store??{id:"store-1",name:"Bakery",slug:"bakery",whatsapp_phone:"+963900000000"};
          if(sql.includes("FROM store_customer_identities"))return Object.hasOwn(options,"identity")?options.identity:{id:"identity-1",store_id:"store-1",customer_phone_key:"+963900000000",customer_name:"Customer"};
          if(sql.includes("FROM store_customer_account_sessions"))return options.accountSessionIdentity??null;
          if(sql.includes("RETURNING attempt_count"))return {attempt_count:1};
          if(sql.includes("SELECT id FROM store_customer_accounts"))return options.existingAccount??null;
          if(sql.includes("SELECT id,customer_identity_id,password_salt,password_hash"))return options.account??null;
          if(sql.includes("COUNT(*) AS unread_count"))return {unread_count:options.unreadCount??1};
          if(sql.includes("SELECT n.id"))return options.existingNotification??{id:"notice-1"};
          return null;
        },
        async all(){
          calls.push({sql,values});
          if(sql.includes("FROM store_orders"))return {results:options.orders??[{id:"order-1",order_number:"MMG-100",customer_decision:"accepted"}]};
          if(sql.includes("FROM store_order_items"))return {results:options.lines??[{order_id:"order-1",product_name:"Pastry",quantity:2}]};
          if(sql.includes("FROM store_order_decision_events"))return {results:options.events??[{order_id:"order-1",from_decision:"pending",to_decision:"accepted"}]};
          if(sql.includes("FROM store_customer_notifications"))return {results:options.notifications??[{id:"notice-1",order_id:"order-1",title:"تم قبول طلبك",message:"تم قبول طلبك"}]};
          return {results:[]};
        },
        async run(){calls.push({sql,values});return {meta:{changes:options.changes??1}};}
      };}};
    }
  };
}

test("Guest customer order history requires the secret QR token and is scoped to its store identity",async()=>{
  const database=db();
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/orders"),{DB:database});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.orders.length,1);
  assert.equal(result.orders[0].items[0].product_name,"Pastry");
  assert.equal(result.orders[0].decision_history[0].to_decision,"accepted");
  const query=database.calls.find(call=>call.sql.includes("FROM store_orders"));
  assert.match(query.sql,/WHERE store_id=\? AND customer_identity_id=\?/);
  assert.deepEqual(query.values,["store-1","identity-1"]);
});

test("Phone number alone cannot retrieve guest orders",async()=>{
  const req=new Request("https://example.com/api/public/stores/bakery/customer/orders");
  const response=await handlePublicCustomerPortal(req,{DB:db()});
  assert.equal(response.status,401);
});

test("A revoked or invalid QR identity cannot read customer notifications",async()=>{
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/notifications"),{
    DB:db({identity:null})
  });
  assert.equal(response.status,401);
});

test("Customer notification read operation is bound to the QR identity and store",async()=>{
  const database=db();
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/notifications/notice-1/read","POST"),{DB:database});
  assert.equal(response.status,200);
  const update=database.calls.find(call=>call.sql.includes("UPDATE store_customer_notifications"));
  assert.ok(update.sql.includes("customer_identity_id=?"));
  assert.deepEqual(update.values,["notice-1","store-1","identity-1"]);
});



test("Guest can create an optional account linked to the existing QR identity",async()=>{
  const database=db();
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/account/register","POST",{
    customer_name:"Customer Name",customer_phone:"+963 900 000 000",password:"strong-password-123",customer_access_token:TOKEN
  },null),{DB:database});
  const result=await response.json();
  assert.equal(response.status,201);
  assert.equal(result.customer_mode,"account");
  assert.equal(result.customer_access_token.length,64);
  const accountInsert=database.calls.find(call=>call.sql.includes("INSERT INTO store_customer_accounts"));
  assert.ok(accountInsert);
  assert.equal(accountInsert.values[2],"identity-1");
});

test("Customer account registration creates a private identity when no guest QR exists",async()=>{
  const database=db({identity:null});
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/account/register","POST",{
    customer_name:"New Customer",customer_phone:"+963 911 222 333",password:"strong-password-123"
  },null),{DB:database});
  const result=await response.json();
  assert.equal(response.status,201);
  assert.equal(result.customer_mode,"account");
  assert.ok(database.calls.some(call=>call.sql.includes("INSERT INTO store_customer_identities")));
  assert.ok(database.calls.some(call=>call.sql.includes("INSERT INTO store_customer_accounts")));
});

test("Customer account login rejects incorrect passwords without issuing a session",async()=>{
  const database=db({account:{id:"account-1",customer_identity_id:"identity-1",password_salt:"a".repeat(32),password_hash:"0".repeat(64)}});
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/account/login","POST",{
    customer_phone:"+963 900 000 000",password:"wrong-password-123"
  },null),{DB:database});
  assert.equal(response.status,401);
  assert.equal(database.calls.some(call=>call.sql.includes("INSERT INTO store_customer_account_sessions")),false);
});

test("Account sessions can retrieve the same private order history without a QR code",async()=>{
  const database=db({
    identity:null,
    accountSessionIdentity:{id:"identity-1",store_id:"store-1",customer_phone_key:"+963900000000",customer_name:"Customer",is_account:1}
  });
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/orders"),{DB:database});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.customer_mode,"account");
  assert.equal(result.orders.length,1);
});

test("Customer account logout revokes the current session token",async()=>{
  const database=db();
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/account/logout","POST",{},TOKEN),{DB:database});
  assert.equal(response.status,200);
  assert.ok(database.calls.some(call=>call.sql.includes("UPDATE store_customer_account_sessions")&&call.values[0].length===64));
});


test("Guest can rotate a lost QR code and the previous token is replaced",async()=>{
  const database=db();
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/qr/rotate","POST",{}),{DB:database});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.customer_mode,"guest");
  assert.equal(result.customer_access_token.length,64);
  assert.ok(database.calls.some(call=>call.sql.includes("UPDATE store_customer_identities SET access_token_hash")));
});

test("Registered customer sessions cannot be rotated as guest QR codes",async()=>{
  const database=db({identity:{id:"identity-1",store_id:"store-1",customer_phone_key:"+963900000000",customer_name:"Customer",is_account:1}});
  const response=await handlePublicCustomerPortal(request("/api/public/stores/bakery/customer/qr/rotate","POST",{}),{DB:database});
  assert.equal(response.status,409);
  assert.equal(database.calls.some(call=>call.sql.includes("UPDATE store_customer_identities SET access_token_hash")),false);
});
