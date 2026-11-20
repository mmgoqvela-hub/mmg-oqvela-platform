import test from "node:test";
import assert from "node:assert/strict";
import {handlePublicStorefront} from "../../backend/routes/storefront.js";

function createDb(options={}) {
  const calls=[];
  return {
    calls,
    prepare(sql) {
      return {sql,bind(...values) {
        return {
          sql,values,
          async first() {
            calls.push({sql,values});
            return options.store ?? null;
          },
          async all() {
            calls.push({sql,values});
            if(sql.includes("FROM categories")) return {results:options.categories || []};
            if(sql.includes("FROM products")) return {results:options.products || []};
            if(sql.includes("FROM product_variants")) return {results:options.variants || []};
            if(sql.includes("FROM platform_settings")) return {results:options.platformSettings || []};
            if(sql.includes("FROM platform_announcements")) return {results:options.announcements || []};
            return {results:[]};
          }
        };
      }};
    }
  };
}
function request(slug="test-store",method="GET") {
  return new Request("https://example.com/api/public/stores/"+slug,{method});
}

test("Unknown or inactive storefronts are not publicly exposed",async()=>{
  const db=createDb();
  const response=await handlePublicStorefront(request(),{DB:db});
  assert.equal(response.status,404);
  assert.equal(db.calls.length,1);
});

test("Public storefront only allows GET requests",async()=>{
  const db=createDb();
  const response=await handlePublicStorefront(request("test-store","POST"),{DB:db});
  assert.equal(response.status,405);
  assert.equal(db.calls.length,0);
});

test("Public storefront returns its selected template and published catalog only",async()=>{
  const db=createDb({
    store:{id:"store-1",name:"Test Store",slug:"test-store",template_key:"boutique"},
    categories:[{id:"category-1",name:"Accessories"}],
    products:[{id:"product-1",name:"Bag",base_price:20,currency:"USD"}],
    variants:[{id:"variant-1",product_id:"product-1",name:"Large",price:25,stock_quantity:4,attributes_json:'{"size":"L"}'}]
  });
  const response=await handlePublicStorefront(request(),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.store.template_key,"boutique");
  assert.equal(result.products[0].name,"Bag");
  assert.equal(result.products[0].variants[0].attributes.size,"L");
  assert.ok(db.calls.some(call=>call.sql.includes("ss.status = 'active'")));
  assert.ok(db.calls.some(call=>call.sql.includes("p.status = 'active'")));
});

test("Public storefront receives the centrally managed bilingual footer",async()=>{
 const db=createDb({
  store:{id:"store-1",name:"Test Store",slug:"test-store"},
  platformSettings:[
   {setting_key:"platform_footer_ar",setting_value:"حقوق MMG محفوظة"},
   {setting_key:"platform_footer_en",setting_value:"MMG rights reserved"}
  ]
 });
 const response=await handlePublicStorefront(request(),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.platform_footer.platform_footer_ar,"حقوق MMG محفوظة");
 assert.equal(result.platform_footer.platform_footer_en,"MMG rights reserved");
});

test("Public storefront exposes only currently active platform announcements",async()=>{
 const db=createDb({
  store:{id:"store-1",name:"Test Store",slug:"test-store"},
  announcements:[{id:"a1",title_ar:"تنبيه",title_en:"Notice",message_ar:"رسالة",message_en:"Message",announcement_type:"warning"}]
 });
 const response=await handlePublicStorefront(request(),{DB:db});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.equal(result.announcements.length,1);
 const query=db.calls.find(call=>call.sql.includes("FROM platform_announcements"));
 assert.ok(query.sql.includes("is_active=1"));
 assert.ok(query.sql.includes("starts_at<=CURRENT_TIMESTAMP"));
 assert.ok(query.sql.includes("ends_at>CURRENT_TIMESTAMP"));
});

test("Invalid slugs are rejected before database access",async()=>{
  const db=createDb();
  const response=await handlePublicStorefront(request("invalid!"),{DB:db});
  assert.equal(response.status,404);
  assert.equal(db.calls.length,0);
});
