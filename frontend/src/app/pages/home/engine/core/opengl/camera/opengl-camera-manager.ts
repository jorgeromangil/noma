import { Camera } from './camera';
import { clamp, distanceVec3, dotVec3, normalizeVec3, Vec3 } from '../math/opengl-math';

export interface OpenGLCameraFit {
  cameraDistance: number;
  minRadius: number;
  maxRadius: number;
  introTargetRadius: number;
}

interface OpenGLViewPose {
  mode: '2d' | '3d';
  radius: number;
  orbitDirection: Vec3;
  lookAtOffset: Vec3;
  cameraOffset: Vec3;
  minRadius: number;
  maxRadius: number;
}

export class OpenGLCameraManager {
  private static readonly TILT_RAD = 0.3490659; // ~20°
  private static readonly RADIUS_SCALE = 1.0;
  // Desplazamiento del punto de mira en Y (positivo = más norte). Ajuste más suave.
  private static readonly TARGET_OFFSET_FACTOR = -0.012;  // mantenemos el ligero desplazamiento del target
  private static readonly CAMERA_Y_OFFSET_FACTOR = -0.085; // bajamos más la cámara sin tocar el ángulo

  private cameraRadius = 6;
  private planetRadius = 1;
  private orbitTheta = 0; // azimut en radianes (alrededor del eje Y)
  private orbitPhi = Math.PI * 0.5; // ángulo polar en radianes (0 = norte)
  private readonly minPolarAngle = 0.1; // clamp estricto para evitar singularidades
  private readonly maxPolarAngle = 3.1; // clamp estricto para evitar singularidades
  private readonly orbitRotateSpeed = 0.0032; // rad/pixel para arrastre de ratón
  private zoomSpeed = 0.0005;  // Reduced for smoother zoom animation
  private minRadius = 2.0;
  private maxRadius = 500.0;
  private readonly userZoomFloorRatio = 0.93; // piso inspirado en 2D para no atravesar el modelo
  private userZoomFloorRadius = 0;
  private readonly wheelPanMaxStepRatio = 0.03; // limite anti-salto por tick de rueda

  private introCamActive = true;
  private introCamTargetRadius = 4;
  private readonly introCamSpeed = 0.02;
  private readonly introCamStopEpsilon = 1e-3;

  private focusZoomActive = false;
  private focusTargetPoint: Vec3 = [0, 0, 0];
  private focusCameraPosition: Vec3 = [0, 0, 6];
  private lookAtTarget: Vec3 = [0, 0, 0];
  private lookAtOffset: Vec3 = [0, 0, 0];
  private viewOffset: Vec3 = [0, 0, 0];
  private cameraOffset: Vec3 = [0, 0, 0];
  private baseMinRadius = this.minRadius;
  private baseMaxRadius = this.maxRadius;
  
  // Defocus animation (zoom out on deselect)
  private defocusZoomActive = false;
  private preFocusCameraPosition: Vec3 = [0, 0, 6];
  private preFocusLookAtTarget: Vec3 = [0, 0, 0];
  private hasFocusAnchor = false; // captura la pose previa al primer foco activo
  private defocusTargetPosition: Vec3 = [0, 0, 6];
  private defocusTargetLookAt: Vec3 = [0, 0, 0];
  private readonly defocusPositionSmoothing = 0.08;  // Slower than focus for smooth out
  private readonly defocusTargetSmoothing = 0.08;
  private readonly defocusZoomStopEpsilon = 5e-4;
  private readonly defocusUnlockRadiusRatio = 0.01;
  
  private readonly focusPositionSmoothing = 0.12;
  private readonly focusTargetSmoothing = 0.14;
  private readonly focusZoomStopEpsilon = 5e-4;
  private readonly focusTailStartFactor = 0.055;
  private readonly focusTailStartMin = 0.03;
  private readonly focusTailStartMax = 0.22;
  private readonly focusTailMinSmoothing = 0.05;
  private readonly focusPinOffsetFactor = 0.012;
  private readonly focusPinOffsetMin = 0.045;
  private readonly focusPinOffsetMax = 0.4;
  private readonly focusSurfaceGuardOffsetFactor = 0.0012;
  private readonly focusSurfaceGuardOffsetMin = 0.004;
  private readonly focusSurfaceGuardOffsetMax = 0.02;
  // En 3D desplazamos levemente el target hacia el sur para que el pin
  // quede más centrado verticalmente (evita que se vea demasiado abajo).
  private readonly focusTargetYOffsetFactor3D = 0.01;
  private readonly focusTargetYOffsetMin3D = 0.008;
  private readonly focusTargetYOffsetMax3D = 0.06;
  private readonly introTiltTargetRadiusRatio = 1.0875;
  private readonly introTiltMinSurfaceDistanceRatio = 0.0875;
  private readonly introTiltHeightRatio = 0.125;
  private readonly introTiltSouthRatio = 0.075;
  private introFocusSmoothingOverride: number | null = null;

  private viewMode: '2d' | '3d' = '2d';
  private stored2dRadius: number | null = null;
  private stored2dOrbit: Vec3 | null = null;
  private readonly topDownDirection: Vec3 = [0, 0, 1];
  private intro3DEntryActive = false;
  private intro3DEntryProgress = 0;
  private intro3DEntryDurationSec = 1.0;
  private intro3DEntryFromDirection: Vec3 = [0, 0, 1];
  private viewTransitionActive = false;
  private viewTransitionProgress = 0;
  private viewTransitionDurationSec = 0.9;
  private viewTransitionFromPose: OpenGLViewPose | null = null;
  private viewTransitionToPose: OpenGLViewPose | null = null;
  private manualFocusZoomLocked = false;

  constructor(private readonly camera: Camera, private readonly target: Vec3 = [0, 0, 0]) {}

  initializePerspective(width: number, height: number): void {
    const aspect = width > 0 && height > 0 ? width / height : 1;
    this.camera.setPerspective(60, aspect, 0.02, 500);
    this.cameraRadius = 6;
    this.setOrbitFromDirection(this.topDownDirection);
    this.lookAtTarget = [...this.target];
    this.focusTargetPoint = [...this.target];
    this.viewOffset = [0, 0, 0];
    this.intro3DEntryActive = false;
    this.intro3DEntryProgress = 0;
    this.intro3DEntryFromDirection = [...this.topDownDirection];
    this.viewTransitionActive = false;
    this.viewTransitionProgress = 0;
    this.viewTransitionFromPose = null;
    this.viewTransitionToPose = null;
    this.updateCameraPose();
  }

  onResize(width: number, height: number): void {
    const aspect = width > 0 && height > 0 ? width / height : 1;
    this.camera.setPerspective(60, aspect, 0.02, 500);
  }

  configureFromPlanetRadius(scaledRadius: number): OpenGLCameraFit {
    this.planetRadius = Math.max(scaledRadius, 1e-3);
    const camDist = Math.max(scaledRadius * 1.8, scaledRadius + 2.0);
    this.cameraRadius = camDist;

    this.minRadius = Math.max(0.59 * scaledRadius, 0.25);
    this.maxRadius = camDist * 3;
    this.baseMinRadius = this.minRadius;
    this.baseMaxRadius = this.maxRadius;
    this.introCamTargetRadius = clamp(0.65 * scaledRadius, this.minRadius, this.maxRadius);
    this.userZoomFloorRadius = this.introCamTargetRadius * this.userZoomFloorRatio;

    this.introCamActive = true;
    this.intro3DEntryActive = false;
    this.intro3DEntryProgress = 0;
    this.intro3DEntryFromDirection = [...this.topDownDirection];
    this.viewTransitionActive = false;
    this.viewTransitionProgress = 0;
    this.viewTransitionFromPose = null;
    this.viewTransitionToPose = null;
    this.viewMode = '2d';
    this.setOrbitFromDirection(this.topDownDirection);
    this.lookAtOffset = [0, 0, 0];
    this.cameraOffset = [0, 0, 0];
    this.viewOffset = [0, 0, 0];
    this.stored2dRadius = this.cameraRadius;
    this.stored2dOrbit = [...this.getOrbitDirection()];
    this.updateCameraPose();

    return {
      cameraDistance: camDist,
      minRadius: this.minRadius,
      maxRadius: this.maxRadius,
      introTargetRadius: this.introCamTargetRadius,
    };
  }

  onWheel(deltaY: number, pointerNdc?: { x: number; y: number }): void {
    if (this.manualFocusZoomLocked) return;

    this.focusZoomActive = false;
    if (this.defocusZoomActive) this.finishDefocusZoom();
    this.introCamActive = false;
    this.cancelIntro3DEntry();
    this.cancelViewModeTransition();
    this.introFocusSmoothingOverride = null;

    // Zoom dolly manteniendo la dirección orbital actual.
    const currentDir = this.getOrbitDirection();
    const currentRadius = this.getRadiusToTargetIgnoringOffsets();
    const smoothedDelta = clamp(deltaY, -48, 48);
    const scale = Math.max(0.1, 1 + smoothedDelta * this.zoomSpeed);
    const newRadius = clamp(currentRadius * scale, this.getEffectiveMinRadius(), this.maxRadius);

    let panDelta: Vec3 | null = null;
    if (pointerNdc) {
      panDelta = this.computePanDeltaFromPointer(pointerNdc, currentDir, newRadius);
    }

    if (panDelta) {
      const maxPanStep = Math.max(this.planetRadius * this.wheelPanMaxStepRatio, 1e-4);
      panDelta = clampVec3Length(panDelta, maxPanStep);
      this.viewOffset = this.applyClampedOffset(
        this.viewOffset[0] + panDelta[0],
        this.viewOffset[1] + panDelta[1],
        this.viewOffset[2] + panDelta[2]
      );
    }

    this.cameraRadius = newRadius;
    this.updateCameraPose();
  }

  /**
   * Control tipo OrbitControls: ajusta theta/phi en base a un arrastre del ratón
   * (delta en píxeles de pantalla) y recalcula la posición de cámara.
   */
  orbitFromMouseDelta(deltaX: number, deltaY: number, options?: { rotateSpeed?: number }): void {
    this.focusZoomActive = false;
    if (this.defocusZoomActive) this.finishDefocusZoom();
    this.introCamActive = false;
    this.cancelIntro3DEntry();
    this.cancelViewModeTransition();
    this.introFocusSmoothingOverride = null;

    const speed = options?.rotateSpeed ?? this.orbitRotateSpeed;
    const radius = this.getRadiusToTargetIgnoringOffsets();
    const nextTheta = this.orbitTheta - deltaX * speed;
    const nextPhi = this.clampPhi(this.orbitPhi - deltaY * speed);

    this.setOrbitSpherical(radius, nextTheta, nextPhi);
  }

  /** Posiciona la cámara con coordenadas esféricas (Three.js style). */
  setOrbitSpherical(radius: number, theta: number, phi: number): void {
    this.cameraRadius = clamp(radius, this.getEffectiveMinRadius(), this.maxRadius);
    this.orbitTheta = theta;
    this.orbitPhi = this.clampPhi(phi);
    this.updateCameraPose();
  }

  private computePanDeltaFromPointer(
    pointerNdc: { x: number; y: number },
    orbitDir: Vec3,
    newRadius: number
  ): Vec3 | null {
    const cameraPos = this.camera.getPosition();
    // Usar el lookAt real evita saltos cuando venimos de foco/desfoco de pin.
    const targetWorld: Vec3 = [...this.lookAtTarget];

    const viewDir = normalizeVec3([
      targetWorld[0] - cameraPos[0],
      targetWorld[1] - cameraPos[1],
      targetWorld[2] - cameraPos[2],
    ]);

    const viewMat = this.camera.getViewMatrix();
    const projMat = this.camera.getProjectionMatrix();
    const preRay = buildPointerRay(pointerNdc, viewMat, projMat, cameraPos);
    if (!preRay) return null;

    const preT = intersectRayPlane(preRay.origin, preRay.direction, targetWorld, viewDir);
    if (preT == null) return null;
    const prePoint: Vec3 = [
      preRay.origin[0] + preRay.direction[0] * preT,
      preRay.origin[1] + preRay.direction[1] * preT,
      preRay.origin[2] + preRay.direction[2] * preT,
    ];

    const tentativePos: Vec3 = [
      targetWorld[0] + orbitDir[0] * newRadius,
      targetWorld[1] + orbitDir[1] * newRadius + this.cameraOffset[1],
      targetWorld[2] + orbitDir[2] * newRadius,
    ];
    const tentativeView = lookAtMatrix(tentativePos, targetWorld);
    const postRay = buildPointerRay(pointerNdc, tentativeView, projMat, tentativePos);
    if (!postRay) return null;

    const postT = intersectRayPlane(postRay.origin, postRay.direction, targetWorld, viewDir);
    if (postT == null) return null;
    const postPoint: Vec3 = [
      postRay.origin[0] + postRay.direction[0] * postT,
      postRay.origin[1] + postRay.direction[1] * postT,
      postRay.origin[2] + postRay.direction[2] * postT,
    ];

    return [
      prePoint[0] - postPoint[0],
      prePoint[1] - postPoint[1],
      prePoint[2] - postPoint[2],
    ];
  }

  private applyClampedOffset(x: number, y: number, z: number): Vec3 {
    const maxLen = this.planetRadius * 0.8;
    const len = Math.hypot(x, y, z);
    if (len > maxLen && len > 1e-6) {
      const k = maxLen / len;
      return [x * k, y * k, z * k];
    }
    return [x, y, z];
  }

  cancelIntroCamera(): void {
    this.introCamActive = false;
  }

  zoomToPin(pinPos: Vec3 | { x: number; y: number; z: number }): void {
    this.introCamActive = false;
    this.cancelIntro3DEntry();
    this.cancelViewModeTransition();
    this.introFocusSmoothingOverride = null;
    this.defocusZoomActive = false; // Cancel any ongoing defocus animation
    
    // Guardar la pose previa SOLO la primera vez que entramos en foco
    // para que encadenar varios pines no reescriba el ancla de desfoco.
    if (!this.hasFocusAnchor) {
      this.preFocusCameraPosition = [...this.camera.getPosition()];
      this.preFocusLookAtTarget = [...this.lookAtTarget];
      this.hasFocusAnchor = true;
    }
    
    const pin = toVec3(pinPos);
    if (!pin) return;

    const currentFocusDir = this.getCurrentFocusDirection();
    const dirToPin = normalizeVec3([
      pin[0] - this.target[0],
      pin[1] - this.target[1],
      pin[2] - this.target[2],
    ]);
    const focusDir = this.viewMode === '3d' ? currentFocusDir : dirToPin;
    const offset = clamp(
      this.planetRadius * this.focusPinOffsetFactor,
      this.focusPinOffsetMin,
      this.focusPinOffsetMax
    );
    const focusTargetYOffset =
      this.viewMode === '3d'
        ? -clamp(
            this.planetRadius * this.focusTargetYOffsetFactor3D,
            this.focusTargetYOffsetMin3D,
            this.focusTargetYOffsetMax3D
          )
        : 0;

    this.focusTargetPoint = [pin[0], pin[1] + focusTargetYOffset, pin[2]];
    const desiredFocusCameraPosition: Vec3 = [
      this.focusTargetPoint[0] + focusDir[0] * offset,
      this.focusTargetPoint[1] + focusDir[1] * offset,
      this.focusTargetPoint[2] + focusDir[2] * offset,
    ];
    this.focusCameraPosition = this.clampFocusPositionOutsidePlanet(desiredFocusCameraPosition, [
      this.focusTargetPoint[0] - this.target[0],
      this.focusTargetPoint[1] - this.target[1],
      this.focusTargetPoint[2] - this.target[2],
    ]);
    this.focusZoomActive = true;
  }

  startDefocusZoom(): void {
    if (!this.hasFocusAnchor) {
      this.releaseManualFocusZoomLock();
      return; // sin ancla válida, no hay a dónde volver
    }

    this.focusZoomActive = false;
    this.defocusZoomActive = true;
    
    // Return to pre-focus position exactly
    const extendFactor = 1.00;
    const dirFromTargetToPrePos = normalizeVec3([
      this.preFocusCameraPosition[0] - this.preFocusLookAtTarget[0],
      this.preFocusCameraPosition[1] - this.preFocusLookAtTarget[1],
      this.preFocusCameraPosition[2] - this.preFocusLookAtTarget[2],
    ]);
    const distanceToPrePos = distanceVec3(this.preFocusCameraPosition, this.preFocusLookAtTarget);
    const extendedDistance = distanceToPrePos * extendFactor;
    
    this.defocusTargetPosition = [
      this.preFocusLookAtTarget[0] + dirFromTargetToPrePos[0] * extendedDistance,
      this.preFocusLookAtTarget[1] + dirFromTargetToPrePos[1] * extendedDistance,
      this.preFocusLookAtTarget[2] + dirFromTargetToPrePos[2] * extendedDistance,
    ];
    this.defocusTargetLookAt = [...this.preFocusLookAtTarget];
  }

  runFocusZoom(): void {
    if (!this.focusZoomActive) return;

    const currentPos = this.camera.getPosition();
    const tailStart = clamp(
      this.planetRadius * this.focusTailStartFactor,
      this.focusTailStartMin,
      this.focusTailStartMax
    );
    const remainingPosBefore = distanceVec3(currentPos, this.focusCameraPosition);
    const remainingTargetBefore = distanceVec3(this.lookAtTarget, this.focusTargetPoint);
    // Avanzar cámara y target con el mismo factor evita oscilaciones
    // aparentes en mitad del trayecto (wobble por desalineación temporal).
    const remainingForSmoothing = Math.max(remainingPosBefore, remainingTargetBefore);
    const baseSmoothing =
      this.viewMode === '3d'
        ? this.introFocusSmoothingOverride ?? this.focusPositionSmoothing
        : this.focusTargetSmoothing;
    const smoothing = this.computeTailSmoothing(remainingForSmoothing, tailStart, baseSmoothing);

    const nextPosRaw = lerpVec3(currentPos, this.focusCameraPosition, smoothing);
    const nextTarget = lerpVec3(this.lookAtTarget, this.focusTargetPoint, smoothing);
    const preferredSurfaceVector: Vec3 = [
      nextTarget[0] - this.target[0],
      nextTarget[1] - this.target[1],
      nextTarget[2] - this.target[2],
    ];
    const currentRadiusToCenter = this.getDistanceToCenter(currentPos);
    const guardRadius = this.getFocusSurfaceGuardRadius(preferredSurfaceVector);
    const nextPos =
      currentRadiusToCenter >= guardRadius - 1e-4
        ? this.clampFocusPositionOutsidePlanet(nextPosRaw, preferredSurfaceVector)
        : nextPosRaw;

    this.camera.setPosition(nextPos);
    this.lookAtTarget = nextTarget;
    this.camera.lookAt(this.lookAtTarget);
    const radiusToTarget = this.getRadiusToTargetIgnoringOffsets(nextPos);
    this.cameraRadius = clamp(
      radiusToTarget,
      this.getEffectiveMinRadius(),
      this.maxRadius
    );
    this.setOrbitFromDirection(this.computeOrbitDirectionFromCamera());

    const remainingPos = distanceVec3(nextPos, this.focusCameraPosition);
    const remainingTarget = distanceVec3(nextTarget, this.focusTargetPoint);
    if (remainingPos < this.focusZoomStopEpsilon && remainingTarget < this.focusZoomStopEpsilon) {
      this.focusZoomActive = false;
      this.introFocusSmoothingOverride = null;
      const radiusAfterStop = this.getRadiusToTargetIgnoringOffsets(nextPos);
      this.cameraRadius = clamp(
        radiusAfterStop,
        this.getEffectiveMinRadius(),
        this.maxRadius
      );
      this.setOrbitFromDirection(this.computeOrbitDirectionFromCamera());
    }
  }

  runDefocusZoom(): void {
    if (!this.defocusZoomActive) return;

    const currentPos = this.camera.getPosition();
    const remainingPos = distanceVec3(currentPos, this.defocusTargetPosition);
    const remainingTarget = distanceVec3(this.lookAtTarget, this.defocusTargetLookAt);
    const remainingForSmoothing = Math.max(remainingPos, remainingTarget);

    // Even slower animation for smooth zoom-out (very slow smooth departure)
    const smoothing = 0.04;

    const nextPos = lerpVec3(currentPos, this.defocusTargetPosition, smoothing);
    const nextTarget = lerpVec3(this.lookAtTarget, this.defocusTargetLookAt, smoothing);

    this.camera.setPosition(nextPos);
    this.lookAtTarget = nextTarget;
    this.camera.lookAt(this.lookAtTarget);

    const radiusToTarget = this.getRadiusToTargetIgnoringOffsets(nextPos);
    this.cameraRadius = clamp(
      radiusToTarget,
      this.getEffectiveMinRadius(),
      this.maxRadius
    );
    this.setOrbitFromDirection(this.computeOrbitDirectionFromCamera());

    const unlockEpsilon = Math.max(
      this.defocusZoomStopEpsilon,
      this.planetRadius * this.defocusUnlockRadiusRatio
    );
    const remainingPosAfter = distanceVec3(nextPos, this.defocusTargetPosition);
    const remainingTargetAfter = distanceVec3(nextTarget, this.defocusTargetLookAt);
    if (remainingPosAfter < unlockEpsilon && remainingTargetAfter < unlockEpsilon) {
      this.releaseManualFocusZoomLock();
    }

    if (remainingPos < this.defocusZoomStopEpsilon && remainingTarget < this.defocusZoomStopEpsilon) {
      this.finishDefocusZoom();
    }
  }

  cancelFocus(): void {
    this.focusZoomActive = false;
    this.cancelIntro3DEntry();
    this.introFocusSmoothingOverride = null;
  }

  releaseFocus(): void {
    this.focusZoomActive = false;
    this.cancelIntro3DEntry();
    this.cancelViewModeTransition();
    this.introFocusSmoothingOverride = null;
    this.hasFocusAnchor = false;
    // No recolocar la cámara al cerrar foco: mantenemos la pose actual.
    this.lookAtTarget = [...this.camera.getTarget()];
    const radiusToTarget = this.getRadiusToTargetIgnoringOffsets();
    this.cameraRadius = clamp(
      radiusToTarget,
      this.getEffectiveMinRadius(),
      this.maxRadius
    );
    this.setOrbitFromDirection(this.computeOrbitDirectionFromCamera());
    this.releaseManualFocusZoomLock();
  }

  private finishDefocusZoom(): void {
    this.defocusZoomActive = false;
    this.camera.setPosition([...this.defocusTargetPosition]);
    this.lookAtTarget = [...this.defocusTargetLookAt];
    this.camera.lookAt(this.lookAtTarget);
    this.hasFocusAnchor = false; // liberar ancla para el siguiente foco
    const radiusAfterStop = this.getRadiusToTargetIgnoringOffsets(this.defocusTargetPosition);
    this.cameraRadius = clamp(
      radiusAfterStop,
      this.getEffectiveMinRadius(),
      this.maxRadius
    );
    this.setOrbitFromDirection(this.computeOrbitDirectionFromCamera());
    this.releaseManualFocusZoomLock();
  }

  activateTiltView(
    targetPointSurface: Vec3,
    options?: {
      focusSmoothingOverride?: number;
    }
  ): void {
    this.cancelIntro3DEntry();
    this.cancelViewModeTransition();
    this.introCamActive = false;
    this.focusZoomActive = false;
    this.introFocusSmoothingOverride = options?.focusSmoothingOverride ?? null;

    const currentRadius = this.getRadiusToTargetIgnoringOffsets();
    this.stored2dRadius = clamp(currentRadius, this.baseMinRadius, this.baseMaxRadius);
    this.stored2dOrbit = [...this.computeOrbitDirectionFromCamera()];

    this.viewMode = '3d';
    this.minRadius = this.baseMinRadius * 0.8;
    this.maxRadius = this.baseMaxRadius * 1.2;
    this.lookAtOffset = [0, 0, 0];
    this.cameraOffset = [0, 0, 0];

    const normal = normalizeVec3([
      targetPointSurface[0] - this.target[0],
      targetPointSurface[1] - this.target[1],
      targetPointSurface[2] - this.target[2],
    ]);
    const planetNorth: Vec3 = [0, 1, 0];
    let east: Vec3 = normalizeVec3(crossVec3(planetNorth, normal));
    if (!isFiniteVec3(east) || vec3LengthSq(east) < 1e-6) east = [1, 0, 0];
    let northTangent: Vec3 = normalizeVec3(crossVec3(normal, east));
    if (!isFiniteVec3(northTangent) || vec3LengthSq(northTangent) < 1e-6) northTangent = [0, 1, 0];

    const surfaceRadius = Math.max(distanceVec3(targetPointSurface, this.target), this.planetRadius);
    const minSurfaceDistance = Math.max(
      this.planetRadius * this.introTiltMinSurfaceDistanceRatio,
      1e-3
    );
    const targetRadius = Math.max(
      this.planetRadius * this.introTiltTargetRadiusRatio,
      surfaceRadius + minSurfaceDistance
    );
    const heightAboveGround = this.planetRadius * this.introTiltHeightRatio;
    const distanceSouth = this.planetRadius * this.introTiltSouthRatio;

    const desiredPos: Vec3 = [
      targetPointSurface[0] + normal[0] * heightAboveGround - northTangent[0] * distanceSouth,
      targetPointSurface[1] + normal[1] * heightAboveGround - northTangent[1] * distanceSouth,
      targetPointSurface[2] + normal[2] * heightAboveGround - northTangent[2] * distanceSouth,
    ];
    const desiredDir = normalizeVec3([
      desiredPos[0] - this.target[0],
      desiredPos[1] - this.target[1],
      desiredPos[2] - this.target[2],
    ]);

    this.focusTargetPoint = [...targetPointSurface];
    this.focusCameraPosition = this.clampFocusPositionOutsidePlanet([
      this.target[0] + desiredDir[0] * targetRadius,
      this.target[1] + desiredDir[1] * targetRadius,
      this.target[2] + desiredDir[2] * targetRadius,
    ], [
      targetPointSurface[0] - this.target[0],
      targetPointSurface[1] - this.target[1],
      targetPointSurface[2] - this.target[2],
    ]);
    this.focusZoomActive = true;
  }

  runIntroCamera(): void {
    if (!this.introCamActive || this.focusZoomActive) return;

    const delta = this.introCamTargetRadius - this.cameraRadius;
    if (Math.abs(delta) < this.introCamStopEpsilon) {
      this.cameraRadius = this.introCamTargetRadius;
      this.introCamActive = false;
    } else {
      this.cameraRadius += delta * this.introCamSpeed;
    }

    this.cameraRadius = clamp(this.cameraRadius, this.minRadius, this.maxRadius);
    this.updateCameraPose();
  }

  startIntro3DEntry(options?: { durationMs?: number }): void {
    if (this.intro3DEntryActive || this.viewMode === '3d') return;

    this.stored2dRadius = clamp(this.cameraRadius, this.baseMinRadius, this.baseMaxRadius);
    this.stored2dOrbit = [...this.computeOrbitDirectionFromCamera()];
    this.intro3DEntryFromDirection = [...this.computeOrbitDirectionFromCamera()];
    this.intro3DEntryDurationSec = Math.max((options?.durationMs ?? 1000) / 1000, 1 / 120);
    this.intro3DEntryProgress = 0;
    this.intro3DEntryActive = true;
    this.minRadius = this.baseMinRadius * 0.8;
    this.maxRadius = this.baseMaxRadius * 1.2;
  }

  runIntro3DEntry(dt: number): void {
    if (!this.intro3DEntryActive) return;

    const step =
      dt > 0 ? dt / this.intro3DEntryDurationSec : 1 / 60 / this.intro3DEntryDurationSec;
    this.intro3DEntryProgress = clamp(this.intro3DEntryProgress + step, 0, 1);
    const eased = smootherStep(this.intro3DEntryProgress);
    const tilt = OpenGLCameraManager.TILT_RAD;
    const targetDirection = normalizeVec3([0, Math.sin(tilt), Math.cos(tilt)]);
    this.setOrbitFromDirection(
      normalizeVec3(lerpVec3(this.intro3DEntryFromDirection, targetDirection, eased))
    );

    const targetLookAtOffsetY = Math.sin(tilt) * this.cameraRadius * OpenGLCameraManager.TARGET_OFFSET_FACTOR;
    const targetCameraOffsetY = this.cameraRadius * OpenGLCameraManager.CAMERA_Y_OFFSET_FACTOR;
    this.lookAtOffset = [0, lerpNumber(0, targetLookAtOffsetY, eased), 0];
    this.cameraOffset = [0, lerpNumber(0, targetCameraOffsetY, eased), 0];
    this.updateCameraPose({ recomputeOffsets: false });

    if (this.intro3DEntryProgress >= 1) {
      this.finishIntro3DEntry();
    }
  }

  getDistanceToTarget(): number {
    return distanceVec3(this.camera.getPosition(), this.target);
  }

  getZoomDistanceMetric(): number {
    return this.getRadiusToTargetIgnoringOffsets();
  }

  getCameraRadiusFromCenter(): number {
    return this.getDistanceToCenter(this.camera.getPosition());
  }

  getViewMode(): '2d' | '3d' {
    return this.viewMode;
  }

  getIntroTargetRadius(): number {
    return this.introCamTargetRadius;
  }

  getIntroRemainingDistance(): number {
    return Math.abs(this.introCamTargetRadius - this.cameraRadius);
  }

  setViewMode(mode: '2d' | '3d'): void {
    this.cancelIntro3DEntry();
    this.cancelViewModeTransition();
    if (mode === this.viewMode) return;

    if (mode === '3d') {
      this.stored2dRadius = this.cameraRadius;
      this.stored2dOrbit = [...this.getOrbitDirection()];
      const tilt = OpenGLCameraManager.TILT_RAD;
      // Cambiamos el sentido: miramos desde el norte hacia el sur.
      this.setOrbitFromDirection([0, Math.sin(tilt), Math.cos(tilt)]);
      // Ajustamos límites de zoom en 3D para acercar más el modelo sin atravesarlo.
      this.minRadius = this.baseMinRadius * 0.8;
      this.maxRadius = this.baseMaxRadius * 1.2;
      this.cameraRadius = clamp(
        this.cameraRadius * OpenGLCameraManager.RADIUS_SCALE,
        this.minRadius,
        this.maxRadius
      );
      const offsetY = Math.sin(tilt) * this.cameraRadius * OpenGLCameraManager.TARGET_OFFSET_FACTOR;
      this.lookAtOffset = [0, offsetY, 0];
      const camOffsetY = this.cameraRadius * OpenGLCameraManager.CAMERA_Y_OFFSET_FACTOR;
      this.cameraOffset = [0, camOffsetY, 0];
      this.viewMode = '3d';
      this.updateCameraPose();
      return;
    }

    // mode === '2d'
    if (this.stored2dRadius !== null) {
      this.cameraRadius = clamp(this.stored2dRadius, this.minRadius, this.maxRadius);
    }
    if (this.stored2dOrbit) {
      this.setOrbitFromDirection(this.stored2dOrbit);
    } else {
      this.setOrbitFromDirection(this.topDownDirection);
    }
    // Restauramos límites originales de zoom para 2D.
    this.minRadius = this.baseMinRadius;
    this.maxRadius = this.baseMaxRadius;
    this.lookAtOffset = [0, 0, 0];
    this.cameraOffset = [0, 0, 0];
    this.viewMode = '2d';
    this.updateCameraPose();
  }

  startViewModeTransition(mode: '2d' | '3d', options?: { durationMs?: number }): void {
    this.cancelIntro3DEntry();
    const currentMode = this.viewTransitionToPose?.mode ?? this.viewMode;
    if (mode === currentMode && this.viewTransitionActive) return;
    if (mode === this.viewMode && !this.viewTransitionActive) return;

    this.focusZoomActive = false;
    this.introCamActive = false;

    const currentPose = this.captureCurrentViewPose();
    const currentRadius = this.getRadiusToTargetIgnoringOffsets();
    if (mode === '3d') {
      this.stored2dRadius = clamp(currentRadius, this.baseMinRadius, this.baseMaxRadius);
      this.stored2dOrbit = [...this.computeOrbitDirectionFromCamera()];
    }

    const targetPose = this.buildViewPose(mode, currentRadius);
    this.minRadius = targetPose.minRadius;
    this.maxRadius = targetPose.maxRadius;
    this.viewTransitionFromPose = currentPose;
    this.viewTransitionToPose = targetPose;
    this.viewTransitionDurationSec = Math.max((options?.durationMs ?? 900) / 1000, 1 / 120);
    this.viewTransitionProgress = 0;
    this.viewTransitionActive = true;
  }

  runViewModeTransition(dt: number): void {
    if (!this.viewTransitionActive || !this.viewTransitionFromPose || !this.viewTransitionToPose) {
      return;
    }

    const step =
      dt > 0 ? dt / this.viewTransitionDurationSec : 1 / 60 / this.viewTransitionDurationSec;
    this.viewTransitionProgress = clamp(this.viewTransitionProgress + step, 0, 1);
    const eased = smootherStep(this.viewTransitionProgress);

    this.cameraRadius = lerpNumber(
      this.viewTransitionFromPose.radius,
      this.viewTransitionToPose.radius,
      eased
    );
    this.setOrbitFromDirection(
      normalizeVec3(
        lerpVec3(this.viewTransitionFromPose.orbitDirection, this.viewTransitionToPose.orbitDirection, eased)
      )
    );
    this.lookAtOffset = lerpVec3(
      this.viewTransitionFromPose.lookAtOffset,
      this.viewTransitionToPose.lookAtOffset,
      eased
    );
    this.cameraOffset = lerpVec3(
      this.viewTransitionFromPose.cameraOffset,
      this.viewTransitionToPose.cameraOffset,
      eased
    );
    this.updateCameraPose({ recomputeOffsets: false });

    if (this.viewTransitionProgress >= 1) {
      this.finishViewModeTransition();
    }
  }

  isIntroCameraActive(): boolean {
    return this.introCamActive;
  }

  isIntro3DEntryActive(): boolean {
    return this.intro3DEntryActive;
  }

  isViewModeTransitionActive(): boolean {
    return this.viewTransitionActive;
  }

  isFocusZoomActive(): boolean {
    return this.focusZoomActive;
  }

  setManualFocusZoomLocked(locked: boolean): void {
    this.manualFocusZoomLocked = locked;
  }

  private releaseManualFocusZoomLock(): void {
    this.manualFocusZoomLocked = false;
  }

  getCenterScreenSurfacePoint(): Vec3 | null {
    const origin = this.camera.getPosition();
    const cameraTarget = this.camera.getTarget();
    const dir = normalizeVec3([
      cameraTarget[0] - origin[0],
      cameraTarget[1] - origin[1],
      cameraTarget[2] - origin[2],
    ]);
    const ox = origin[0] - this.target[0];
    const oy = origin[1] - this.target[1];
    const oz = origin[2] - this.target[2];
    const halfB = ox * dir[0] + oy * dir[1] + oz * dir[2];
    const c = ox * ox + oy * oy + oz * oz - this.planetRadius * this.planetRadius;
    const disc = halfB * halfB - c;
    if (disc < 0) return null;

    const sqrtDisc = Math.sqrt(disc);
    const nearT = -halfB - sqrtDisc;
    const farT = -halfB + sqrtDisc;
    const t = nearT > 1e-6 ? nearT : farT > 1e-6 ? farT : null;
    if (t == null) return null;

    return [
      origin[0] + dir[0] * t,
      origin[1] + dir[1] * t,
      origin[2] + dir[2] * t,
    ];
  }

  private updateCameraPose(options?: { recomputeOffsets?: boolean }): void {
    if (options?.recomputeOffsets !== false) this.recomputeOffsets();
    const orbitDirection = this.getOrbitDirection();
    const targetX = this.target[0] + this.lookAtOffset[0] + this.viewOffset[0];
    const targetY = this.target[1] + this.lookAtOffset[1] + this.viewOffset[1];
    const targetZ = this.target[2] + this.lookAtOffset[2] + this.viewOffset[2];
    this.camera.setPosition([
      targetX + orbitDirection[0] * this.cameraRadius,
      targetY + orbitDirection[1] * this.cameraRadius + this.cameraOffset[1],
      targetZ + orbitDirection[2] * this.cameraRadius,
    ]);
    this.lookAtTarget = [targetX, targetY, targetZ];
    this.camera.lookAt(this.lookAtTarget);
  }

  private cancelViewModeTransition(): void {
    this.viewTransitionActive = false;
    this.viewTransitionProgress = 0;
    this.viewTransitionFromPose = null;
    this.viewTransitionToPose = null;
  }

  private cancelIntro3DEntry(): void {
    this.intro3DEntryActive = false;
    this.intro3DEntryProgress = 0;
  }

  private finishIntro3DEntry(): void {
    this.intro3DEntryActive = false;
    this.intro3DEntryProgress = 0;
    this.viewMode = '3d';
    this.setOrbitFromDirection([0, Math.sin(OpenGLCameraManager.TILT_RAD), Math.cos(OpenGLCameraManager.TILT_RAD)]);
    this.recomputeOffsets();
    this.updateCameraPose({ recomputeOffsets: false });
  }

  private finishViewModeTransition(): void {
    if (!this.viewTransitionToPose) {
      this.cancelViewModeTransition();
      return;
    }

    this.applyViewPose(this.viewTransitionToPose);
    this.cancelViewModeTransition();
    this.updateCameraPose();
  }

  private captureCurrentViewPose(): OpenGLViewPose {
    return {
      mode: this.viewMode,
      radius: this.getRadiusToTargetIgnoringOffsets(),
      orbitDirection: [...this.computeOrbitDirectionFromCamera()],
      lookAtOffset: [...this.lookAtOffset],
      cameraOffset: [...this.cameraOffset],
      minRadius: this.minRadius,
      maxRadius: this.maxRadius,
    };
  }

  private buildViewPose(mode: '2d' | '3d', currentRadius: number): OpenGLViewPose {
    if (mode === '3d') {
      const tilt = OpenGLCameraManager.TILT_RAD;
      const minRadius = this.baseMinRadius * 0.8;
      const maxRadius = this.baseMaxRadius * 1.2;
      const radius = clamp(currentRadius * OpenGLCameraManager.RADIUS_SCALE, minRadius, maxRadius);
      const offsetY = Math.sin(tilt) * radius * OpenGLCameraManager.TARGET_OFFSET_FACTOR;
      const camOffsetY = radius * OpenGLCameraManager.CAMERA_Y_OFFSET_FACTOR;
      return {
        mode,
        radius,
        orbitDirection: normalizeVec3([0, Math.sin(tilt), Math.cos(tilt)]),
        lookAtOffset: [0, offsetY, 0],
        cameraOffset: [0, camOffsetY, 0],
        minRadius,
        maxRadius,
      };
    }

    return {
      mode,
      radius: clamp(
        // Al volver de 3D mantenemos, como mínimo, el radio actual para que
        // la transición levante la cámara sin hacer un pequeño zoom-in previo.
        Math.max(this.stored2dRadius ?? currentRadius, currentRadius),
        this.baseMinRadius,
        this.baseMaxRadius
      ),
      orbitDirection: normalizeVec3(this.stored2dOrbit ?? this.topDownDirection),
      lookAtOffset: [0, 0, 0],
      cameraOffset: [0, 0, 0],
      minRadius: this.baseMinRadius,
      maxRadius: this.baseMaxRadius,
    };
  }

  private applyViewPose(pose: OpenGLViewPose): void {
    this.viewMode = pose.mode;
    this.cameraRadius = pose.radius;
    this.setOrbitFromDirection(pose.orbitDirection);
    this.lookAtOffset = [...pose.lookAtOffset];
    this.cameraOffset = [...pose.cameraOffset];
    this.minRadius = pose.minRadius;
    this.maxRadius = pose.maxRadius;
  }

  /** Recalcula offsets dependientes del radio para que el zoom conserve la perspectiva */
  private recomputeOffsets(): void {
    if (this.viewMode !== '3d') {
      this.lookAtOffset = [0, 0, 0];
      this.cameraOffset = [0, 0, 0];
      return;
    }
    const tilt = OpenGLCameraManager.TILT_RAD;
    const offsetY = Math.sin(tilt) * this.cameraRadius * OpenGLCameraManager.TARGET_OFFSET_FACTOR;
    this.lookAtOffset = [0, offsetY, 0];
    const camOffsetY = this.cameraRadius * OpenGLCameraManager.CAMERA_Y_OFFSET_FACTOR;
    this.cameraOffset = [0, camOffsetY, 0];
  }

  private getEffectiveMinRadius(): number {
    // Evita que el usuario cruce el modelo, replicando el límite seguro usado en 2D
    return Math.max(this.minRadius, this.userZoomFloorRadius);
  }

  private getRadiusToTargetIgnoringOffsets(pos: Vec3 = this.camera.getPosition()): number {
    // Usa la posición sin el offset de cámara para medir el radio real (coincide con 2D)
    const targetX = this.target[0] + this.lookAtOffset[0] + this.viewOffset[0];
    const targetY = this.target[1] + this.lookAtOffset[1] + this.viewOffset[1];
    const targetZ = this.target[2] + this.lookAtOffset[2] + this.viewOffset[2];
    const px = pos[0] - this.cameraOffset[0] - targetX;
    const py = pos[1] - this.cameraOffset[1] - targetY;
    const pz = pos[2] - this.cameraOffset[2] - targetZ;
    return Math.hypot(px, py, pz);
  }

  private computeOrbitDirectionFromCamera(): Vec3 {
    const pos = this.camera.getPosition();
    // Medimos respecto al target real y restamos el offset de cámara para no sesgar la dirección (consistente con 2D)
    const targetX = this.target[0] + this.lookAtOffset[0] + this.viewOffset[0];
    const targetY = this.target[1] + this.lookAtOffset[1] + this.viewOffset[1];
    const targetZ = this.target[2] + this.lookAtOffset[2] + this.viewOffset[2];
    const dir = normalizeVec3([
      pos[0] - this.cameraOffset[0] - targetX,
      pos[1] - this.cameraOffset[1] - targetY,
      pos[2] - this.cameraOffset[2] - targetZ,
    ]);
    const finite = Number.isFinite(dir[0]) && Number.isFinite(dir[1]) && Number.isFinite(dir[2]);
    if (!finite) return this.getOrbitDirection();
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < 1e-6) return this.getOrbitDirection();
    return dir;
  }

  private clampPhi(phi: number): number {
    return clamp(phi, this.minPolarAngle, this.maxPolarAngle);
  }

  private getOrbitDirection(): Vec3 {
    return this.directionFromSpherical(this.orbitTheta, this.orbitPhi);
  }

  private directionFromSpherical(theta: number, phi: number): Vec3 {
    const sinPhi = Math.sin(phi);
    const x = sinPhi * Math.sin(theta);
    const y = Math.cos(phi);
    const z = sinPhi * Math.cos(theta);
    return normalizeVec3([x, y, z]);
  }

  private setOrbitFromDirection(dir: Vec3): void {
    const clampedY = clamp(dir[1], -1, 1);
    this.orbitPhi = this.clampPhi(Math.acos(clampedY));
    this.orbitTheta = Math.atan2(dir[0], dir[2]);
  }

  private getCurrentFocusDirection(): Vec3 {
    const pos = this.camera.getPosition();
    const delta: Vec3 = [
      pos[0] - this.lookAtTarget[0],
      pos[1] - this.lookAtTarget[1],
      pos[2] - this.lookAtTarget[2],
    ];
    const len = Math.hypot(delta[0], delta[1], delta[2]);
    if (len < 1e-6) return this.computeOrbitDirectionFromCamera();
    return normalizeVec3(delta);
  }

  private computeTailSmoothing(remaining: number, tailStart: number, baseSmoothing: number): number {
    if (tailStart <= 1e-6) return baseSmoothing;
    const ratio = clamp(remaining / tailStart, 0, 1);
    const smooth = ratio * ratio * (3 - 2 * ratio); // smoothstep
    return this.focusTailMinSmoothing + (baseSmoothing - this.focusTailMinSmoothing) * smooth;
  }

  private getDistanceToCenter(pos: Vec3): number {
    return Math.hypot(
      pos[0] - this.target[0],
      pos[1] - this.target[1],
      pos[2] - this.target[2]
    );
  }

  private getFocusSurfaceGuardRadius(surfaceVector?: Vec3): number {
    const fallbackRadius = Math.max(this.planetRadius, 1e-3);
    const surfaceRadius = surfaceVector
      ? Math.hypot(surfaceVector[0], surfaceVector[1], surfaceVector[2])
      : fallbackRadius;
    const radius =
      Number.isFinite(surfaceRadius) && surfaceRadius > 1e-3
        ? surfaceRadius
        : fallbackRadius;
    const guardOffset = clamp(
      radius * this.focusSurfaceGuardOffsetFactor,
      this.focusSurfaceGuardOffsetMin,
      this.focusSurfaceGuardOffsetMax
    );
    return radius + guardOffset;
  }

  private clampFocusPositionOutsidePlanet(pos: Vec3, preferredSurfaceVector?: Vec3): Vec3 {
    const cx = this.target[0];
    const cy = this.target[1];
    const cz = this.target[2];
    const vx = pos[0] - cx;
    const vy = pos[1] - cy;
    const vz = pos[2] - cz;
    const len = Math.hypot(vx, vy, vz);
    const minLen = this.getFocusSurfaceGuardRadius(preferredSurfaceVector);
    if (len >= minLen) return pos;

    const fallback =
      preferredSurfaceVector ?? (len > 1e-6 ? ([vx, vy, vz] as Vec3) : this.getOrbitDirection());
    const out = normalizeVec3([
      Number.isFinite(fallback[0]) ? fallback[0] : 0,
      Number.isFinite(fallback[1]) ? fallback[1] : 0,
      Number.isFinite(fallback[2]) ? fallback[2] : 1,
    ]);
    return [cx + out[0] * minLen, cy + out[1] * minLen, cz + out[2] * minLen];
  }
}

function buildPointerRay(
  pointer: { x: number; y: number },
  view: Float32Array,
  projection: Float32Array,
  cameraPosition: Vec3
): { origin: Vec3; direction: Vec3 } | null {
  const viewProjection = multiplyMat4(projection, view);
  const invViewProjection = invertMat4(viewProjection);
  if (!invViewProjection) return null;

  const farClip = transformVec4(invViewProjection, [pointer.x, pointer.y, 1, 1]);
  if (Math.abs(farClip[3]) < 1e-6) return null;

  const farPoint: Vec3 = [
    farClip[0] / farClip[3],
    farClip[1] / farClip[3],
    farClip[2] / farClip[3],
  ];
  const dir = normalizeVec3([
    farPoint[0] - cameraPosition[0],
    farPoint[1] - cameraPosition[1],
    farPoint[2] - cameraPosition[2],
  ]);

  return { origin: [...cameraPosition] as Vec3, direction: dir };
}

function intersectRayPlane(
  origin: Vec3,
  dir: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3
): number | null {
  const denom = dotVec3(dir, planeNormal);
  if (Math.abs(denom) < 1e-6) return null;
  const px = planePoint[0] - origin[0];
  const py = planePoint[1] - origin[1];
  const pz = planePoint[2] - origin[2];
  const t = (px * planeNormal[0] + py * planeNormal[1] + pz * planeNormal[2]) / denom;
  return t >= -1e-6 ? t : null;
}

function lookAtMatrix(eye: Vec3, center: Vec3): Float32Array {
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;
  let up: Vec3 = [0, 1, 0];

  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  const zlen = Math.hypot(zx, zy, zz) || 1;
  zx /= zlen; zy /= zlen; zz /= zlen;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  let xlen = Math.hypot(xx, xy, xz);
  if (xlen < 1e-6) {
    up = [0, 0, 1];
    xx = up[1] * zz - up[2] * zy;
    xy = up[2] * zx - up[0] * zz;
    xz = up[0] * zy - up[1] * zx;
    xlen = Math.hypot(xx, xy, xz);
  }
  if (xlen < 1e-6) {
    xx = 1; xy = 0; xz = 0;
    xlen = 1;
  }
  xx /= xlen; xy /= xlen; xz /= xlen;

  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;
  const ylen = Math.hypot(yx, yy, yz) || 1;
  yx /= ylen; yy /= ylen; yz /= ylen;

  const out = new Float32Array(16);
  out[0] = xx; out[4] = yx; out[8]  = zx; out[12] = -(xx * ex + yx * ey + zx * ez);
  out[1] = xy; out[5] = yy; out[9]  = zy; out[13] = -(xy * ex + yy * ey + zy * ez);
  out[2] = xz; out[6] = yz; out[10] = zz; out[14] = -(xz * ex + yz * ey + zz * ez);
  out[3] = 0;  out[7] = 0;  out[11] = 0; out[15] = 1;
  return out;
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function transformVec4(
  mat: Float32Array,
  v: [number, number, number, number]
): [number, number, number, number] {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const w = v[3];
  return [
    mat[0] * x + mat[4] * y + mat[8] * z + mat[12] * w,
    mat[1] * x + mat[5] * y + mat[9] * z + mat[13] * w,
    mat[2] * x + mat[6] * y + mat[10] * z + mat[14] * w,
    mat[3] * x + mat[7] * y + mat[11] * z + mat[15] * w,
  ];
}

function invertMat4(m: Float32Array): Float32Array | null {
  const out = new Float32Array(16);

  const a00 = m[0];
  const a01 = m[1];
  const a02 = m[2];
  const a03 = m[3];
  const a10 = m[4];
  const a11 = m[5];
  const a12 = m[6];
  const a13 = m[7];
  const a20 = m[8];
  const a21 = m[9];
  const a22 = m[10];
  const a23 = m[11];
  const a30 = m[12];
  const a31 = m[13];
  const a32 = m[14];
  const a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 -
    b01 * b10 +
    b02 * b09 +
    b03 * b08 -
    b04 * b07 +
    b05 * b06;
  if (Math.abs(det) < 1e-10) return null;
  det = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

  return out;
}

function toVec3(value: Vec3 | { x: number; y: number; z: number }): Vec3 | null {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
    return null;
  }

  const x = Number((value as any)?.x);
  const y = Number((value as any)?.y);
  const z = Number((value as any)?.z);
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return [x, y, z];
  return null;
}

function lerpVec3(from: Vec3, to: Vec3, t: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function clampVec3Length(v: Vec3, maxLen: number): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= maxLen || len < 1e-8) return v;
  const k = maxLen / len;
  return [v[0] * k, v[1] * k, v[2] * k];
}

function lerpNumber(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function smootherStep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function crossVec3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function vec3LengthSq(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}
