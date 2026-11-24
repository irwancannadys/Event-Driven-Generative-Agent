// Whether the page shows the 3D picture or only the panels (brief: a "no 3D" mode for debugging and demos).
// `?view=panel` asks for panels only, `?view=3d` for the picture. A browser without WebGL gets the panels,
// and the page says why.

export type ViewMode = 'scene' | 'panel';

export interface ViewChoice {
  mode: ViewMode;
  reason: 'default' | 'asked' | 'no-webgl';
}

export function chooseView(search: string, webgl: boolean): ViewChoice {
  const asked = new URLSearchParams(search).get('view');
  if (asked === 'panel') return { mode: 'panel', reason: 'asked' };
  if (!webgl) return { mode: 'panel', reason: 'no-webgl' };
  return { mode: 'scene', reason: asked === '3d' ? 'asked' : 'default' };
}

/** Whether a canvas made by `makeCanvas` can give a WebGL context. */
export function hasWebGL(makeCanvas: () => { getContext(id: string): unknown } | null): boolean {
  try {
    const canvas = makeCanvas();
    return Boolean(canvas?.getContext('webgl2') ?? canvas?.getContext('webgl'));
  } catch {
    return false;
  }
}
