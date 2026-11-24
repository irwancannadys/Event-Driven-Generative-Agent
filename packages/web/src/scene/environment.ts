import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFSoftShadowMap,
  PMREMGenerator,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The light of the cafe: warm, with soft shadows, like an evening in a nice coffee shop. The numbers are
// the result of looking at screenshots; lights are physically based since three r155.

export function lightTheScene(renderer: WebGLRenderer, scene: Scene): void {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  scene.background = new Color(0x15110e);

  scene.add(new HemisphereLight(0xfff0dc, 0x6f5640, 1.5));
  const sun = new DirectionalLight(0xffe2bf, 2.4);
  sun.position.set(9, 20, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // Reflections on the metal and the glass come from a small, plain room
  try {
    const generator = new PMREMGenerator(renderer);
    scene.environment = generator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    generator.dispose();
  } catch {
    // no reflections (the renderer is a stand-in in the tests): the picture is a little flatter, that is all
  }
}
