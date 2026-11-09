import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownWideNarrow, Compass, HeartHandshake, Plus, Search, Sparkles } from 'lucide-react';
import { isAvailable } from '../lib/catalog';
import { inScope, useCatalogClock, useVisibleSectors } from '../hooks/territory';
import { db } from '../db/db';
import type { ListingType } from '../db/types';
import { useAppStore } from '../store/useAppStore';
import { useCurrentProfile, useEmergencyMode } from '../hooks';
import { distanceMeters } from '../lib/geo';
import { LISTING_TYPE_ICON, LISTING_TYPE_LABEL, cn } from '../lib/utils';
import { ListingCard } from '../components/cards';
import { Chip, EmptyState, Input } from '../components/ui';
import { PageHeading } from '../components/PageBits';

const TYPES: Array<ListingType | 'all'> = [
  'all',
  'promotion',
  'recommendation',
  'loan',
  'donation',
  'favor',
  'time_bank',
  'mobility',
  'service',
];

type FeedSort = 'recent' | 'nearby';

export function WallPage() {
  const { profile } = useCurrentProfile();
  const sectors = useVisibleSectors(profile);
  const now = useCatalogClock();
  const emergency = useEmergencyMode();
  const openPublish = useAppStore((state) => state.openPublish);
  const [type, setType] = useState<ListingType | 'all'>(new URLSearchParams(window.location.search).get('tipo') === 'favor' ? 'favor' : 'all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<FeedSort>('recent');
  const [limit,setLimit] = useState(12);

  const listings = useLiveQuery(async () => {
    const rows = (await db.listings.toArray())
      .filter((item) => isAvailable(item, now) && inScope(sectors, item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.all(
      rows.map(async (listing) => ({
        listing,
        author: await db.profiles.get(listing.authorId),
      })),
    );
  }, [sectors, now]);

  const coords = { lat: profile?.lat ?? -12.083, lng: profile?.lng ?? -77.051 };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (listings ?? []).filter(({ listing }) => {
      if (type !== 'all' && listing.type !== type) return false;
      if (!normalized) return true;
      return [listing.title, listing.description, listing.category, listing.district]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [listings, type, query]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => sort === 'recent'
      ? b.listing.createdAt.localeCompare(a.listing.createdAt)
      : distanceMeters(coords, { lat: a.listing.lat, lng: a.listing.lng })
        - distanceMeters(coords, { lat: b.listing.lat, lng: b.listing.lng })),
    [filtered, sort, coords.lat, coords.lng],
  );
  const page = sorted.slice(0,limit);

  return (
    <div className="space-y-4">
      <PageHeading
        title="Muro del barrio"
        subtitle="Lo que tus vecinos comparten, necesitan y recomiendan."
        action={
          <button
            type="button"
            onClick={() => openPublish('auto')}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-community-600 px-3.5 text-xs font-semibold text-white hover:bg-community-700"
          >
            <Plus size={15} />
            Publicar
          </button>
        }
      />

      {emergency ? (
        <div className="mb-3 rounded-lg border border-crisis-200 bg-crisis-50 px-4 py-3 text-xs text-crisis-800">
          <p className="font-semibold">Modo emergencia activo</p>
          <p className="mt-0.5 text-crisis-700">
            Las necesidades urgentes se priorizan. Si hay riesgo de vida, crea una alerta SOS.
          </p>
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3">
          <Search size={17} className="shrink-0 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en el muro"
            className="border-0 bg-transparent px-1 shadow-none focus:ring-0"
            aria-label="Buscar publicaciones"
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {filtered.length} publicaciones
          </span>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1" aria-label="Ordenar publicaciones">
            <button
              type="button"
              onClick={() => setSort('recent')}
              aria-pressed={sort === 'recent'}
              className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors', sort === 'recent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
            >
              <ArrowDownWideNarrow size={14} /> Nuevas
            </button>
            <button
              type="button"
              onClick={() => setSort('nearby')}
              aria-pressed={sort === 'nearby'}
              className={cn('inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors', sort === 'nearby' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}
            >
              <Compass size={14} /> Cerca
            </button>
          </div>
        </div>
      </div>

      <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TYPES.map((item) => {
          const Icon = item === 'all' ? Sparkles : LISTING_TYPE_ICON[item];
          return (
            <Chip
              key={item}
              active={type === item}
              onClick={() => setType(item)}
              className={cn(item === 'all' && 'font-semibold')}
            >
              <Icon size={14} aria-hidden="true" />
              {item === 'all' ? 'Todos' : LISTING_TYPE_LABEL[item]}
            </Chip>
          );
        })}
      </div>

      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<HeartHandshake size={34} />}
            title="El muro está tranquilo"
            description="Publica un préstamo, una donación o un favor. La red se activa con el primer gesto."
            action={
              <button
                type="button"
                onClick={() => openPublish('auto')}
                className="inline-flex h-10 items-center rounded-lg bg-community-600 px-4 text-xs font-semibold text-white"
              >
                Crear publicación
              </button>
            }
          />
        ) : (
          page.map(({ listing, author }) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              author={author}
              distance={distanceMeters(coords, { lat: listing.lat, lng: listing.lng })}
            />
          ))
        )}
      </div>

      {limit < filtered.length && (
        <button
          type="button"
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:border-community-600 hover:text-community-700"
          onClick={() => setLimit((value) => value + 12)}
        >
          Ver más publicaciones
        </button>
      )}
      <p className="pb-2 text-center text-[10px] text-slate-400">
        {filtered.length} publicaciones abiertas · radio hiperlocal
      </p>
    </div>
  );
}
