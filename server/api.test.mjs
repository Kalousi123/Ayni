import assert from 'node:assert/strict';
import test from 'node:test';
import {openStore} from './store.mjs';
import {apiServer} from './index.mjs';
import {register} from './auth.mjs';
import {locate} from './verification.mjs';

test('la ubicación reconoce un distrito conocido aunque el geocodificador priorice Lima',async()=>{
 const originalFetch=globalThis.fetch;
 let lookup;
 globalThis.fetch=async(url)=>{lookup=new URL(url);return new Response(JSON.stringify({
  lat:'-12.083',lon:'-77.051',
  address:{country_code:'pe',city_district:'Lima',suburb:'Jesus Maria',city:'Lima'},
 }),{status:200,headers:{'content-type':'application/json'}});};
 try{
  const result=await locate(-12.08345,-77.05145);
  assert.equal(result.district,'Jesús María');
  assert.match(result.zone,/Jesús María/);
  assert.equal(result.lat,-12.08345);
  assert.equal(result.lng,-77.05145);
  assert.equal(lookup.searchParams.get('lat'),'-12.083');
  assert.equal(lookup.searchParams.get('lon'),'-77.051');
 }finally{
  globalThis.fetch=originalFetch;
 }
});

test('el registro admite nuevos distritos y conserva el territorio',async()=>{
 const store=await openStore({filename:':memory:'});
 try{
   const profile=await register(store,{name:'Ana Vecina',email:'ana@example.org',password:'prueba-local-234',district:'Comas',lat:-11.932,lng:-77.042,verifiedEmail:true});
   assert.equal(profile.district,'Comas');
   assert.equal((await store.transaction(sql=>sql('SELECT district FROM territories')))[0].district,'Comas');
 }finally{await store.close();}
});

test('la geolocalización admite ubicaciones fuera del Perú',async()=>{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({
  lat:'47.6062',lon:'-122.3321',
  address:{country_code:'us',city:'Seattle',state:'Washington',country:'United States'},
 }),{status:200,headers:{'content-type':'application/json'}});
 try{
  const result=await locate(47.6062,-122.3321);
  assert.equal(result.district,'Seattle');
 }finally{
  globalThis.fetch=originalFetch;
 }
});
test('registro, OTP, GPS, login, lectura y recuperación',async()=>{
 const store=await openStore({filename:':memory:'});let code;
 const server=apiServer(store,{deliver:async(_,v)=>{code=v;},emailVerificationMode:'local',coordinatorSecret:'junta-de-prueba',geocode:async()=>({lat:-12.083,lng:-77.051,district:'Jesús María',zone:'Jesús María, Lima'})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 const post=(path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
 try{
 const health=await fetch(base+'/health');
 assert.equal(health.status,200);
 assert.equal(health.headers.get('content-security-policy'),"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
 assert.equal(health.headers.get('x-frame-options'),'DENY');
 const email='vecina@example.org',password='prueba-local-234',account={name:'Ana Pérez',email,password,lat:-12.083,lng:-77.051};
 assert.equal((await post('/auth/register',account)).status,401);
 const exhausted='intentos@example.org';
 assert.equal((await post('/auth/otp/send',{email:exhausted})).status,200);
 const exhaustedCode=code;
 for(let i=0;i<5;i++)assert.equal((await post('/auth/otp/verify',{email:exhausted,code:'invalido'})).status,400);
 assert.match((await(await post('/auth/otp/verify',{email:exhausted,code:exhaustedCode})).json()).error,/cinco/);
 assert.equal((await post('/auth/otp/send',{email})).status,200);
 assert.equal((await post('/auth/otp/send',{email})).status,429);
 assert.equal((await post('/auth/otp/verify',{email,code:'invalid'})).status,400);
 const {ticket}=await (await post('/auth/otp/verify',{email,code})).json();
 const registered=await post('/auth/register',{...account,ticket});assert.equal(registered.status,200);
 const registeredProfile=(await registered.json()).profile;
 assert.equal(registeredProfile.emailVerified,true);
 assert.equal(registeredProfile.emailVerificationMode,'local');
 assert.equal(registeredProfile.dniRegistered,undefined);
 assert.equal(registeredProfile.verified,0);
 const login=await post('/auth/login',{email,password});assert.equal(login.status,200);
 const {profile}=await login.json();const headers={cookie:login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),'x-vecino-profile':profile.id};
 assert.equal((await fetch(base+'/sync',{headers})).status,200);
 assert.equal((await post('/coordinator/claim',{invitation:'codigo-incorrecto'},headers)).status,403);
 const claim=await post('/coordinator/claim',{invitation:'junta-de-prueba'},headers);
 assert.equal(claim.status,200);
 const chair=(await claim.json()).profile;
 assert.equal(chair.verified,1);
 assert.ok(chair.roles.includes('coordinador'));
 assert.equal(chair.residencyVerifiedAt,'');
 assert.equal((await post('/auth/refresh',{},headers)).status,200);
 assert.equal((await post('/location',account,headers)).status,200);
 assert.equal((await post('/auth/otp/send',{email,purpose:'reset'})).status,200);
 const reset=await(await post('/auth/otp/verify',{email,purpose:'reset',code})).json();
 assert.equal((await post('/auth/reset',{ticket:reset.ticket,password:'nueva-clave-123'})).status,200);
 assert.equal((await post('/auth/login',{email,password})).status,401);
 for(let i=0;i<4;i++)assert.equal((await post('/auth/login',{email,password:'clave-incorrecta'})).status,401);
 assert.equal((await post('/auth/login',{email,password:'nueva-clave-123'})).status,429);
 assert.equal((await store.transaction(sql=>sql('SELECT attempts FROM auth_failures')))[0].attempts,5);
 }finally{await new Promise(r=>server.close(r));await store.close();}
});

test('el límite de autenticación por IP se persiste y responde 429',async()=>{
 const store=await openStore({filename:':memory:'});
 const server=apiServer(store,{deliver:async()=>{}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 try{
   const results=await Promise.all(Array.from({length:31},(_,i)=>fetch(base+'/auth/otp/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`limit-${i}@example.org`})})));
   assert.equal(results.filter(response=>response.status===429).length,1);
   assert.equal((await store.transaction(sql=>sql('SELECT requests FROM auth_rate_limits')))[0].requests,30);
 }finally{await new Promise(resolve=>server.close(resolve));await store.close();}
});

test('dos sesiones, residencia, alertas, entrega, reintentos y reservas simultáneas',async()=>{
 const store=await openStore({filename:':memory:'});const codes=new Map();
 const zone={lat:-12.083,lng:-77.051,district:'Jesús María',zone:'Sector central'};
 const server=apiServer(store,{deliver:async(email,code)=>codes.set(email,code),geocode:async()=>zone,coordinatorSecret:'junta-de-prueba'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 const post=(path,data,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
 async function enroll(email,invitation){
   assert.equal((await post('/auth/otp/send',{email})).status,200);
   const {ticket}=await (await post('/auth/otp/verify',{email,code:codes.get(email)})).json();
   const response=await post('/auth/register',{...zone,email,invitation,ticket,name:'Vecino de prueba',password:'prueba-local-234'});
   const {profile}=await response.json();assert.equal(response.status,200);
   return {id:profile.id,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),'x-vecino-profile':profile.id};
 }
 try{
   const chair=await enroll('junta@example.org','junta-de-prueba');
   const neighbor=await enroll('vecino@example.org');
   const outsider=await enroll('tercero@example.org');
   const op=(entity,payload)=>({entity,payload,entityId:payload.id,idempotencyKey:'alta-'+payload.id,baseVersion:0,operation:'create'});
   const alert=op('alerts',{...zone,id:'incidencia',authorId:neighbor.id,title:'Prueba vecinal',description:'Simulacro',category:'otro',severity:'high',status:'pending'});
   assert.equal((await post('/sync',alert,neighbor)).status,403);
   assert.equal((await post('/membership',{id:neighbor.id,verified:true},chair)).status,200);
   assert.equal((await post('/membership',{id:outsider.id,verified:true},chair)).status,200);
   assert.equal((await post('/community-role',{role:'coordinador'},neighbor)).status,403);
   const providerRole=await post('/community-role',{role:'prestador'},neighbor);
   assert.equal(providerRole.status,200);
   assert.ok((await providerRole.json()).profile.roles.includes('prestador'));
   assert.equal((await post('/devices/push',{token:'ExpoPushToken[dispositivoPrueba]'},chair)).status,200);
   const oversized={...alert,payload:{...alert.payload,title:'x'.repeat(121)},idempotencyKey:'alta-invalida'};
   assert.equal((await post('/sync',oversized,neighbor)).status,400);
   const result=await (await post('/sync',alert,neighbor)).json();assert.equal(result.ok,true);
   assert.deepEqual(await (await post('/sync',alert,neighbor)).json(),result);
   const snap=await (await fetch(base+'/sync',{headers:chair})).json();
   assert.equal(snap.records.filter(r=>r.entity==='alerts').length,1);
   const listing={...zone,id:'listing-chat',type:'loan',authorId:neighbor.id,title:'Escalera',description:'Presto escalera',category:'Herramientas',status:'open',expiresAt:'2099-01-01',meta:{}};
   assert.equal((await post('/sync',op('listings',listing),neighbor)).status,200);
   const comment={id:'comment-chat',listingId:listing.id,authorId:chair.id,body:'¿Está disponible mañana?',status:'visible'};
   assert.equal((await post('/sync',op('comments',{...comment,authorId:neighbor.id}),chair)).status,403);
   assert.equal((await post('/sync',op('comments',comment),chair)).status,200);
   const commentReport={id:'comment-report',targetType:'comment',targetId:comment.id,reporterId:neighbor.id,reason:'Información engañosa',status:'open'};
   assert.equal((await post('/sync',op('reports',commentReport),neighbor)).status,200);
   const hiddenComment={...comment,status:'hidden'};
   assert.equal((await post('/sync',{...op('comments',hiddenComment),operation:'update',baseVersion:1,idempotencyKey:'ocultar-comment-chat'},chair)).status,200);
   const reviewedReport={...commentReport,status:'resolved'};
   assert.equal((await post('/sync',{...op('reports',reviewedReport),operation:'update',baseVersion:1,idempotencyKey:'resolver-comment-report'},chair)).status,200);
   const neighborSnap=await (await fetch(base+'/sync',{headers:neighbor})).json();
   assert.equal(neighborSnap.records.some(record=>record.entity==='comments'&&record.id===comment.id),false);
   const request={id:'request-chat',listingId:listing.id,requesterId:chair.id,ownerId:neighbor.id,status:'pending',message:'Necesito una escalera',meta:{}};
   assert.equal((await post('/sync',op('requests',request),chair)).status,200);
   const accepted={...request,status:'accepted',version:1};
   assert.equal((await post('/sync',{...op('requests',accepted),operation:'update',baseVersion:1,idempotencyKey:'aceptar-request-chat'},neighbor)).status,200);
   const message={id:'message-chat',requestId:request.id,authorId:chair.id,body:'Gracias, paso a las seis.'};
   assert.equal((await post('/sync',op('messages',{...message,authorId:neighbor.id}),chair)).status,403);
   assert.equal((await post('/sync',op('messages',{...message,id:'message-outsider',authorId:outsider.id}),outsider)).status,403);
   assert.equal((await post('/sync',op('messages',message),chair)).status,200);
   const outsiderSnap=await (await fetch(base+'/sync',{headers:outsider})).json();
   assert.equal(outsiderSnap.records.some(record=>record.entity==='messages'&&record.id===message.id),false);
   const privateSnap=await (await fetch(base+'/sync',{headers:neighbor})).json();
   assert.equal(privateSnap.records.some(record=>record.entity==='messages'&&record.id===message.id),true);
   const deliveries=await store.transaction(sql=>sql('SELECT id,state FROM push_deliveries'));assert.equal(deliveries.length,1);
   const {deliverPush}=await import('./push.mjs');
   await deliverPush(store,deliveries[0].id,async()=>({status:'ok',id:'ticket-prueba'}));
   assert.equal((await store.transaction(sql=>sql('SELECT state FROM push_deliveries')))[0].state,'receipt');
   await store.transaction(sql=>sql("INSERT INTO points_ledger(member_id,event_id,amount,label,recorded_at) VALUES(?, 'saldo-prueba',20,'Saldo de prueba',?)",[neighbor.id,new Date().toISOString()]));
   const favor=id=>op('listings',{...zone,id,type:'favor',authorId:neighbor.id,title:'Apoyo',description:'Favor de prueba',category:'apoyo',status:'open',expiresAt:'2099-01-01',meta:{pointsCost:50,wallet:{cost:50,held:50,subsidy:0,crisis:false}}});
   const credits=await Promise.all(['favor-1','favor-2','favor-3'].map(id=>post('/sync',favor(id),neighbor)));
   assert.deepEqual(credits.map(r=>r.status).sort(),[200,200,422]);
   const favorForOutsider={...zone,id:'favor-reward',type:'favor',authorId:outsider.id,title:'Ayuda con compras',description:'Apoyo vecinal',category:'Apoyo',status:'open',expiresAt:'2099-01-01',meta:{pointsCost:15,wallet:{cost:15,held:15,subsidy:0,crisis:false}}};
   assert.equal((await post('/sync',op('listings',favorForOutsider),outsider)).status,200);
   const favorRequest={id:'favor-help-request',listingId:favorForOutsider.id,requesterId:chair.id,ownerId:outsider.id,status:'pending',message:'Puedo ayudarte',meta:{}};
   assert.equal((await post('/sync',op('requests',favorRequest),chair)).status,200);
   const acceptedFavor={...favorRequest,status:'accepted'};
   assert.equal((await post('/sync',{...op('requests',acceptedFavor),operation:'update',baseVersion:1,idempotencyKey:'aceptar-favor-prueba'},outsider)).status,200);
   const startedFavor={...acceptedFavor,status:'in_progress'};
   assert.equal((await post('/sync',{...op('requests',startedFavor),operation:'update',baseVersion:2,idempotencyKey:'entregar-favor-prueba'},chair)).status,200);
   const completedFavor={...startedFavor,status:'completed',meta:{receipt:{accuracy:5,punctuality:5,quality:5,comment:'Ayuda recibida',flagged:false,at:new Date().toISOString(),crisis:false}}};
   assert.equal((await post('/sync',{...op('requests',completedFavor),operation:'update',baseVersion:3,idempotencyKey:'confirmar-favor-prueba'},outsider)).status,200);
   const helperWallet=await (await fetch(base+'/sync',{headers:chair})).json();
   assert.ok(helperWallet.ledger.some(entry=>entry.id===favorRequest.id && entry.delta===15));
   const ownerWallet=await (await fetch(base+'/sync',{headers:outsider})).json();
   assert.ok(ownerWallet.ledger.some(entry=>entry.id===favorRequest.id && entry.delta===-15));
   await assert.rejects(store.transaction(sql=>sql('UPDATE points_ledger SET amount=100')));
   assert.equal((await post('/auth/logout',{},chair)).status,200);
   assert.equal((await store.transaction(sql=>sql('SELECT token FROM push_devices'))).length,0);
 }finally{await new Promise(resolve=>server.close(resolve));await store.close();}
});
