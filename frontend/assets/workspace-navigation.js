/* MMG OQVELA workspace navigation: role-aware shortcuts to existing live modules. */
(()=> {
  const dashboard=document.getElementById("dashboard");
  if(!dashboard||dashboard.dataset.workspaceReady==="1")return;
  const top=dashboard.querySelector(":scope > .dashboard-top");
  const notifications=document.getElementById("notificationPanel");
  const accounts=document.getElementById("accountGrid");
  const admin=document.getElementById("adminPanel");
  if(!top||!notifications||!accounts||!admin)return;
  dashboard.dataset.workspaceReady="1";

  const layout=document.createElement("div");layout.className="workspace-layout";
  const sidebar=document.createElement("aside");sidebar.className="workspace-sidebar";
  sidebar.setAttribute("aria-label","Workspace navigation");
  const brand=document.createElement("div");brand.className="workspace-brand";
  brand.innerHTML="<strong>MMG OQVELA</strong><small data-ar='مساحة العمل الذكية' data-en='Intelligent workspace'>مساحة العمل الذكية</small>";
  const nav=document.createElement("nav");nav.className="workspace-nav";
  const content=document.createElement("div");content.className="workspace-content";
  const foot=document.createElement("div");foot.className="workspace-sidebar-foot";
  foot.textContent="MMG OQVELA · Workspace";

  const views=[
    {id:"home",icon:"⌂",ar:"الرئيسية",en:"Overview",target:()=>top},
    {id:"stores",icon:"▦",ar:"المتاجر",en:"Stores",find:["إدارة بيانات المتجر","إنشاء متجر"]},
    {id:"products",icon:"◇",ar:"المنتجات والمخزون",en:"Products & inventory",find:["إدارة المنتجات والمخزون"]},
    {id:"orders",icon:"⇄",ar:"الطلبات والمدفوعات",en:"Orders & payments",find:["إدارة الطلبات وطرق الدفع"]},
    {id:"team",icon:"♙",ar:"الفريق والصلاحيات",en:"Team & permissions",find:["إدارة فريق المتجر"]},
    {id:"design",icon:"✧",ar:"تصميم المتجر",en:"Store design",find:["قالب المتجر","إدارة بيانات المتجر"]},
    {id:"billing",icon:"▤",ar:"الاشتراكات",en:"Subscriptions",find:["اشتراك المتجر"]},
    {id:"notifications",icon:"♢",ar:"الإشعارات",en:"Notifications",target:()=>notifications},
    {id:"admin",icon:"⚙",ar:"إدارة المنصة",en:"Platform admin",target:()=>admin}
  ];
  const sections={home:[top,notifications,accounts],notifications:[notifications],admin:[admin]};
  const buttons=[];
  function language(){return document.documentElement.lang==="en"?"en":"ar"}
  function findTarget(item){
    if(item.target)return item.target();
    const textNodes=[...accounts.querySelectorAll("button,h3,h4,h5,label")];
    for(const phrase of item.find||[]){
      const found=textNodes.find(node=>node.textContent.trim().includes(phrase));
      if(found)return found.closest(".account-card")||found;
    }
    return null;
  }
  function activate(button,target){
    buttons.forEach(b=>b.setAttribute("aria-current",b===button?"page":"false"));
    if(target){
      target.scrollIntoView({behavior:"smooth",block:"start"});
      target.classList.add("workspace-focus");
      window.setTimeout(()=>target.classList.remove("workspace-focus"),1200);
    }
  }
  for(const item of views){
    const b=document.createElement("button");b.type="button";b.dataset.view=item.id;
    const icon=document.createElement("span");icon.className="nav-icon";icon.textContent=item.icon;
    const label=document.createElement("span");label.dataset.ar=item.ar;label.dataset.en=item.en;label.textContent=item[language()];
    b.append(icon,label);
    b.addEventListener("click",()=>{
      const target=findTarget(item);
      if(item.id==="admin"&&admin.classList.contains("hidden"))return;
      if(target)activate(b,target);
    });
    nav.append(b);buttons.push(b);
  }
  sidebar.append(brand,nav,foot);
  dashboard.insertBefore(layout,top);
  layout.append(sidebar,content);
  content.append(top,notifications,accounts,admin);

  function refresh(){
    const isAdmin=!admin.classList.contains("hidden");
    for(let i=0;i<views.length;i++){
      const item=views[i],button=buttons[i];
      if(item.id==="home"||item.id==="notifications"){button.hidden=false;continue;}
      if(item.id==="admin"){button.hidden=!isAdmin;continue;}
      button.hidden=!findTarget(item);
    }
    nav.querySelectorAll("[data-ar][data-en]").forEach(el=>el.textContent=el.dataset[language()]);
  }
  document.getElementById("languageToggle")?.addEventListener("click",()=>setTimeout(refresh,0));
  new MutationObserver(refresh).observe(admin,{attributes:true,attributeFilter:["class"]});
  new MutationObserver(refresh).observe(accounts,{childList:true,subtree:true});
  refresh();
  buttons[0].setAttribute("aria-current","page");
})();