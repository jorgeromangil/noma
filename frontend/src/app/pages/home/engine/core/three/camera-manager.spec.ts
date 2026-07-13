import * as THREE from 'three';

import { CameraManager } from './camera-manager';

describe('CameraManager 3D->2D return behavior', () => {
  let manager: CameraManager;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    manager = new CameraManager(canvas);
  });

  afterEach(() => {
    manager.destroy();
  });

  it('disables zoom when 3D->2D return starts', () => {
    manager.isCinematicMode = true;

    manager.transitionToTopDownMapForHybrid();

    expect(manager.controls.enableZoom).toBeFalse();
  });

  it('re-enables zoom after return and north realign finish', () => {
    manager.isCinematicMode = true;
    manager.transitionToTopDownMapForHybrid();

    manager.releaseFocusOnlyTarget();
    expect((manager as any).isNorthRealigning).toBeTrue();
    expect(manager.controls.enableZoom).toBeFalse();

    (manager as any).updateNorthRealign(700);

    expect((manager as any).isNorthRealigning).toBeFalse();
    expect(manager.controls.enableZoom).toBeTrue();
  });

  it('uses projected heading on XZ plane for return end direction', () => {
    manager.getCamera().position.set(20, 15, 40);
    manager.controls.target.set(0, 0, 0);
    manager.isCinematicMode = true;

    manager.transitionToTopDownMapForHybrid();

    const expected = new THREE.Vector3(20, 0, 40).normalize();
    const endDir = (manager as any).focusEndDir as THREE.Vector3;
    expect(Math.abs(endDir.y)).toBeLessThan(1e-6);
    expect(endDir.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('completes north realign in ~700ms and ends at north direction', () => {
    manager.getCamera().position.set(30, 0, 0);
    manager.controls.target.set(0, 0, 0);
    (manager as any).startNorthRealign();

    (manager as any).updateNorthRealign(699);
    expect((manager as any).isNorthRealigning).toBeTrue();

    (manager as any).updateNorthRealign(1);
    expect((manager as any).isNorthRealigning).toBeFalse();

    const finalDir = manager.getCamera().position.clone().normalize();
    expect(finalDir.distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-6);
  });
});
