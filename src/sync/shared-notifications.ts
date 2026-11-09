import { needsReview, supplierId } from '../economy/points';
import type { AppNotification, Listing, ListingComment, Profile, RequestEntity } from '../db/types';

export function sharedRequestNotifications(
  profileId: string,
  request: RequestEntity,
  listing: Listing | undefined,
  profiles: Profile[],
): AppNotification[] {
  if (request.meta.recommendedName) return [];
  const timestamp = request.updatedAt || request.createdAt;
  const person = (id: string) => profiles.find(profile => profile.id === id)?.name || 'Un vecino';
  const notification = (
    event: string,
    type: AppNotification['type'],
    title: string,
    body: string,
    link = '/perfil/solicitudes',
  ): AppNotification => ({
    id: `shared-request-${request.id}-${event}`,
    profileId,
    type,
    title,
    body,
    link,
    read: 0,
    createdAt: timestamp,
  });
  const title = listing?.title || 'tu publicación';
  const result: AppNotification[] = [];

  if (request.ownerId === profileId) {
    result.push(notification(
      'received',
      'request_received',
      'Nueva solicitud de ayuda',
      `${person(request.requesterId)} quiere ayudarte con "${title}".`,
    ));
  }
  if (request.requesterId === profileId && ['accepted', 'in_progress', 'completed'].includes(request.status)) {
    result.push(notification(
      'accepted',
      'request_accepted',
      '¡Solicitud aceptada!',
      `${person(request.ownerId)} aceptó tu solicitud de "${title}". Coordinen la entrega.`,
    ));
  }
  if (request.requesterId === profileId && request.status === 'rejected') {
    result.push(notification(
      'rejected',
      'request_rejected',
      'Solicitud no aceptada',
      `${person(request.ownerId)} no pudo aceptar tu solicitud de "${title}".`,
    ));
  }

  const receipt = request.meta.receipt;
  if (!receipt || request.status !== 'completed' || ![request.ownerId, request.requesterId].includes(profileId)) {
    return result;
  }

  if (request.status === 'completed') {
    const awaitingReview = needsReview(receipt) && !request.meta.review;
    const invalidated = request.meta.review?.decision === 'fraud';
    const helperId = listing ? supplierId(listing, request) : request.requesterId;
    const crisis = receipt.crisis || Boolean(listing?.meta.wallet?.crisis);
    const points = listing?.type === 'favor' && !crisis
      ? listing.meta.wallet?.cost ?? listing.meta.pointsCost ?? 15
      : 0;
    const body = invalidated
      ? `La junta invalidó la entrega de "${title}"; no se abonaron puntos.`
      : awaitingReview
        ? `La recepción de "${title}" quedó pendiente de revisión de la junta; los puntos aún no se abonaron.`
        : profileId === helperId
          ? `Se confirmó la ayuda con "${title}".${points ? ` Sumaste ${points} puntos en tu billetera.` : ' Gracias por tu aporte al barrio.'}`
          : `Se confirmó la recepción de "${title}".${points ? ` ${points} puntos se abonaron a ${person(helperId)} por ayudar.` : ''}`;
    result.push(notification(
      'completed',
      'request_completed',
      awaitingReview ? 'Entrega enviada a revisión' : 'Recepción confirmada',
      body,
      profileId === helperId ? '/billetera' : '/perfil/solicitudes',
    ));
  }

  if (request.meta.review) {
    const valid = request.meta.review.decision === 'valid';
    const helperId = listing ? supplierId(listing, request) : request.requesterId;
    const crisis = receipt.crisis || Boolean(listing?.meta.wallet?.crisis);
    const points = listing?.type === 'favor' && !crisis
      ? listing.meta.wallet?.cost ?? listing.meta.pointsCost ?? 15
      : 0;
    result.push(notification(
      `review-${request.meta.review.decision}`,
      'moderation',
      valid ? 'Entrega validada por la junta' : 'Entrega invalidada por la junta',
      valid
        ? `La junta validó la ayuda de "${title}".${points ? ` Se abonaron ${points} puntos a ${person(helperId)}.` : ''}`
        : `La junta invalidó la entrega de "${title}"; no se abonaron puntos.`,
      '/billetera',
    ));
  }

  return result;
}

export function sharedCommentNotifications(
  profileId: string,
  comment: ListingComment,
  listing: Listing | undefined,
  profiles: Profile[],
): AppNotification[] {
  if (
    comment.status !== 'visible'
    || comment.authorId === profileId
    || listing?.authorId !== profileId
  ) return [];
  const author = profiles.find(profile => profile.id === comment.authorId)?.name || 'Un vecino';
  return [{
    id: `shared-comment-${comment.id}`,
    profileId,
    type: 'listing_comment',
    title: 'Nuevo comentario en tu publicación',
    body: `${author}: ${comment.body}`,
    link: `/muro/${listing.id}`,
    read: 0,
    createdAt: comment.createdAt,
  }];
}
