import {getAuthenticatedSession, validOrigin} from "../security/authentication.js";

function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

async function readBody(request) {
  try {
    const raw=await request.text();
    if(raw.length>10000) return {error:"Request too large",status:413};
    const body=JSON.parse(raw);
    if(!body || typeof body!=="object" || Array.isArray(body)) return {error:"Invalid JSON",status:400};
    return {body};
  } catch {
    return {error:"Invalid JSON",status:400};
  }
}

const ROLE_PRESETS=[
  {name:"مشاهد",description:"عرض الكتالوج والمخزون دون تعديل",permissions:["catalog.read","inventory.read"]},
  {name:"مدير الكتالوج",description:"إدارة التصنيفات والمنتجات والمتغيرات",permissions:["catalog.read","catalog.manage"]},
  {name:"مدير المخزون",description:"عرض الكتالوج وإدارة حركات المخزون",permissions:["catalog.read","inventory.read","inventory.manage"]},
  {name:"مدير المتجر",description:"إدارة الكتالوج والمخزون",permissions:["catalog.read","catalog.manage","inventory.read","inventory.manage"]}
];
const ALLOWED_PERMISSIONS=new Set(["catalog.read","catalog.manage","inventory.read","inventory.manage","team.manage"]);

async function getContext(request,env,storeId) {
  if(!validOrigin(request)) return {response:json({error:"Invalid origin"},403)};
  const session=await getAuthenticatedSession(request,env.DB);
  if(!session) return {response:json({error:"Authentication required"},401)};
  const store=await env.DB.prepare(`
    SELECT s.id,s.account_id,s.status AS store_status,a.status AS account_status,
           au.role AS account_role,sm.id AS store_member_id,
           COALESCE(GROUP_CONCAT(DISTINCT p.code),'') AS permissions
    FROM stores s
    JOIN accounts a ON a.id=s.account_id
    JOIN account_users au ON au.account_id=s.account_id
    LEFT JOIN store_members sm ON sm.store_id=s.id AND sm.user_id=au.user_id AND sm.status='active'
    LEFT JOIN member_roles mr ON mr.store_member_id=sm.id
    LEFT JOIN roles r ON r.id=mr.role_id AND r.store_id=s.id
    LEFT JOIN role_permissions rp ON rp.role_id=r.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    WHERE s.id=? AND au.user_id=? AND au.status='active' AND a.status='active'
      AND (au.role IN ('owner','admin') OR sm.id IS NOT NULL)
    GROUP BY s.id,a.status,au.role,sm.id
    LIMIT 1
  `).bind(storeId,session.user_id).first();
  if(!store) return {response:json({error:"Store not found"},404)};
  if(store.store_status!=="active") return {response:json({error:"Store is not active"},409)};
  const permissions=String(store.permissions||"").split(",");
  if(!["owner","admin"].includes(store.account_role) && !permissions.includes("team.manage")) {
    return {response:json({error:"Store team management permission required"},403)};
  }
  return {session,store};
}

async function canAssignRole(db,store,roleId) {
  if(["owner","admin"].includes(store.account_role)) return true;
  const result=await db.prepare(`
    SELECT p.code
    FROM role_permissions rp
    JOIN permissions p ON p.id=rp.permission_id
    JOIN roles r ON r.id=rp.role_id
    WHERE r.id=? AND r.store_id=?
  `).bind(roleId,store.id).all();
  const own=new Set(String(store.permissions||"").split(",").filter(Boolean));
  return (result.results||[]).every(permission=>own.has(permission.code));
}

async function ensurePresetRoles(db,storeId) {
  const statements=[];
  for(const preset of ROLE_PRESETS) {
    const roleId=crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT INTO roles (id,store_id,name,description,is_system)
      SELECT ?,?,?,?,1
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE store_id=? AND name=?)
    `).bind(roleId,storeId,preset.name,preset.description,storeId,preset.name));
    for(const code of preset.permissions) {
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO role_permissions (role_id,permission_id)
        SELECT r.id,p.id
        FROM roles r JOIN permissions p ON p.code=?
        WHERE r.store_id=? AND r.name=?
      `).bind(code,storeId,preset.name));
    }
  }
  if(statements.length) await db.batch(statements);
}

async function listTeam(db,storeId) {
  await ensurePresetRoles(db,storeId);
  const [rolesResult,membersResult]=await Promise.all([
    db.prepare(`
      SELECT r.id,r.name,r.description,r.is_system,
             COALESCE(GROUP_CONCAT(DISTINCT p.code), '') AS permissions
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id=r.id
      LEFT JOIN permissions p ON p.id=rp.permission_id
      WHERE r.store_id=?
      GROUP BY r.id
      ORDER BY r.is_system DESC,r.name COLLATE NOCASE ASC
    `).bind(storeId).all(),
    db.prepare(`
      SELECT sm.id AS member_id,sm.user_id,sm.status,u.full_name,u.email,
             COALESCE(GROUP_CONCAT(DISTINCT r.id), '') AS role_ids,
             COALESCE(GROUP_CONCAT(DISTINCT r.name), '') AS role_names
      FROM store_members sm
      JOIN users u ON u.id=sm.user_id
      LEFT JOIN member_roles mr ON mr.store_member_id=sm.id
      LEFT JOIN roles r ON r.id=mr.role_id AND r.store_id=sm.store_id
      WHERE sm.store_id=?
      GROUP BY sm.id
      ORDER BY sm.created_at DESC
    `).bind(storeId).all()
  ]);
  return {
    roles:(rolesResult.results||[]).map(role=>({...role,permissions:role.permissions?role.permissions.split(","):[]})),
    members:(membersResult.results||[]).map(member=>({...member,role_ids:member.role_ids?member.role_ids.split(","):[],role_names:member.role_names?member.role_names.split(","):[]}))
  };
}

async function list(request,env,store) {
  return json({status:"ok",...(await listTeam(env.DB,store.id))});
}

async function addMember(request,env,session,store) {
  const parsed=await readBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const email=typeof parsed.body.email==="string"?parsed.body.email.trim().toLowerCase():"";
  const roleId=typeof parsed.body.role_id==="string"?parsed.body.role_id:"";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!roleId) {
    return json({error:"Enter a valid employee email and role"},400);
  }
  const user=await env.DB.prepare("SELECT id,email,status FROM users WHERE email=? LIMIT 1").bind(email).first();
  if(!user||user.status!=="active") return json({error:"The employee must have an active MMG OQVELA account first"},404);
  const role=await env.DB.prepare("SELECT id FROM roles WHERE id=? AND store_id=? LIMIT 1").bind(roleId,store.id).first();
  if(!role) return json({error:"Role not found in this store"},404);
  if(!(await canAssignRole(env.DB,store,roleId))) return json({error:"You cannot assign permissions you do not hold"},403);
  const accountMember=await env.DB.prepare("SELECT role,status FROM account_users WHERE account_id=? AND user_id=? LIMIT 1").bind(store.account_id,user.id).first();
  if(accountMember && accountMember.status!=="active") return json({error:"This account membership is suspended"},409);
  if(accountMember && ["owner","admin"].includes(accountMember.role)) return json({error:"Account owners and administrators already have store access"},409);
  const existing=await env.DB.prepare("SELECT id,status FROM store_members WHERE store_id=? AND user_id=? LIMIT 1").bind(store.id,user.id).first();
  if(existing?.status==="active") return json({error:"This employee is already assigned to the store"},409);
  const memberId=existing?.id || crypto.randomUUID();
  try {
    const statements=[
      env.DB.prepare(`
        INSERT INTO account_users (account_id,user_id,role,status)
        VALUES (?,?,'member','active')
        ON CONFLICT(account_id,user_id) DO NOTHING
      `).bind(store.account_id,user.id),
      env.DB.prepare(`
        INSERT INTO store_members (id,store_id,user_id,status)
        VALUES (?,?,?,'active')
        ON CONFLICT(store_id,user_id) DO UPDATE SET status='active'
      `).bind(memberId,store.id,user.id),
      env.DB.prepare("DELETE FROM member_roles WHERE store_member_id=?").bind(memberId),
      env.DB.prepare(`
        INSERT INTO member_roles (store_member_id,role_id)
        SELECT sm.id,r.id FROM store_members sm
        JOIN roles r ON r.id=?
        WHERE sm.id=? AND sm.store_id=? AND sm.status='active' AND r.store_id=sm.store_id
      `).bind(roleId,memberId,store.id)
    ];
    const results=await env.DB.batch(statements);
    if(!results[1]?.meta?.changes||!results[3]?.meta?.changes) return json({error:"Unable to assign this employee and role"},409);
    return json({status:"ok",message:"Employee added to the store",member:{id:memberId,user_id:user.id,email:user.email}},201);
  } catch {
    return json({error:"Unable to add employee to this store"},409);
  }
}

async function updateMember(request,env,store,memberId) {
  const parsed=await readBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const status=parsed.body.status===undefined?"active":parsed.body.status;
  const roleId=typeof parsed.body.role_id==="string"?parsed.body.role_id:"";
  if(!["active","suspended"].includes(status)) return json({error:"Invalid employee status"},400);
  const member=await env.DB.prepare("SELECT id FROM store_members WHERE id=? AND store_id=? LIMIT 1").bind(memberId,store.id).first();
  if(!member) return json({error:"Store employee not found"},404);
  if(status==="active") {
    const role=await env.DB.prepare("SELECT id FROM roles WHERE id=? AND store_id=? LIMIT 1").bind(roleId,store.id).first();
    if(!role) return json({error:"Choose a valid role for this store"},400);
    if(!(await canAssignRole(env.DB,store,roleId))) return json({error:"You cannot assign permissions you do not hold"},403);
    const results=await env.DB.batch([
      env.DB.prepare("UPDATE store_members SET status='active' WHERE id=? AND store_id=?").bind(memberId,store.id),
      env.DB.prepare("DELETE FROM member_roles WHERE store_member_id=?").bind(memberId),
      env.DB.prepare("INSERT INTO member_roles (store_member_id,role_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM roles WHERE id=? AND store_id=?)").bind(memberId,roleId,roleId,store.id)
    ]);
    if(!results[0]?.meta?.changes||!results[2]?.meta?.changes) return json({error:"Unable to update employee access"},409);
  } else {
    await env.DB.prepare("UPDATE store_members SET status='suspended' WHERE id=? AND store_id=?").bind(memberId,store.id).run();
  }
  return json({status:"ok",message:"Employee access updated"});
}

async function createRole(request,env,store) {
  const parsed=await readBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const name=typeof parsed.body.name==="string"?parsed.body.name.trim():"";
  const description=typeof parsed.body.description==="string"?parsed.body.description.trim():"";
  const permissions=parsed.body.permissions;
  if(name.length<2||name.length>80||description.length>300||!Array.isArray(permissions)||permissions.length<1||permissions.length>5||
    permissions.some(code=>typeof code!=="string"||!ALLOWED_PERMISSIONS.has(code))||new Set(permissions).size!==permissions.length) {
    return json({error:"Invalid custom role or permissions"},400);
  }
  if(!["owner","admin"].includes(store.account_role) && permissions.some(code=>!String(store.permissions||"").split(",").includes(code))) {
    return json({error:"You cannot grant permissions you do not hold"},403);
  }
  const roleId=crypto.randomUUID();
  const statements=[
    env.DB.prepare("INSERT INTO roles (id,store_id,name,description,is_system) VALUES (?,?,?, ?,0)").bind(roleId,store.id,name,description||null),
    ...permissions.map(code=>env.DB.prepare("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE code=?").bind(roleId,code))
  ];
  try {
    const results=await env.DB.batch(statements);
    if(!results[0]?.meta?.changes||results.slice(1).some(result=>!result?.meta?.changes)) return json({error:"Unable to create role"},409);
    return json({status:"ok",role:{id:roleId,name,description,permissions}},201);
  } catch {
    return json({error:"A role with this name already exists in this store"},409);
  }
}

async function updateRole(request,env,store,roleId) {
  const parsed=await readBody(request);
  if(parsed.error) return json({error:parsed.error},parsed.status);
  const name=typeof parsed.body.name==="string"?parsed.body.name.trim():"";
  const description=typeof parsed.body.description==="string"?parsed.body.description.trim():"";
  const permissions=parsed.body.permissions;
  if(name.length<2||name.length>80||description.length>300||!Array.isArray(permissions)||permissions.length<1||permissions.length>5||
    permissions.some(code=>typeof code!=="string"||!ALLOWED_PERMISSIONS.has(code))||new Set(permissions).size!==permissions.length) {
    return json({error:"Invalid custom role or permissions"},400);
  }
  if(!["owner","admin"].includes(store.account_role) && permissions.some(code=>!String(store.permissions||"").split(",").includes(code))) {
    return json({error:"You cannot grant permissions you do not hold"},403);
  }
  const role=await env.DB.prepare("SELECT id,is_system FROM roles WHERE id=? AND store_id=? LIMIT 1").bind(roleId,store.id).first();
  if(!role) return json({error:"Role not found"},404);
  if(role.is_system) return json({error:"Built-in roles cannot be modified"},409);
  try {
    const statements=[
      env.DB.prepare("UPDATE roles SET name=?,description=? WHERE id=? AND store_id=? AND is_system=0").bind(name,description||null,roleId,store.id),
      env.DB.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(roleId),
      ...permissions.map(code=>env.DB.prepare("INSERT INTO role_permissions (role_id,permission_id) SELECT ?,id FROM permissions WHERE code=?").bind(roleId,code))
    ];
    await env.DB.batch(statements);
    return json({status:"ok",message:"Role updated"});
  } catch {
    return json({error:"Unable to update role"},409);
  }
}

async function deleteRole(env,store,roleId) {
  const role=await env.DB.prepare("SELECT id,is_system FROM roles WHERE id=? AND store_id=? LIMIT 1").bind(roleId,store.id).first();
  if(!role) return json({error:"Role not found"},404);
  if(role.is_system) return json({error:"Built-in roles cannot be deleted"},409);
  const assigned=await env.DB.prepare("SELECT 1 FROM member_roles mr JOIN store_members sm ON sm.id=mr.store_member_id WHERE mr.role_id=? AND sm.store_id=? LIMIT 1").bind(roleId,store.id).first();
  if(assigned) return json({error:"Remove this role from employees before deleting it"},409);
  await env.DB.prepare("DELETE FROM roles WHERE id=? AND store_id=? AND is_system=0").bind(roleId,store.id).run();
  return json({status:"ok"});
}

export async function handleTeam(request,env) {
  const url=new URL(request.url);
  const match=url.pathname.match(/^\/api\/stores\/([^/]+)\/team(?:\/(roles)(?:\/([^/]+))?|\/([^/]+))?$/);
  if(!match) return null;
  let storeId,roleId=null,memberId=null;
  try {
    storeId=decodeURIComponent(match[1]);
    roleId=match[3]?decodeURIComponent(match[3]):null;
    memberId=match[4]?decodeURIComponent(match[4]):null;
  } catch {
    return json({error:"Invalid store or team resource ID"},400);
  }
  const context=await getContext(request,env,storeId);
  if(context.response) return context.response;
  const {store,session}=context;

  if(match[2]==="roles") {
    if(!roleId && request.method==="GET") {
      const data=await listTeam(env.DB,store.id);
      return json({status:"ok",roles:data.roles});
    }
    if(!roleId && request.method==="POST") return createRole(request,env,store);
    if(roleId && request.method==="PUT") return updateRole(request,env,store,roleId);
    if(roleId && request.method==="DELETE") return deleteRole(env,store,roleId);
    return json({error:"Method not allowed"},405);
  }

  if(!memberId && request.method==="GET") return list(request,env,store);
  if(!memberId && request.method==="POST") return addMember(request,env,session,store);
  if(memberId && request.method==="PUT") return updateMember(request,env,store,memberId);
  if(memberId && request.method==="DELETE") { const headers=new Headers(request.headers); headers.set("Content-Type","application/json"); return updateMember(new Request(request.url,{method:"PUT",headers,body:JSON.stringify({status:"suspended"})}),env,store,memberId); }
  return json({error:"Method not allowed"},405);
}
