import {sectorFields} from './sectors.mjs';
import {enqueueAlert} from './push.mjs';
import {startJobs} from './jobs.mjs';
import {WebSocketServer,WebSocket} from 'ws';
import http from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { authenticate, check, createSession, hash, isCoordinator, login, now, register } from './auth.mjs';
import { applyOperation, snapshot } from './sync.mjs';
import { applyGovernance, readGovernance, geographic, boardRole } from './governance.mjs';

import { secret, issue, verify, challenge, resetPassword, deliverEmail, locate } from './verification.mjs';
const prefix='/api/v1';
async function readBody(req) {
  check(req.headers['content-type']?.split(';')[0]==='application/json','Se requiere JSON.',415);
  const parts=[]; let bytes=0;
  for await (const chunk of req) {
    bytes+=chunk.length;
    check(bytes<=4_100_000,'Archivo demasiado grande.',413);
    parts.push(chunk);
  }
  let value;
  try { value=JSON.parse(Buffer.concat(parts).toString()); } catch { check(false,'JSON inválido.'); }
  check(value && typeof value==='object' && !Array.isArray(value),'Solicitud inválida.');
  return value;
}

export function apiServer(store,{coordinatorSecret,secureCookies=false,deliver=deliverEmail,geocode=locate,broadcast,emailVerificationMode='email'}={}) {
  const streams=new Set();
  const sockets=new WebSocketServer({noServer:true,maxPayload:128});
  const channels=new Map();
  function changed(district){if(broadcast)broadcast(district);else localChange(district);}
  function localChange(district) {
    for(const [socket,zone] of channels)if(zone===district && socket.readyState===WebSocket.OPEN)socket.send('update');
    for (const stream of streams) if(stream.district===district) stream.res.write('data: update\n\n');
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const route=url.pathname.slice(prefix.length);
    const token=String(req.headers.cookie||'').match(/(?:^|;\s*)vecino_sid=([a-f0-9]{64})(?:;|$)/)?.[1]||'';
    const access=String(req.headers.cookie||'').match(/(?:^|;\s*)ayni_access=([^;]+)/)?.[1];
    const cookie=(value,age)=>res.setHeader('Set-Cookie',['vecino_sid='+value+'; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age='+age+(secureCookies?'; Secure':''),...(res.getHeader('Set-Cookie')||[])]);
    const answer=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try {
      check(url.pathname.startsWith(prefix+'/'),'Ruta no encontrada.',404);
      const post=req.method==='POST';
    check(post || req.method==='GET','Método no permitido.',405);
      if(post && req.headers.origin) check(new URL(req.headers.origin).host===req.headers.host,'Origen no autorizado.',403);
      const data=post ? await readBody(req) : {};
      const key=await secret(store);
      if(!post && route==='/health'){
        await store.transaction(sql=>sql('SELECT 1 AS ready'));
        return answer(200,{ok:true});
      }
      const accessCookie=id=>res.setHeader('Set-Cookie',['ayni_access='+issue(key,id,'access','15m')+'; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=900'+(secureCookies?'; Secure':'')]);
      if(post && ['/auth/register','/auth/login','/auth/otp/send','/auth/otp/verify','/auth/reset'].includes(route)) {
        const forwarded=process.env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||'').split(',')[0].trim():'';
        const address=forwarded||req.socket.remoteAddress||'unknown';
        const ipKey=createHmac('sha256',key).update(address).digest('hex');
        const startedAt=Date.now();
        const allowed=await store.transaction(async sql=>{
          await sql('DELETE FROM auth_rate_limits WHERE window_start<=?',[startedAt-60_000]);
          const [bucket]=await sql('SELECT window_start,requests FROM auth_rate_limits WHERE identity=?',[ipKey]);
          if(bucket && startedAt-Number(bucket.window_start)<60_000){
            if(Number(bucket.requests)>=30)return false;
            await sql('UPDATE auth_rate_limits SET requests=requests+1 WHERE identity=?',[ipKey]);
          }else{
            await sql('INSERT INTO auth_rate_limits(identity,window_start,requests) VALUES(?,?,1) ON CONFLICT(identity) DO UPDATE SET window_start=excluded.window_start,requests=1',[ipKey,startedAt]);
          }
          return true;
        });
        check(allowed,'Espera un minuto para volver a intentarlo.',429);
        if(route.includes('/otp/'))return answer(200,await challenge(store,key,route,data,deliver));
        if(route==='/auth/reset')return answer(200,await resetPassword(store,key,data));
        if(route==='/auth/login'){
          const normalized=typeof data.email==='string'?data.email.trim().toLowerCase():'';
          const identity=createHmac('sha256',key).update(address+'|'+normalized).digest('hex');
          const startedAt=Date.now();
          const allowed=await store.transaction(async sql=>{
            await sql('DELETE FROM auth_failures WHERE started_at<=?',[startedAt-15*60_000]);
            const [attempt]=await sql('SELECT started_at,attempts FROM auth_failures WHERE identity=?',[identity]);
            if(attempt && startedAt-Number(attempt.started_at)<15*60_000 && Number(attempt.attempts)>=5)return false;
            if(attempt && startedAt-Number(attempt.started_at)<15*60_000) {
              await sql('UPDATE auth_failures SET attempts=attempts+1 WHERE identity=?',[identity]);
            } else {
              await sql('INSERT INTO auth_failures(identity,started_at,attempts) VALUES(?,?,1) ON CONFLICT(identity) DO UPDATE SET started_at=excluded.started_at,attempts=1',[identity,startedAt]);
            }
            return true;
          });
          check(allowed,'Demasiados intentos. Espera 15 minutos antes de volver a ingresar.',429);
          try {
            const profile=await login(store,data);
            await store.transaction(sql=>sql('DELETE FROM auth_failures WHERE identity=?',[identity]));
            accessCookie(profile.id);
            cookie(await createSession(store,profile),7*86400);
            return answer(200,{profile});
          } catch(error) {
            if(error.status!==401)await store.transaction(sql=>sql('DELETE FROM auth_failures WHERE identity=?',[identity]));
            throw error;
          }
        }
        if(route==='/auth/register'){
          const email=verify(data.ticket,key,'register');
          check(email===String(data.email).trim().toLowerCase(),'Verifica este correo.');
          check(typeof data.password==='string' && Buffer.byteLength(data.password)<=72,'Contraseña demasiado larga.');
          Object.assign(data,await geocode(data.lat,data.lng),{email,verifiedEmail:true,emailVerificationMode});
        }
        const profile=route==='/auth/register' ? await register(store,data,coordinatorSecret) : await login(store,data);
        accessCookie(profile.id);
        cookie(await createSession(store,profile),7*86400);
        if (route==='/auth/register') changed(profile.district);
        return answer(200,{profile});
      }
      const expected=req.headers['x-vecino-profile'] || url.searchParams.get('profile');
      const withSession=fn=>store.transaction(async sql=>{
        const p=await authenticate(sql,token);
        check(expected===p.id,'La sesión de este dispositivo cambió. Vuelve a ingresar.',401);
        if(route!=='/auth/refresh')check(verify(access,key,'access')===p.id,'Sesión vencida.',401);
        return fn(sql,p);
      });
      if(!post && route==='/events') {
        const p=await withSession((_,p)=>p);
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write('retry: 5000\n\n');
        const stream={district:p.district,res};streams.add(stream);
        const heartbeat=setInterval(()=>res.write(': ping\n\n'),15_000);
        // Reauthenticate periodically when the browser reconnects.
        const expiry=setTimeout(()=>res.end(),5*60_000);
        res.on('close',()=>{streams.delete(stream);clearInterval(heartbeat);clearTimeout(expiry);});
        return;
      }
      const result=await withSession(async(sql,p)=>{
        if(post && route==='/auth/refresh'){accessCookie(p.id);return {ok:true};}
        if (!post && route==='/sync') {
          const snap=await snapshot(sql,p);
          return {...snap,governance:p.verified ? await readGovernance(sql,p) : []};
        }
        if (post && route==='/sync') {
          const result=await applyOperation(sql,p,data,store.postgis);
          if(result.ok && data.entity==='alerts' && data.operation==='create' && ['critical','high'].includes(result.record.data.severity))await enqueueAlert(sql,result.record.data);
          return result;
        }
        if(post && route==='/devices/push'){
          check(typeof data.token==='string' && /^(?:Expo|Exponent)PushToken\[[a-zA-Z0-9_-]{1,200}\]$/.test(data.token),'Identificador de dispositivo inválido.');
          if(data.enabled===false)await sql('DELETE FROM push_devices WHERE token=? AND session_hash=?',[data.token,hash(token)]);
          else {
            check(p.verified,'La junta debe validar tu residencia.',403);
            await sql('DELETE FROM push_devices WHERE token=? AND member_id<>?',[data.token,p.id]);
            await sql('INSERT INTO push_devices(token,member_id,session_hash) VALUES(?,?,?) ON CONFLICT(token) DO UPDATE SET session_hash=excluded.session_hash',[data.token,p.id,hash(token)]);
          }
          return {ok:true};
        }
        if(post && route==='/coordinator/claim'){
          check(typeof data.invitation==='string' && data.invitation.length>0 && data.invitation.length<=200,'Código de junta no válido.',403);
          check(coordinatorSecret && timingSafeEqual(Buffer.from(hash(data.invitation)),Buffer.from(hash(coordinatorSecret))),'Código de junta no válido.',403);
          if(isCoordinator(p))return {profile:p};
          const members=await sql('SELECT profile FROM members WHERE district=?',[p.district]);
          check(!members.some(row=>{const member=JSON.parse(row.profile);return isCoordinator(member)&&geographic(member).id===geographic(p).id;}),'Este sector ya tiene una presidencia habilitada.',409);
          p.roles=[...new Set([...p.roles,'coordinador'])];
          p.verified=1;
          p.residencyVerifiedAt='';
          p.updatedAt=now();
          await sql('UPDATE members SET profile=? WHERE id=?',[JSON.stringify(p),p.id]);
          await sql('INSERT INTO admin_audit(id,actor,target,action,created_at) VALUES(?,?,?,?,?)',[randomUUID(),p.id,p.id,'coordinator:claim',now()]);
          return {profile:p};
        }
        if (post && route==='/auth/logout') { await sql('DELETE FROM push_devices WHERE session_hash=?',[hash(token)]);await sql('DELETE FROM sessions WHERE token_hash=?',[hash(token)]);cookie('',0);return {ok:true}; }
        if (post && route==='/governance') {
          check(p.verified,'La junta debe verificar tu inscripción.',403);
          return applyGovernance(sql,p,data);
        }
        if(post && route==='/community-role'){
          check(p.verified && ['prestador','brigadista'].includes(data.role),'Verifica tu residencia antes de inscribirte.',403);
          if(!p.roles.includes(data.role))p.roles.push(data.role);
          await sql('UPDATE members SET profile=? WHERE id=?',[JSON.stringify(p),p.id]);
          return {profile:p};
        }
        if (post && route==='/membership') {
          const actorRole=await boardRole(sql,p);
          check((actorRole==='presidente' || (actorRole==='vocal' && data.verified===true && Object.keys(data).every(k=>['id','verified'].includes(k)))) && p.id!==data.id,'Solo la presidencia puede validar a otro vecino.',403);
          const [row]=await sql('SELECT profile FROM members WHERE id=? AND district=?',[data.id,p.district]);
          check(row,'Integrante no encontrado.',404);
          const member=JSON.parse(row.profile);
          check(!isCoordinator(member),'Acción no permitida.',403);
          check(geographic(member).id===geographic(p).id,'El vecino pertenece a otra junta.',403);
          if (typeof data.verified==='boolean') {
            member.verified=data.verified?1:0;
            member.residencyVerifiedAt=data.verified?now():'';
          }
          if(data.walletReinstatedAt)member.walletReinstatedAt=now();
          if (Object.hasOwn(data,'protectionSince')) {
            check(!member.protectionSince && data.protectionSince && member.verified, 'La protección requiere un vecino verificado sin subsidio previo.');
            member.protectionSince=now();
          }
          member.updatedAt=now();
          await sql('UPDATE members SET profile=? WHERE id=?',[JSON.stringify(member),member.id]);
          await sql('INSERT INTO admin_audit(id,actor,target,action,created_at) VALUES(?,?,?,?,?)',[randomUUID(),p.id,member.id,'membership:'+JSON.stringify({verified:member.verified,protected:!!member.protectionSince}),now()]);
          return {profile:member};
        }
        if(post && route==='/location/resolve'){const place=await geocode(data.lat,data.lng);return store.postgis?{...place,...await sectorFields(sql,place)}:place;}
        if(post && route==='/location'){
          const zone=await geocode(data.lat,data.lng);
          if(store.postgis)Object.assign(zone,await sectorFields(sql,zone));
          check(zone.district===p.district || !isCoordinator(p),'La presidencia debe transferir su cargo antes de cambiar de distrito.');
          if(geographic(p).id!==geographic(zone).id){
            check(!isCoordinator(p),'Transfiere la presidencia antes de cambiar de sector.');
            p.verified=0;p.residencyVerifiedAt='';
          }
          if(zone.district!==p.district){
            const active=await sql("SELECT body FROM records WHERE district=? AND entity IN ('listings','requests')",[p.district]);
            check(!active.some(({body})=>{const x=JSON.parse(body);return [x.authorId,x.ownerId,x.requesterId].includes(p.id) && ['open','reserved','pending','accepted','in_progress'].includes(x.status);}), 'Cierra tus publicaciones y solicitudes antes de cambiar de distrito.');
          }
          delete p.sectorId;delete p.sectorName;delete p.adjacentSectors;
          Object.assign(p,zone,{updatedAt:now()});
          await sql('INSERT INTO territories(district) VALUES (?) ON CONFLICT(district) DO NOTHING',[zone.district]);
          await sql('UPDATE members SET profile=?,district=? WHERE id=?',[JSON.stringify(p),zone.district,p.id]);return {profile:p};
        }
        if(post && route==='/profile') {
          check(data.district===p.district && typeof data.name==='string' && data.name.trim().length>=3 && data.name.length<=150 && typeof data.phone==='string' && /^[\d\s()+-]{0,24}$/.test(data.phone),'Comprueba tu nombre, teléfono y distrito.');
          if(data.photo!==undefined){check(typeof data.photo==='string' && data.photo.length<=100000 && (!data.photo || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(data.photo)),'Foto inválida.');p.photo=data.photo;}
          Object.assign(p,{name:data.name.trim(),phone:data.phone.trim(),updatedAt:now()});
          await sql('UPDATE members SET profile=? WHERE id=?',[JSON.stringify(p),p.id]);return {profile:p};
        }
        if (post && route==='/crisis') {
          check(isCoordinator(p),'Se requiere la presidencia.',403);
          check(typeof data.active==='boolean' && typeof data.title==='string' && data.title.length<=160,'Estado de crisis inválido.');
          const key='disaster/'+geographic(p).id;
          await sql('INSERT INTO board_records(district,record_key,body) VALUES(?,?,?) ON CONFLICT(district,record_key) DO UPDATE SET body=excluded.body',[p.district,key,JSON.stringify({active:data.active,title:data.title,since:now()})]);
          if(!data.active)await sql('DELETE FROM board_records WHERE district=? AND record_key LIKE ?',[p.district,'federation/'+geographic(p).id+':%']);
          await sql('INSERT INTO admin_audit(id,actor,target,action,created_at) VALUES(?,?,?,?,?)',[randomUUID(),p.id,p.district,'crisis:'+data.title,now()]);
          return {ok:true};
        }
        check(false,'Ruta no encontrada.',404);
      });
      if (post && !['/auth/logout','/auth/refresh','/location/resolve'].includes(route) && result?.ok!==false) {
        const p=await withSession((_,p)=>p);
        changed(p.district);
      }
      return answer(200,result??{ok:true});
    } catch(e) {
      if (!e.status) console.error('Vecino360:',e.message);
      if(!res.headersSent) answer(e.status??500,{error:e.status?e.message:'El servidor no pudo completar la operación.'});
    }
  });
  server.on('upgrade',async(req,socket,head)=>{
    socket.on('error',()=>socket.destroy());
    try{
      const url=new URL(req.url,'http://localhost');
      check(url.pathname===prefix+'/live' && req.headers.origin && new URL(req.headers.origin).host===req.headers.host,'Origen inválido.',403);
      const cookies=Object.fromEntries((req.headers.cookie || '').split(/;\s*/).map(v=>v.split('=')));
      const key=await secret(store);
      const profile=await store.transaction(sql=>authenticate(sql,cookies.vecino_sid || ''));
      check(verify(cookies.ayni_access,key,'access')===profile.id && url.searchParams.get('profile')===profile.id,'Sesión inválida.',401);
      sockets.handleUpgrade(req,socket,head,ws=>{
        channels.set(ws,profile.district);
        const expiry=setTimeout(()=>ws.close(),300000);
        ws.on('error',()=>ws.terminate());
        ws.on('message',()=>ws.close(1008));
        ws.on('close',()=>{clearTimeout(expiry);channels.delete(ws);});
      });
    }catch{socket.destroy();}
  });
  server.on('district-change',localChange);
  server.on('close',()=>{for(const s of streams)s.res.end();for(const ws of channels.keys())ws.terminate();sockets.close();});
  return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.env.NODE_ENV==='production'){
    const required=['DATABASE_URL','SMTP_URL','MAIL_FROM','AYNI_AUTH_KEY','VECINO_CHAIR_CODE'];
    const missing=required.filter(name=>!process.env[name]);
    if(missing.length)throw Error('Faltan variables obligatorias para producción: '+missing.join(', '));
    if(process.env.COOKIE_SECURE!=='1')throw Error('En producción COOKIE_SECURE debe ser 1 y la aplicación debe servirse solo por HTTPS.');
    if(process.env.TRUST_PROXY!=='1')throw Error('En producción TRUST_PROXY debe ser 1 y la API solo debe aceptar tráfico desde el proxy de confianza.');
    if(Buffer.byteLength(process.env.AYNI_AUTH_KEY)<32)throw Error('AYNI_AUTH_KEY debe tener al menos 32 bytes.');
    if(Buffer.byteLength(process.env.VECINO_CHAIR_CODE)<16)throw Error('VECINO_CHAIR_CODE debe tener al menos 16 bytes.');
    if(process.env.AYNI_DEV_OTP==='1')throw Error('AYNI_DEV_OTP no puede activarse en producción.');
  }
  const store=await openStore({databaseUrl:process.env.DATABASE_URL,filename:process.env.VECINO_DB || 'server/data/vecino360.sqlite'});
  const port=Number(process.env.PORT||4174);
  const host=process.env.HOST || '127.0.0.1';
  const localOtp=process.env.AYNI_DEV_OTP==='1';
  if(localOtp && (process.env.NODE_ENV==='production' || !['127.0.0.1','localhost','::1'].includes(host))) {
    throw Error('Los códigos OTP locales solo se permiten en desarrollo y con la API enlazada a localhost.');
  }
  const deliver=localOtp ? async(email,code)=>{
    const maskedEmail=email.replace(/^(.).*(@.*)$/,'$1***$2');
    console.info(`[Ayni desarrollo] Código de verificación para ${maskedEmail}: ${code}`);
    return 'local';
  } : deliverEmail;
  let jobs;
  const server=apiServer(store,{coordinatorSecret:process.env.VECINO_CHAIR_CODE,secureCookies:process.env.COOKIE_SECURE==='1',deliver,emailVerificationMode:localOtp?'local':'email',broadcast:district=>jobs.notify(district)});
  jobs=await startJobs(store,district=>server.emit('district-change',district));
  server.on('close',async()=>{await jobs.close();await store.close();});
  server.listen(port,host,()=>console.log('Vecino360 API · puerto '+port+' · '+(store.postgis?'PostgreSQL/PostGIS':'SQLite')));
}
