import { describe, expect, it } from 'vitest';
import { AGENT_IDS } from '@cafe/core';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import {
  AVATAR_COLORS,
  CUSTOMER_COLORS,
  STEP_LENGTH,
  UNIFORM,
  createAvatar,
  type StaffRole,
} from './avatar';

const ROLES: StaffRole[] = [...AGENT_IDS, 'boss'];

const colorOf = (object: Object3D | undefined): number =>
  ((object as Mesh).material as MeshStandardMaterial).color.getHex();
/** The colour of the shirt (the torso) and of the trousers (the leg) of an avatar. */
const clothes = (avatar: ReturnType<typeof createAvatar>) => ({
  shirt: colorOf(avatar.object.getObjectByName('torso')),
  trousers: colorOf(avatar.object.getObjectByName('leg-shape')),
});
const part = (avatar: ReturnType<typeof createAvatar>, name: string) =>
  avatar.object.getObjectByName(name);

describe('createAvatar', () => {
  it.each(ROLES)('builds %s as a person: torso, head with a face, arms and legs', (role) => {
    const { object } = createAvatar(role);
    for (const name of [
      'torso',
      'head',
      'eye',
      'nose',
      'arm-left',
      'arm-right',
      'leg-left',
      'leg-right',
      'hand',
      'shoe',
    ]) {
      expect(object.getObjectByName(name), name).toBeDefined();
    }
  });

  it('dresses all the staff the same: a green shirt and white trousers', () => {
    for (const role of AGENT_IDS) {
      expect(clothes(createAvatar(role)), role).toEqual({
        shirt: UNIFORM.shirt,
        trousers: UNIFORM.trousers,
      });
    }
    expect(UNIFORM.shirt).toBe(0x2f8f5b);
    expect(AGENT_IDS.every((role) => AVATAR_COLORS[role] === UNIFORM.shirt)).toBe(true);
  });

  it('tells the staff apart by their hair, the hat of the cook and the beard, not by their clothes', () => {
    expect(part(createAvatar('cook'), 'toque')).toBeDefined();
    expect(part(createAvatar('cook'), 'hair')).toBeUndefined();
    for (const role of ['cashier', 'stock_admin', 'waiter'] as const) {
      expect(part(createAvatar(role), 'hair'), role).toBeDefined();
      expect(part(createAvatar(role), 'toque'), role).toBeUndefined();
    }
    expect(part(createAvatar('cashier'), 'long-hair')).toBeDefined();
    expect(part(createAvatar('waiter'), 'ponytail')).toBeDefined();
  });

  it('makes the cashier and Rina women, and the cook, the stock admin and the boss men', () => {
    const woman = (role: StaffRole) => part(createAvatar(role), 'lips') !== undefined;
    expect([woman('cashier'), woman('waiter')]).toEqual([true, true]);
    expect([woman('cook'), woman('stock_admin'), woman('boss')]).toEqual([false, false, false]);
    expect(part(createAvatar('cook'), 'beard')).toBeDefined();
    expect(part(createAvatar('cashier'), 'beard')).toBeUndefined();
  });

  it('gives men broad shoulders and women slim ones, longer hair to some women, and never a beard to a woman', () => {
    const width = (role: StaffRole) => (part(createAvatar(role), 'torso') as Mesh).scale.x;
    expect(width('cook')).toBeGreaterThan(width('cashier') + 0.15);
    expect(width('stock_admin')).toBe(width('cook'));
    for (let variant = 0; variant < 12; variant += 1) {
      const customer = createAvatar('customer', variant);
      const woman = part(customer, 'lips') !== undefined;
      expect(woman, `customer ${variant}`).toBe(variant % 2 === 1);
      if (woman) expect(part(customer, 'beard')).toBeUndefined();
      else expect(part(customer, 'long-hair')).toBeUndefined();
    }
    expect(
      [0, 1, 2, 3, 4, 5].some(
        (variant) => part(createAvatar('customer', variant), 'long-hair') !== undefined,
      ),
    ).toBe(true);
  });

  it('puts the boss in a dark suit with a tie', () => {
    const boss = createAvatar('boss');
    expect(clothes(boss).shirt).not.toBe(UNIFORM.shirt);
    expect(part(boss, 'tie')).toBeDefined();
  });

  it('dresses customers differently, by their number, and always the same for the same number', () => {
    const shirt = (variant: number) => clothes(createAvatar('customer', variant)).shirt;
    expect(shirt(0)).toBe(CUSTOMER_COLORS[0]);
    expect(shirt(CUSTOMER_COLORS.length + 2)).toBe(shirt(2));
    expect(shirt(-1)).toBe(CUSTOMER_COLORS[1]);
    expect(new Set([0, 1, 2, 3, 4].map(shirt)).size).toBe(5);
    expect(CUSTOMER_COLORS).not.toContain(UNIFORM.shirt); // nobody is mistaken for staff
  });

  it('shares its shapes between people, so that customers coming and going leak nothing', () => {
    const a = part(createAvatar('customer', 1), 'torso') as Mesh;
    const b = part(createAvatar('customer', 9), 'torso') as Mesh;
    expect(a.geometry).toBe(b.geometry);
  });

  /** Walks an avatar `distance` units at `speed` units per real second, drawing every 1/60 s. */
  function walkFor(avatar: ReturnType<typeof createAvatar>, distance: number, speed: number) {
    const frame = 1 / 60;
    const frames = Math.round(distance / (speed * frame));
    const legs: number[] = [];
    for (let index = 1; index <= frames; index += 1) {
      avatar.play('walking', index * frame, index * speed * frame);
      legs.push(part(avatar, 'leg-left')?.rotation.x ?? 0);
    }
    return legs;
  }

  it('swings the arms and the legs against each other when walking', () => {
    const avatar = createAvatar('cashier');
    const seen = new Set<number>();
    let walked = 0;
    for (let index = 1; index <= 60; index += 1) {
      walked += 0.03;
      avatar.play('walking', index / 60, walked);
      const leftLeg = part(avatar, 'leg-left')?.rotation.x ?? 0;
      const rightLeg = part(avatar, 'leg-right')?.rotation.x ?? 0;
      const leftArm = part(avatar, 'arm-left')?.rotation.x ?? 0;
      const rightArm = part(avatar, 'arm-right')?.rotation.x ?? 0;
      expect(leftLeg).toBeCloseTo(-rightLeg);
      expect(leftArm).toBeCloseTo(-rightArm);
      expect(leftArm * leftLeg).toBeLessThanOrEqual(1e-9); // an arm swings against the leg on its side
      expect(Math.abs(leftLeg)).toBeLessThanOrEqual(0.5 + 1e-9);
      seen.add(Math.round(leftLeg * 100));
    }
    expect(seen.size).toBeGreaterThan(8);
    expect(part(avatar, 'figure')?.position.y).toBeLessThanOrEqual(0.03 + 1e-9);
  });

  it('makes one step for every step length it walks: the legs swing by the distance, not by the time', () => {
    const slow = createAvatar('cook');
    const fast = createAvatar('cook');
    walkFor(slow, STEP_LENGTH * 4, 0.6); // four steps, slowly
    walkFor(fast, STEP_LENGTH * 4, 1.5); // four steps, faster
    // after a whole number of steps the legs are in the same place, whatever the speed
    expect(part(slow, 'leg-left')?.rotation.x).toBeCloseTo(
      part(fast, 'leg-left')?.rotation.x ?? 9,
      1,
    );
    // and the swing goes once through the whole cycle for two steps
    const cycle = walkFor(createAvatar('cook'), STEP_LENGTH * 2, 0.8);
    expect(Math.max(...cycle)).toBeGreaterThan(0.45);
    expect(Math.min(...cycle)).toBeLessThan(-0.45);
  });

  it('stands still with its legs when it does not move forward', () => {
    const avatar = createAvatar('waiter');
    for (let index = 1; index <= 30; index += 1) avatar.play('walking', index / 60, 2); // always at 2 units
    const before = part(avatar, 'leg-left')?.rotation.x;
    avatar.play('walking', 1, 2);
    expect(part(avatar, 'leg-left')?.rotation.x).toBe(before);
  });

  it('never swings the legs faster than a person can, however fast the clock runs', () => {
    const avatar = createAvatar('stock_admin');
    let last = 0;
    let biggest = 0;
    for (let index = 1; index <= 60; index += 1) {
      avatar.play('walking', index / 60, index * 5); // 300 units per second: a very fast clock
      const now = part(avatar, 'leg-left')?.rotation.x ?? 0;
      biggest = Math.max(
        biggest,
        Math.abs(
          Math.asin(Math.max(-1, Math.min(1, now / 0.5))) -
            Math.asin(Math.max(-1, Math.min(1, last / 0.5))),
        ),
      );
      last = now;
    }
    expect(biggest).toBeLessThan(13 / 60 + 0.4); // the angle of the legs changes by about 13 rad/s at the most
  });

  it('holds the arms out in front and moves them while working', () => {
    const avatar = createAvatar('cook');
    const arm = part(avatar, 'arm-left');
    const angles = Array.from({ length: 30 }, (_, index) => {
      avatar.play('working', index / 11);
      return arm?.rotation.x ?? 0;
    });
    expect(Math.max(...angles)).toBeLessThan(-0.8); // always raised
    expect(new Set(angles.map((angle) => Math.round(angle * 1000))).size).toBeGreaterThan(5);
  });

  it('rests with the arms and legs down when idle, and comes back to it from walking', () => {
    const avatar = createAvatar('waiter');
    avatar.play('walking', 0.4);
    avatar.play('idle', 1);
    for (const name of ['leg-left', 'leg-right']) expect(part(avatar, name)?.rotation.x).toBe(0);
    expect(part(avatar, 'arm-left')?.rotation.x).toBe(0);
  });

  it('sits down with the legs forward, lower to the floor, and stands up again', () => {
    const avatar = createAvatar('customer', 4);
    const figure = part(avatar, 'figure');
    avatar.sit(true);
    avatar.play('idle', 2);
    expect(figure?.position.y).toBeLessThan(-0.3);
    expect(part(avatar, 'leg-left')?.rotation.x).toBeLessThan(-1);
    avatar.sit(false);
    avatar.play('idle', 2);
    expect(Math.abs(figure?.position.y ?? 1)).toBeLessThan(0.01);
    expect(part(avatar, 'leg-left')?.rotation.x).toBe(0);
  });

  it('holds a cup in its right hand only when told to', () => {
    const avatar = createAvatar('customer', 2);
    expect(part(avatar, 'cup')?.visible).toBe(false);
    avatar.carry(true);
    expect(part(avatar, 'cup')?.visible).toBe(true);
    avatar.carry(false);
    expect(part(avatar, 'cup')?.visible).toBe(false);
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
});
