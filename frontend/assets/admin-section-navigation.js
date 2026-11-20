(()=> {
 const panel=document.getElementById("adminPanel");
 if(!panel||panel.dataset.sectionNavReady==="1")return;
 panel.dataset.sectionNavReady="1";
 const headings=[...panel.querySelectorAll("h3")].filter(h=>h.textContent.trim());
 if(!headings.length)return;
 const nav=document.createElement("nav");nav.className="admin-section-nav";nav.setAttribute("aria-label","أقسام الإدارة");
 const title=document.createElement("div");title.className="admin-section-nav-title";title.textContent="أقسام لوحة الإدارة";
 nav.append(title);
 headings.forEach((heading,index)=>{
   const id=heading.id||"admin-section-"+index;heading.id=id;
   const button=document.createElement("button");button.type="button";button.textContent=heading.textContent.trim();button.addEventListener("click",()=>{
     heading.scrollIntoView({behavior:"smooth",block:"start"});
     nav.querySelectorAll("button").forEach(x=>x.removeAttribute("aria-current"));
     button.setAttribute("aria-current","location");
   });nav.append(button);
 });
 panel.insertBefore(nav,panel.children[3]||panel.firstChild);
})();
