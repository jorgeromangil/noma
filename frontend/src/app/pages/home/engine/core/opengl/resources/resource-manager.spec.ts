import { TGestorRecursos, TRecursoMaterial } from './resource-manager';

describe('TGestorRecursos', () => {
  it('registra materiales en memoria y reutiliza el recurso cacheado', () => {
    const gestor = TGestorRecursos.getInstancia();
    const clave = `material-test:${Date.now()}:${Math.random()}`;

    const ptrA = gestor.registrarMaterialEnMemoria(clave, {
      nombre: 'arcilla',
      baseColorFactor: [0.8, 0.35, 0.18, 1],
      rugosidad: 0.72,
      metalicidad: 0.04,
      dobleCara: true,
    });
    const ptrB = gestor.registrarMaterialEnMemoria(clave, {
      nombre: 'no-debe-reemplazar-cache',
      baseColorFactor: [1, 1, 1, 1],
    });

    expect(ptrA.get()).toBe(ptrB.get());
    expect(ptrA.get().obtenerMaterial()).toEqual({
      nombre: 'arcilla',
      baseColorFactor: [0.8, 0.35, 0.18, 1],
      opacidad: 1,
      rugosidad: 0.72,
      metalicidad: 0.04,
      dobleCara: true,
    });

    ptrA.release();
    ptrB.release();
    gestor.purgarNoReferenciados();
  });

  it('carga materiales mediante loader asincrono una sola vez', async () => {
    const gestor = TGestorRecursos.getInstancia();
    const clave = `material-loader-test:${Date.now()}:${Math.random()}`;
    let llamadas = 0;

    const loader = async () => {
      llamadas += 1;
      return {
        nombre: 'metal-pulido',
        baseColorFactor: [0.6, 0.62, 0.65, 0.9] as [number, number, number, number],
        metalicidad: 0.85,
        rugosidad: 0.18,
      };
    };

    const [ptrA, ptrB] = await Promise.all([
      gestor.cargarMaterial(clave, loader),
      gestor.cargarMaterial(clave, loader),
    ]);

    expect(llamadas).toBe(1);
    expect(ptrA.get()).toBe(ptrB.get());
    expect(ptrA.get()).toEqual(jasmine.any(TRecursoMaterial));
    expect(ptrA.get().obtenerMaterial().opacidad).toBe(0.9);

    ptrA.release();
    ptrB.release();
    gestor.purgarNoReferenciados();
  });
});
