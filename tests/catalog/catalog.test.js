import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { handleCatalog } from "../../backend/routes/catalog.js";

const TOKEN = "a".repeat(43);
const SESSION = {
  session_id: "session-001",
  user_id: "user-001",
  expires_at: "2099-01-01 00:00:00",
  full_name: "Test User",
  email: "test@example.com",
  user_status: "active"
};
const OWNER = { id:"store-001", store_status:"active", account_status:"active", account_role:"owner" };
const MEMBER = { ...OWNER, account_role:"member", store_member_id:"member-001", permissions:"catalog.read,inventory.read" };

function createDb(options = {}) {
  const calls = [];
  return {
    calls,
    async batch(statements) {
      calls.push(...statements.map(statement => ({sql:statement.sql, values:statement.values})));
      return (options.batchResults || statements.map(() => ({meta:{changes:1}})));
    },
    prepare(sql) {
      return {
        sql,
        bind(...values) {
          return {
            sql, values,
            async first() {
              if (sql.includes("COUNT(*) AS total FROM products")) return {total:options.productCount ?? 0};
              if (sql.includes("COUNT(*) AS total FROM categories")) return {total:options.childCategoryCount ?? 0};
              if (sql.includes("FROM auth_sessions")) return options.session === undefined ? SESSION : options.session;
              if (sql.includes("FROM stores s")) return options.access === undefined ? OWNER : options.access;
              if (sql.includes("FROM categories")) return options.category || null;
              if (sql.includes("FROM products")) return options.product || null;
              if (sql.includes("FROM product_variants")) return options.variant || null;
              return null;
            },
            async all() {
              calls.push({sql, values});
              if (sql.includes("FROM product_images")) return {results: options.images || []};
              if (sql.includes("FROM product_variants")) return {results: options.variants || options.rows || []};
              return {results: options.rows || []};
            },
            async run() {
              if (!sql.includes("UPDATE auth_sessions")) calls.push({sql, values});
              return {meta:{changes:options.runChanges ?? 1}};
            }
          };
        }
      };
    }
  };
}

function makeRequest(path, method = "GET", body, options = {}) {
  const headers = {Origin:"https://example.com"};
  if (options.auth !== false) headers.Cookie = "mmg_session=" + TOKEN;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request("https://example.com/api/stores/store-001/" + path, {
    method,
    headers,
    body:body === undefined ? undefined : JSON.stringify(body)
  });
}

test("Product images can only reference uploaded media from the same store", async () => {
  const db = createDb({ product:{id:"product-1",store_id:"store-001"} });
  const response = await handleCatalog(makeRequest("products/product-1/images","POST",{
    url:"/media/another-store/123e4567-e89b-12d3-a456-426614174000.webp",
    alt_text:"Product cover"
  }),{DB:db,STORE_MEDIA:{head:async()=>({customMetadata:{storeId:"store-001"}})}});
  assert.equal(response.status,400);
  assert.equal(db.calls.some(call=>call.sql.includes("INSERT INTO product_images")),false);
});

test("Product image registration verifies the R2 object and scopes the record to its store", async () => {
  const db = createDb({ product:{id:"product-1",store_id:"store-001"} });
  const response = await handleCatalog(makeRequest("products/product-1/images","POST",{
    url:"/media/store-001/123e4567-e89b-12d3-a456-426614174000.webp",
    alt_text:"Blue bag"
  }),{DB:db,STORE_MEDIA:{head:async key=>({key,customMetadata:{storeId:"store-001"}})}});
  const result = await response.json();
  assert.equal(response.status,201);
  assert.equal(result.image.url,"/media/store-001/123e4567-e89b-12d3-a456-426614174000.webp");
  const insert=db.calls.find(call=>call.sql.includes("INSERT INTO product_images"));
  assert.ok(insert);
  assert.ok(insert.values.includes("store-001"));
  assert.ok(insert.values.includes("product-1"));
});

test("Owners can update product details within their own store", async () => {
  const db = createDb({
    product:{id:"product-1",store_id:"store-001",track_inventory:1,stock_quantity:0}
  });
  const response = await handleCatalog(makeRequest("products/product-1","PUT",{
    name:"Updated product",description:"Updated description",sku:"SKU-UPDATED",
    product_type:"physical",status:"active",base_price:19.5,
    compare_at_price:24,currency:"USD",track_inventory:true,
    is_featured:true,category_id:null
  }),{DB:db});
  assert.equal(response.status,200);
  const update = db.calls.find(call => call.sql.includes("UPDATE products"));
  assert.ok(update);
  assert.match(update.sql,/WHERE id = \? AND store_id = \?/);
  assert.ok(update.values.includes("SKU-UPDATED"));
  assert.ok(update.values.includes("product-1"));
  assert.ok(update.values.includes("store-001"));
});

test("Catalog readers without catalog.manage cannot edit products", async () => {
  const db = createDb({
    access:{...MEMBER,permissions:"catalog.read"},
    product:{id:"product-1",store_id:"store-001",track_inventory:1,stock_quantity:0}
  });
  const response = await handleCatalog(makeRequest("products/product-1","PUT",{
    name:"Attempted change",base_price:10
  }),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE products")),false);
});

test("Product updates reject a category from another tenant", async () => {
  const db = createDb({
    product:{id:"product-1",store_id:"store-001",track_inventory:1,stock_quantity:0},
    category:null
  });
  const response = await handleCatalog(makeRequest("products/product-1","PUT",{
    name:"Updated product",description:"",product_type:"physical",status:"draft",
    base_price:10,currency:"USD",sku:"",track_inventory:true,
    is_featured:false,category_id:"foreign-category"
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE products")),false);
});

test("Archiving a product preserves its database record and stock history", async () => {
  const db = createDb({
    product:{id:"product-1",store_id:"store-001",track_inventory:1,stock_quantity:6}
  });
  const response = await handleCatalog(makeRequest("products/product-1","DELETE"),{DB:db});
  assert.equal(response.status,200);
  const archive = db.calls.find(call => call.sql.includes("UPDATE products"));
  assert.ok(archive);
  assert.match(archive.sql,/SET status = 'archived'/);
  assert.match(archive.sql,/WHERE id = \? AND store_id = \?/);
  assert.equal(db.calls.some(call => call.sql.includes("DELETE FROM products")),false);
});

test("Categories with linked products cannot be deleted", async () => {
  const db = createDb({category:{id:"cat-1"},productCount:2});
  const response = await handleCatalog(makeRequest("categories/cat-1","DELETE"),{DB:db});
  const result = await response.json();
  assert.equal(response.status,409);
  assert.equal(result.linked_products,2);
  assert.equal(db.calls.some(call=>call.sql.includes("DELETE FROM categories")),false);
});

test("Categories with child categories cannot be deleted", async () => {
  const db = createDb({category:{id:"cat-1"},childCategoryCount:1});
  const response = await handleCatalog(makeRequest("categories/cat-1","DELETE"),{DB:db});
  const result = await response.json();
  assert.equal(response.status,409);
  assert.equal(result.child_categories,1);
  assert.equal(db.calls.some(call=>call.sql.includes("DELETE FROM categories")),false);
});

test("Unused categories can be deleted without touching products", async () => {
  const db = createDb({category:{id:"cat-1"}});
  const response = await handleCatalog(makeRequest("categories/cat-1","DELETE"),{DB:db});
  assert.equal(response.status,200);
  assert.ok(db.calls.some(call=>call.sql.includes("DELETE FROM categories") && call.values.includes("store-001")));
  assert.equal(db.calls.some(call=>call.sql.includes("DELETE FROM products")),false);
});

test("Category deletion is blocked for members without catalog.manage", async () => {
  const db = createDb({access:MEMBER,category:{id:"cat-1"}});
  const response = await handleCatalog(makeRequest("categories/cat-1","DELETE"),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.some(call=>call.sql.includes("DELETE FROM categories")),false);
});

test("A category from another store cannot be deleted", async () => {
  const db = createDb({category:null});
  const response = await handleCatalog(makeRequest("categories/foreign-category","DELETE"),{DB:db});
  assert.equal(response.status,404);
  assert.equal(db.calls.some(call=>call.sql.includes("DELETE FROM categories")),false);
});

test("Catalog endpoints require an authenticated account member", async () => {
  const db = createDb({session:null});
  const response = await handleCatalog(makeRequest("products", "GET", undefined, {auth:false}), {DB:db});
  assert.equal(response.status, 401);
});

test("Users cannot read catalog data from another tenant", async () => {
  const db = createDb({access:null});
  const response = await handleCatalog(makeRequest("products"), {DB:db});
  assert.equal(response.status, 404);
  assert.equal(db.calls.length, 0);
});

test("Account members can read store categories", async () => {
  const db = createDb({access:MEMBER, rows:[{id:"cat-1",name:"Category"}]});
  const response = await handleCatalog(makeRequest("categories"), {DB:db});
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.categories.length, 1);
  assert.ok(db.calls.some(call => call.sql.includes("WHERE store_id = ?")));
});

test("Account members cannot create categories or products", async () => {
  const db = createDb({access:MEMBER});
  const category = await handleCatalog(makeRequest("categories","POST",{name:"New category"}),{DB:db});
  const product = await handleCatalog(makeRequest("products","POST",{
    name:"New product",base_price:10
  }),{DB:db});
  assert.equal(category.status,403);
  assert.equal(product.status,403);
  assert.equal(db.calls.length,0);
});

test("A category cannot use a parent from another store", async () => {
  const db = createDb({category:null});
  const response = await handleCatalog(makeRequest("categories","POST",{
    name:"Child category",parent_id:"foreign-category"
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.length,0);
});

test("Products cannot reference a category from another store", async () => {
  const db = createDb({category:null});
  const response = await handleCatalog(makeRequest("products","POST",{
    name:"Test product",base_price:10,category_id:"foreign-category"
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.length,0);
});

test("Product creation records initial stock in the same database batch", async () => {
  const db = createDb();
  const response = await handleCatalog(makeRequest("products","POST",{
    name:"Test product",base_price:12.5,currency:"USD",
    product_type:"physical",status:"draft",stock_quantity:7
  }),{DB:db});
  const result = await response.json();
  assert.equal(response.status,201);
  assert.equal(result.product.stock_quantity,7);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls[0].sql.includes("INSERT INTO products"));
  assert.ok(db.calls[1].sql.includes("INSERT INTO inventory_movements"));
});

test("Product listing is scoped to the selected store", async () => {
  const db = createDb({access:MEMBER,rows:[{id:"product-1",name:"Tenant product"}]});
  const response = await handleCatalog(makeRequest("products?q=Tenant"),{DB:db});
  const result = await response.json();
  assert.equal(response.status,200);
  assert.equal(result.products.length,1);
  assert.match(db.calls[0].sql,/p\.store_id = \?/);
});

test("Inventory cannot be reduced below zero", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1,stock_quantity:2}});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"sale",quantity_change:-3
  }),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.length,0);
});

test("Inventory movement is rejected when variant belongs to another store or product", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1,stock_quantity:10},variant:null});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",variant_id:"foreign-variant",
    movement_type:"sale",quantity_change:-1
  }),{DB:db});
  assert.equal(response.status,404);
  assert.equal(db.calls.length,0);
});

test("Valid inventory movements update stock and create a movement record atomically", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1,stock_quantity:5}});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"purchase",quantity_change:4,
    notes:"Restock"
  }),{DB:db});
  const result = await response.json();
  assert.equal(response.status,200);
  assert.equal(result.stock_quantity,9);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls[0].sql.includes("UPDATE products"));
  assert.ok(db.calls[1].sql.includes("INSERT INTO inventory_movements"));
});


test("Account members cannot create product variants", async () => {
  const db = createDb({access:MEMBER,product:{id:"product-1",track_inventory:1}});
  const response = await handleCatalog(makeRequest("products/product-1/variants","POST",{
    name:"Large",price:15
  }),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});

test("Product variant creation records initial variant stock", async () => {
  const db = createDb({product:{id:"product-1",track_inventory:1}});
  const response = await handleCatalog(makeRequest("products/product-1/variants","POST",{
    name:"Large",sku:"LARGE-1",price:15,stock_quantity:3,
    attributes:{size:"L",color:"Blue"}
  }),{DB:db});
  const result = await response.json();
  assert.equal(response.status,201);
  assert.equal(result.variant.stock_quantity,3);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls[0].sql.includes("INSERT INTO product_variants"));
  assert.ok(db.calls[1].sql.includes("INSERT INTO inventory_movements"));
});

test("A product variant with remaining stock cannot be deactivated", async () => {
  const db = createDb({
    product:{id:"product-1",track_inventory:1},
    variant:{id:"variant-1",stock_quantity:4,status:"active"}
  });
  const response = await handleCatalog(makeRequest("products/product-1/variants/variant-1","DELETE"),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.some(call => call.sql.includes("UPDATE product_variants")),false);
});

test("Variant routes cannot cross product or store boundaries", async () => {
  const db = createDb({access:null});
  const response = await handleCatalog(makeRequest("products/foreign-product/variants","POST",{
    name:"Variant",price:1
  }),{DB:db});
  assert.equal(response.status,404);
});


test("Store members without catalog permission cannot read catalog data", async () => {
  const db = createDb({access:{...MEMBER,permissions:"inventory.read"}});
  const response = await handleCatalog(makeRequest("products"),{DB:db});
  assert.equal(response.status,403);
});

test("Store members with inventory read permission can view stock history", async () => {
  const db = createDb({access:MEMBER,rows:[{id:"movement-1",quantity_change:2}]});
  const response = await handleCatalog(makeRequest("inventory"),{DB:db});
  assert.equal(response.status,200);
});

test("Store members without inventory management permission cannot change stock", async () => {
  const db = createDb({access:MEMBER,product:{id:"product-1",track_inventory:1,stock_quantity:5}});
  const response = await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"purchase",quantity_change:1
  }),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.length,0);
});


test("Catalog readers can load product details and tenant-scoped variants",async()=>{
  const db=createDb({
    access:MEMBER,
    product:{id:"product-1",store_id:"store-001",name:"Shirt"},
    rows:[{id:"variant-1",name:"Large",sku:"SHIRT-L",price:20,stock_quantity:4,attributes_json:'{"size":"L"}',status:"active"}]
  });
  const response=await handleCatalog(makeRequest("products/product-1"),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.product.id,"product-1");
  assert.equal(result.variants.length,1);
  assert.match(db.calls.find(call=>call.sql.includes("FROM product_variants")).sql,/product_id = \? AND store_id = \?/);
});

test("Product detail includes its image gallery in display order",async()=>{
  const db=createDb({
    product:{id:"product-1",store_id:"store-001",name:"Bag"},
    variants:[{id:"variant-1",name:"Large"}],
    images:[
      {id:"image-main",url:"/media/store-001/main.webp",alt_text:"Front",sort_order:0},
      {id:"image-side",url:"/media/store-001/side.webp",alt_text:"Side",sort_order:1}
    ]
  });
  const response=await handleCatalog(makeRequest("products/product-1"),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(result.images.map(image=>image.id),["image-main","image-side"]);
  const query=db.calls.find(call=>call.sql.includes("FROM product_images"));
  assert.ok(query.sql.includes("product_id = ? AND store_id = ?"));
  assert.ok(query.sql.includes("ORDER BY sort_order ASC"));
});

test("Store members without catalog.read cannot inspect product variants",async()=>{
  const db=createDb({
    access:{...MEMBER,permissions:"inventory.read"},
    product:{id:"product-1",store_id:"store-001",name:"Private product"}
  });
  const response=await handleCatalog(makeRequest("products/product-1"),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.some(call=>call.sql.includes("FROM product_variants")),false);
});


test("Inventory movements update a selected product variant stock",async()=>{
  const db=createDb({
    product:{id:"product-1",track_inventory:1,stock_quantity:12},
    variant:{id:"variant-1",stock_quantity:3,status:"active"}
  });
  const response=await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",variant_id:"variant-1",
    movement_type:"purchase",quantity_change:5,notes:"Variant restock"
  }),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.stock_quantity,8);
  assert.ok(db.calls.some(call=>call.sql.includes("UPDATE product_variants")));
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO inventory_movements") && call.values.includes("variant-1")));
});

test("Inventory history includes variant names without crossing tenant boundaries",async()=>{
  const db=createDb({access:MEMBER,rows:[{product_name:"Shirt",variant_name:"Large"}]});
  const response=await handleCatalog(makeRequest("inventory"),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.movements[0].variant_name,"Large");
  assert.ok(db.calls.some(call=>call.sql.includes("LEFT JOIN product_variants") && call.sql.includes("v.store_id = im.store_id")));
});

test("Inventory movement types enforce their quantity direction",async()=>{
  for (const [movement_type,quantity_change] of [
    ["purchase",-2],["return",-1],["sale",2],["damage",1]
  ]) {
    const db=createDb({product:{id:"product-1",track_inventory:1,stock_quantity:8}});
    const response=await handleCatalog(makeRequest("inventory","POST",{
      product_id:"product-1",movement_type,quantity_change
    }),{DB:db});
    assert.equal(response.status,400, movement_type+" must reject an invalid quantity direction");
    assert.equal(db.calls.length,0);
  }
});

test("Inventory adjustments accept either signed direction and preserve nonnegative stock",async()=>{
  const db=createDb({product:{id:"product-1",track_inventory:1,stock_quantity:8}});
  const response=await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"adjustment",quantity_change:-3,
    notes:"Physical count correction"
  }),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.stock_quantity,5);
  assert.ok(db.calls.some(call=>call.sql.includes("UPDATE products")));
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO inventory_movements")));
});

test("Inventory movements are rejected when tracking is disabled",async()=>{
  const db=createDb({product:{id:"product-1",track_inventory:0,stock_quantity:0}});
  const response=await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"purchase",quantity_change:2
  }),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.length,0);
});

test("Members without inventory.manage cannot create inventory movements",async()=>{
  const db=createDb({
    access:{...MEMBER,permissions:"catalog.read,inventory.read"},
    product:{id:"product-1",track_inventory:1,stock_quantity:5}
  });
  const response=await handleCatalog(makeRequest("inventory","POST",{
    product_id:"product-1",movement_type:"purchase",quantity_change:2
  }),{DB:db});
  assert.equal(response.status,403);
  assert.equal(db.calls.some(call=>call.sql.includes("UPDATE products") || call.sql.includes("INSERT INTO inventory_movements")),false);
});

