import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { MapPin, ShieldCheck } from 'lucide-react';
import { db } from '../db/db';
import { useCurrentProfile } from '../hooks';
import { Avatar, Badge, Card, EmptyState } from '../components/ui';
import { PageHeading } from '../components/PageBits';
import { ListingCard } from '../components/cards';

export function PublicProfilePage(){
  const {id}=useParams<{id:string}>();
  const {profile:current}=useCurrentProfile();
  const profile=useLiveQuery(()=>id?db.profiles.get(id):undefined,[id]);
  const listings=useLiveQuery(async()=>{
    if(!id)return [];
    return (await db.listings.where('authorId').equals(id).toArray()).filter(listing=>listing.status!=='hidden').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  },[id]);
  const provider=useLiveQuery(()=>id?db.providers.where('profileId').equals(id).filter(item=>item.status==='active').first():undefined,[id]);
  const endorsements=useLiveQuery(async()=>{
    if(!provider)return [];
    const rows=await db.endorsements.where('providerId').equals(provider.id).toArray();
    return Promise.all(rows.map(async item=>({item,author:await db.profiles.get(item.endorserId)})));
  },[provider?.id]);
  if(!profile)return <div className="space-y-4"><PageHeading title="Perfil vecinal" back={{to:'/',label:'Inicio'}}/><EmptyState title="Perfil no disponible" description="Solo se muestran perfiles compartidos con tu comunidad." /></div>;
  return <div className="space-y-4">
    <PageHeading title="Perfil vecinal" back={{to:'/',label:'Inicio'}}/>
    <Card className="overflow-hidden p-0">
      <div className="bg-slate-900 p-5 text-white">
        <div className="flex items-start gap-3">
          {profile.photo?<img src={profile.photo} alt="" width={56} height={56} className="rounded-full object-cover"/>:<Avatar name={profile.name} color={profile.avatarColor} size="lg" verified={profile.verified===1}/>}
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{profile.name}</h1>
            {profile.verified===1?<p className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[10px]"><ShieldCheck size={13}/> Residencia revisada por la comunidad</p>:<p className="mt-1 text-[11px] text-white/70">Residencia pendiente de revisión</p>}
            <p className="mt-2 flex items-center gap-1 text-xs text-white/75"><MapPin size={13}/>{profile.zone||profile.district}</p>
            <div className="mt-2 flex flex-wrap gap-1">{profile.roles.filter(role=>role!=='coordinador'&&role!=='vecino').map(role=><Badge key={role} tone="neutral">{role==='prestador'?'Prestador vecinal':'Brigadista'}</Badge>)}</div>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-white/60">Por privacidad, este perfil no muestra dirección exacta, correo ni teléfono.</p>
      </div>
      {current?.id===profile.id?<Link to="/perfil/editar" className="block border-t border-slate-200 px-4 py-3 text-xs font-semibold text-slate-700">Editar mi perfil</Link>:null}
    </Card>
    {provider?<Card>
      <h2 className="text-sm font-semibold text-slate-900">Oficio ofrecido</h2>
      <p className="mt-1 text-xs font-semibold text-slate-700">{provider.trade}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{provider.description}</p>
      <p className="mt-2 text-[11px] text-slate-500">{provider.endorsementCount} Visto Bueno Vecinal · {provider.score.toFixed(1)} de puntaje agregado</p>
      {endorsements?.length?<div className="mt-3 space-y-2 border-t border-slate-100 pt-3">{endorsements.slice(0,5).map(({item,author})=><div key={item.id} className="text-xs text-slate-600"><span className="font-semibold">{author?.name??'Vecino'}:</span> {item.comment}</div>)}</div>:null}
    </Card>:null}
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-900">Publicaciones compartidas</h2>
      {listings?.length?listings.map(listing=><ListingCard key={listing.id} listing={listing} author={profile}/>):<Card className="p-4 text-xs text-slate-500">Aún no hay publicaciones visibles.</Card>}
    </section>
    <p className="text-center text-[10px] text-slate-400">En Ayni la confianza se construye con contribuciones comunitarias, no con popularidad.</p>
  </div>;
}
