import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {handlePos} from "../../backend/routes/pos.js";

const TOKEN="b".repeat(43);
function makeDb(options={}){
 const calls=[];
 return {calls,prepare(sql){return {sql,bind(...values){return {sql,values,
  async first(){
   if(sql.includes("FROM auth_sessions"))return {session_id:"session-1",user_id:"user-1",expires_at:"2099-01-01",user_status:"active"};
   if(sql.includes("GROUP_CONCAT"))return options.access??{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"pos.access,pos.wholesale"};
   if(sql.includes("FROM store_pricing_settings"))return options.settings??{pricing_mode:"cost_plus_margin",rounding_increment_minor_units:1};
   if(sql.includes("FROM products WHERE id"))return options.product??{id:"p-1",name:"Coffee",sku:"C-1",base_price:15,currency:"USD",track_inventory:1,stock_quantity:50,status:"active"};
   if(sql.includes("FROM product_variants"))return options.variant??null;
   if(sql.includes("SELECT id FROM product_variants"))return options.hasVariants??null;
   if(sql.includes("FROM product_cost_versions"))return options.cost??{id:"cost-1",cost_minor_units:1000};
   return null;
  },
  async all(){
   if(sql.includes("FROM store_pricing_tiers"))return {results:options.tiers??[
    {tier_code:"retail",min_quantity:1,profit_margin_bps:3000,is_enabled:1},
    {tier_code:"wholesale",min_quantity:5,profit_margin_bps:2000,is_enabled:1},
    {tier_code:"bulk_wholesale",min_quantity:10,profit_margin_bps:1000,is_enabled:1}
   ]};
   if(sql.includes("FROM product_tier_margin_overrides"))return {results:options.overrides||[]};
   return {results:[]};
  },
  async run(){calls.push({sql,values});return {meta:{changes:1}};}
 };}};}};
}
function req(body,method="POST"){
 return new Request("https://example.test/api/stores/store-1/pos/quote",{method,
  headers:{Origin:"https://example.test",Cookie:"mmg_session="+TOKEN,"Content-Type":"application/json"},
  body:body===undefined?undefined:JSON.stringify(body)});
}
test("POS quote applies a permitted wholesale tier using server-side cost",async()=>{
 const database=makeDb();
 const response=await handlePos(req({items:[{product_id:"p-1",quantity:5,tier_code:"wholesale"}]}),{DB:database});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.quote.items[0].unit_price,12);
 assert.equal(result.quote.items[0].tier_code,"wholesale");
 assert.equal(result.quote.total,60);
 assert.equal(JSON.stringify(result).includes("cost_minor_units"),false);
 assert.equal(JSON.stringify(result).includes("profit_margin_bps"),false);
});
test("POS denies wholesale tier when staff lacks the matching permission",async()=>{
 const database=makeDb({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"pos.access"}});
 const response=await handlePos(req({items:[{product_id:"p-1",quantity:5,tier_code:"wholesale"}]}),{DB:database});
 assert.equal(response.status,403);
});
test("POS enforces the selected tier minimum quantity",async()=>{
 const response=await handlePos(req({items:[{product_id:"p-1",quantity:4,tier_code:"wholesale"}]}),{DB:makeDb()});
 assert.equal(response.status,409);
});
test("POS keeps legacy manual catalog prices when automatic pricing is off",async()=>{
 const database=makeDb({product:{id:"p-1",name:"Service",sku:null,base_price:10,currency:"SYP",track_inventory:0,stock_quantity:0,status:"active"},settings:{pricing_mode:"manual",rounding_increment_minor_units:1}});
 const response=await handlePos(req({items:[{product_id:"p-1",quantity:1}]}),{DB:database});
 assert.equal(response.status,200);
});
test("POS requires authentication",async()=>{
 const noSession=makeDb();
 noSession.prepare=(sql)=>({sql,bind(){return {async first(){return null;},async all(){return {results:[]};},async run(){return {meta:{changes:1}};}};}});
 const denied=await handlePos(req({items:[{product_id:"p-1",quantity:1}]}),{DB:noSession});
 assert.equal(denied.status,401);
});

test("POS blocks staff without POS access",async()=>{
 const database=makeDb({access:{id:"store-1",store_status:"active",account_status:"active",account_role:"member",permissions:"catalog.read"}});
 const response=await handlePos(req({items:[{product_id:"p-1",quantity:1}]}),{DB:database});
 assert.equal(response.status,403);
});
test("POS refuses automatic pricing for non-USD products",async()=>{
 const database=makeDb({product:{id:"p-1",name:"Item",sku:null,base_price:10,currency:"SYP",track_inventory:0,stock_quantity:0,status:"active"}});
 const response=await handlePos(req({items:[{product_id:"p-1",quantity:1}]}),{DB:database});
 assert.equal(response.status,409);
});
