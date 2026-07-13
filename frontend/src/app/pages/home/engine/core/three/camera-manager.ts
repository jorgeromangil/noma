import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class CameraManager {
  public camera: THREE.PerspectiveCamera;
  public controls: OrbitControls;

  // ── Auto-zoom (intro) ──
  private autoZoom: boolean = true;
  private readonly targetCameraZ: number = 84;
  private readonly easing: number = 0.014;
  private readonly autoZoomTailStartZ: number = 140;
  private readonly autoZoomTailSpeed: number = 0.72;
  private readonly autoZoomTailBlendWindow: number = 18;
  private readonly autoZoomStopEpsilon: number = 0.05;

  // ── OrbitControls tunables ──
  private readonly originalRotateSpeed: number = 0.03;
  private readonly originalMinDistance: number = 80.3;
  private readonly originalMaxDistance: number = 260;
  private readonly originalZoomSpeed: number = 0.45;
  private readonly cinematicZoomSpeed: number = 0.65;
  private readonly minOrbitRotateSpeed: number = 0.012;
  private readonly orbitDampingFactor: number = 0.1;
  private readonly cinematicDampingFactor: number = 0.12;
  private readonly controlTuningLerp: number = 0.12;

  // ── Cinematic (3D) defaults ──
  private readonly cinematicDefaultTargetRadius: number = 87.0;
  private readonly cinematicDefaultMinSurfaceDistance: number = 7.0;
  private readonly cinematicHeightAboveGround: number = 10.0;
  private readonly cinematicDistanceSouth: number = 6.0;
  private readonly cinematicMinDistance: number = 1.5;
  private readonly cinematicMaxDistance: number = 60.0;
  private readonly cinematicMinCameraRadiusOffset: number = 1.5;
  private readonly cinematicMinPolarAngle: number = Math.PI * 0.15;
  private readonly cinematicMaxPolarAngle: number = Math.PI * 0.85;

  // ── Cinematic locked tilt ──
  private cinematicLockedPhi: number = 0;
  private cinematicLockedTheta: number = 0;
  private cinematicTiltLocked: boolean = false;

  // ── Focus / transition state ──
  private isFocusing: boolean = false;
  private focusTarget: THREE.Vector3 = new THREE.Vector3();
  private focusPosition: THREE.Vector3 = new THREE.Vector3();
  private readonly focusSmoothing: number = 0.095;
  private readonly returnFocusSmoothing: number = 0.038;
  private introFocusSmoothingOverride: number | null = null;
  private introControlsBlendInSpeedOverride: number | null = null;

  public isCinematicMode: boolean = false;
  private readonly planetRadius: number = 80.0;
  private targetRadius: number = this.cinematicDefaultTargetRadius;

  private preserveTargetOnRelease: boolean = false;

  // ── Return-to-orbit (3D → 2D) ──
  private isReturningToOrbit: boolean = false;
  private focusBlend: number = 0;
  private readonly returnBlendSpeed: number = 0.016;
  private focusStartDir: THREE.Vector3 = new THREE.Vector3();
  private focusEndDir: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  private focusReturnDistance: number = this.targetCameraZ;
  private focusStartTarget: THREE.Vector3 = new THREE.Vector3();
  private focusEndTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  // ── Cross-fade de controles durante transiciones ──
  private controlsBlend: number = 0; // 0 = cinematic profile, 1 = 2D profile
  private isBlendingControls: boolean = false;
  private readonly controlsBlendInSpeed: number = 0.075;
  private readonly controlsBlendOutSpeed: number = 0.016;

  // ── North realign after 3D → 2D ──
  private isNorthRealigning: boolean = false;
  private northRealignProgress: number = 0;
  private northRealignFromDir: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  private northRealignToDir: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  private northRealignTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private northRealignDistance: number = this.targetCameraZ;
  private readonly northRealignDurationMs: number = 700;

  private lastUpdateTimeMs: number | null = null;

  private savedState: {
    position: THREE.Vector3;
    target: THREE.Vector3;
    up: THREE.Vector3;
  } | null = null;

  private resizeHandler: () => void;

  constructor(rendererDomElement: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.z = 260;
    this.camera.up.set(0, 1, 0);

    this.controls = new OrbitControls(this.camera, rendererDomElement);
    this.controls.dampingFactor = this.orbitDampingFactor;
    this.controls.enableDamping = true;
    this.controls.zoomSpeed = this.originalZoomSpeed;
    this.controls.cursor.set(0, 0, 0);
    this.controls.maxTargetRadius = this.planetRadius;
    this.applyTopDown2DControlsProfile();
    this.controls.minDistance = this.originalMinDistance;
    this.controls.maxDistance = this.originalMaxDistance;

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
  }

  // ────────────────────────────────────────────
  //  Zoom a pin (click en marcador)
  // ────────────────────────────────────────────
  public zoomToPin(pinPos: THREE.Vector3): void {
    this.isReturningToOrbit = false;
    this.isBlendingControls = false;
    this.autoZoom = false;
    this.isFocusing = true;
    this.controls.minDistance = 1.0;

    const direction = pinPos.clone().normalize();

    if (this.isCinematicMode) {
      this.targetRadius = this.planetRadius + 1.0;
      this.focusTarget.copy(pinPos).setLength(this.planetRadius);
      const currentOffset = this.camera.position.clone().sub(this.controls.target).normalize();
      this.focusPosition.copy(pinPos).add(currentOffset.multiplyScalar(2.0));
      this.focusPosition.setLength(this.targetRadius);
    } else {
      this.targetRadius = this.planetRadius + 3.0;
      this.focusTarget.copy(pinPos);
      this.focusPosition.copy(pinPos).add(direction.multiplyScalar(3.0));
    }
  }

  // ────────────────────────────────────────────
  //  Entrar en vista 3D (tilt) — llamado al acercarse
  // ────────────────────────────────────────────
  public activateTiltView(
    targetPointSurface: THREE.Vector3,
    options?: {
      targetRadius?: number;
      minSurfaceDistance?: number;
      focusSmoothingOverride?: number;
      controlsBlendInSpeedOverride?: number;
    }
  ): void {
    this.isReturningToOrbit = false;
    this.isBlendingControls = false;
    this.isNorthRealigning = false;

    if (!this.savedState) {
      this.savedState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        up: this.camera.up.clone()
      };
    }

    this.isCinematicMode = true;
    this.isFocusing = true;
    this.autoZoom = false;
    this.cinematicTiltLocked = false; // se bloqueará al terminar la transición
    this.introFocusSmoothingOverride = options?.focusSmoothingOverride ?? null;
    this.introControlsBlendInSpeedOverride = options?.controlsBlendInSpeedOverride ?? null;

    // ...existing code (desiredTargetRadius, minSurfaceDistance, surfaceRadius, finalTargetRadius, this.targetRadius)...
    const desiredTargetRadius = options?.targetRadius ?? this.cinematicDefaultTargetRadius;
    const minSurfaceDistance = options?.minSurfaceDistance ?? this.cinematicDefaultMinSurfaceDistance;
    const surfaceRadius = Math.max(targetPointSurface.length(), this.planetRadius);
    const finalTargetRadius = Math.max(desiredTargetRadius, surfaceRadius + minSurfaceDistance);
    this.targetRadius = finalTargetRadius;

    // Transición suave de controles: empezamos desde el perfil actual
    this.controlsBlend = 0;
    this.isBlendingControls = true;
    this.controls.minDistance = this.cinematicMinDistance;
    this.controls.maxDistance = this.cinematicMaxDistance;

    const normal = targetPointSurface.clone().normalize();
    const planetNorth = new THREE.Vector3(0, 1, 0);
    let east = new THREE.Vector3().crossVectors(planetNorth, normal).normalize();
    if (east.lengthSq() < 0.001) east.set(1, 0, 0);
    const northTangent = new THREE.Vector3().crossVectors(normal, east).normalize();

    const heightAboveGround = this.cinematicHeightAboveGround;
    const distanceSouth = this.cinematicDistanceSouth;
    const desiredPos = targetPointSurface.clone()
      .add(normal.clone().multiplyScalar(heightAboveGround))
      .add(northTangent.clone().multiplyScalar(-distanceSouth));

    this.focusPosition.copy(desiredPos).setLength(this.targetRadius);
    this.focusTarget.copy(targetPointSurface).setLength(this.planetRadius);

    // Pre-calculate the locked tilt from the desired camera arrangement
    const desiredDir = this.focusPosition.clone().sub(this.focusTarget);
    const desiredSpherical = new THREE.Spherical().setFromVector3(desiredDir);
    this.cinematicLockedPhi = desiredSpherical.phi;
    this.cinematicLockedTheta = desiredSpherical.theta;
  }

  // ────────────────────────────────────────────
  //  Salida 3D → 2D (instantánea)
  // ────────────────────────────────────────────
  public transitionToTopDownMapForHybrid(): void {
    if (!this.isCinematicMode) return;
    this.switchToTopDownInstant();
  }

  public transitionToOrbitFromCinematicForHybrid(): void {
    this.transitionToTopDownMapForHybrid();
  }

  public resetToOrbitView(): void {
    this.switchToTopDownInstant();
  }

  private switchToTopDownInstant(): void {
    const currentPos = this.camera.position.clone();
    const currentRadius = currentPos.length();
    const distance = Math.max(this.originalMinDistance, currentRadius);
    const anchorDir = (this.isFocusing ? this.focusTarget : this.controls.target).clone();
    if (anchorDir.lengthSq() < 1e-8) anchorDir.copy(this.controls.target);
    if (anchorDir.lengthSq() < 1e-8) anchorDir.copy(currentPos);
    if (anchorDir.lengthSq() < 1e-8) anchorDir.set(0, 0, 1);
    const outwardDir = anchorDir.normalize();

    this.isCinematicMode = false;
    this.cinematicTiltLocked = false;
    this.isFocusing = false;
    this.isReturningToOrbit = false;
    this.isBlendingControls = false;
    this.isNorthRealigning = false;
    this.autoZoom = false;
    this.preserveTargetOnRelease = false;
    this.controlsBlend = 1;
    this.resetIntroTransitionOverrides();

    this.camera.position.copy(outwardDir.multiplyScalar(distance));
    this.camera.up.set(0, 1, 0);
    this.focusPosition.copy(this.camera.position);
    this.focusTarget.set(0, 0, 0);

    this.applyTopDown2DControlsProfile();
    this.controls.minDistance = this.originalMinDistance;
    this.controls.maxDistance = this.originalMaxDistance;
    this.controls.enableZoom = true;
    this.controls.target.set(0, 0, 0);
  }

  public releaseFocus(): void {
    this.isFocusing = false;
    this.autoZoom = false;
    this.isReturningToOrbit = false;
    this.isBlendingControls = false;
    this.isNorthRealigning = false;
    this.preserveTargetOnRelease = false;
    this.resetIntroTransitionOverrides();
    this.controls.enableZoom = true;

    if (!this.isCinematicMode) {
      this.applyTopDown2DControlsProfile();
      this.controls.minDistance = this.originalMinDistance;
      this.controls.maxDistance = this.originalMaxDistance;
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  public releaseFocusOnlyTarget(): void {
    this.isFocusing = false;
    this.isReturningToOrbit = false;
    this.isBlendingControls = false;

    if (!this.isCinematicMode) {
      if (this.preserveTargetOnRelease) {
        this.startNorthRealign();
        this.preserveTargetOnRelease = false;
        this.resetIntroTransitionOverrides();
        return;
      }
      this.isNorthRealigning = false;
      this.applyTopDown2DControlsProfile();
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = this.originalMinDistance;
      this.controls.maxDistance = this.originalMaxDistance;
      this.controls.enableZoom = true;
    } else {
      this.applyCinematicControlsProfile();
      this.controls.minDistance = this.cinematicMinDistance;
      this.controls.maxDistance = this.cinematicMaxDistance;
      // Lock the tilt at the current angle when focus finishes
      this.lockCurrentCinematicTilt();
    }
    this.controls.update();
    this.preserveTargetOnRelease = false;
    this.resetIntroTransitionOverrides();
  }

  // ────────────────────────────────────────────
  //  MAIN UPDATE — llamado cada frame
  // ────────────────────────────────────────────
  public update(): void {
    const dtMs = this.computeDeltaTimeMs();
    this.tuneControlsForDistance();
    this.updateControlsBlend();

    if (this.isFocusing) {
      // ─── Retorno 3D → 2D ───
      if (this.isReturningToOrbit && !this.isCinematicMode) {
        this.focusBlend = Math.min(1, this.focusBlend + this.returnBlendSpeed);
        // Usamos una curva ease-in-out más suave
        const eased = this.smootherStep(this.focusBlend);

        const dir = this.focusStartDir.clone().lerp(this.focusEndDir, eased).normalize();
        this.focusPosition.copy(dir.multiplyScalar(this.focusReturnDistance));

        const targetInterpolated = this.focusStartTarget.clone().lerp(this.focusEndTarget, eased);
        this.focusTarget.copy(targetInterpolated);

        if (this.focusBlend >= 1) this.finalizeOrbitReturn();
      }

      // Lerp suave de posición y target
      const activeFocusSmoothing = this.introFocusSmoothingOverride ?? this.focusSmoothing;
      const smoothing = this.isReturningToOrbit ? this.returnFocusSmoothing : activeFocusSmoothing;
      this.camera.position.lerp(this.focusPosition, smoothing);
      this.controls.target.lerp(this.focusTarget, smoothing);

      if (this.isCinematicMode) {
        const currentDist = this.camera.position.length();
        const nextDist = THREE.MathUtils.lerp(currentDist, this.targetRadius, smoothing);
        this.camera.position.setLength(nextDist);
        // Solo forzar target a planetRadius si no estamos muy cerca (evita snap perpendicular)
        const distToTarget = this.camera.position.distanceTo(this.controls.target);
        if (distToTarget > this.cinematicMinDistance * 2) {
          this.controls.target.setLength(this.planetRadius);
        }
        this.enforceCinematicSurfaceGuard();
        this.enforceCinematicTilt();
        // Transición suave del vector up
        const targetUp = this.camera.position.clone().normalize();
        this.camera.up.lerp(targetUp, smoothing).normalize();
      } else {
        this.camera.up.lerp(new THREE.Vector3(0, 1, 0), smoothing).normalize();
      }

      this.controls.update();

      // Re-enforce tilt AFTER controls.update to prevent OrbitControls drift
      if (this.isCinematicMode) {
        this.enforceCinematicTilt();
      }

      const distPos = this.camera.position.distanceTo(this.focusPosition);
      const distTarget = this.controls.target.distanceTo(this.focusTarget);

      if (distPos < 0.15 && distTarget < 0.15) {
        if (this.isReturningToOrbit) {
          this.finalizeOrbitReturn();
        } else {
          this.releaseFocusOnlyTarget();
        }
      }
    } else if (this.isNorthRealigning) {
      this.updateNorthRealign(dtMs);
    } else {
      // Re-enforce tilt BEFORE and AFTER controls.update
      if (this.isCinematicMode && this.cinematicTiltLocked) {
        this.enforceCinematicTilt();
      }

      this.controls.update();

      if (this.isCinematicMode) {
        this.enforceCinematicSurfaceGuard();
        this.enforceCinematicTilt();
        const targetUp = this.camera.position.clone().normalize();
        this.camera.up.lerp(targetUp, 0.05).normalize();
        const distToTarget = this.camera.position.distanceTo(this.controls.target);
        if (distToTarget > this.cinematicMinDistance * 2 &&
            Math.abs(this.controls.target.length() - this.planetRadius) > 0.01) {
          this.controls.target.setLength(this.planetRadius);
        }
        this.controls.update();
        // Final enforcement after second update
        this.enforceCinematicTilt();
      }
    }

    // ─── Auto-zoom inicial ───
    if (this.autoZoom && !this.isCinematicMode && !this.isFocusing) {
      const delta = this.targetCameraZ - this.camera.position.z;
      const easingStep = delta * this.easing;
      const linearStep = Math.sign(delta) * Math.min(Math.abs(delta), this.autoZoomTailSpeed);

      const blendStart = this.autoZoomTailStartZ + this.autoZoomTailBlendWindow;
      const blendEnd = this.autoZoomTailStartZ - this.autoZoomTailBlendWindow;

      if (this.camera.position.z > blendStart) {
        this.camera.position.z += easingStep;
      } else if (this.camera.position.z <= blendEnd) {
        this.camera.position.z += linearStep;
      } else {
        const blendT = THREE.MathUtils.clamp(
          (blendStart - this.camera.position.z) / (2 * this.autoZoomTailBlendWindow),
          0,
          1
        );
        const mixedStep = THREE.MathUtils.lerp(easingStep, linearStep, blendT);
        this.camera.position.z += mixedStep;
      }

      if (Math.abs(this.camera.position.z - this.targetCameraZ) < this.autoZoomStopEpsilon) {
        this.camera.position.z = this.targetCameraZ;
        this.autoZoom = false;
      }
    }
  }

  // ────────────────────────────────────────────
  //  Helpers privados
  // ────────────────────────────────────────────

  /** Ken Perlin's smoother step — C² continuous, less jerky than smoothstep */
  private smootherStep(t: number): number {
    t = THREE.MathUtils.clamp(t, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** Mezcla gradual de perfiles de control durante las transiciones */
  private updateControlsBlend(): void {
    if (!this.isBlendingControls) return;

    const blendSpeed = this.isCinematicMode
      ? (this.introControlsBlendInSpeedOverride ?? this.controlsBlendInSpeed)
      : this.controlsBlendOutSpeed;
    this.controlsBlend = Math.min(1, this.controlsBlend + blendSpeed);
    const t = this.smootherStep(this.controlsBlend);

    if (this.isCinematicMode) {
      // Transición 2D → 3D: blend de rotateSpeed, damping
      this.controls.rotateSpeed = THREE.MathUtils.lerp(this.originalRotateSpeed, 0.2, t);
      this.controls.dampingFactor = THREE.MathUtils.lerp(this.orbitDampingFactor, this.cinematicDampingFactor, t);
    } else {
      // Transición 3D → 2D: blend inverso
      this.controls.rotateSpeed = THREE.MathUtils.lerp(0.2, this.originalRotateSpeed, t);
      this.controls.dampingFactor = THREE.MathUtils.lerp(this.cinematicDampingFactor, this.orbitDampingFactor, t);
    }

    if (this.controlsBlend >= 1) {
      this.isBlendingControls = false;
      // Aplicar perfil final limpio
      if (this.isCinematicMode) {
        this.applyCinematicControlsProfile();
      } else {
        this.applyTopDown2DControlsProfile();
      }
    }
  }

  private onResize(): void {
    const canvas = this.controls.domElement as HTMLCanvasElement;
    if (!canvas) return;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private currentNowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  private computeDeltaTimeMs(): number {
    const now = this.currentNowMs();
    if (this.lastUpdateTimeMs == null) {
      this.lastUpdateTimeMs = now;
      return 1000 / 60;
    }
    const dt = now - this.lastUpdateTimeMs;
    this.lastUpdateTimeMs = now;
    if (!Number.isFinite(dt) || dt < 0) return 1000 / 60;
    return Math.min(dt, 100);
  }

  private resetIntroTransitionOverrides(): void {
    this.introFocusSmoothingOverride = null;
    this.introControlsBlendInSpeedOverride = null;
  }

  private finalizeOrbitReturn(): void {
    this.isReturningToOrbit = false;
    this.focusPosition.copy(this.focusEndDir).setLength(this.focusReturnDistance);
    this.focusTarget.copy(this.focusEndTarget);
  }

  private startNorthRealign(): void {
    const fromDir = this.camera.position.clone().setY(0);
    if (fromDir.lengthSq() < 1e-8) fromDir.set(this.focusEndDir.x, 0, this.focusEndDir.z);
    if (fromDir.lengthSq() < 1e-8) fromDir.set(0, 0, 1);

    this.northRealignFromDir.copy(fromDir.normalize());
    this.northRealignToDir.set(0, 0, 1);
    this.northRealignTarget.set(0, 0, 0);
    this.northRealignDistance = Math.max(this.targetCameraZ, this.camera.position.length());
    this.northRealignProgress = 0;
    this.controls.enableZoom = false;
    this.isNorthRealigning = true;
  }

  private updateNorthRealign(dtMs: number): void {
    if (!this.isNorthRealigning) return;

    this.northRealignProgress = Math.min(
      1,
      this.northRealignProgress + Math.max(0, dtMs) / this.northRealignDurationMs
    );

    const eased = this.smootherStep(this.northRealignProgress);
    const dir = this.northRealignFromDir.clone().lerp(this.northRealignToDir, eased);
    if (dir.lengthSq() < 1e-8) dir.copy(this.northRealignToDir);
    dir.normalize();

    this.controls.target.copy(this.northRealignTarget);
    this.camera.position.copy(dir.multiplyScalar(this.northRealignDistance));
    this.camera.up.lerp(new THREE.Vector3(0, 1, 0), 0.12).normalize();
    this.controls.update();

    if (this.northRealignProgress >= 1) {
      this.finishNorthRealign();
    }
  }

  private finishNorthRealign(): void {
    this.isNorthRealigning = false;
    this.northRealignProgress = 0;
    this.controls.target.copy(this.northRealignTarget);
    this.camera.position.copy(this.northRealignToDir).setLength(this.northRealignDistance);
    this.camera.up.set(0, 1, 0);
    this.applyTopDown2DControlsProfile();
    this.controls.minDistance = this.originalMinDistance;
    this.controls.maxDistance = this.originalMaxDistance;
    this.controls.enableZoom = true;
    this.controls.update();
    this.preserveTargetOnRelease = false;
  }

  private startTopDownReturnTransition(): void {
    this.isCinematicMode = false;
    this.cinematicTiltLocked = false;
    this.isReturningToOrbit = true;
    this.isFocusing = true;
    this.isNorthRealigning = false;
    this.autoZoom = false;
    this.preserveTargetOnRelease = true;
    this.focusBlend = 0;

    this.controlsBlend = 0;
    this.isBlendingControls = true;

    this.controls.minDistance = 0.1;
    this.controls.maxDistance = this.originalMaxDistance;
    this.controls.enablePan = false;
    this.controls.enableRotate = false;
    this.controls.enableZoom = false;

    this.focusStartDir.copy(this.camera.position);
    if (this.focusStartDir.lengthSq() < 0.0001) this.focusStartDir.set(0, 0, 1);
    this.focusStartDir.normalize();
    const headingProjected = this.camera.position.clone().setY(0);
    if (headingProjected.lengthSq() < 0.0001) headingProjected.set(this.focusStartDir.x, 0, this.focusStartDir.z);
    if (headingProjected.lengthSq() < 0.0001) headingProjected.set(0, 0, 1);
    this.focusEndDir.copy(headingProjected.normalize());

    this.focusReturnDistance = Math.max(this.targetCameraZ, this.camera.position.length());
    this.focusStartTarget.copy(this.controls.target);
    this.focusEndTarget.set(0, 0, 0);

    this.focusPosition.copy(this.camera.position);
    this.focusTarget.copy(this.controls.target);
  }

  private tuneControlsForDistance(): void {
    // Si estamos en transición de controles, dejamos que updateControlsBlend() maneje todo
    if (this.isBlendingControls) return;

    const distance = this.camera.position.distanceTo(this.controls.target);

    if (this.isCinematicMode) {
      this.controls.dampingFactor = this.cinematicDampingFactor;
      return;
    }

    const normalizedDistance = THREE.MathUtils.clamp(
      (distance - this.originalMinDistance) / (this.originalMaxDistance - this.originalMinDistance),
      0,
      1
    );
    const targetRotateSpeed = THREE.MathUtils.lerp(
      this.minOrbitRotateSpeed,
      this.originalRotateSpeed,
      normalizedDistance
    );

    this.controls.rotateSpeed = THREE.MathUtils.lerp(
      this.controls.rotateSpeed,
      targetRotateSpeed,
      this.controlTuningLerp
    );
    this.controls.dampingFactor = this.orbitDampingFactor;
  }

  private applyCinematicControlsProfile(): void {
    this.controls.rotateSpeed = 0.2;
    this.controls.zoomSpeed = this.cinematicZoomSpeed;
    this.controls.enablePan = true;
    this.controls.enableRotate = false;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.minPolarAngle = this.cinematicMinPolarAngle;
    this.controls.maxPolarAngle = this.cinematicMaxPolarAngle;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
  }

  private applyTopDown2DControlsProfile(): void {
    this.controls.rotateSpeed = this.originalRotateSpeed;
    this.controls.zoomSpeed = this.originalZoomSpeed;
    this.controls.enablePan = false;
    this.controls.enableRotate = true;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
  }

  private enforceCinematicSurfaceGuard(): void {
    if (!this.isCinematicMode) return;
    const minCameraRadius = this.planetRadius + this.cinematicMinCameraRadiusOffset;
    const currentRadius = this.camera.position.length();
    if (currentRadius < minCameraRadius) {
      if (currentRadius < 1e-6) this.camera.position.set(0, 0, minCameraRadius);
      else this.camera.position.setLength(minCameraRadius);
    }
  }

  /** Lock the current camera tilt angle for rigid enforcement during zoom */
  private lockCurrentCinematicTilt(): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(dir);
    this.cinematicLockedPhi = THREE.MathUtils.clamp(
      spherical.phi,
      this.cinematicMinPolarAngle,
      this.cinematicMaxPolarAngle
    );
    this.cinematicLockedTheta = spherical.theta;
    this.cinematicTiltLocked = true;
  }

  /**
   * Rigidly enforce the locked tilt angle — only the distance (zoom) is
   * allowed to change; the viewing angle stays constant.
   */
  private enforceCinematicTilt(): void {
    if (!this.isCinematicMode) return;
    if (!this.cinematicTiltLocked) return;

    const dir = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(dir);

    // Keep the current distance but force phi (tilt) and theta (azimuth) to locked values
    spherical.phi = this.cinematicLockedPhi;
    spherical.theta = this.cinematicLockedTheta;

    dir.setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(dir);
  }

  // ── Public getters / utilities ──
  public getCamera(): THREE.PerspectiveCamera { return this.camera; }
  public getCameraRadiusFromCenter(): number { return this.camera.position.length(); }
  public getZoomDistanceToTarget(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }
  public cancelFocusForUserInteraction(): void {
    this.isFocusing = false;
    this.isReturningToOrbit = false;
    this.isBlendingControls = false;
    this.isNorthRealigning = false;
    this.autoZoom = false;
    this.controls.enableZoom = true;
    this.resetIntroTransitionOverrides();
    // If in cinematic mode, lock the current tilt so user zoom doesn't change angle
    if (this.isCinematicMode && !this.cinematicTiltLocked) {
      this.lockCurrentCinematicTilt();
    }
  }
  public isAutoZoomActive(): boolean { return this.autoZoom; }
  public isFocusTransitionActive(): boolean { return this.isFocusing || this.isReturningToOrbit; }
  public setUserControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }
  public destroy(): void {
    window.removeEventListener('resize', this.resizeHandler);
    this.controls.dispose();
  }
}
