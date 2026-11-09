import { randomInt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { check, districts } from './auth.mjs';

export async function secret(store) {
 if(process.env.AYNI_AUTH_KEY){
  check(Buffer.byteLength(process.env.AYNI_AUTH_KEY)>=32,'AYNI_AUTH_KEY debe tener al menos 32 bytes.',500);
  return process.env.AYNI_AUTH_KEY;
 }
 return store.transaction(async sql=>{
  await sql("INSERT INTO secrets(name,value) VALUES ('auth-key',?) ON CONFLICT(name) DO NOTHING",[randomBytes(48).toString('hex')]);
  return (await sql("SELECT value FROM secrets WHERE name='auth-key'"))[0].value;
 });
}
const emailKey=value=>String(value??'').trim().toLowerCase();
export function issue(key,subject,purpose,expiresIn){return jwt.sign({purpose},key,{subject,expiresIn,algorithm:'HS256'});}
export function verify(token,key,purpose){
 try {const data=jwt.verify(token,key,{algorithms:['HS256']});if(data.purpose===purpose)return data.sub;}catch{}
 check(false,'La verificación venció. Vuelve a ingresar.',401);
}
export async function challenge(store,key,route,data,deliver) {
 const email=emailKey(data.email),purpose=data.purpose==='reset'?'reset':'register';
 const domain=email.split('@')[1];
 check(email.length<=150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/(^|\.)(mailinator\.com|yopmail\.com|guerrillamail\.com|10minutemail\.com|tempmail\.com|sharklasers\.com)$/.test(domain),'Usa un correo personal válido.');
 const digest=(code)=>createHmac('sha256',key).update(email+'|'+purpose+'|'+code).digest('hex');
 const now=Date.now();
 if(route==='/auth/otp/send'){
  const code=String(randomInt(1000000)).padStart(6,'0');
  const send=await store.transaction(async sql=>{
   const [member]=await sql('SELECT id FROM members WHERE email=?',[email]);
   if(purpose==='register')check(!member,'Este correo ya tiene una cuenta.',409);
   if(purpose==='reset'&&!member)return false;
   const [old]=await sql('SELECT sent FROM email_challenges WHERE email=? AND purpose=?',[email,purpose]);
   check(!old || now-Number(old.sent)>=60000,'Espera 60 segundos para reenviar.',429);
   await sql('INSERT INTO email_challenges(email,purpose,digest,expires,sent,attempts) VALUES(?,?,?,?,?,0) ON CONFLICT(email,purpose) DO UPDATE SET digest=excluded.digest,expires=excluded.expires,sent=excluded.sent,attempts=0',[email,purpose,digest(code),now+600000,now]);return true;
  });
  let local=false;
  if(send)try{local=await deliver(email,code)==='local';}catch{
   await store.transaction(sql=>sql('DELETE FROM email_challenges WHERE email=? AND purpose=? AND digest=?',[email,purpose,digest(code)]));
   check(false,process.env.SMTP_URL&&process.env.MAIL_FROM?'No se pudo enviar el correo. Revisa la configuración del servicio.':'Configura SMTP_URL y MAIL_FROM en .env.local y reinicia la API con npm run server. Para pruebas sin correo, usa npm run server:local.',503);
  }
  return {ok:true,...(local?{local:true}:{})};
 }
 const result=await store.transaction(async sql=>{
  const [row]=await sql('SELECT * FROM email_challenges WHERE email=? AND purpose=?',[email,purpose]);
  if(!row || Number(row.expires)<=now)return 'El código venció, solicita uno nuevo';
  if(row.attempts>=5)return 'Agotaste los cinco intentos. Solicita otro código.';
  if(!timingSafeEqual(Buffer.from(row.digest),Buffer.from(digest(String(data.code))))){
   await sql('UPDATE email_challenges SET attempts=attempts+1 WHERE email=? AND purpose=?',[email,purpose]);return 'El código es incorrecto';
  }
  await sql('DELETE FROM email_challenges WHERE email=? AND purpose=?',[email,purpose]);return '';
 });
 check(!result,result);return {ticket:issue(key,email,purpose,'10m')};
}
export async function resetPassword(store,key,data){
 const email=verify(data.ticket,key,'reset');
 check(typeof data.password==='string' && data.password.length>=10 && Buffer.byteLength(data.password)<=72,'Usa al menos 10 caracteres y máximo 72 bytes.');
 const hash=await bcrypt.hash(data.password,12);
 await store.transaction(async sql=>{
  const used=await sql('SELECT name FROM secrets WHERE name=?',['used:'+data.ticket]);check(!used.length,'Solicita un código nuevo.');
  await sql('INSERT INTO secrets(name,value) VALUES(?,?)',['used:'+data.ticket,'1']);
  await sql('UPDATE members SET password_hash=? WHERE email=?',[hash,email]);
  await sql('DELETE FROM sessions WHERE member_id=(SELECT id FROM members WHERE email=?)',[email]);
 });return {ok:true};
}
export async function deliverEmail(email,code){
 if(!process.env.SMTP_URL || !process.env.MAIL_FROM)throw Error('SMTP');
 await nodemailer.createTransport(process.env.SMTP_URL).sendMail({from:process.env.MAIL_FROM,to:email,subject:'Código de Ayni',text:'Tu código es '+code+'. Vence en 10 minutos.'});
}
function recognizedDistrict(address){
 const normalize=value=>String(value??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').trim().toLowerCase().replace(/^distrito\s+(?:de|del)\s+/,'').replace(/\s+/g,' ');
 const known=new Map(Object.keys(districts).map(name=>[normalize(name),name]));
 const fields=['district','city_district','borough','municipality','county','state_district','suburb','town','village','city','state','country'];
 for(const field of fields){
  const district=known.get(normalize(address[field]));
  if(district)return district;
 }
 return fields.map(field=>address[field]).find(value=>typeof value==='string'&&value.trim())?.trim().slice(0,150) || 'Ubicación general';
}
export async function locate(lat,lng){
 check(Number.isFinite(lat)&&Math.abs(lat)<=90&&Number.isFinite(lng)&&Math.abs(lng)<=180,'Permite el acceso al GPS.');
 // Send only an approximate grid point to the reverse geocoder.
 const lookupLat=Math.round(lat*1000)/1000,lookupLng=Math.round(lng*1000)/1000;
 const url=new URL(process.env.REVERSE_GEOCODER_URL || 'https://nominatim.openstreetmap.org/reverse');
 url.search=new URLSearchParams({lat:lookupLat,lon:lookupLng,format:'jsonv2',zoom:'14','accept-language':'es'}).toString();
 const response=await fetch(url,{headers:{'User-Agent':'Ayni/1.0 (community location)'},signal:AbortSignal.timeout(9000)});
 check(response.ok,'No pudimos detectar tu zona. Reintenta.',503);
 const result=await response.json();const a=result?.address??{};
 check(result?.lat && result?.lon,'No pudimos detectar tu zona. Reintenta.',503);
 const district=recognizedDistrict(a);
 return {lat,lng,district,zone:[a.neighbourhood||a.suburb,district,a.city].filter((v,i,all)=>v&&all.indexOf(v)===i).join(', ')};
}
