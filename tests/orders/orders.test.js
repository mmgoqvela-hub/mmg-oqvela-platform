import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handleOrders} from "../../backend/routes/orders.js";

const TOKEN="a".repeat(43);
const STORE={id:"store-1",name:"Test Store",slug:"test-store"};
const PRODUCT={id:"product-1",name:"Product",sku:"SKU-1",base_price:12.5,currency:"USD",track_inventory:1,stock_quantity:8,status:"active"};
function db(options={}) {
  const calls=[];
  return {
    calls,
    async batch(statements) {
      calls.push(...statements.map(statement=>({sql:statement.sql,values:statement.values})));
      return statements.map(()=>({meta:{changes:1}}));
    },
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          return {
            sql,values,
            async first() {
              if(sql.includes("FROM store_orders WHERE id=? AND store_id=?")) calls.push({sql,values});
              if(sql.includes("SELECT COUNT(*) AS total_orders")) return options.reportTotals??{total_orders:0,completed_orders:0,open_orders:0,cancelled_orders:0};
              if(sql.includes("store_order_settings")) return options.settings??null;
              if(sql.includes("SELECT id,order_status,payment_status")) return options.order??null;
              if(sql.includes("GROUP_CONCAT")) return options.access===undefined
                ? {id:"store-1",store_status:"active",account_status:"active",account_role:"owner",permissions:""}
                : options.access;
              if(sql.includes("FROM stores s")) return options.store===undefined?STORE:options.store;
              if(sql.includes("FROM auth_sessions")) return options.session===undefined
                ? {session_id:"session-1",user_id:"user-1",expires_at:"2099-01-01",user_status:"active"}
                : options.session;
              if(sql.includes("SELECT id FROM product_variants")) return options.hasVariants??null;
              if(sql.includes("FROM product_variants")) return options.variant??null;
              if(sql.includes("FROM products WHERE id")) return options.product===undefined?PRODUCT:options.product;
              return null;
            },
            async all() {
              calls.push({sql,values});
              if(sql.includes("FROM store_order_items i")) return {results:options.reportTopProducts||[]};
              if(sql.includes("paid_revenue")) return {results:options.reportRevenue||[]};
              return {results:options.rows||[]};
            },
            async run() { if(!sql.includes("UPDATE auth_sessions")) calls.push({sql,values}); return {meta:{changes:1}}; }
          };
        }
      };
    }
  };
}
function request(path,method="POST",body,authenticated=false){
 const headers={Origin:"https://example.com"};
 if(authenticated)headers.Cookie="mmg_session="+TOKEN;
 if(body!==undefined)headers["Content-Type"]="application/json";
 return new Request("https://example.com"+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
const checkout={
 customer_name:"Customer Name",customer_phone:"+963 900 000 000",
 payment_method:"cash_on_delivery",
 items:[{product_id:"product-1",quantity:2}]
};

test("Store reports return tenant-scoped order counts and paid revenue only",async()=>{
 const database=db({
  reportTotals:{total_orders:12,completed_orders:5,open_orders:4,cancelled_orders:3},
  reportRevenue:[{currency:"USD",paid_orders:4,paid_revenue:250}],
  reportTopProducts:[{product_id:"p1",product_name:"Product A",units_sold:8,paid_sales:160}]
 });
 const response=await handleOrders(request("/api/stores/store-1/reports?period=7d","GET",undefined,true),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.report.period,"7d");
 assert.equal(result.report.totals.total_orders,12);
 assert.equal(result.report.paid_revenue[0].paid_revenue,250);
 assert.equal(result.report.top_products[0].units_sold,8);
 const revenueQuery=database.calls.find(call=>call.sql.includes("paid_revenue"));
 assert.ok(revenueQuery.sql.includes("payment_status='paid'"));
 assert.ok(revenueQuery.sql.includes("store_id=?"));
 assert.equal(revenueQuery.values[1],"-7 days");
 const productQuery=database.calls.find(call=>call.sql.includes("FROM store_order_items i"));
 assert.ok(productQuery.sql.includes("o.payment_status='paid'"));
});

test("Store reports reject unsupported periods and require order read permission",async()=>{
 const invalid=await handleOrders(request("/api/stores/store-1/reports?period=all","GET",undefined,true),{DB:db()});
 assert.equal(invalid.status,400);
 const denied=await handleOrders(request("/api/stores/store-1/reports?period=30d","GET",undefined,true),{
  DB:db({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"catalog.read"}})
 });
 assert.equal(denied.status,403);
});

test("Public checkout creates a COD order using server-side prices and atomic D1 batch",async()=>{
 const database=db();
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",checkout),{DB:database});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.order.payment_method,"cash_on_delivery");
 assert.equal(result.order.payment_status,"unpaid");
 assert.equal(result.order.total,25);
 assert.equal(database.calls.length,2);
 assert.match(database.calls[0].sql,/INSERT INTO store_orders/);
 assert.match(database.calls[1].sql,/INSERT INTO store_order_items/);
 assert.equal(database.calls[1].values[8],2);
 assert.equal(database.calls[1].values[9],12.5);
});

test("Sham Cash checkout requires a configured recipient, sender and transaction reference",async()=>{
 const noRecipient=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,payment_method:"shamcash",sender_name:"Sender Name",transaction_reference:"TX123"}),{DB:db()});
 assert.equal(noRecipient.status,400);
 const configured=db({settings:{cash_on_delivery_enabled:1,shamcash_enabled:1,shamcash_recipient:"recipient-123",shamcash_instructions:"Send exact amount"}});
 const valid=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,payment_method:"shamcash",sender_name:"Sender Name",transaction_reference:"TX123"}),{DB:configured});
 const result=await valid.json();
 assert.equal(valid.status,201);
 assert.equal(result.order.payment_status,"pending");
 assert.equal(result.order.shamcash.recipient,"recipient-123");
});

test("Checkout rejects client price tampering and out-of-stock quantities",async()=>{
 const database=db({product:{...PRODUCT,stock_quantity:1}});
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,items:[{product_id:"product-1",quantity:2,price:0.01}]}),{DB:database});
 assert.equal(response.status,409);
 assert.equal(database.calls.length,0);
});

test("Checkout rejects mixed currencies and invalid payment methods",async()=>{
 const database=db({product:{...PRODUCT,currency:"EUR"}});
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,payment_method:"bank_transfer"}),{DB:database});
 assert.equal(response.status,400);
});

test("Authenticated store settings cannot be changed by ordinary members",async()=>{
 const database=db({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"orders.read"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/settings","PUT",{
  cash_on_delivery_enabled:true,shamcash_enabled:true,shamcash_recipient:"receiver"
 },true),{DB:database});
 assert.equal(response.status,403);
});

test("Order reads require orders.read and remain scoped to the requested store",async()=>{
 const denied=db({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"catalog.read"}});
 const forbidden=await handleOrders(request("/api/stores/store-1/orders","GET",undefined,true),{DB:denied});
 assert.equal(forbidden.status,403);
 const allowedDb=db({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"orders.read"},rows:[]});
 const allowed=await handleOrders(request("/api/stores/store-1/orders","GET",undefined,true),{DB:allowedDb});
 assert.equal(allowed.status,200);
 assert.ok(allowedDb.calls.some(call=>call.sql.includes("FROM store_orders WHERE store_id=?")&&call.values[0]==="store-1"));
});

test("Order updates require orders.manage even when a member can read orders",async()=>{
 const database=db({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"orders.read"},order:{id:"order-1",order_status:"pending",payment_status:"unpaid",payment_method:"cash_on_delivery"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{order_status:"confirmed"},true),{DB:database});
 assert.equal(response.status,403);
 assert.equal(database.calls.some(call=>call.sql.includes("UPDATE store_orders")),false);
});

test("Order API and migration enforce tenant scope, stock reservation, restoration and payment audit fields",async()=>{
 const source=await readFile(new URL("../../database/migrations/0020_store_orders_checkout.sql",import.meta.url),"utf8");
 assert.match(source,/UNIQUE \(id, store_id\)/);
 assert.match(source,/FOREIGN KEY \(product_id, store_id\)/);
 assert.match(source,/trg_order_item_validate_catalog/);
 assert.match(source,/trg_order_item_reserve_variant_stock/);
 assert.match(source,/trg_order_item_reserve_product_stock/);
 assert.match(source,/Insufficient variant stock/);
 assert.match(source,/Insufficient product stock/);
 assert.match(source,/trg_store_order_restore_variant_stock/);
 assert.match(source,/NEW\.order_status = 'cancelled'/);
 assert.match(source,/CREATE TABLE store_order_settings/);
 assert.match(source,/idx_store_orders_unique_shamcash_reference/);
 assert.match(source,/orders\.read/);
 assert.match(source,/orders\.manage/);
 assert.match(source,/trg_notify_store_order_created/);
 assert.match(source,/store-order-created:/);
 assert.match(source,/CREATE TABLE store_order_events/);
 assert.match(source,/trg_store_order_created_event/);
 assert.match(source,/trg_store_order_status_event/);
 assert.match(source,/trg_store_payment_status_event/);
 assert.match(source,/updated_by TEXT/);
});


test("Store owner can configure both checkout methods and Sham Cash recipient",async()=>{
 const database=db();
 const response=await handleOrders(request("/api/stores/store-1/orders/settings","PUT",{
  cash_on_delivery_enabled:true,shamcash_enabled:true,
  shamcash_recipient:"recipient-123",shamcash_instructions:"Transfer the exact order total"
 },true),{DB:database});
 assert.equal(response.status,200);
 assert.ok(database.calls.some(call=>call.sql.includes("INSERT INTO store_order_settings")));
});

test("Sham Cash orders cannot be fulfilled before manual payment approval",async()=>{
 const database=db({order:{id:"order-1",order_status:"pending",payment_status:"pending",payment_method:"shamcash"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  order_status:"confirmed"
 },true),{DB:database});
 assert.equal(response.status,409);
 assert.equal(database.calls.some(call=>call.sql.includes("UPDATE store_orders")),false);
});

test("Store owner can approve Sham Cash payment and confirm the order together",async()=>{
 const database=db({order:{id:"order-1",order_status:"pending",payment_status:"pending",payment_method:"shamcash"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  order_status:"confirmed",payment_status:"paid"
 },true),{DB:database});
 assert.equal(response.status,200);
 assert.ok(database.calls.some(call=>call.sql.includes("UPDATE store_orders")));
});

test("An unpaid order cannot be marked completed",async()=>{
 const database=db({order:{id:"order-1",order_status:"processing",payment_status:"unpaid",payment_method:"cash_on_delivery"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  order_status:"completed"
 },true),{DB:database});
 assert.equal(response.status,409);
});


test("A foreign-store order ID cannot be used to update an order",async()=>{
 const database=db({order:null});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-from-store-2","PATCH",{
  order_status:"confirmed"
 },true),{DB:database});
 assert.equal(response.status,404);
 const lookup=database.calls.find(call=>call.sql.includes("SELECT id,order_status,payment_status,payment_method FROM store_orders"));
 assert.ok(lookup);
 assert.match(lookup.sql,/WHERE id=\? AND store_id=\?/);
 assert.deepEqual(lookup.values,["order-from-store-2","store-1"]);
 assert.equal(database.calls.some(call=>call.sql.includes("UPDATE store_orders")),false);
});

test("Order item and event history queries are constrained to the same tenant as the order list",async()=>{
 const database=db({rows:[{id:"order-1",order_number:"1001"}]});
 const response=await handleOrders(request("/api/stores/store-1/orders","GET",undefined,true),{DB:database});
 assert.equal(response.status,200);
 const itemQuery=database.calls.find(call=>call.sql.includes("FROM store_order_items WHERE store_id=?"));
 const eventQuery=database.calls.find(call=>call.sql.includes("FROM store_order_events WHERE store_id=?"));
 assert.ok(itemQuery);
 assert.ok(eventQuery);
 assert.equal(itemQuery.values[0],"store-1");
 assert.equal(eventQuery.values[0],"store-1");
});
