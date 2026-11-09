import { AlertTriangle, HeartHandshake, MapPin, Plus, Search, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { useCurrentProfile } from '../hooks';
import { inScope, useCatalogClock, useVisibleSectors } from '../hooks/territory';
import { isAvailable } from '../lib/catalog';
import { firstName } from '../lib/utils';
import { distanceMeters } from '../lib/geo';
import { useAppStore } from '../store/useAppStore';
import { AlertCard, ListingCard, ProviderCard } from '../components/cards';
import { Button, EmptyState, Input } from '../components/ui';
import { PageHeading } from '../components/PageBits';
import { useEmergencyMode } from '../hooks';
import { EmergencyPage } from './EmergencyPage';

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function HomePage() {
  const emergency = useEmergencyMode();

  return emergency ? <EmergencyPage /> : <CommunityHomePage />;
}

function CommunityHomePage() {
  const { profile } = useCurrentProfile();
  const sectors = useVisibleSectors(profile);
  const now = useCatalogClock();
  const openPublish = useAppStore((state) => state.openPublish);
  const [query, setQuery] = useState('');

  const listings = useLiveQuery(async () => {
    const rows = (await db.listings.toArray())
      .filter((listing) => isAvailable(listing, now) && inScope(sectors, listing))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.all(
      rows.map(async (listing) => ({
        listing,
        author: await db.profiles.get(listing.authorId),
      })),
    );
  }, [sectors, now]);

  const activeAlerts = useLiveQuery(async () => {
    const rows = (await db.alerts.toArray())
      .filter((alert) => inScope(sectors, alert) && ['pending', 'assigned', 'in_progress'].includes(alert.status))
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2 };
        return order[a.severity] - order[b.severity] || b.createdAt.localeCompare(a.createdAt);
      });
    return Promise.all(
      rows.map(async (alert) => ({
        alert,
        author: await db.profiles.get(alert.authorId),
      })),
    );
  }, [sectors]);

  const providers = useLiveQuery(async () => {
    const rows = await db.providers.where('status').equals('active').toArray();
    return Promise.all(
      rows.filter((provider) => inScope(sectors, provider)).map(async (provider) => ({
        provider,
        profile: await db.profiles.get(provider.profileId),
      })),
    );
  }, [sectors]);

  const coords = { lat: profile?.lat ?? -12.083, lng: profile?.lng ?? -77.051 };
  const location = profile?.zone || profile?.district || 'tu barrio';
  const normalizedQuery = normalizeSearchText(query.trim());
  const filteredListings = useMemo(
    () => (listings ?? []).filter(({ listing, author }) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText([
        listing.title,
        listing.description,
        listing.category,
        listing.district,
        author?.name ?? '',
      ].join(' ')).includes(normalizedQuery);
    }),
    [listings, normalizedQuery],
  );
  const filteredProviders = useMemo(
    () => (providers ?? []).filter(({ provider, profile: providerProfile }) => {
      if (!normalizedQuery) return true;
      return normalizeSearchText([
        provider.trade,
        provider.description,
        provider.district,
        providerProfile?.name ?? '',
      ].join(' ')).includes(normalizedQuery);
    }),
    [providers, normalizedQuery],
  );
  const homeProviders = normalizedQuery ? filteredProviders : filteredProviders.slice(0, 3);

  return (
    <div className="space-y-4">
      <PageHeading
        title={`Hola, ${firstName(profile?.name || 'vecino')}`}
        subtitle="Todas las publicaciones abiertas de tu comunidad."
        action={
          <Button size="sm" onClick={() => openPublish('auto')}>
            <Plus size={15} />
            Publicar
          </Button>
        }
      />

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <MapPin size={14} />
        {location}
        {listings ? ` · ${listings.length} publicaciones` : ''}
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
        <Search size={18} className="shrink-0 text-slate-400" aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar publicaciones y servicios"
          className="border-0 bg-transparent px-1 shadow-none focus:ring-0"
          aria-label="Buscar publicaciones y servicios del barrio"
        />
        {query ? (
          <button
            type="button"
            className="shrink-0 px-2 text-xs font-semibold text-slate-500 hover:text-slate-900"
            onClick={() => setQuery('')}
            aria-label="Limpiar búsqueda"
          >
            Limpiar
          </button>
        ) : null}
      </div>

      {normalizedQuery ? (
        <p className="text-xs font-medium text-slate-500" aria-live="polite">
          {filteredListings.length + filteredProviders.length} resultados para “{query.trim()}”
        </p>
      ) : null}

      {activeAlerts?.length ? (
        <section aria-label="Emergencias activas" className="space-y-2 rounded-xl border border-crisis-200 bg-crisis-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-crisis-800">
              <AlertTriangle size={16} />
              Emergencias activas
            </h2>
            <Link to="/alertas" className="text-xs font-semibold text-crisis-700 underline">
              Ver todas
            </Link>
          </div>
          {activeAlerts.slice(0, 3).map(({ alert, author }) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              author={author}
              distance={distanceMeters(coords, { lat: alert.lat, lng: alert.lng })}
            />
          ))}
        </section>
      ) : null}

      {homeProviders.length ? (
        <section aria-label="Oficios y servicios del barrio" className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <Wrench size={15} />
              Oficios y servicios del barrio
            </h2>
            <Link to="/directorio" className="text-xs font-semibold text-slate-600 underline">
              Ver directorio
            </Link>
          </div>
          {homeProviders.map(({ provider, profile: providerProfile }) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              profile={providerProfile}
              distance={distanceMeters(coords, { lat: provider.lat, lng: provider.lng })}
            />
          ))}
        </section>
      ) : null}

      <section aria-label="Publicaciones del barrio" className="space-y-2.5">
        {filteredListings.length ? (
          <>
            {filteredListings.map(({ listing, author }) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                author={author}
                distance={distanceMeters(coords, { lat: listing.lat, lng: listing.lng })}
              />
            ))}
          </>
        ) : listings && providers && activeAlerts && !homeProviders.length ? (
          <EmptyState
            icon={normalizedQuery ? <Search size={34} /> : <HeartHandshake size={34} />}
            title={normalizedQuery ? 'No encontramos resultados' : 'Todavía no hay publicaciones'}
            description={normalizedQuery
              ? 'Prueba con otras palabras o limpia la búsqueda para ver todas las publicaciones.'
              : 'Comparte un servicio, una ayuda o un intercambio con tu comunidad.'}
            action={normalizedQuery ? (
              <Button size="sm" variant="outline" onClick={() => setQuery('')}>Ver todas las publicaciones</Button>
            ) : (
              <Button size="sm" onClick={() => openPublish('auto')}>
                <Plus size={15} /> Crear publicación
              </Button>
            )}
          />
        ) : null}
      </section>
    </div>
  );
}
