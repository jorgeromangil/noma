import { NgZone } from '@angular/core';

import { OpenGLGraphicsEngineAdapter } from './opengl-graphics-engine.adapter';

describe('OpenGLGraphicsEngineAdapter hybrid return to 2D', () => {
  const createAdapter = (): any => {
    const adapter = new OpenGLGraphicsEngineAdapter(
      new NgZone({ enableLongStackTrace: false }),
      'browser'
    ) as any;
    adapter.homeIntroState = 'idle';
    adapter.hybridAutoEnabled = true;
    adapter.viewMode = '3d';
    spyOn(adapter, 'refreshPinOverlays');
    spyOn(adapter.pinManager, 'setViewMode');
    spyOn(adapter.layersManager, 'getThresholds').and.returnValue({
      comunidades: 1.72,
      provincias: 1.4,
    });
    return adapter;
  };

  const createCameraManagerStub = (overrides: Record<string, unknown> = {}): any => ({
    getViewMode: jasmine.createSpy('getViewMode').and.returnValue('3d'),
    isFocusZoomActive: jasmine.createSpy('isFocusZoomActive').and.returnValue(false),
    isIntro3DEntryActive: jasmine.createSpy('isIntro3DEntryActive').and.returnValue(false),
    isViewModeTransitionActive: jasmine.createSpy('isViewModeTransitionActive').and.returnValue(false),
    getIntroTargetRadius: jasmine.createSpy('getIntroTargetRadius').and.returnValue(1.6),
    getZoomDistanceMetric: jasmine.createSpy('getZoomDistanceMetric').and.returnValue(1.85),
    getCameraRadiusFromCenter: jasmine.createSpy('getCameraRadiusFromCenter').and.returnValue(1.85),
    startViewModeTransition: jasmine.createSpy('startViewModeTransition'),
    ...overrides,
  });

  const createRotationManagerStub = (): any => ({
    startTiltTransition: jasmine.createSpy('startTiltTransition'),
  });

  it('returns to 2D when zooming out past the hybrid threshold', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub();
    const rotationManager = createRotationManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.rotationManager = rotationManager;

    adapter.runHybridZoomMode();

    expect(cameraManager.startViewModeTransition).toHaveBeenCalledOnceWith('2d');
    expect(rotationManager.startTiltTransition).toHaveBeenCalledOnceWith(0, 0);
    expect(adapter.pinManager.setViewMode).toHaveBeenCalledOnceWith('2d');
    expect(adapter.pendingViewMode).toBe('2d');
    expect(adapter.viewMode).toBe('3d');
  });

  it('enters 3D when zooming in past the hybrid threshold', () => {
    const adapter = createAdapter();
    adapter.viewMode = '2d';
    const cameraManager = createCameraManagerStub({
      getViewMode: jasmine.createSpy('getViewMode').and.returnValue('2d'),
      getZoomDistanceMetric: jasmine.createSpy('getZoomDistanceMetric').and.returnValue(1.72),
    });
    const rotationManager = createRotationManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.rotationManager = rotationManager;

    adapter.runHybridZoomMode();

    expect(cameraManager.startViewModeTransition).toHaveBeenCalledOnceWith('3d');
    expect(rotationManager.startTiltTransition).toHaveBeenCalledOnceWith(-0.3490659, 0);
    expect(adapter.pinManager.setViewMode).toHaveBeenCalledOnceWith('3d');
    expect(adapter.pendingViewMode).toBe('3d');
    expect(adapter.viewMode).toBe('2d');
  });

  it('does not return to 2D before crossing the zoom threshold', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      getZoomDistanceMetric: jasmine.createSpy('getZoomDistanceMetric').and.returnValue(1.8),
    });
    const rotationManager = createRotationManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.rotationManager = rotationManager;

    adapter.runHybridZoomMode();

    expect(cameraManager.startViewModeTransition).not.toHaveBeenCalled();
    expect(rotationManager.startTiltTransition).not.toHaveBeenCalled();
    expect(adapter.pinManager.setViewMode).not.toHaveBeenCalled();
    expect(adapter.viewMode).toBe('3d');
  });

  it('does not enter 3D before crossing the hybrid hysteresis edge', () => {
    const adapter = createAdapter();
    adapter.viewMode = '2d';
    const cameraManager = createCameraManagerStub({
      getViewMode: jasmine.createSpy('getViewMode').and.returnValue('2d'),
      getZoomDistanceMetric: jasmine.createSpy('getZoomDistanceMetric').and.returnValue(1.73),
    });
    const rotationManager = createRotationManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.rotationManager = rotationManager;

    adapter.runHybridZoomMode();

    expect(cameraManager.startViewModeTransition).not.toHaveBeenCalled();
    expect(rotationManager.startTiltTransition).not.toHaveBeenCalled();
    expect(adapter.pinManager.setViewMode).not.toHaveBeenCalled();
    expect(adapter.viewMode).toBe('2d');
  });

  it('uses the animated camera transition when switching manually to 2D', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub();
    const rotationManager = createRotationManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.rotationManager = rotationManager;

    adapter.setViewMode('2d');

    expect(cameraManager.startViewModeTransition).toHaveBeenCalledOnceWith('2d');
    expect(rotationManager.startTiltTransition).toHaveBeenCalledOnceWith(0, 0);
    expect(adapter.pinManager.setViewMode).toHaveBeenCalledOnceWith('2d');
    expect(adapter.pendingViewMode).toBe('2d');
    expect(adapter.viewMode).toBe('3d');
  });

  it('syncs the effective mode only after the transition settles', () => {
    const adapter = createAdapter();
    const cameraManager = createCameraManagerStub({
      getViewMode: jasmine.createSpy('getViewMode').and.returnValue('2d'),
    });
    const rotationManager = createRotationManagerStub();
    adapter.cameraManager = cameraManager;
    adapter.rotationManager = rotationManager;
    adapter.pendingViewMode = '2d';

    adapter.syncViewModeState();

    expect(adapter.pendingViewMode).toBeNull();
    expect(adapter.viewMode).toBe('2d');
  });
});

describe('OpenGLGraphicsEngineAdapter pin selection', () => {
  const createInteractiveAdapter = (): any => {
    const adapter = new OpenGLGraphicsEngineAdapter(
      new NgZone({ enableLongStackTrace: false }),
      'browser'
    ) as any;
    adapter.homeIntroState = 'idle';
    adapter.controlsManager = {
      shouldIgnoreClick: jasmine.createSpy('shouldIgnoreClick').and.returnValue(false),
    };
    adapter.camera = {
      getPosition: jasmine.createSpy('getPosition').and.returnValue([0, 0, 2]),
      getViewMatrix: jasmine.createSpy('getViewMatrix').and.returnValue(new Float32Array(16)),
      getProjectionMatrix: jasmine.createSpy('getProjectionMatrix').and.returnValue(new Float32Array(16)),
    };
    adapter.cameraManager = {
      zoomToPin: jasmine.createSpy('zoomToPin'),
    };
    adapter.modalManager = {
      show: jasmine.createSpy('show'),
    };
    spyOn(adapter.layersManager, 'getOverlayOpacity').and.returnValue(1);
    return adapter;
  };

  it('ignores an immediate duplicate click on the pin that just opened the modal', () => {
    const adapter = createInteractiveAdapter();
    const selectedPin = {
      product: { uid: 'product-1', title: 'Producto' },
      getWorldPosition: jasmine.createSpy('selectedGetWorldPosition').and.returnValue({ x: 1, y: 2, z: 3 }),
    };
    const activePin = {
      getWorldPosition: jasmine.createSpy('activeGetWorldPosition').and.returnValue({ x: 1, y: 2, z: 3 }),
    };
    spyOn(adapter.pinManager, 'activatePinAtPointer').and.returnValue(selectedPin);
    spyOn(adapter.pinManager, 'getActivePin').and.returnValue(activePin);
    spyOn(adapter, 'closeModal').and.callThrough();
    spyOn(adapter, 'nowMs').and.returnValue(1000);

    adapter.onClick();
    adapter.onClick();

    expect(adapter.modalManager.show).toHaveBeenCalledTimes(1);
    expect(adapter.closeModal).not.toHaveBeenCalled();
  });

  it('does not close an individual product modal when the active pin is clicked again later', () => {
    const adapter = createInteractiveAdapter();
    const selectedPin = {
      product: { uid: 'product-1', title: 'Producto' },
      getWorldPosition: jasmine.createSpy('selectedGetWorldPosition').and.returnValue({ x: 1, y: 2, z: 3 }),
    };
    const activePin = {
      getWorldPosition: jasmine.createSpy('activeGetWorldPosition').and.returnValue({ x: 1, y: 2, z: 3 }),
    };
    spyOn(adapter.pinManager, 'activatePinAtPointer').and.returnValue(selectedPin);
    spyOn(adapter.pinManager, 'getActivePin').and.returnValue(activePin);
    spyOn(adapter, 'closeModal').and.callThrough();
    spyOn(adapter, 'nowMs').and.returnValues(1000, 2000);

    adapter.onClick();
    adapter.onClick();

    expect(adapter.modalManager.show).toHaveBeenCalledTimes(1);
    expect(adapter.closeModal).not.toHaveBeenCalled();
  });

  it('keeps the current product modal open when locations refresh', () => {
    const adapter = createInteractiveAdapter();
    adapter.modalManager = {
      isVisible: jasmine.createSpy('isVisible').and.returnValue(true),
      hide: jasmine.createSpy('hide'),
    };
    spyOn(adapter.pinManager, 'setLocations');
    spyOn(adapter, 'refreshPinOverlays');
    spyOn(adapter, 'closeModal').and.callThrough();

    adapter.setLocations([]);

    expect(adapter.pinManager.setLocations).toHaveBeenCalledOnceWith([]);
    expect(adapter.refreshPinOverlays).toHaveBeenCalled();
    expect(adapter.closeModal).not.toHaveBeenCalled();
    expect(adapter.modalManager.hide).not.toHaveBeenCalled();
  });
});
