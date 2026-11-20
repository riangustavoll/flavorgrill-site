// Varredura de contraste WCAG AA (mesma usada no site)
() => {
 function parse(c){const m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
 function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
 function mix(top,bot){const a=top.a;return {r:top.r*a+bot.r*(1-a),g:top.g*a+bot.g*(1-a),b:top.b*a+bot.b*(1-a),a:1};}
 function bg(el){const stack=[];let e=el;while(e){const s=getComputedStyle(e);if(s.backgroundImage&&s.backgroundImage!=='none'&&!s.backgroundImage.startsWith('radial'))return null;const c=parse(s.backgroundColor);if(c&&c.a>0){stack.push(c);if(c.a>=1)break;}e=e.parentElement;}let res={r:255,g:255,b:255,a:1};for(let i=stack.length-1;i>=0;i--)res=mix(stack[i],res);return res;}
 const out=[];
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 const seen=new Set();
 while(walker.nextNode()){const t=walker.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(seen.has(el))continue;seen.add(el);
  const s=getComputedStyle(el);const r=el.getBoundingClientRect();if(!r.width||s.visibility==='hidden'||s.opacity==='0'||el.closest('[hidden]')||el.closest('[aria-hidden=true]'))continue;
  let p=el,op=1;while(p){op*=parseFloat(getComputedStyle(p).opacity);p=p.parentElement;} if(op<0.05)continue;
  const fg=parse(s.color);const b=bg(el);if(!fg||!b)continue;const f=mix(fg,b);
  const L1=lum(f),L2=lum(b);const cr=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
  const size=parseFloat(s.fontSize),w=parseInt(s.fontWeight);const grande=size>=24||(size>=18.66&&w>=700);
  const min=grande?3:4.5;
  if(cr<min)out.push({txt:t.textContent.trim().slice(0,30),sel:el.tagName.toLowerCase()+(el.className?'.'+String(el.className).split(' ')[0]:'')+(el.id?'#'+el.id:''),cor:s.color,fundo:`rgb(${Math.round(b.r)},${Math.round(b.g)},${Math.round(b.b)})`,cr:+cr.toFixed(2),min,size});
 }
 return out;}
