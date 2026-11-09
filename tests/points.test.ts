import { describe, expect, it } from 'vitest';
import { projectWallet, reservePoints, STARTING_POINTS } from '../src/economy/points';

describe('puntos de bienvenida', () => {
  it('inicia cada billetera con 100 puntos y los proyecta una sola vez', () => {
    const profileId = 'vecina-nueva';
    const createdAt = '2026-11-08T12:00:00.000Z';

    const wallet = projectWallet(profileId, [], [], '', '', new Date('2026-11-09T12:00:00.000Z'), createdAt);
    const refreshedWallet = projectWallet(profileId, [], [], '', '', new Date('2026-11-09T12:00:00.000Z'), createdAt);

    expect(STARTING_POINTS).toBe(100);
    expect(wallet.balance).toBe(100);
    expect(wallet.available).toBe(100);
    expect(wallet.entries.filter(entry => entry.id === `bienvenida-${profileId}`)).toHaveLength(1);
    expect(refreshedWallet.balance).toBe(100);
    expect(reservePoints(15, wallet.available, false, false).held).toBe(15);
  });
});
