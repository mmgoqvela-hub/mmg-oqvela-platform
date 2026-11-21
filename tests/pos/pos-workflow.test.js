import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handlePos} from "../../backend/routes/pos.js";

const TOKEN="c".repeat(43);
function workflowDb(options={}){
 const batches=[];
 const db={
  batches,
  prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},
   async first(){
    if(sql.includes("FROM auth_sessions"))return {session_id:"session-1",user_id:"cashier-1",user_status:"active"};
    if(sql.includes("GROUP_CONCAT"))return options.access??{id:"store-1",store_status:"active",account_status:"active",account_role:"owner",permissions:""};
    if(sql.includes("idempotency_key"))return options.prior??null;
    if(sql.includes("FROM pos_cash_sessions")&&sql.includes("warehouse_id,currency,status"))return options.cashSession??{id:"cs-1",warehouse_id:"wh-1",currency:"USD",status:"open"};
    if(sql.includes("FROM store_pricing_settings"))return options.settings??{pricing_mode:"manual",rounding_increment_minor_units:1};
    if(sql.includes("FROM products WHERE id"))return options.product??{id:"p-1",name:"Coffee",sku:"C-1",base_price:10,currency:"USD",track_inventory:1,stock_quantity:30,status:"active"};
    if(sql.includes("SELECT id FROM product_variants"))return options.hasVariants??null;
    if(sql.includes("FROM product_variants"))return options.variant??null;
    if(sql.includes("FROM inventory_warehouses"))return options.warehouse??{id:"wh-1"};
    if(sql.includes("SELECT id,currency,opening_cash_amount"))return options.sessionToClose??{id:"cs-1",currency:"USD",opening_cash_amount:20};
    if(sql.includes("AS cash_received"))return options.cashTotals??{cash_received:15,cash_refunded:4};
    if(sql.includes("FROM pos_cash_sessions cs JOIN inventory_warehouses"))return options.currentSession??{id:"cs-1",store_id:"store-1",warehouse_id:"wh-1",currency:"USD",status:"open",opening_cash_amount:20,warehouse_name:"Main"};
    return null;
   },
   async all(){
    if(sql.includes("FROM store_pricing_tiers"))return {results:options.tiers||[]};
    if(sql.includes("FROM product_tier_margin_overrides"))return {results:options.overrides||[]};
    return {results:[]};
   },
   async run(){return {meta:{changes:options.runChanges??1}};}
  };},
  async batch(statements){batches.push(statements);return statements.map(()=>({meta:{changes:1}}));}
 };
 return db;
}
function req(path,body,method="POST"){
 return new Request("https://example.test/api/stores/store-1/pos/"+path,{method,
  headers:{Origin:"https://example.test",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},
  body:body===undefined?undefined:JSON.stringify(body)});
}
const baseSale=()=>({idempotency_key:"cashier-sale-key-0001",cash_session_id:"cs-1",
 items:[{product_id:"p-1",quantity:3}],payments:[{payment_method:"cash",amount:30}]});

test("POS posts a sale, split tender and inventory writes in one atomic batch",async()=>{
 const db=workflowDb();
 const response=await handlePos(req("sales",baseSale()),{DB:db});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.sale.status,"posted");
 assert.equal(result.sale.total,30);
 assert.equal(db.batches.length,1);
 const sql=db.batches[0].map(statement=>statement.sql);
 assert.match(sql[0],/INSERT INTO pos_sales/);
 assert.match(sql[1],/INSERT INTO pos_sale_items/);
 assert.match(sql[2],/INSERT INTO pos_sale_payments/);
 assert.match(sql[3],/UPDATE pos_sales SET status='posted'/);
});
test("POS supports split cash and card payments",async()=>{
 const sale=baseSale();
 sale.payments=[{payment_method:"cash",amount:10},{payment_method:"card",amount:20}];
 const db=workflowDb();
 const response=await handlePos(req("sales",sale),{DB:db});
 assert.equal(response.status,201);
 assert.equal(db.batches[0].filter(statement=>statement.sql.includes("INSERT INTO pos_sale_payments")).length,2);
});
test("POS rejects payment totals that do not equal the sale total",async()=>{
 const sale=baseSale();sale.payments=[{payment_method:"cash",amount:29.99}];
 const db=workflowDb();
 const response=await handlePos(req("sales",sale),{DB:db});
 assert.equal(response.status,400);
 assert.equal(db.batches.length,0);
});
test("POS requires Sham Cash transaction number and sender",async()=>{
 const sale=baseSale();sale.payments=[{payment_method:"shamcash",amount:30}];
 const response=await handlePos(req("sales",sale),{DB:workflowDb()});
 assert.equal(response.status,400);
});
test("POS replays an idempotent sale without writing stock or payments twice",async()=>{
 const db=workflowDb({prior:{id:"sale-1",sale_number:"POS-001",total:30,currency:"USD",status:"posted"}});
 const response=await handlePos(req("sales",baseSale()),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.replayed,true);
 assert.equal(db.batches.length,0);
});
test("POS discount requires explicit permission and a reason",async()=>{
 const sale=baseSale();sale.discount_amount=1;sale.discount_reason="Manager approval";
 sale.payments=[{payment_method:"cash",amount:29}];
 const db=workflowDb({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"pos.access"}});
 const response=await handlePos(req("sales",sale),{DB:db});
 assert.equal(response.status,403);
 assert.equal(db.batches.length,0);
});
test("POS refuses to post a sale into a closed or different-currency session",async()=>{
 const db=workflowDb({cashSession:{id:"cs-1",warehouse_id:"wh-1",currency:"SYP",status:"closed"}});
 const response=await handlePos(req("sales",baseSale()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
test("POS cash session opening uses the store default warehouse and writes an audit event",async()=>{
 const db=workflowDb();
 const response=await handlePos(req("cash-sessions/open",{currency:"USD",opening_cash_amount:50}),{DB:db});
 assert.equal(response.status,201);
 assert.equal(db.batches.length,1);
 assert.equal(db.batches[0].length,2);
 assert.match(db.batches[0][0].sql,/INSERT INTO pos_cash_sessions/);
 assert.match(db.batches[0][1].sql,/INSERT INTO pos_cash_session_events/);
});
test("POS cash session close reports expected cash and difference",async()=>{
 const db=workflowDb();
 const response=await handlePos(req("cash-sessions/cs-1",{closing_cash_amount:38}),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.session.expected_cash_amount,31);
 assert.equal(result.session.cash_difference,7);
});

test("POS cash session reconciliation subtracts cash refunds from posted returns",async()=>{
 const db=workflowDb({cashTotals:{cash_received:120,cash_refunded:25}});
 const response=await handlePos(req("cash-sessions/cs-1",{closing_cash_amount:110}),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.session.expected_cash_amount,115);
 assert.equal(result.session.cash_difference,-5);
});

test("POS cash reconciliation subtracts full void refunds from expected drawer cash",async()=>{
 const db=workflowDb({cashTotals:{cash_received:120,cash_refunded:25,cash_void_refunded:10}});
 const response=await handlePos(req("cash-sessions/cs-1",{closing_cash_amount:100}),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.session.expected_cash_amount,105);
 assert.equal(result.session.cash_difference,-5);
});
