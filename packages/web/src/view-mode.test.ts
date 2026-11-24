import { describe, expect, it } from 'vitest';
import { chooseView, hasWebGL } from './view-mode';

describe('chooseView', () => {
  it('shows the picture when the browser can, and nothing was asked', () => {
    expect(chooseView('', true)).toEqual({ mode: 'scene', reason: 'default' });
    expect(chooseView('?foo=1', true)).toEqual({ mode: 'scene', reason: 'default' });
  });

  it('shows only the panels when asked to, even where the picture would work', () => {
    expect(chooseView('?view=panel', true)).toEqual({ mode: 'panel', reason: 'asked' });
    expect(chooseView('?view=panel', false)).toEqual({ mode: 'panel', reason: 'asked' });
  });

  it('shows the panels, and says why, when the browser has no WebGL', () => {
    expect(chooseView('', false)).toEqual({ mode: 'panel', reason: 'no-webgl' });
    expect(chooseView('?view=3d', false)).toEqual({ mode: 'panel', reason: 'no-webgl' });
  });

  it('takes ?view=3d as a request for the picture', () => {
    expect(chooseView('?view=3d', true)).toEqual({ mode: 'scene', reason: 'asked' });
  });
});

describe('hasWebGL', () => {
  const canvas = (contexts: string[]) => () => ({
    getContext: (id: string) => (contexts.includes(id) ? {} : null),
  });

  it('is true when the canvas gives WebGL 2 or, failing that, WebGL 1', () => {
    expect(hasWebGL(canvas(['webgl2']))).toBe(true);
    expect(hasWebGL(canvas(['webgl']))).toBe(true);
  });

  it('is false when it gives neither, when there is no canvas, or when asking fails', () => {
    expect(hasWebGL(canvas([]))).toBe(false);
    expect(hasWebGL(() => null)).toBe(false);
    expect(
      hasWebGL(() => {
        throw new Error('blocked');
      }),
    ).toBe(false);
  });
});
