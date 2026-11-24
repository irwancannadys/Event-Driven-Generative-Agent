import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  BoxGeometry,
} from 'three';
import type { AgentId } from '@cafe/core';
import type { PoseStatus } from './pose';

// A person from simple shapes: a torso, a head with a face and hair, arms and legs that swing. Other code
// only calls `createAvatar` and `play` (decision 016), so these shapes can be swapped for a model later
// without touching anything else. All the staff wear the same uniform (a green shirt and white trousers,
// told apart by their hair and by the cook's hat); the boss wears a dark suit; every customer is dressed
// a little differently, picked from its order number.

export type StaffRole = AgentId | 'boss';
export type AvatarRole = StaffRole | 'customer';

export const UNIFORM = { shirt: 0x2f8f5b, trousers: 0xf3f3ef, shoes: 0x2b2b2b } as const;
const SUIT = { jacket: 0x1f2a44, trousers: 0x1b2236, tie: 0xb23a48 } as const;

/** The colour of the shirt of everybody who works here, and of the boss. Kept for the tests. */
export const AVATAR_COLORS: Record<StaffRole, number> = {
  cashier: UNIFORM.shirt,
  cook: UNIFORM.shirt,
  stock_admin: UNIFORM.shirt,
  waiter: UNIFORM.shirt,
  boss: SUIT.jacket,
};

/** The shirts of the customers: the one of a customer is picked from its order number. */
export const CUSTOMER_COLORS = [
  0x378add, 0xd4537e, 0xe8c24a, 0x8a6bbd, 0x2b3a67, 0xe76f51, 0x6c757d, 0xb08968,
];
const CUSTOMER_TROUSERS = [0x3b5b8c, 0x2d2d33, 0x6b5a45, 0x4b5563];
const HAIR_COLORS = [0x2a1d14, 0x5a3b22, 0xb5782f, 0x111111, 0x8c8c8c, 0x7a3b1d];
const SKIN_TONES = [0xf3d5b5, 0xe0b48c, 0xc68a5e, 0x8d5a3a];
const STAFF_HAIR: Record<AgentId, number> = {
  cashier: 0x111111,
  cook: 0x5a3b22,
  stock_admin: 0x2a1d14,
  waiter: 0xb5782f,
};
const STAFF_SKIN: Record<AgentId, number> = {
  cashier: 0xf3d5b5,
  cook: 0xe0b48c,
  stock_admin: 0xc68a5e,
  waiter: 0xf3d5b5,
};

const shapes = {
  torso: new CapsuleGeometry(0.19, 0.34, 6, 14),
  head: new SphereGeometry(0.17, 18, 14),
  hair: new SphereGeometry(0.185, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
  bun: new SphereGeometry(0.07, 10, 8),
  toque: new CylinderGeometry(0.16, 0.17, 0.2, 16),
  toquePuff: new SphereGeometry(0.2, 14, 10),
  eye: new SphereGeometry(0.02, 8, 6),
  nose: new SphereGeometry(0.025, 8, 6),
  arm: new CapsuleGeometry(0.055, 0.42, 4, 8),
  hand: new SphereGeometry(0.06, 10, 8),
  leg: new CapsuleGeometry(0.08, 0.6, 4, 10),
  shoe: new BoxGeometry(0.15, 0.08, 0.26),
  cup: new CylinderGeometry(0.06, 0.045, 0.12, 12),
  tie: new BoxGeometry(0.07, 0.3, 0.02),
};
const materials = new Map<string, MeshStandardMaterial>();
function material(color: number, roughness = 0.8): MeshStandardMaterial {
  const key = `${color}:${roughness}`;
  let found = materials.get(key);
  if (!found) {
    found = new MeshStandardMaterial({ color, roughness });
    materials.set(key, found);
  }
  return found;
}

export interface Avatar {
  /** Put it in the scene and move it: `position` for where, `rotation.y` for which way it faces. */
  object: Group;
  /** Shows the pose: walking swings arms and legs, working holds the arms out and moves them, idle rests. */
  play(status: PoseStatus, seconds: number): void;
  /** Puts a cup in its hand, or takes it away. */
  carry(on: boolean): void;
  /** Sits down (a customer at a table) or stands up again. */
  sit(on: boolean): void;
}

interface Outfit {
  shirt: number;
  trousers: number;
  shoes: number;
  skin: number;
  hair: number;
  hat: 'none' | 'toque';
  hairStyle: 'short' | 'bun' | 'ponytail';
  tie?: number;
}

function outfit(role: AvatarRole, variant: number): Outfit {
  const pick = <T>(list: readonly T[], offset = 0): T =>
    list[(Math.abs(variant) + offset) % list.length] as T;
  if (role === 'customer') {
    return {
      shirt: pick(CUSTOMER_COLORS),
      trousers: pick(CUSTOMER_TROUSERS, 1),
      shoes: 0x3a2e28,
      skin: pick(SKIN_TONES, 2),
      hair: pick(HAIR_COLORS, 3),
      hat: 'none',
      hairStyle: variant % 3 === 0 ? 'bun' : variant % 3 === 1 ? 'short' : 'ponytail',
    };
  }
  if (role === 'boss') {
    return {
      shirt: SUIT.jacket,
      trousers: SUIT.trousers,
      shoes: 0x111111,
      skin: 0xe0b48c,
      hair: 0x111111,
      hat: 'none',
      hairStyle: 'short',
      tie: SUIT.tie,
    };
  }
  return {
    shirt: UNIFORM.shirt,
    trousers: UNIFORM.trousers,
    shoes: UNIFORM.shoes,
    skin: STAFF_SKIN[role],
    hair: STAFF_HAIR[role],
    hat: role === 'cook' ? 'toque' : 'none',
    hairStyle: role === 'cashier' ? 'bun' : role === 'waiter' ? 'ponytail' : 'short',
  };
}

/** `variant` dresses a customer (any whole number). Staff and the boss have their own clothes. */
export function createAvatar(role: AvatarRole, variant = 0): Avatar {
  const look = outfit(role, variant);
  const object = new Group();
  object.name = `avatar-${role}`;
  const figure = new Group();
  figure.name = 'figure';
  object.add(figure);

  const put = (name: string, mesh: Mesh, x: number, y: number, z: number): Mesh => {
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };

  // torso, head, face and hair
  const torso = put('torso', new Mesh(shapes.torso, material(look.shirt)), 0, 1.18, 0);
  torso.scale.set(1.05, 1, 0.72);
  const head = put('head', new Mesh(shapes.head, material(look.skin, 0.6)), 0, 1.64, 0);
  figure.add(
    torso,
    head,
    put('eye', new Mesh(shapes.eye, material(0x111111, 0.4)), -0.06, 1.67, 0.15),
    put('eye', new Mesh(shapes.eye, material(0x111111, 0.4)), 0.06, 1.67, 0.15),
    put('nose', new Mesh(shapes.nose, material(look.skin, 0.6)), 0, 1.63, 0.17),
  );
  if (look.hat === 'toque') {
    figure.add(
      put('toque', new Mesh(shapes.toque, material(0xffffff, 0.9)), 0, 1.86, 0),
      put('toque-puff', new Mesh(shapes.toquePuff, material(0xffffff, 0.9)), 0, 2.02, 0),
    );
  } else {
    figure.add(put('hair', new Mesh(shapes.hair, material(look.hair, 0.9)), 0, 1.68, -0.01));
    if (look.hairStyle === 'bun')
      figure.add(put('bun', new Mesh(shapes.bun, material(look.hair, 0.9)), 0, 1.86, -0.06));
    if (look.hairStyle === 'ponytail')
      figure.add(put('ponytail', new Mesh(shapes.bun, material(look.hair, 0.9)), 0, 1.6, -0.2));
  }
  if (look.tie !== undefined)
    figure.add(put('tie', new Mesh(shapes.tie, material(look.tie)), 0, 1.22, 0.14));

  // arms and legs hang from pivots at the shoulders and the hips, so that they swing from there
  const limb = (name: string, x: number, y: number, build: () => Mesh[]): Group => {
    const pivot = new Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    pivot.add(...build());
    figure.add(pivot);
    return pivot;
  };
  const arm = (name: string, side: number) =>
    limb(name, side * 0.27, 1.42, () => [
      put('arm-shape', new Mesh(shapes.arm, material(look.shirt)), 0, -0.26, 0),
      put('hand', new Mesh(shapes.hand, material(look.skin, 0.6)), 0, -0.52, 0),
    ]);
  const leg = (name: string, side: number) =>
    limb(name, side * 0.1, 0.86, () => [
      put('leg-shape', new Mesh(shapes.leg, material(look.trousers)), 0, -0.4, 0),
      put('shoe', new Mesh(shapes.shoe, material(look.shoes, 0.6)), 0, -0.82, 0.05),
    ]);
  const left = { arm: arm('arm-left', -1), leg: leg('leg-left', -1) };
  const right = { arm: arm('arm-right', 1), leg: leg('leg-right', 1) };
  const cup = put('cup', new Mesh(shapes.cup, material(0xffffff, 0.3)), 0, -0.58, 0.05);
  cup.visible = false;
  right.arm.add(cup);

  let seated = false;
  const rest = (): void => {
    for (const pivot of [left.arm, right.arm, left.leg, right.leg]) pivot.rotation.set(0, 0, 0);
    left.arm.rotation.z = 0.08;
    right.arm.rotation.z = -0.08;
    figure.position.y = seated ? -0.4 : 0;
    figure.rotation.z = 0;
    if (seated) left.leg.rotation.x = right.leg.rotation.x = -1.45;
  };
  rest();

  return {
    object,
    play(status, seconds) {
      rest();
      if (status === 'walking') {
        const swing = Math.sin(seconds * 9);
        left.leg.rotation.x = swing * 0.7;
        right.leg.rotation.x = -swing * 0.7;
        left.arm.rotation.x = -swing * 0.55;
        right.arm.rotation.x = swing * 0.55;
        figure.position.y = Math.abs(Math.cos(seconds * 9)) * 0.06;
      } else if (status === 'working') {
        // the arms held out in front, moving: typing, stirring, writing
        left.arm.rotation.x = -1 + Math.sin(seconds * 7) * 0.12;
        right.arm.rotation.x = -1 + Math.sin(seconds * 7 + 2) * 0.12;
        figure.rotation.z = Math.sin(seconds * 3) * 0.02;
      } else {
        figure.position.y += Math.sin(seconds * 1.6) * 0.006; // breathing
      }
    },
    carry(on) {
      cup.visible = on;
    },
    sit(on) {
      seated = on;
      rest();
    },
  };
}
