import { clamp, quatFromEuler, quatToMat4, Vec3 } from '../math/opengl-math';

export class OpenGLRotationManager {
  private pitch = 0;
  private yaw = 0;
  private pitchTarget = 0;
  private yawTarget = 0;

  // Inclinación fija que se aplica además de la rotación interactiva.
  private tiltPitch = 0;
  private tiltYaw = 0;
  private tiltPitchTarget = 0;
  private tiltYawTarget = 0;
  private tiltTransitionActive = false;
  private tiltTransitionProgress = 0;
  private tiltTransitionDuration = 0.9;
  private tiltTransitionStartPitch = 0;
  private tiltTransitionStartYaw = 0;
  private tiltTransitionEndPitch = 0;
  private tiltTransitionEndYaw = 0;

  // Orientacion inicial equivalente a la usada en el motor Three.
  private readonly introTargetPitch = 0.678;
  private readonly introTargetYaw = Math.PI * 0.55;
  private introAnimActive = true;
  private readonly introAnimSpeed = 0.02;
  private readonly introEaseAngle = 0.08;
  private readonly introStopAngle = 0.0015;

  private readonly dragDampingHz = 16;
  private readonly dragEpsilon = 1e-4;
  private readonly pointerRotateSpeed = 0.0002; // rad/pixel para drag directo (muy suave)
  private readonly pointerDeltaClamp = 14; // evita saltos por eventos con deltas anómalos

  private rotateSpeed = 0.15;
  private readonly maxPitch = Math.PI * 0.48; // evita que el planeta llegue a "voltearse"

  constructor(private readonly onModelMatrixChange: (matrix: Float32Array) => void) {
    this.updateModelMatrix();
  }

  resetOrientation(): void {
    this.pitch = 0;
    this.yaw = 0;
    this.pitchTarget = 0;
    this.yawTarget = 0;
    this.tiltPitch = 0;
    this.tiltYaw = 0;
    this.tiltPitchTarget = 0;
    this.tiltYawTarget = 0;
    this.tiltTransitionActive = false;
    this.tiltTransitionProgress = 0;
    this.introAnimActive = true;
    this.updateModelMatrix();
  }

  cancelIntroAnimation(): void {
    this.introAnimActive = false;
  }

  syncTargetToCurrent(): void {
    this.pitchTarget = this.pitch;
    this.yawTarget = this.yaw;
  }

  applyArcballRotation(v0: Vec3, v1: Vec3): void {
    const dot = clamp(v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2], -1, 1);
    const angle = Math.acos(dot);
    if (angle < 1e-5) return;

    const axis: Vec3 = [
      v0[1] * v1[2] - v0[2] * v1[1],
      v0[2] * v1[0] - v0[0] * v1[2],
      v0[0] * v1[1] - v0[1] * v1[0],
    ];
    const axisLen = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    axis[0] /= axisLen;
    axis[1] /= axisLen;
    axis[2] /= axisLen;

    // Proyectamos el arcball a yaw/pitch y descartamos roll para conservar cardinales.
    const scaledAngle = angle * this.rotateSpeed;
    this.pitchTarget = clamp(this.pitchTarget + axis[0] * scaledAngle, -this.maxPitch, this.maxPitch);
    this.yawTarget += axis[1] * scaledAngle;
    this.wrapYawState();
  }

  /**
   * Rotación directa por delta de puntero (sin arcball):
   * arrastrar mueve el planeta y mantiene la cámara estable.
   */
  applyPointerDrag(deltaX: number, deltaY: number): void {
    const clampedDx = clamp(deltaX, -this.pointerDeltaClamp, this.pointerDeltaClamp);
    const clampedDy = clamp(deltaY, -this.pointerDeltaClamp, this.pointerDeltaClamp);

    // Aplicación directa durante el drag para evitar sensación de retraso.
    this.pitch = clamp(
      this.pitch + clampedDy * this.pointerRotateSpeed,
      -this.maxPitch,
      this.maxPitch
    );
    this.yaw += clampedDx * this.pointerRotateSpeed;
    this.wrapYawState();
    this.pitchTarget = this.pitch;
    this.yawTarget = this.yaw;
    this.updateModelMatrix();
  }

  setTilt(pitch: number, yaw: number = 0): void {
    this.tiltPitch = pitch;
    this.tiltYaw = yaw;
    this.tiltPitchTarget = pitch;
    this.tiltYawTarget = yaw;
    this.tiltTransitionActive = false;
    this.tiltTransitionProgress = 0;
    this.updateModelMatrix();
  }

  startTiltTransition(pitch: number, yaw: number = 0, durationSec: number = 0.9): void {
    const samePitch = Math.abs(this.tiltPitchTarget - pitch) < 1e-6;
    const sameYaw = Math.abs(this.tiltYawTarget - yaw) < 1e-6;
    if (
      samePitch &&
      sameYaw &&
      !this.tiltTransitionActive &&
      Math.abs(this.tiltPitch - pitch) < 1e-6 &&
      Math.abs(this.tiltYaw - yaw) < 1e-6
    ) {
      return;
    }

    this.tiltTransitionStartPitch = this.tiltPitch;
    this.tiltTransitionStartYaw = this.tiltYaw;
    this.tiltTransitionEndPitch = pitch;
    this.tiltTransitionEndYaw = yaw;
    this.tiltPitchTarget = pitch;
    this.tiltYawTarget = yaw;
    this.tiltTransitionDuration = Math.max(durationSec, 1 / 120);
    this.tiltTransitionProgress = 0;
    this.tiltTransitionActive = true;
  }

  clearTilt(): void {
    this.setTilt(0, 0);
  }

  runTiltTransition(dt: number): void {
    if (!this.tiltTransitionActive) return;

    const step = dt > 0 ? dt / this.tiltTransitionDuration : 1 / 60 / this.tiltTransitionDuration;
    this.tiltTransitionProgress = clamp(this.tiltTransitionProgress + step, 0, 1);
    const eased = smootherStep(this.tiltTransitionProgress);

    this.tiltPitch = lerp(this.tiltTransitionStartPitch, this.tiltTransitionEndPitch, eased);
    this.tiltYaw = lerp(this.tiltTransitionStartYaw, this.tiltTransitionEndYaw, eased);
    this.updateModelMatrix();

    if (this.tiltTransitionProgress >= 1) {
      this.tiltPitch = this.tiltPitchTarget;
      this.tiltYaw = this.tiltYawTarget;
      this.tiltTransitionActive = false;
      this.updateModelMatrix();
    }
  }

  runIntroAnimation(): void {
    if (!this.introAnimActive) return;

    const deltaPitch = this.introTargetPitch - this.pitch;
    const deltaYaw = this.introTargetYaw - this.yaw;
    const angle = Math.hypot(deltaPitch, deltaYaw);

    if (angle < this.introStopAngle) {
      this.pitch = this.introTargetPitch;
      this.yaw = this.introTargetYaw;
      this.pitchTarget = this.introTargetPitch;
      this.yawTarget = this.introTargetYaw;
      this.introAnimActive = false;
      this.updateModelMatrix();
      return;
    }

    const ratio = clamp(angle / this.introEaseAngle, 0, 1);
    const ease = 1 - Math.pow(1 - ratio, 3);
    const t = this.introAnimSpeed * ease;

    this.pitch += deltaPitch * t;
    this.yaw += deltaYaw * t;
    this.pitchTarget = this.pitch;
    this.yawTarget = this.yaw;
    this.wrapYawState();
    this.updateModelMatrix();
  }

  relaxDragRotation(dt: number): void {
    if (this.introAnimActive) {
      this.syncTargetToCurrent();
      return;
    }

    const deltaPitch = this.pitchTarget - this.pitch;
    const deltaYaw = this.yawTarget - this.yaw;
    if (Math.hypot(deltaPitch, deltaYaw) < this.dragEpsilon) {
      this.pitch = this.pitchTarget;
      this.yaw = this.yawTarget;
      this.updateModelMatrix();
      return;
    }

    const smoothing = dt > 0 ? 1 - Math.exp(-this.dragDampingHz * dt) : 0.22;
    const t = clamp(smoothing, 0, 1);
    this.pitch += deltaPitch * t;
    this.yaw += deltaYaw * t;
    this.wrapYawState();
    this.updateModelMatrix();
  }

  private updateModelMatrix(): void {
    // Se suma la inclinación fija al estado interactivo.
    this.onModelMatrixChange(
      quatToMat4(quatFromEuler(this.pitch + this.tiltPitch, this.yaw + this.tiltYaw, 0))
    );
  }

  private wrapYawState(): void {
    const wrappedYaw = wrapAnglePi(this.yaw);
    const yawOffset = wrappedYaw - this.yaw;
    this.yaw = wrappedYaw;
    this.yawTarget += yawOffset;
  }

  isIntroAnimationActive(): boolean {
    return this.introAnimActive;
  }

  getIntroRemainingAngle(): number {
    return Math.hypot(this.introTargetPitch - this.pitch, this.introTargetYaw - this.yaw);
  }

  isTiltTransitionActive(): boolean {
    return this.tiltTransitionActive;
  }
}

function wrapAnglePi(angle: number): number {
  const twoPi = 2 * Math.PI;
  let wrapped = (angle + Math.PI) % twoPi;
  if (wrapped < 0) wrapped += twoPi;
  return wrapped - Math.PI;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smootherStep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}
