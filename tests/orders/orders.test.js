import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handleOrders} from "../../backend/routes/orders.js";
const lifecycleMigration=await readFile(new URL("../../database/migrations/0022_order_lifecycle_guards.sql",import.meta.url),"utf8");
const orderDecisionsMigration=await readFile(new URL("../../database/migrations/0043_guest_identity_and_order_decisions.sql",import.meta.url),"utf8");
const customerAccountsMigration=await readFile(new URL("../../database/migrations/0044_optional_customer_accounts.sql",import.meta.url),"utf8");
const rejectionReasonsMigration=await readFile(new URL("../../database/migrations/0045_store_rejection_reasons.sql",import.meta.url),"utf8");
const orderNotificationsMigration=await readFile(new URL("../../database/migrations/0046_store_order_notifications.sql",import.meta.url),"utf8");

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
              if(sql.includes("FROM store_orders WHERE id=? AND store_id=?")||sql.includes("INSERT INTO public_checkout_rate_limits")||sql.includes("AS estimated_gross_profit")) calls.push({sql,values});
              if(sql.includes("SELECT COUNT(*) AS total_orders")) return options.reportTotals??{total_orders:0,completed_orders:0,open_orders:0,cancelled_orders:0};
              if(sql.includes("AS estimated_gross_profit")) return options.reportProfit??{costed_lines:0,costed_orders:0,uncosted_lines:0,costed_revenue:0,estimated_gross_profit:0};
              if(sql.includes("INSERT INTO public_checkout_rate_limits")) return options.rateLimit===undefined?{request_count:1}:options.rateLimit;
              if(sql.includes("store_order_settings")) return options.settings??null;
              if(sql.includes("FROM store_customer_identities")) return options.identity??null;
              if(sql.includes("FROM store_customer_account_sessions")) return options.accountIdentity??null;
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
              if(sql.includes("FROM store_order_rejection_reasons")) return {results:options.rejectionReasons||[]};
              if(sql.includes("FROM store_order_items i")) return {results:options.reportTopProducts||[]};
              if(sql.includes("AS report_date")) return {results:options.reportDailyRevenue||[]};
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
 customer_name:"Customer Name",customer_phone:"+963 900 000 000",shipping_address:"Damascus, Syria",
 payment_method:"cash_on_delivery",fulfillment_method:"pickup",
 items:[{product_id:"product-1",quantity:2}]
};

test("Store reports return tenant-scoped order counts and paid revenue only",async()=>{
 const database=db({
  reportTotals:{total_orders:12,completed_orders:5,open_orders:4,cancelled_orders:3},
  reportRevenue:[{currency:"USD",paid_orders:4,paid_revenue:250}],
  reportDailyRevenue:[{report_date:"2026-11-21",currency:"USD",paid_orders:2,paid_revenue:100}],
  reportProfit:{costed_lines:2,costed_orders:2,uncosted_lines:1,costed_revenue:200,estimated_gross_profit:65},
  reportTopProducts:[{product_id:"p1",product_name:"Product A",sale_unit:"kg",quantity_base_units:10000,display_quantity:10,paid_sales:160}]
 });
 const response=await handleOrders(request("/api/stores/store-1/reports?period=7d","GET",undefined,true),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.report.period,"7d");
 assert.equal(result.report.totals.total_orders,12);
 assert.equal(result.report.paid_revenue[0].paid_revenue,250);
 assert.equal(result.report.daily_revenue[0].report_date,"2026-11-21");
 assert.equal(result.report.daily_revenue[0].paid_revenue,100);
 assert.equal(result.report.profit.estimated_gross_profit,65);
 assert.equal(result.report.profit.uncosted_lines,1);
 assert.equal(result.report.top_products[0].sale_unit,"kg");
 assert.equal(result.report.top_products[0].display_quantity,10);
 const revenueQuery=database.calls.find(call=>call.sql.includes("paid_revenue"));
 assert.ok(revenueQuery.sql.includes("payment_status='paid'"));
 assert.ok(revenueQuery.sql.includes("store_id=?"));
 assert.equal(revenueQuery.values[1],"-7 days");
 const profitQuery=database.calls.find(call=>call.sql.includes("AS estimated_gross_profit"));
 assert.ok(profitQuery.sql.includes("pricing_mode"));
 assert.ok(profitQuery.sql.includes("payment_status"));
 assert.equal(profitQuery.values[0],"store-1");
 const dailyQuery=database.calls.find(call=>call.sql.includes("AS report_date"));
 assert.ok(dailyQuery.sql.includes("GROUP BY date(created_at),currency"));
 assert.ok(dailyQuery.sql.includes("store_id=?"));
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
 const orderCalls=database.calls.filter(call=>call.sql.includes("INSERT INTO store_orders")||call.sql.includes("INSERT INTO store_order_items"));
 assert.equal(orderCalls.length,2);
 assert.match(orderCalls[0].sql,/INSERT INTO store_orders/);
 assert.match(orderCalls[1].sql,/INSERT INTO store_order_items/);
 assert.equal(orderCalls[1].values[8],2);
 assert.equal(orderCalls[1].values[9],12.5);
});


test("Public checkout supports delivery, requires an address and adds the configured delivery fee",async()=>{
 const missingAddress=await handleOrders(request("/api/public/stores/test-store/orders","POST",{
   ...checkout,fulfillment_method:"delivery",shipping_address:null
 }),{DB:db({settings:{cash_on_delivery_enabled:1,shamcash_enabled:0,pickup_enabled:1,delivery_enabled:1,delivery_fee:5}})});
 assert.equal(missingAddress.status,400);
 const database=db({settings:{cash_on_delivery_enabled:1,shamcash_enabled:0,pickup_enabled:1,delivery_enabled:1,delivery_fee:5}});
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",{
   ...checkout,fulfillment_method:"delivery",shipping_address:"Damascus, Syria"
 }),{DB:database});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.order.fulfillment_method,"delivery");
 assert.equal(result.order.delivery_fee,5);
 assert.equal(result.order.total,30);
 assert.ok(database.calls.some(call=>call.sql.includes("fulfillment_method")&&call.values.includes("delivery")));
});

test("Public checkout rejects disabled fulfillment methods",async()=>{
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",checkout),{
   DB:db({settings:{cash_on_delivery_enabled:1,shamcash_enabled:0,pickup_enabled:0,delivery_enabled:1,delivery_fee:0}})
 });
 assert.equal(response.status,400);
});

test("Public checkout rate-limits each store and hashed client address",async()=>{
 const database=db();
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",checkout),{DB:database});
 assert.equal(response.status,201);
 const limiter=database.calls.find(call=>call.sql.includes("INSERT INTO public_checkout_rate_limits"));
 assert.ok(limiter);
 assert.equal(limiter.values[0],"store-1");
 assert.match(limiter.sql,/request_count<5/);
 assert.match(limiter.sql,/datetime\('now','-10 minutes'\)/);
 assert.equal(limiter.values[1].length,64);
 const blockedDb=db({rateLimit:null});
 const blocked=await handleOrders(request("/api/public/stores/test-store/orders","POST",checkout),{DB:blockedDb});
 assert.equal(blocked.status,429);
 assert.equal(blockedDb.calls.some(call=>call.sql.includes("INSERT INTO store_orders")),false);
});

test("Sham Cash checkout requires a configured recipient but collects no transfer details before handover",async()=>{
 const noRecipient=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,payment_method:"shamcash"}),{DB:db()});
 assert.equal(noRecipient.status,400);
 const configured=db({settings:{cash_on_delivery_enabled:1,shamcash_enabled:1,pickup_enabled:1,delivery_enabled:1,delivery_fee:0,shamcash_recipient:"recipient-123",shamcash_instructions:"Pay after handover"}});
 const valid=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,payment_method:"shamcash"}),{DB:configured});
 const result=await valid.json();
 assert.equal(valid.status,201);
 assert.equal(result.order.payment_status,"unpaid");
 assert.equal(result.order.payment_method,"shamcash");
 assert.equal(result.order.customer_access_token.length,64);
 assert.equal(result.order.shamcash.recipient,"recipient-123");
 const insert=configured.calls.find(call=>call.sql.includes("INSERT INTO store_orders"));
 assert.ok(insert.sql.includes("customer_payment_method"));
 assert.equal(insert.values[8],"cash_on_delivery");
 assert.equal(insert.values.at(-2),"shamcash");
});

test("Checkout rejects client price tampering and out-of-stock quantities",async()=>{
 const database=db({product:{...PRODUCT,stock_quantity:1}});
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",{...checkout,items:[{product_id:"product-1",quantity:2,price:0.01}]}),{DB:database});
 assert.equal(response.status,409);
 assert.equal(database.calls.some(call=>call.sql.includes("INSERT INTO store_orders")||call.sql.includes("INSERT INTO store_order_items")),false);
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
  pickup_enabled:true,delivery_enabled:true,delivery_fee:0,
  shamcash_recipient:"recipient-123",shamcash_instructions:"Transfer the exact order total"
 },true),{DB:database});
 assert.equal(response.status,200);
 assert.ok(database.calls.some(call=>call.sql.includes("INSERT INTO store_order_settings")));
});

test("Sham Cash order acceptance does not require payment before handover",async()=>{
 const database=db({order:{id:"order-1",order_status:"pending",payment_status:"unpaid",payment_method:"cash_on_delivery",customer_payment_method:"shamcash",customer_decision:"pending"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  customer_decision:"accepted"
 },true),{DB:database});
 assert.equal(response.status,200);
 const update=database.calls.find(call=>call.sql.includes("UPDATE store_orders"));
 assert.ok(update.sql.includes("customer_decision"));
 assert.equal(update.values[0],"accepted");
});

test("Store owner rejection requires a reason and records the decision",async()=>{
 const database=db({order:{id:"order-1",order_status:"pending",payment_status:"unpaid",payment_method:"cash_on_delivery",customer_payment_method:"cash_on_delivery",customer_decision:"pending"}});
 const missing=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  customer_decision:"rejected"
 },true),{DB:database});
 assert.equal(missing.status,400);
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  customer_decision:"rejected",rejection_reason:"المحل مغلق حالياً"
 },true),{DB:database});
 assert.equal(response.status,200);
 assert.equal((await response.json()).order.rejection_reason,"المحل مغلق حالياً");
});

test("Delivery completion records collection immediately using the selected payment method",async()=>{
 const database=db({order:{id:"order-1",order_status:"confirmed",payment_status:"unpaid",payment_method:"cash_on_delivery",customer_payment_method:"cash_on_delivery",customer_decision:"accepted"}});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  complete_delivery:true
 },true),{DB:database});
 assert.equal(response.status,200);
 const update=database.calls.find(call=>call.sql.includes("UPDATE store_orders"));
 assert.ok(update.sql.includes("payment_collected_at=CURRENT_TIMESTAMP"));
 assert.ok(update.sql.includes("delivered_at=CURRENT_TIMESTAMP"));
 assert.equal((await response.json()).order.payment_status,"paid");
});

test("Sham Cash collection requires transaction evidence at handover, not at checkout",async()=>{
 const database=db({order:{id:"order-1",order_status:"confirmed",payment_status:"unpaid",payment_method:"cash_on_delivery",customer_payment_method:"shamcash",customer_decision:"accepted"}});
 const missing=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  complete_delivery:true
 },true),{DB:database});
 assert.equal(missing.status,400);
 const response=await handleOrders(request("/api/stores/store-1/orders/order-1","PATCH",{
  complete_delivery:true,payment_reference:"TX-123",payment_sender_name:"Sender Name"
 },true),{DB:database});
 assert.equal(response.status,200);
});


test("A foreign-store order ID cannot be used to update an order",async()=>{
 const database=db({order:null});
 const response=await handleOrders(request("/api/stores/store-1/orders/order-from-store-2","PATCH",{
  order_status:"confirmed"
 },true),{DB:database});
 assert.equal(response.status,404);
 const lookup=database.calls.find(call=>call.sql.includes("SELECT id,order_status,payment_status,payment_method,customer_payment_method,customer_decision FROM store_orders"));
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


test("D1 enforces order and payment transitions even outside the HTTP route",()=>{
 assert.match(lifecycleMigration,/DROP TRIGGER IF EXISTS trg_store_order_restore_variant_stock/);
 assert.match(lifecycleMigration,/im\.reference_id = NEW\.id[\s\S]*?im\.movement_type = 'sale'[\s\S]*?SUM\(-im\.quantity_change\)/);
 assert.match(lifecycleMigration,/movement_type,quantity_change,reference_id,notes\)[\s\S]*?'return',SUM\(-im\.quantity_change\),NEW\.id/);
 assert.match(lifecycleMigration,/CREATE TRIGGER trg_store_order_status_transition_guard/);
 assert.match(lifecycleMigration,/OLD\.order_status = 'pending' AND NEW\.order_status IN \('confirmed','cancelled'\)/);
 assert.match(lifecycleMigration,/OLD\.order_status = 'shipped' AND NEW\.order_status = 'completed'/);
 assert.match(lifecycleMigration,/CREATE TRIGGER trg_store_payment_status_transition_guard/);
 assert.match(lifecycleMigration,/OLD\.payment_status = 'pending' AND NEW\.payment_status = 'rejected'[\s\S]*?OLD\.payment_method = 'shamcash'/);
 assert.match(lifecycleMigration,/OLD\.payment_status = 'paid' AND NEW\.payment_status = 'refunded'[\s\S]*?NEW\.order_status = 'cancelled'/);
 assert.match(lifecycleMigration,/CREATE TRIGGER trg_store_order_payment_consistency_guard/);
 assert.match(lifecycleMigration,/NEW\.order_status = 'completed' AND NEW\.payment_status != 'paid'/);
 assert.match(lifecycleMigration,/NEW\.payment_method = 'shamcash'[\s\S]*?NEW\.payment_status != 'paid'/);
});

test("Kilogram checkout stores grams and charges the proportional kilogram price",async()=>{
 const database=db({product:{...PRODUCT,sale_unit:"kg",stock_quantity:1000}});
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",{
  ...checkout,items:[{product_id:"product-1",quantity:250}]
 }),{DB:database});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.order.subtotal,3.13);
 const line=database.calls.find(call=>call.sql.includes("INSERT INTO store_order_items"));
 assert.equal(line.values[8],250);
 assert.equal(line.values[9],12.5);
 assert.equal(line.values.at(-1),"kg");
});


test("Customer directory is store-scoped and groups order history by phone",async()=>{
 const database=db({rows:[{customer_name:"Customer Name",customer_phone:"+963 900 000 000",phone_key:"+963900000000",orders_count:3,total_orders_value:75,last_order_at:"2026-11-21 10:00:00",open_orders:1}]});
 const response=await handleOrders(request("/api/stores/store-1/customers","GET",undefined,true),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.customers.length,1);
 assert.equal(result.customers[0].orders_count,3);
 const query=database.calls.find(call=>call.sql.includes("GROUP BY REPLACE"));
 assert.ok(query.sql.includes("WHERE store_id=?"));
 assert.equal(query.values[0],"store-1");
});

test("Customer directory and individual history require order read permission",async()=>{
 const database=db({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"catalog.read"}});
 const response=await handleOrders(request("/api/stores/store-1/customers","GET",undefined,true),{DB:database});
 assert.equal(response.status,403);
 const history=await handleOrders(request("/api/stores/store-1/customers/%2B963900000000","GET",undefined,true),{DB:database});
 assert.equal(history.status,403);
});


test("Merchant notification inbox is restricted to the active store and its own orders",async()=>{
 const database=db({rows:[{id:"notice-1",entity_id:"order-1",title:"طلب جديد"}]});
 const response=await handleOrders(request("/api/stores/store-1/notifications","GET",undefined,true),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.notifications.length,1);
 const query=database.calls.find(call=>call.sql.includes("FROM user_notifications n"));
 assert.ok(query.sql.includes("JOIN store_orders o"));
 assert.ok(query.sql.includes("o.store_id=?"));
 assert.deepEqual(query.values.slice(0,2),["store-1","user-1"]);
});

test("Merchant can mark only a notification belonging to this store as read",async()=>{
 const database=db();
 const response=await handleOrders(request("/api/stores/store-1/notifications/notice-1/read","POST",{},true),{DB:database});
 assert.equal(response.status,200);
 const update=database.calls.find(call=>call.sql.includes("UPDATE user_notifications"));
 assert.ok(update.sql.includes("EXISTS (SELECT 1 FROM store_orders"));
 assert.deepEqual(update.values,["notice-1","user-1","store-1"]);
});

test("Decision workflow preserves legacy stock reservations and customer account privacy",()=>{
 assert.match(orderDecisionsMigration,/CREATE TABLE store_order_stock_reservations/);
 assert.match(orderDecisionsMigration,/trg_order_decision_reserve_stock/);
 assert.match(orderDecisionsMigration,/trg_order_decision_restore_stock/);
 assert.match(orderDecisionsMigration,/trg_notify_customer_order_decision/);
 assert.ok(orderDecisionsMigration.includes("customer_decision IN ('pending','accepted','rejected')"));
 assert.match(orderDecisionsMigration,/payment_reference/);
 assert.match(customerAccountsMigration,/CREATE TABLE store_customer_accounts/);
 assert.match(customerAccountsMigration,/CREATE TABLE store_customer_account_sessions/);
 assert.ok(customerAccountsMigration.includes("UNIQUE (store_id,customer_phone_key)"));
});


test("Registered customer account session can place an order without receiving a guest QR",async()=>{
 const accountToken="b".repeat(64);
 const database=db({accountIdentity:{id:"identity-account-1",customer_phone_key:"963900000000"}});
 const response=await handleOrders(request("/api/public/stores/test-store/orders","POST",{
  ...checkout,customer_access_token:accountToken
 }),{DB:database});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.order.customer_access_token,accountToken);
 const orderInsert=database.calls.find(call=>call.sql.includes("INSERT INTO store_orders"));
 assert.equal(orderInsert.values.at(-3),"identity-account-1");
 assert.equal(database.calls.some(call=>call.sql.includes("INSERT INTO store_customer_identities")),false);
});


test("Rejection reason list is store-scoped and seeds default choices",async()=>{
 const database=db({rejectionReasons:[{id:"reason-1",reason_text:"المحل مغلق حالياً",is_enabled:1}]});
 const response=await handleOrders(request("/api/stores/store-1/order-rejection-reasons","GET",undefined,true),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.reasons[0].reason_text,"المحل مغلق حالياً");
 assert.ok(database.calls.some(call=>call.sql.includes("INSERT OR IGNORE INTO store_order_rejection_reasons")));
 const query=database.calls.find(call=>call.sql.includes("SELECT id,reason_text,is_enabled"));
 assert.deepEqual(query.values,["store-1"]);
});

test("Merchant can add and disable a custom rejection reason",async()=>{
 const database=db();
 const added=await handleOrders(request("/api/stores/store-1/order-rejection-reasons","POST",{reason_text:"تعذر تأمين الطلب"},true),{DB:database});
 assert.equal(added.status,201);
 const insert=database.calls.find(call=>call.sql.includes("INSERT INTO store_order_rejection_reasons"));
 assert.ok(insert);
 const disabled=await handleOrders(request("/api/stores/store-1/order-rejection-reasons/reason-1","PATCH",{is_enabled:false},true),{DB:database});
 assert.equal(disabled.status,200);
 const update=database.calls.find(call=>call.sql.includes("UPDATE store_order_rejection_reasons"));
 assert.equal(update.values[0],0);
});

test("Rejection reasons are stored per store and support enabling or disabling",()=>{
 assert.ok(rejectionReasonsMigration.includes("CREATE TABLE store_order_rejection_reasons"));
 assert.ok(rejectionReasonsMigration.includes("UNIQUE (store_id,reason_text)"));
});


test("Store owner order notifications use the selected post-handover payment method",()=>{
  assert.match(orderNotificationsMigration,/DROP TRIGGER IF EXISTS trg_notify_store_order_created/);
  assert.match(orderNotificationsMigration,/CREATE TRIGGER trg_notify_store_order_created/);
  assert.match(orderNotificationsMigration,/AFTER INSERT ON store_orders/);
  assert.ok(orderNotificationsMigration.includes("NEW.customer_payment_method = 'shamcash'"));
  assert.match(orderNotificationsMigration,/يتم تحصيل المبلغ بعد تسليم الطلب/);
  assert.match(orderNotificationsMigration,/يتم تحصيل المبلغ عند التسليم/);
  assert.ok(orderNotificationsMigration.includes("NEW.id"));
  assert.ok(orderNotificationsMigration.includes("a.owner_user_id IS NOT NULL"));
  assert.ok(!orderNotificationsMigration.includes("NEW.payment_method"));
});
