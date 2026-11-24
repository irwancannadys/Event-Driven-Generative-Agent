import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import type { AgentId } from '@cafe/core';
import type { PoseStatus } from './pose';

// A character from primitives: a cylinder for the body, a sphere for the head and a small box on the
// front as the nose, so that you can see which way it looks. Other code only calls `createAvatar` and
// `play` (decision 016), so these shapes can be swapped for a model later without touching anything else.

export type StaffRole = AgentId | 'boss';
export type AvatarRole = StaffRole | 'customer';

export const AVATAR_COLORS: Record<StaffRole, number> = {
  cashier: 0xd85a30,
  cook: 0x1d9e75,
  stock_admin: 0x7f77dd,
  waiter: 0xef9f27,
  boss: 0x2c2c2a,
};

/** The shirts of the customers: the one of a customer is picked from its order number. */
export const CUSTOMER_COLORS = [
  0x378add, 0xd4537e, 0x639922, 0x8a6bbd, 0x2a9d8f, 0xe76f51, 0x6c757d, 0xb08968,
];

const SKIN = 0xf3d5b5;
const NOSE = 0x444441;
const CUP = 0xffffff;

// Shared by all the characters: a customer comes and goes, and must not leave shapes behind.
const shapes = {
  body: new CylinderGeometry(0.3, 0.34, 0.9, 16),
  head: new SphereGeometry(0.27, 16, 12),
  nose: new BoxGeometry(0.1, 0.1, 0.12),
  cup: new CylinderGeometry(0.07, 0.055, 0.14, 12),
};
const materials = new Map<number, MeshLambertMaterial>();
function material(color: number): MeshLambertMaterial {
  let found = materials.get(color);
  if (!found) {
    found = new MeshLambertMaterial({ color });
    materials.set(color, found);
  }
  return found;
}

export interface Avatar {
  /** Put it in the scene and move it: `position` for where, `rotation.y` for which way it faces. */
  object: Group;
  /** Shows the pose: walking bobs, working sways a little, idle stands still. `seconds` is real time. */
  play(status: PoseStatus, seconds: number): void;
  /** Puts a cup in its hand, or takes it away. */
  carry(on: boolean): void;
}

/** `variant` picks the shirt of a customer (any whole number). Staff have their own colour. */
export function createAvatar(role: AvatarRole, variant = 0): Avatar {
  const object = new Group();
  object.name = `avatar-${role}`;
  const figure = new Group();
  figure.name = 'figure';
  object.add(figure);

  const shirt =
    role === 'customer'
      ? (CUSTOMER_COLORS[Math.abs(variant) % CUSTOMER_COLORS.length] as number)
      : AVATAR_COLORS[role];
  const body = new Mesh(shapes.body, material(shirt));
  body.name = 'body';
  body.position.y = 0.55;
  const head = new Mesh(shapes.head, material(SKIN));
  head.name = 'head';
  head.position.y = 1.25;
  const nose = new Mesh(shapes.nose, material(NOSE));
  nose.name = 'nose';
  nose.position.set(0, 1.27, 0.27);
  const cup = new Mesh(shapes.cup, material(CUP));
  cup.name = 'cup';
  cup.position.set(0.3, 0.8, 0.22);
  cup.visible = false;
  figure.add(body, head, nose, cup);

  return {
    object,
    play(status, seconds) {
      if (status === 'walking') {
        figure.position.y = Math.abs(Math.sin(seconds * 10)) * 0.1;
        figure.rotation.z = 0;
      } else if (status === 'working') {
        figure.position.y = 0;
        figure.rotation.z = Math.sin(seconds * 6) * 0.05;
      } else {
        figure.position.y = 0;
        figure.rotation.z = 0;
      }
    },
    carry(on) {
      cup.visible = on;
    },
  };
}
