import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handlePosVoids} from "../../backend/routes/pos_voids.js";

const TOKEN="v".repeat(43);
function makeDb(options={}){
 const batches=[];
 return {batches,prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},
  async first(){
   if(sql.includes("FROM auth_sessions"))return {session_id:"s-1",user_id:"cashier-1",user_status:"active"};
   if(sql.includes("GROUP_CONCAT"))return options.access??{store_status:"active",account_status:"active",account_role:"owner",permissions:""};
   if(sql.includes("FROM pos_sale_voids")&&sql.includes("idempotency_key"))return options.replay??null;
   if(sql.includes("FROM pos_sales WHERE id=? AND store_id=?"))return options.sale??{id:"sale-1",sale_number:"POS-1",cash_session_id:"cs-1",warehouse_id:"wh-1",currency:"USD",total:30,status:"posted"};
   if(sql.includes("FROM pos_sale_returns"))return options.existingReturn??null;
   if(sql.includes("SELECT track_inventory FROM products"))return options.product??{track_inventory:1};
   if(sql.includes("FROM inventory_movements WHERE store_id"))return Object.prototype.hasOwnProperty.call(options,"original")?options.original:{id:"move-1",warehouse_id:"wh-1"};
   return null;
  },
  async all(){
   if(sql.includes("FROM pos_sale_items"))return {results:options.items??[{id:"item-1",product_id:"p-1",variant_id:null,quantity:3,currency:"USD"}]};
   if(sql.includes("FROM pos_sale_payments"))return {results:options.payments??[{payment_method:"cash",amount:20,currency:"USD"},{payment_method:"shamcash",amount:10,currency:"USD"}]};
   return {results:[]};
  }
 };},async batch(statements){batches.push(statements);return statements.map(()=>({meta:{changes:1}}));}};
}
function req(body,path="/api/stores/store-1/pos/sales/sale-1/void"){
 return new Request("https://example.test"+path,{method:"POST",headers:{Origin:"https://example.test",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},body:JSON.stringify(body)});
}
const payload=()=>({idempotency_key:"void-key-0000000001",reason:"Duplicate sale entered"});

test("POS void atomically restores inventory, refunds original tenders and records immutable audit rows",async()=>{
 const db=makeDb();
 const response=await handlePosVoids(req(payload()),{DB:db});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.void.status,"posted");
 assert.equal(result.void.refund_total,30);
 assert.deepEqual(result.void.refund_payments.map(x=>x.payment_method),["cash","digital"]);
 const sql=db.batches[0].map(x=>x.sql).join("\n");
 assert.match(sql,/INSERT INTO pos_sale_voids/);
 assert.match(sql,/INSERT INTO pos_sale_void_items/);
 assert.match(sql,/INSERT INTO inventory_movements/);
 assert.match(sql,/reversal_of_id/);
 assert.match(sql,/UPDATE products SET stock_quantity=stock_quantity\+/);
 assert.match(sql,/INSERT INTO pos_sale_void_payments/);
 assert.match(sql,/UPDATE pos_sale_voids SET status='posted'/);
});
test("POS void requires dedicated permission",async()=>{
 const db=makeDb({access:{store_status:"active",account_status:"active",account_role:"member",permissions:"pos.access"}});
 const response=await handlePosVoids(req(payload()),{DB:db});
 assert.equal(response.status,403);
 assert.equal(db.batches.length,0);
});
test("POS void refuses a sale that already has posted returns",async()=>{
 const db=makeDb({existingReturn:{id:"return-1"}});
 const response=await handlePosVoids(req(payload()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
test("POS void fails closed when original stock movement is missing",async()=>{
 const db=makeDb({original:null});
 const response=await handlePosVoids(req(payload()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
test("POS void idempotency replay never repeats refund or stock writes",async()=>{
 const db=makeDb({replay:{id:"void-1",void_number:"VOID-1",sale_id:"sale-1",refund_total:30,currency:"USD",status:"posted"}});
 const response=await handlePosVoids(req(payload()),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.replayed,true);
 assert.equal(db.batches.length,0);
});
test("POS void only accepts an untouched posted sale",async()=>{
 const db=makeDb({sale:{id:"sale-1",status:"partially_refunded",total:30}});
 const response=await handlePosVoids(req(payload()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
