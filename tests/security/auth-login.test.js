import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {handleAuth} from "../../backend/routes/auth.js";

if(!globalThis.crypto)globalThis.crypto=webcrypto;

function createRateLimitDb(){
 const attempts=new Map();
 const calls=[];
 return {
  calls,
  prepare(sql){
   return {sql,bind(...values){
    return {
     sql,values,
     async first(){
      calls.push({sql,values,kind:"first"});
      if(sql.includes("FROM auth_login_attempts")){
       const row=attempts.get(values[0]);
       return row?.blocked?{blocked:1}:null;
      }
      if(sql.includes("FROM users"))return null;
      return null;
     },
     async run(){
      calls.push({sql,values,kind:"run"});
      if(sql.includes("INSERT INTO auth_login_attempts")){
       const key=values[0],row=attempts.get(key)||{attempts:0,blocked:false};
       row.attempts++;
       if(row.attempts>=5)row.blocked=true;
       attempts.set(key,row);
      }
      return {meta:{changes:1}};
     }
    };
   }};
  }
 };
}

function loginRequest(email="owner@example.com",ip="203.0.113.10",origin){
 const headers={"Content-Type":"application/json","CF-Connecting-IP":ip};
 if(origin)headers.Origin=origin;
 return new Request("https://platform.example/api/auth/login",{
  method:"POST",headers,body:JSON.stringify({email,password:"WrongPassword123!"})
 });
}

test("Login throttles repeated failures and returns Retry-After after five attempts",async()=>{
 const DB=createRateLimitDb();
 for(let i=0;i<4;i++){
  const response=await handleAuth(loginRequest(),{DB});
  assert.equal(response.status,401);
 }
 const fifth=await handleAuth(loginRequest(),{DB});
 assert.equal(fifth.status,429);
 assert.equal(fifth.headers.get("Retry-After"),"900");
 const userLookupsBefore=DB.calls.filter(call=>call.sql.includes("FROM users")).length;
 const sixth=await handleAuth(loginRequest(),{DB});
 assert.equal(sixth.status,429);
 assert.equal(sixth.headers.get("Retry-After"),"900");
 assert.equal(DB.calls.filter(call=>call.sql.includes("FROM users")).length,userLookupsBefore);
});

test("Login rejects a cross-origin request before reading credentials",async()=>{
 const DB=createRateLimitDb();
 const response=await handleAuth(loginRequest("owner@example.com","203.0.113.10","https://attacker.example"),{DB});
 assert.equal(response.status,403);
 assert.equal(DB.calls.length,0);
});
