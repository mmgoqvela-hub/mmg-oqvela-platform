import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import { handlePublicCustomerPortal } from "../../backend/routes/customer_portal.js";

const TOKEN="a".repeat(64);
function request(path,method="GET"){
  return new Request("https://example.com"+path,{
    method,
    headers:{"X-Customer-Token":TOKEN,Origin:"https://example.com","Content-Type":"application/json"}
  });
}
function db(options={}){
  const calls=[];
  return {
    calls,
    prepare(sql){
      return {sql,bind(...values){return {
        sql,values,
        async first(){
          calls.push({sql,values});
          if(sql.includes("FROM stores s"))return options.store??{id:"store-1",name:"Bakery",slug:"bakery",whatsapp_phone:"+963900000000"};
          if(sql.includes("FROM store_customer_identities"))return options.identity??{id:"identity-1",store_id:"store-1",customer_phone_key:"+963900000000",customer_name:"Customer"};
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
