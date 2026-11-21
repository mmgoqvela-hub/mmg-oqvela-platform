import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handlePos} from "../../backend/routes/pos.js";

const TOKEN="r".repeat(43);
function dbMock(){
 const queries=[];
 return {queries,prepare(sql){return {sql,values:[],bind(...values){this.values=values;queries.push({sql,values});return this;},
  async first(){
   if(sql.includes("FROM auth_sessions"))return {session_id:"s1",user_id:"u1",user_status:"active"};
   if(sql.includes("GROUP_CONCAT"))return {id:"store-1",store_status:"active",account_status:"active",account_role:"owner",permissions:""};
   if(sql.includes("AS net_sales")||sql.includes("AS returns_total"))return {sale_count:4,completed_count:3,void_count:1,gross_sales:150,discounts:10,sales_total:140,returns_total:15,voids_total:20};
   return null;
  },
  async all(){
   if(sql.includes("GROUP BY date(s.created_at)"))return {results:[{day:"2026-11-21",sale_count:4,sales_total:140}]};
   if(sql.includes("GROUP BY p.payment_method"))return {results:[{payment_method:"cash",received:100}]};
   if(sql.includes("GROUP BY i.product_id"))return {results:[{product_id:"p1",product_name:"Pastry",sale_unit:"kg",quantity:10,display_quantity:0.5,sales_total:50}]};
   return {results:[]};
  }
 };}};
}
function request(path){
 return new Request("https://example.test/api/stores/store-1/pos/"+path,{headers:{Origin:"https://example.test",Cookie:"mmg_session="+TOKEN}});
}
test("POS report returns store-scoped sales, refunds, voids and product units",async()=>{
 const DB=dbMock();
 const response=await handlePos(request("reports?from=2026-11-01&to=2026-11-30&currency=USD"),{DB});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.totals.sale_count,4);
 assert.equal(result.totals.net_sales,125);
 assert.equal(result.totals.voids_total,20);
 assert.equal(result.daily[0].day,"2026-11-21");
 assert.equal(result.top_products[0].sale_unit,"kg");
 const totalsQuery=DB.queries.find(q=>q.sql.includes("AS returns_total"));
 assert.ok(totalsQuery);
 assert.equal(totalsQuery.values.length,21);
 assert.equal(totalsQuery.values[0],"store-1");
 assert.equal(totalsQuery.values[14],"store-1");
});
test("POS report rejects invalid date and currency filters without querying sales",async()=>{
 const DB=dbMock();
 const response=await handlePos(request("reports?from=bad&currency=EUR"),{DB});
 assert.equal(response.status,400);
 assert.equal(DB.queries.some(q=>q.sql.includes("FROM pos_sales s")),false);
});
test("POS report rejects reversed date ranges",async()=>{
 const DB=dbMock();
 const response=await handlePos(request("reports?from=2026-11-30&to=2026-11-01"),{DB});
 assert.equal(response.status,400);
 assert.equal(DB.queries.some(q=>q.sql.includes("FROM pos_sales s")),false);
});
