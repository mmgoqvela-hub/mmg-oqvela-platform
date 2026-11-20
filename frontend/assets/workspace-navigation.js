/* Progressive navigation shell; existing forms and API handlers remain intact. */
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
  const foot=document.createElement("div");foot.className="workspace-sidebar-foot";foot.textContent="MMG OQVELA · Workspace";
  const views=[
    {id:"home",icon:"⌂",ar:"الرئيسية",en:"Overview"},
    {id:"stores",icon:"▦",ar:"المتاجر والحسابات",en:"Stores & accounts"},
    {id:"notifications",icon:"♢",ar:"الإشعارات",en:"Notifications"},
    {id:"admin",icon:"⚙",ar:"إدارة المنصة",en:"Platform admin"}
  ];
  const sections={home:[top,notifications,accounts],stores:[top,accounts],notifications:[top,notifications],admin:[top,admin]};
  const buttons=[];
  function language(){return document.documentElement.lang==="en"?"en":"ar"}
  function show(id){
    const allowed=id!=="admin"||!admin.classList.contains("hidden");
    if(!allowed)return;
    for(const key of Object.keys(sections)){
      for(const node of sections[key])node.hidden=!sections[id].includes(node);
    }
    for(const b of buttons)b.setAttribute("aria-current",b.dataset.view===id?"page":"false");
    content.dataset.activeView=id;
  }
  for(const item of views){
    const b=document.createElement("button");b.type="button";b.dataset.view=item.id;
    const icon=document.createElement("span");icon.className="nav-icon";icon.textContent=item.icon;
    const label=document.createElement("span");label.dataset.ar=item.ar;label.dataset.en=item.en;label.textContent=item[language()];
    b.append(icon,label);b.addEventListener("click",()=>show(item.id));nav.append(b);buttons.push(b);
  }
  sidebar.append(brand,nav,foot);
  dashboard.insertBefore(layout,top);
  layout.append(sidebar,content);
  content.append(top,notifications,accounts,admin);
  function refreshLabels(){sidebar.querySelectorAll("[data-ar][data-en]").forEach(el=>el.textContent=el.dataset[language()]);}
  document.getElementById("languageToggle")?.addEventListener("click",()=>setTimeout(refreshLabels,0));
  new MutationObserver(()=>{const adminButton=buttons.find(b=>b.dataset.view==="admin");adminButton.hidden=admin.classList.contains("hidden");if(content.dataset.activeView==="admin"&&adminButton.hidden)show("home")}).observe(admin,{attributes:true,attributeFilter:["class"]});
  show("home");refreshLabels();
})();
