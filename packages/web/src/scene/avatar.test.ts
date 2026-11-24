import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from '@cafe/core';
import type { Mesh, MeshLambertMaterial } from 'three';
import { AVATAR_COLORS, CUSTOMER_COLORS, createAvatar, type StaffRole } from './avatar';

const ROLES: StaffRole[] = [...AGENT_IDS, 'boss'];

describe('createAvatar', () => {
  it.each(ROLES)('builds %s from a body, a head and a nose, in the colour of the role', (role) => {
    const { object } = createAvatar(role);
    for (const name of ['body', 'head', 'nose'])
      expect(object.getObjectByName(name), name).toBeDefined();
    const body = object.getObjectByName('body') as Mesh;
    expect((body.material as MeshLambertMaterial).color.getHex()).toBe(AVATAR_COLORS[role]);
  });

  it('gives every role its own colour', () => {
    expect(new Set(ROLES.map((role) => AVATAR_COLORS[role])).size).toBe(ROLES.length);
  });

  it('puts the nose on the front (+z), so the rotation shows which way the character looks', () => {
    const nose = createAvatar('cook').object.getObjectByName('nose');
    expect(nose?.position.z).toBeGreaterThan(0.2);
  });

  it('bobs a little while walking, up to 0.1, and stands flat when idle', () => {
    const avatar = createAvatar('cashier');
    const figure = avatar.object.getObjectByName('figure');
    const heights = Array.from({ length: 50 }, (_, index) => {
      avatar.play('walking', index / 17);
      return figure?.position.y ?? -1;
    });
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(0.1);
    expect(Math.max(...heights)).toBeGreaterThan(0.01);
    avatar.play('idle', 1);
    expect([figure?.position.y, figure?.rotation.z]).toEqual([0, 0]);
  });

  it('sways a little while working', () => {
    const avatar = createAvatar('cook');
    const figure = avatar.object.getObjectByName('figure');
    const sways = Array.from({ length: 40 }, (_, index) => {
      avatar.play('working', index / 13);
      return figure?.rotation.z ?? 0;
    });
    expect(Math.max(...sways.map(Math.abs))).toBeLessThanOrEqual(0.05);
    expect(new Set(sways).size).toBeGreaterThan(5);
    expect(figure?.position.y).toBe(0);
  });

  it('keeps the position and the facing for the scene to set, whatever the pose', () => {
    const avatar = createAvatar('waiter');
    avatar.object.position.set(1, 0, 2);
    avatar.object.rotation.y = 1.2;
    avatar.play('walking', 0.3);
    avatar.play('working', 0.4);
    expect([avatar.object.position.x, avatar.object.position.z, avatar.object.rotation.y]).toEqual([
      1, 2, 1.2,
    ]);
  });

  it('gives a customer the shirt that its number picks, and different customers different shirts', () => {
    const shirt = (variant: number) =>
      (
        (createAvatar('customer', variant).object.getObjectByName('body') as Mesh)
          .material as MeshLambertMaterial
      ).color.getHex();
    expect(shirt(0)).toBe(CUSTOMER_COLORS[0]);
    expect(shirt(3)).toBe(CUSTOMER_COLORS[3]);
    expect(shirt(CUSTOMER_COLORS.length + 2)).toBe(shirt(2));
    expect(shirt(-1)).toBe(CUSTOMER_COLORS[1]);
    expect(new Set([0, 1, 2, 3, 4].map(shirt)).size).toBe(5);
  });

  it('shares its shapes between characters, so that customers coming and going leak nothing', () => {
    const a = createAvatar('customer', 1).object.getObjectByName('body') as Mesh;
    const b = createAvatar('customer', 9).object.getObjectByName('body') as Mesh;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material); // the same shirt colour is the same material
  });

  it('holds a cup in its hand only when told to', () => {
    const avatar = createAvatar('customer', 2);
    const cup = avatar.object.getObjectByName('cup');
    expect(cup?.visible).toBe(false);
    avatar.carry(true);
    expect(cup?.visible).toBe(true);
    avatar.carry(false);
    expect(cup?.visible).toBe(false);
  });
});
