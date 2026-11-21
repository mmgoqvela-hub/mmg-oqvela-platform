import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handlePos} from "../../backend/routes/pos.js";

const TOKEN="h".repeat(43);
function dbMock(){
 const queries=[];
 return {queries,prepare(sql){return {sql,values:[],bind(...values){this.values=values;queries.push({sql,values});return this;},
  async run(){return {meta:{changes:1}};},
  async first(){
   if(sql.includes("FROM auth_sessions"))return {session_id:"s1",user_id:"u1",user_status:"active"};
   if(sql.includes("GROUP_CONCAT"))return {id:"store-1",store_status:"active",account_status:"active",account_role:"owner",permissions:""};
   if(sql.includes("FROM pos_sales WHERE id="))return {id:"sale-1",sale_number:"POS-1",currency:"USD",total:25,status:"posted"};
   return null;
  },
  async all(){
   if(sql.includes("FROM pos_sales s LEFT JOIN"))return {results:[{id:"sale-1",sale_number:"POS-1",currency:"USD",total:25,item_count:1,unit_count:2}]};
   if(sql.includes("FROM pos_sale_items"))return {results:[{product_name:"Coffee",quantity:2,line_total:25}]};
   if(sql.includes("FROM pos_sale_payments"))return {results:[{payment_method:"cash",amount:25}]};
   if(sql.includes("FROM pos_sale_events"))return {results:[{event_type:"posted",details_json:'{"total":25}',created_at:"2026-11-21"}]};
   return {results:[]};
  }
 };}};
}
function request(path,method="GET"){
 return new Request("https://example.test/api/stores/store-1/pos/"+path,{method,
  headers:{Origin:"https://example.test",Cookie:"mmg_session="+TOKEN}});
}
test("POS sales history is store-scoped and supports safe filters",async()=>{
 const DB=dbMock();
 const response=await handlePos(request("sales?currency=USD&status=posted&limit=500"),{DB});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.sales.length,1);
 assert.equal(result.limit,100);
 assert.match(DB.queries[0].sql,/s.store_id=\?/);
 assert.deepEqual(DB.queries[0].values.slice(0,5),["store-1","posted","posted","USD","USD"]);
});
test("POS sales history rejects invalid filters",async()=>{
 const DB=dbMock();
 const response=await handlePos(request("sales?currency=EUR"),{DB});
 assert.equal(response.status,400);
 assert.equal(DB.queries.some(q=>q.sql.includes("FROM pos_sales s LEFT JOIN")),false);
});
test("POS sale detail returns receipt lines, tenders and audit events",async()=>{
 const DB=dbMock();
 const response=await handlePos(request("sales/sale-1"),{DB});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.sale.sale_number,"POS-1");
 assert.equal(result.items[0].quantity,2);
 assert.equal(result.payments[0].payment_method,"cash");
 assert.equal(result.events[0].details.total,25);
 assert.ok(DB.queries.every(q=>!q.sql.includes("WHERE id=? AND store_id=?")||q.values[1]==="store-1"));
});
test("POS sale detail does not expose another store's sale",async()=>{
 const DB=dbMock();
 DB.prepare=(sql)=>({sql,bind(...values){return {first:async()=>sql.includes("FROM auth_sessions")?{session_id:"s1",user_id:"u1",user_status:"active"}:sql.includes("GROUP_CONCAT")?{id:"store-1",store_status:"active",account_status:"active",account_role:"owner",permissions:""}:null,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})};}});
 const response=await handlePos(request("sales/foreign-sale"),{DB});
 assert.equal(response.status,404);
});
