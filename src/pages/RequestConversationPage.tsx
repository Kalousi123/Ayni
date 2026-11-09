import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { LockKeyhole, Send } from 'lucide-react';
import { db } from '../db/db';
import { sendRequestMessage } from '../db/repositories';
import { useCurrentProfile } from '../hooks';
import { useAppStore } from '../store/useAppStore';
import { Avatar, Button, Card, EmptyState, Textarea } from '../components/ui';
import { PageHeading } from '../components/PageBits';
import { relativeTime } from '../lib/utils';

export function RequestConversationPage(){
  const {id}=useParams<{id:string}>();
  const {profile}=useCurrentProfile();
  const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false);
  const toast=useAppStore(state=>state.toast);
  const request=useLiveQuery(()=>id?db.requests.get(id):undefined,[id]);
  const listing=useLiveQuery(()=>request?db.listings.get(request.listingId):undefined,[request?.listingId]);
  const otherId=request?(request.ownerId===profile?.id?request.requesterId:request.ownerId):'';
  const other=useLiveQuery(()=>otherId?db.profiles.get(otherId):undefined,[otherId]);
  const messages=useLiveQuery(async()=>{
    if(!id)return [];
    const rows=await db.messages.where('requestId').equals(id).toArray();
    return Promise.all(rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(async message=>({message,author:await db.profiles.get(message.authorId)})));
  },[id]);
  const allowed=!!profile && !!request && [request.ownerId,request.requesterId].includes(profile.id) && ['accepted','in_progress','completed'].includes(request.status);
  const submit=async()=>{
    if(!profile || !request || !body.trim())return;
    setBusy(true);
    try{await sendRequestMessage(request,profile,body);setBody('');}
    catch(error){toast({tone:'error',title:'No se pudo enviar',description:error instanceof Error?error.message:'Inténtalo de nuevo.'});}
    finally{setBusy(false);}
  };
  if(!allowed)return <div className="space-y-4">
    <PageHeading title="Conversación privada" back={{to:'/perfil/solicitudes',label:'Solicitudes'}}/>
    <EmptyState icon={<LockKeyhole size={32}/>} title="Conversación no disponible" description="Solo las personas participantes pueden conversar y únicamente mientras la solicitud esté aceptada o en curso."/>
  </div>;
  return <div className="space-y-4">
    <PageHeading title="Coordinar ayuda" subtitle={listing?.title??'Conversación privada'} back={{to:`/muro/${request?.listingId}`,label:'Publicación'}}/>
    <Card className="flex items-center gap-3 p-3">
      <Avatar name={other?.name??'Vecino'} color={other?.avatarColor} size="md" verified={other?.verified===1}/>
      <div className="min-w-0 flex-1"><Link to={`/vecinos/${otherId}`} className="text-sm font-semibold text-slate-900 hover:underline">{other?.name??'Vecino'}</Link><p className="text-[11px] text-slate-500">Mensajes privados para coordinar esta solicitud</p></div>
      <LockKeyhole size={16} className="text-slate-400" aria-label="Conversación privada"/>
    </Card>
    <section className="space-y-2" aria-label="Mensajes">
      {messages?.length?messages.map(({message:item,author})=><div key={item.id} className={`flex ${item.authorId===profile?.id?'justify-end':''}`}>
        <div className={`max-w-[85%] rounded-xl px-3 py-2 ${item.authorId===profile?.id?'bg-slate-900 text-white':'border border-slate-200 bg-white text-slate-700'}`}>
          <div className="flex items-center justify-between gap-4 text-[10px] opacity-70"><span>{item.authorId===profile?.id?'Tú':author?.name??'Vecino'}</span><time>{relativeTime(item.createdAt)}</time></div>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{item.body}</p>
        </div>
      </div>):<p className="py-6 text-center text-xs text-slate-500">Aún no hay mensajes. Coordinen aquí sin compartir públicamente sus datos personales.</p>}
    </section>
    {request?.status==='completed'?<p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Intercambio completado. Esta conversación quedó en modo lectura para las personas participantes.</p>:<Card className="space-y-2 p-3">
      <Textarea label="Mensaje" placeholder="Escribe para coordinar la ayuda…" value={body} maxLength={2000} onChange={event=>setBody(event.target.value)}/>
      <div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">{body.length}/2000 · Se guarda en este dispositivo si no hay conexión.</span><Button size="sm" disabled={!body.trim()||busy} loading={busy} onClick={()=>void submit()}><Send size={14}/> Enviar</Button></div>
    </Card>}
  </div>;
}
