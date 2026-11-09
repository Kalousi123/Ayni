import { describe, expect, it } from 'vitest';
import type { Listing, ListingComment, Profile, RequestEntity } from '../src/db/types';
import { sharedCommentNotifications, sharedRequestNotifications } from '../src/sync/shared-notifications';

const owner: Profile = {
  id: 'harold', name: 'Harold', phone: '', district: 'Barrio', lat: 0, lng: 0,
  roles: ['vecino'], verified: 1, avatarColor: '', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
const helper: Profile = {
  ...owner, id: 'daniel', name: 'Daniel',
};
const listing: Listing = {
  id: 'favor-1', type: 'favor', category: 'Ayuda', title: 'Ayuda con compras', description: 'Compra',
  authorId: owner.id, district: owner.district, lat: 0, lng: 0, status: 'completed',
  expiresAt: '2027-01-01', meta: { pointsCost: 15, wallet: { cost: 15, held: 15, subsidy: 0, crisis: false } },
  createdAt: '2026-01-01', updatedAt: '2026-01-01', version: 1, syncStatus: 'synced',
};
const request: RequestEntity = {
  id: 'request-1', listingId: listing.id, requesterId: helper.id, ownerId: owner.id,
  status: 'pending', message: 'Te ayudo', meta: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  version: 1, syncStatus: 'synced',
};

describe('notificaciones sincronizadas de favores', () => {
  it('avisa al dueño cuando llega una solicitud', () => {
    const [notification] = sharedRequestNotifications(owner.id, request, listing, [owner, helper]);
    expect(notification).toMatchObject({
      id: 'shared-request-request-1-received',
      type: 'request_received',
      body: 'Daniel quiere ayudarte con "Ayuda con compras".',
    });
    expect(sharedRequestNotifications(helper.id, request, listing, [owner, helper])).toHaveLength(0);
  });

  it('avisa al ayudante cuando Harold acepta', () => {
    const accepted = { ...request, status: 'accepted' as const, updatedAt: '2026-01-02' };
    const [notification] = sharedRequestNotifications(helper.id, accepted, listing, [owner, helper]);
    expect(notification).toMatchObject({ type: 'request_accepted', title: '¡Solicitud aceptada!' });
  });

  it('informa los puntos solo después de confirmar la recepción', () => {
    const completed: RequestEntity = {
      ...request,
      status: 'completed',
      meta: { receipt: { accuracy: 5, punctuality: 5, quality: 5, comment: 'Todo bien', flagged: false, at: '2026-01-03', crisis: false } },
      updatedAt: '2026-01-03',
    };
    const helperNotice = sharedRequestNotifications(helper.id, completed, listing, [owner, helper]);
    const ownerNotice = sharedRequestNotifications(owner.id, completed, listing, [owner, helper]);
    expect(helperNotice.find(item => item.id.endsWith('-completed'))?.body).toContain('Sumaste 15 puntos');
    expect(ownerNotice.find(item => item.id.endsWith('-completed'))?.body).toContain('15 puntos se abonaron a Daniel');
  });

  it('explica que los puntos esperan la revisión cuando se reporta un problema', () => {
    const completed: RequestEntity = {
      ...request,
      status: 'completed',
      meta: { receipt: { accuracy: 2, punctuality: 5, quality: 5, comment: 'Necesita revisión', flagged: false, at: '2026-01-03', crisis: false } },
      updatedAt: '2026-01-03',
    };
    const notification = sharedRequestNotifications(helper.id, completed, listing, [owner, helper])
      .find(item => item.id.endsWith('-completed'));
    expect(notification?.body).toContain('pendiente de revisión');
    expect(notification?.body).toContain('aún no se abonaron');
  });

  it('notifies the listing owner when someone comments and links to the listing', () => {
    const comment: ListingComment = {
      id: 'comment-1', listingId: listing.id, authorId: helper.id, body: 'Puedo ayudarte hoy.',
      status: 'visible', createdAt: '2026-01-04', updatedAt: '2026-01-04', version: 1, syncStatus: 'synced',
    };
    const [notification] = sharedCommentNotifications(owner.id, comment, listing, [owner, helper]);
    expect(notification).toMatchObject({
      id: 'shared-comment-comment-1',
      type: 'listing_comment',
      title: 'Nuevo comentario en tu publicación',
      body: 'Daniel: Puedo ayudarte hoy.',
      link: '/muro/favor-1',
    });
    expect(sharedCommentNotifications(helper.id, comment, listing, [owner, helper])).toHaveLength(0);
    expect(sharedCommentNotifications(owner.id, { ...comment, status: 'hidden' }, listing, [owner, helper])).toHaveLength(0);
  });
});
