import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto) globalThis.crypto=webcrypto;
import {handleTeam} from "../../backend/routes/team.js";

const TOKEN="a".repeat(43);
const SESSION={session_id:"session-1",user_id:"owner-1",expires_at:"2099-01-01",full_name:"Owner",email:"owner@example.test",user_status:"active"};
const OWNER={id:"store-1",account_id:"account-1",store_status:"active",account_status:"active",account_role:"owner",permissions:""};
function createDb(options={}) {
  const calls=[];
  return {
    calls,
    async batch(statements) {
      calls.push(...statements.map(x=>({sql:x.sql,values:x.values})));
      return statements.map(()=>({meta:{changes:1}}));
    },
    prepare(sql) {
      return {sql,bind(...values) {
        return {
          sql,values,
          async first() {
            if(sql.includes("FROM auth_sessions")) return options.session===undefined?SESSION:options.session;
            if(sql.includes("FROM stores s")) return options.store===undefined?OWNER:options.store;
            if(sql.includes("FROM users WHERE email")) return options.user===undefined?{id:"employee-1",email:"staff@example.test",status:"active"}:options.user;
            if(sql.includes("FROM account_users")) return options.accountMember??null;
            if(sql.includes("FROM store_members")) return options.member??null;
            if(sql.includes("FROM roles WHERE id")) return options.role===undefined?{id:"role-1"}:options.role;
            return null;
          },
          async all() {
            if(sql.includes("FROM roles r")) return {results:options.roles||[]};
            if(sql.includes("FROM store_members sm")) return {results:options.members||[]};
            return {results:[]};
          },
          async run() {calls.push({sql,values});return {meta:{changes:1}};}
        };
      }};
    }
  };
}
function makeRequest(path,method="GET",body,options={}) {
  const headers={Origin:"https://example.com",Cookie:options.auth===false?"":"mmg_session="+TOKEN};
  if(body!==undefined) headers["Content-Type"]="application/json";
  return new Request("https://example.com/api/stores/store-1/team"+path,{
    method,headers,body:body===undefined?undefined:JSON.stringify(body)
  });
}

test("Unauthenticated users cannot manage store teams",async()=>{
  const db=createDb({session:null});
  const response=await handleTeam(makeRequest("","GET",undefined,{auth:false}),{DB:db});
  assert.equal(response.status,401);
});

test("Store members need the explicit team management permission",async()=>{
  const db=createDb({store:{...OWNER,account_role:"member",store_member_id:"sm-1",permissions:"catalog.read"}});
  const response=await handleTeam(makeRequest(""),{DB:db});
  assert.equal(response.status,403);
});

test("A store member with team.manage can view team and roles",async()=>{
  const db=createDb({store:{...OWNER,account_role:"member",store_member_id:"sm-1",permissions:"team.manage"}});
  const response=await handleTeam(makeRequest(""),{DB:db});
  const result=await response.json();
  assert.equal(response.status,200);
  assert.ok(Array.isArray(result.roles));
  assert.ok(Array.isArray(result.members));
});

test("Store owners can add an existing platform user and assign a store role",async()=>{
  const db=createDb();
  const response=await handleTeam(makeRequest("","POST",{email:"staff@example.test",role_id:"role-1"}),{DB:db});
  const result=await response.json();
  assert.equal(response.status,201);
  assert.equal(result.member.email,"staff@example.test");
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO account_users")));
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO store_members")));
  assert.ok(db.calls.some(call=>call.sql.includes("INSERT INTO member_roles")));
});

test("Suspended account members cannot be re-added to a store",async()=>{
  const db=createDb({accountMember:{role:"member",status:"suspended"}});
  const response=await handleTeam(makeRequest("","POST",{email:"staff@example.test",role_id:"role-1"}),{DB:db});
  assert.equal(response.status,409);
  assert.equal(db.calls.some(call=>call.sql.includes("INSERT INTO store_members")),false);
});

test("Custom roles accept only known unique permission codes",async()=>{
  const db=createDb();
  const response=await handleTeam(makeRequest("/roles","POST",{
    name:"Sales operator",description:"Sales team",
    permissions:["catalog.read","inventory.read"]
  }),{DB:db});
  const result=await response.json();
  assert.equal(response.status,201);
  assert.equal(result.role.name,"Sales operator");
  assert.equal(result.role.permissions.length,2);
});

test("Custom roles cannot be granted unknown or duplicate permissions",async()=>{
  const db=createDb();
  const response=await handleTeam(makeRequest("/roles","POST",{
    name:"Unsafe role",permissions:["platform.super_admin","platform.super_admin"]
  }),{DB:db});
  assert.equal(response.status,400);
  assert.equal(db.calls.some(call=>call.sql.includes("INSERT INTO roles")),false);
});

test("A team manager cannot create a role with permissions they do not hold",async()=>{
 const db=createDb({store:{...OWNER,account_role:"member",store_member_id:"sm-1",permissions:"team.manage"}});
 const response=await handleTeam(makeRequest("/roles","POST",{
  name:"Escalation role",permissions:["team.manage","catalog.manage"]
 }),{DB:db});
 assert.equal(response.status,403);
 assert.equal(db.calls.some(call=>call.sql.includes("INSERT INTO roles")),false);
});
