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

export type AvatarRole = AgentId | 'boss';

export const AVATAR_COLORS: Record<AvatarRole, number> = {
  cashier: 0xd85a30,
  cook: 0x1d9e75,
  stock_admin: 0x7f77dd,
  waiter: 0xef9f27,
  boss: 0x2c2c2a,
};

const SKIN = 0xf3d5b5;
const NOSE = 0x444441;

export interface Avatar {
  /** Put it in the scene and move it: `position` for where, `rotation.y` for which way it faces. */
  object: Group;
  /** Shows the pose: walking bobs, working sways a little, idle stands still. `seconds` is real time. */
  play(status: PoseStatus, seconds: number): void;
}

export function createAvatar(role: AvatarRole): Avatar {
  const object = new Group();
  object.name = `avatar-${role}`;
  const figure = new Group();
  figure.name = 'figure';
  object.add(figure);

  const body = new Mesh(
    new CylinderGeometry(0.3, 0.34, 0.9, 16),
    new MeshLambertMaterial({ color: AVATAR_COLORS[role] }),
  );
  body.name = 'body';
  body.position.y = 0.55;
  const head = new Mesh(new SphereGeometry(0.27, 16, 12), new MeshLambertMaterial({ color: SKIN }));
  head.name = 'head';
  head.position.y = 1.25;
  const nose = new Mesh(new BoxGeometry(0.1, 0.1, 0.12), new MeshLambertMaterial({ color: NOSE }));
  nose.name = 'nose';
  nose.position.set(0, 1.27, 0.27);
  figure.add(body, head, nose);

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
  };
}
