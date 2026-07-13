import { NgZone } from '@angular/core';
import * as THREE from 'three';

import { ThreeGraphicsEngineAdapter } from './three-graphics-engine.adapter';

describe('ThreeGraphicsEngineAdapter hybrid switching', () => {
  const createAdapter = (): any => {
    const adapter = new ThreeGraphicsEngineAdapter(
      new NgZone({ enableLongStackTrace: false }),
      'browser'
    ) as any;
    adapter.homeIntroState = 'idle';
    adapter.hybridAutoEnabled = true;
    adapter.hybridMode = 'far2d';
    adapter.pointerInputActive = false;
    adapter.lastUserInputMs = Number.NEGATIVE_INFINITY;
    adapter.lastWheelInputMs = Number.NEGATIVE_INFINITY;
    adapter.lastHybridReentryAttemptMs = Number.NEGATIVE_INFINITY;
    return adapter;
  };

  const createCameraManagerStub = (overrides: Record<string, unknown> = {}): any => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, 0, 10);
    return {
      isCinematicMode: false,
      controls: { target: new THREE.Vector3(0, 0, 0) },
      isFocusTransitionActive: jasmine.createSpy('isFocusTransitionActive').and.returnValue(false),
      isAutoZoomActive: jasmine.createSpy('isAutoZoomActive').and.returnValue(false),
      getZoomDistanceToTarget: jasmine.createSpy('getZoomDistanceToTarget').and.returnValue(100),
      getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(100),
      getCamera: jasmine.createSpy('getCamera').and.returnValue(camera),
      activateTiltView: jasmine.createSpy('activateTiltView'),
      transitionToTopDownMapForHybrid: jasmine.createSpy('transitionToTopDownMapForHybrid'),
      ...overrides
    };
  };

  const createPlanetManagerStub = (): any => ({
    getPlanet: jasmine.createSpy('getPlanet').and.returnValue(new THREE.Object3D())
  });

  it('starts intro tilt at <=108 and passes cinematic intro overrides', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      isAutoZoomActive: jasmine.createSpy('isAutoZoomActive').and.returnValue(true),
      getZoomDistanceToTarget: jasmine.createSpy('getZoomDistanceToTarget').and.returnValue(108)
    });
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();
    adapter.homeIntroState = 'zoom2d';

    spyOn(THREE.Raycaster.prototype, 'intersectObject').and.returnValue([
      { point: new THREE.Vector3(2, 1, 3) } as THREE.Intersection<THREE.Object3D>
    ]);

    adapter.runHomeIntroStep();

    expect(cameraManager.activateTiltView).toHaveBeenCalled();
    const options = cameraManager.activateTiltView.calls.mostRecent().args[1];
    expect(options?.focusSmoothingOverride).toBe(0.052);
    expect(options?.controlsBlendInSpeedOverride).toBe(0.03);
    expect(adapter.homeIntroState).toBe('to3d');
  });

  it('ignores wheel input during 3D->2D return transition', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      isCinematicMode: false,
      isFocusTransitionActive: jasmine.createSpy('isFocusTransitionActive').and.returnValue(true)
    });
    adapter.cameraManager = cameraManager;
    adapter.homeIntroState = 'idle';
    adapter.lastWheelInputMs = 50;
    adapter.lastUserInputMs = 40;

    spyOn<any>(adapter, 'nowMs').and.returnValue(100);
    adapter.onWheelInput();

    expect(adapter.lastWheelInputMs).toBe(50);
    expect(adapter.lastUserInputMs).toBe(40);
  });

  it('enters 3D immediately during continuous wheel when radius is <= 89', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(89)
    });
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();
    adapter.hybridMode = 'far2d';
    adapter.lastUserInputMs = 990;
    adapter.lastWheelInputMs = 995;

    spyOn<any>(adapter, 'nowMs').and.returnValue(1000);
    const hitPoint = new THREE.Vector3(1, 2, 3);
    spyOn(THREE.Raycaster.prototype, 'intersectObject').and.returnValue([
      { point: hitPoint } as THREE.Intersection<THREE.Object3D>
    ]);

    adapter.runHybridZoomMode();

    expect(cameraManager.activateTiltView).toHaveBeenCalled();
    const activatedPoint = cameraManager.activateTiltView.calls.mostRecent().args[0] as THREE.Vector3;
    expect(activatedPoint.equals(hitPoint)).toBeTrue();
    expect(adapter.hybridMode).toBe('toNear3d');
  });

  it('exits from near3d to 2D when radius is >= 92', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      isCinematicMode: true,
      getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(92)
    });
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();
    adapter.hybridMode = 'near3d';
    adapter.lastUserInputMs = 0;

    spyOn<any>(adapter, 'nowMs').and.returnValue(500);
    adapter.runHybridZoomMode();

    expect(cameraManager.transitionToTopDownMapForHybrid).toHaveBeenCalled();
    expect(adapter.hybridMode).toBe('toFar2d');
  });

  it('blocks switching while pointer input is active', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(80)
    });
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();
    adapter.hybridMode = 'far2d';
    adapter.pointerInputActive = true;
    adapter.lastWheelInputMs = 995;

    spyOn<any>(adapter, 'nowMs').and.returnValue(1000);
    spyOn(THREE.Raycaster.prototype, 'intersectObject').and.returnValue([
      { point: new THREE.Vector3(1, 0, 0) } as THREE.Intersection<THREE.Object3D>
    ]);

    adapter.runHybridZoomMode();

    expect(cameraManager.activateTiltView).not.toHaveBeenCalled();
    expect(adapter.hybridMode).toBe('far2d');
  });

  it('uses fallback ray toward controls.target when screen-center ray misses', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();

    const fallbackPoint = new THREE.Vector3(4, 5, 6);
    const noHits: THREE.Intersection<THREE.Object3D>[] = [];
    const fallbackHits: THREE.Intersection<THREE.Object3D>[] = [
      { point: fallbackPoint } as THREE.Intersection<THREE.Object3D>
    ];

    let calls = 0;
    const intersectSpy = spyOn(THREE.Raycaster.prototype, 'intersectObject').and.callFake(
      (() => {
        calls += 1;
        return calls === 1 ? noHits : fallbackHits;
      }) as any
    );

    const activated = adapter.enterCinematicAtScreenCenter();

    expect(activated).toBeTrue();
    expect(intersectSpy.calls.count()).toBe(2);
    expect(cameraManager.activateTiltView).toHaveBeenCalled();
    const activatedPoint = cameraManager.activateTiltView.calls.mostRecent().args[0] as THREE.Vector3;
    expect(activatedPoint.equals(fallbackPoint)).toBeTrue();
  });

  it('does not enter 3D at hysteresis edge when far2d radius is 90', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(90)
    });
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();
    adapter.hybridMode = 'far2d';
    adapter.lastUserInputMs = 0;

    spyOn<any>(adapter, 'nowMs').and.returnValue(1000);
    const intersectSpy = spyOn(THREE.Raycaster.prototype, 'intersectObject').and.returnValue([
      { point: new THREE.Vector3(1, 1, 1) } as THREE.Intersection<THREE.Object3D>
    ]);

    adapter.runHybridZoomMode();

    expect(intersectSpy).not.toHaveBeenCalled();
    expect(cameraManager.activateTiltView).not.toHaveBeenCalled();
    expect(adapter.hybridMode).toBe('far2d');
  });

  it('does not exit 3D at hysteresis edge when near3d radius is 91', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      isCinematicMode: true,
      getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(91)
    });
    adapter.cameraManager = cameraManager;
    adapter.planetManager = createPlanetManagerStub();
    adapter.hybridMode = 'near3d';
    adapter.lastUserInputMs = 0;

    spyOn<any>(adapter, 'nowMs').and.returnValue(1000);
    adapter.runHybridZoomMode();

    expect(cameraManager.transitionToTopDownMapForHybrid).not.toHaveBeenCalled();
    expect(adapter.hybridMode).toBe('near3d');
  });

  it('keeps the current product modal open when locations refresh', () => {
    const adapter = createAdapter();
    adapter.pinManager = {
      setLocations: jasmine.createSpy('setLocations')
    };
    adapter.modalManager = {
      isVisible: jasmine.createSpy('isVisible').and.returnValue(true),
      hide: jasmine.createSpy('hide')
    };
    spyOn(adapter, 'closeModal').and.callThrough();

    adapter.setLocations([]);

    expect(adapter.pinManager.setLocations).toHaveBeenCalledOnceWith([]);
    expect(adapter.closeModal).not.toHaveBeenCalled();
    expect(adapter.modalManager.hide).not.toHaveBeenCalled();
  });
});
