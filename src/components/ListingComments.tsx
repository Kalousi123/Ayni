import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Flag, MessageCircle, Send } from 'lucide-react';
import { db } from '../db/db';
import type { Profile } from '../db/types';
import { createListingComment, createReport } from '../db/repositories';
import { useAppStore } from '../store/useAppStore';
import { Avatar, Button, Card, Sheet, Textarea } from './ui';
import { relativeTime } from '../lib/utils';

export function ListingComments({ listingId, profile }: { listingId: string; profile?: Profile }) {
  const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false);
  const [reportId,setReportId]=useState('');
  const [reason,setReason]=useState('');
  const toast=useAppStore(state=>state.toast);
  const comments=useLiveQuery(async()=>{
    const rows=await db.comments.where('listingId').equals(listingId).toArray();
    return Promise.all(rows.filter(comment=>comment.status==='visible').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(async comment=>({comment,author:await db.profiles.get(comment.authorId)})));
  },[listingId]);
  const submit=async()=>{
    if(!profile || body.trim().length<2) return;
    setBusy(true);
    try{
      await createListingComment(listingId,profile,body);
      setBody('');
    }catch(error){
      toast({tone:'error',title:'No se pudo publicar el comentario',description:error instanceof Error?error.message:'Inténtalo de nuevo.'});
    }finally{setBusy(false);}
  };
  return <section className="space-y-3" aria-labelledby="listing-comments-title">
    <div className="flex items-center gap-2">
      <MessageCircle size={17} className="text-slate-500"/>
      <h2 id="listing-comments-title" className="text-sm font-semibold text-slate-900">Conversación vecinal</h2>
      <span className="text-xs text-slate-400">{comments?.length??0}</span>
    </div>
    {comments?.length ? <div className="space-y-2">{comments.map(({comment,author})=><Card key={comment.id} className="p-3">
      <div className="flex items-start gap-2.5">
        <Avatar name={author?.name??'Vecino'} color={author?.avatarColor} size="sm" verified={author?.verified===1}/>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <Link to={`/vecinos/${comment.authorId}`} className="truncate font-semibold text-slate-800 hover:underline">{author?.name??'Vecino'}</Link>
            <time className="shrink-0 text-slate-400">{relativeTime(comment.createdAt)}</time>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-600">{comment.body}</p>
          {profile && profile.id!==comment.authorId?<button type="button" className="mt-2 inline-flex min-h-8 items-center gap-1 text-[10px] text-slate-500 hover:text-crisis-700" onClick={()=>setReportId(comment.id)}><Flag size={11}/> Reportar comentario</button>:null}
        </div>
      </div>
    </Card>)}</div> : <p className="text-xs text-slate-500">Aún no hay comentarios. Puedes iniciar la conversación con una pregunta u oferta de ayuda.</p>}
    {profile ? <Card className="space-y-2 p-3">
      <Textarea label="Escribe un comentario" placeholder="Pregunta o propone cómo ayudar…" value={body} maxLength={1000} onChange={event=>setBody(event.target.value)}/>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-400">{body.length}/1000</span>
        <Button size="sm" disabled={body.trim().length<2 || busy} loading={busy} onClick={()=>void submit()}><Send size={14}/> Comentar</Button>
      </div>
    </Card> : <p className="text-xs text-slate-500">Inicia sesión para participar en la conversación.</p>}
    <Sheet open={!!reportId} onClose={()=>{setReportId('');setReason('');}} title="Reportar comentario" description="Un coordinador revisará el contenido." footer={<Button full variant="danger" disabled={reason.trim().length<5} onClick={async()=>{if(!profile)return;try{await createReport('comment',reportId,profile,reason);setReportId('');setReason('');toast({tone:'info',title:'Reporte enviado'});}catch(error){toast({tone:'error',title:'No se pudo reportar',description:error instanceof Error?error.message:'Inténtalo de nuevo.'});}}}>Enviar reporte</Button>}>
      <Textarea label="Motivo" value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explica brevemente el problema…" maxLength={500}/>
    </Sheet>
  </section>;
}
