import { createColoredSphere } from '../geometry/geometry';
import { identityMat4 } from '../scene/scene-math';
import { TAnimacion, TFrameAnimacionRenderInfo } from './animation';

describe('TAnimacion', () => {
  it('advances frames with elapsed time and loops by default', () => {
    const animacion = new TAnimacion({
      nombre: 'animacion-test-tiempo',
      frames: [
        { id: 'inicio', duracionMs: 100 },
        { id: 'medio', duracionMs: 100 },
      ],
    });

    expect(animacion.getFrameActual().id).toBe('inicio');

    animacion.actualizar(0.11);
    expect(animacion.getFrameActual().id).toBe('medio');

    animacion.actualizar(0.1);
    expect(animacion.getFrameActual().id).toBe('inicio');
  });

  it('loads multiple mesh/material data through the resource manager', async () => {
    const renderInfo: { value?: TFrameAnimacionRenderInfo } = {};
    const uniqueKey = `animacion-test-malla:${Date.now()}:${Math.random()}`;
    const animacion = new TAnimacion({
      nombre: 'animacion-test-recursos',
      autoplay: false,
      materiales: [
        {
          id: 'material-rojo',
          baseColorFactor: [1, 0, 0, 1],
          rugosidad: 0.8,
        },
      ],
      mallas: [
        {
          id: 'malla-a',
          claveRecurso: `${uniqueKey}:a`,
          materialId: 'material-rojo',
          cargarGeometria: async () => createColoredSphere(1, 4, 4, [1, 0, 0]),
        },
        {
          id: 'malla-b',
          claveRecurso: `${uniqueKey}:b`,
          materialId: 'material-rojo',
          cargarGeometria: async () => createColoredSphere(0.5, 4, 4, [0, 1, 0]),
        },
      ],
      frames: [{ id: 'frame-a', meshIds: ['malla-a', 'malla-b'] }],
      onFrame: (info) => {
        renderInfo.value = info;
      },
    });

    await animacion.cargarRecursos();
    animacion.dibujar(identityMat4());

    expect(animacion.estaCargada()).toBeTrue();
    expect(renderInfo.value?.mallas.length).toBe(2);
    expect(renderInfo.value?.mallas[0].material?.id).toBe('material-rojo');

    animacion.destruir();
    expect(animacion.estaCargada()).toBeFalse();
  });
});
