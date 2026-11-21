import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handlePosReturns} from "../../backend/routes/pos_returns.js";

const TOKEN="d".repeat(43);
function makeDb(options={}){
 const batches=[];
 return {batches,prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},
  async first(){
   if(sql.includes("FROM auth_sessions"))return {session_id:"s-1",user_id:"cashier-1",user_status:"active"};
   if(sql.includes("GROUP_CONCAT"))return options.access??{store_status:"active",account_status:"active",account_role:"owner",permissions:""};
   if(sql.includes("SELECT id,return_number,refund_total,currency,status FROM pos_sale_returns"))return options.replay??null;
   if(sql.includes("SELECT id,sale_number,currency,subtotal,total,status,warehouse_id FROM pos_sales"))return options.sale??{id:"sale-1",sale_number:"POS-1",currency:"USD",subtotal:30,total:30,status:"posted",warehouse_id:"wh-1"};
   if(sql.includes("SELECT COALESCE(SUM(refund_total)"))return options.refunded??{amount:0};
   if(sql.includes("SELECT COALESCE(SUM(ri.quantity)"))return options.previously??{quantity:0};
   if(sql.includes("FROM inventory_movements WHERE store_id"))return Object.prototype.hasOwnProperty.call(options,"original")?options.original:{id:"movement-1",warehouse_id:"wh-1"};
   if(sql.includes("SELECT track_inventory FROM products"))return options.product??{track_inventory:1};
   return null;
  },
  async all(){
   if(sql.includes("SELECT id,product_id,variant_id,quantity,line_total,currency FROM pos_sale_items"))
    return {results:options.items??[{id:"sale-item-1",product_id:"p-1",variant_id:null,quantity:3,line_total:30,currency:"USD"}]};
   return {results:[]};
  },
  async run(){return {meta:{changes:1}};}
 };},async batch(statements){batches.push(statements);return statements.map(()=>({meta:{changes:1}}));}};
}
function req(body,path="/api/stores/store-1/pos/sales/sale-1/returns",method="POST"){
 return new Request("https://example.test"+path,{method,headers:{Origin:"https://example.test",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
}
const payload=()=>({idempotency_key:"return-key-00000001",reason:"Customer returned item",
 items:[{sale_item_id:"sale-item-1",quantity:1,restock:true}],
 refund_total:10,refund_payments:[{payment_method:"cash",amount:10}]});

test("POS return records refund, restock reversal and immutable audit writes atomically",async()=>{
 const db=makeDb();
 const response=await handlePosReturns(req(payload()),{DB:db});
 const result=await response.json();
 assert.equal(response.status,201);
 assert.equal(result.return.status,"posted");
 assert.equal(result.return.refund_total,10);
 const sql=db.batches[0].map(x=>x.sql).join("\n");
 assert.match(sql,/INSERT INTO pos_sale_returns/);
 assert.match(sql,/INSERT INTO pos_sale_return_items/);
 assert.match(sql,/INSERT INTO inventory_movements/);
 assert.match(sql,/reversal_of_id/);
 assert.match(sql,/INSERT INTO pos_sale_refund_payments/);
 assert.match(sql,/UPDATE pos_sale_returns SET status='posted'/);
});
test("POS return refuses a quantity already returned",async()=>{
 const db=makeDb({previously:{quantity:3}});
 const response=await handlePosReturns(req(payload()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
test("POS return fails closed when the original stock movement is missing",async()=>{
 const db=makeDb({original:null});
 const response=await handlePosReturns(req(payload()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
test("POS return enforces the refund permission",async()=>{
 const db=makeDb({access:{store_status:"active",account_status:"active",account_role:"member",permissions:"pos.access"}});
 const response=await handlePosReturns(req(payload()),{DB:db});
 assert.equal(response.status,403);
});
test("POS return idempotency replay does not duplicate refund or stock",async()=>{
 const db=makeDb({replay:{id:"ret-1",return_number:"RET-1",refund_total:10,currency:"USD",status:"posted"}});
 const response=await handlePosReturns(req(payload()),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.replayed,true);
 assert.equal(db.batches.length,0);
});
test("POS return prevents cumulative refund above original sale total",async()=>{
 const db=makeDb({refunded:{amount:25}});
 const response=await handlePosReturns(req(payload()),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});


test("POS refund cannot exceed the value of the returned quantity",async()=>{
 const db=makeDb();
 const body=payload();body.refund_total=11;body.refund_payments=[{payment_method:"cash",amount:11}];
 const response=await handlePosReturns(req(body),{DB:db});
 assert.equal(response.status,409);
 assert.equal(db.batches.length,0);
});
