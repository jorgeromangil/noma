import { clamp } from '../math/opengl-math';
import { GlRenderer } from '../rendering/gl-renderer';

export interface OpenGLLayerIds {
  comunidades: string;
  provincias: string;
}

export interface OpenGLThresholdSetup {
  cameraDistance: number;
  introTargetRadius: number;
  minRadius: number;
}

export class OpenGLAdministrativeLayersManager {
  private areComunidadesVisible = false;
  private currentOpacityComunidades = 0.0;
  private targetOpacityComunidades = 0.0;
  private readonly fadeSpeedComunidades = 0.05;

  private areProvinciasVisible = false;
  private currentOpacityProvincias = 0.0;
  private targetOpacityProvincias = 0.0;
  private readonly fadeSpeedProvincias = 0.015;
  private readonly fadeOutSpeedProvincias = 0.08;

  private zoomDistanceThresholdComunidades = Number.POSITIVE_INFINITY;
  private zoomDistanceThresholdProvincias = Number.POSITIVE_INFINITY;

  private readonly comunidadesIntroLeadFactor = 0.01;
  private readonly provinciasZoomAfterIntroFactor = 0.6;

  resetState(renderer: GlRenderer, layerIds: OpenGLLayerIds): void {
    this.areComunidadesVisible = false;
    this.currentOpacityComunidades = 0.0;
    this.targetOpacityComunidades = 0.0;

    this.areProvinciasVisible = false;
    this.currentOpacityProvincias = 0.0;
    this.targetOpacityProvincias = 0.0;

    renderer.setMapLayerOpacity(layerIds.comunidades, 0);
    renderer.setMapLayerOpacity(layerIds.provincias, 0);
  }

  configureThresholds(setup: OpenGLThresholdSetup): void {
    const introZoomSpan = Math.max(0, setup.cameraDistance - setup.introTargetRadius);
    const comunidadesLead = introZoomSpan * this.comunidadesIntroLeadFactor;
    this.zoomDistanceThresholdComunidades = setup.introTargetRadius + comunidadesLead;

    const provinciasThresholdRaw = setup.minRadius +
      (setup.introTargetRadius - setup.minRadius) * this.provinciasZoomAfterIntroFactor;

    this.zoomDistanceThresholdProvincias = clamp(
      Math.min(provinciasThresholdRaw, this.zoomDistanceThresholdComunidades - 1e-4),
      setup.minRadius,
      this.zoomDistanceThresholdComunidades
    );
  }

  clearThresholds(): void {
    this.zoomDistanceThresholdComunidades = Number.POSITIVE_INFINITY;
    this.zoomDistanceThresholdProvincias = Number.POSITIVE_INFINITY;
  }

  update(distance: number, renderer: GlRenderer, layerIds: OpenGLLayerIds): void {
    const shouldShowComunidades = distance <= this.zoomDistanceThresholdComunidades;
    if (shouldShowComunidades !== this.areComunidadesVisible) {
      this.areComunidadesVisible = shouldShowComunidades;
      this.targetOpacityComunidades = shouldShowComunidades ? 1.0 : 0.0;
    }

    this.currentOpacityComunidades +=
      (this.targetOpacityComunidades - this.currentOpacityComunidades) * this.fadeSpeedComunidades;
    this.currentOpacityComunidades = clamp(this.currentOpacityComunidades, 0, 1);
    renderer.setMapLayerOpacity(layerIds.comunidades, this.currentOpacityComunidades);

    const shouldShowProvincias = distance <= this.zoomDistanceThresholdProvincias;
    if (shouldShowProvincias !== this.areProvinciasVisible) {
      this.areProvinciasVisible = shouldShowProvincias;
      this.targetOpacityProvincias = shouldShowProvincias ? 1.0 : 0.0;
    }

    const provinciasSpeed = this.targetOpacityProvincias > 0.5
      ? this.fadeSpeedProvincias
      : this.fadeOutSpeedProvincias;

    this.currentOpacityProvincias +=
      (this.targetOpacityProvincias - this.currentOpacityProvincias) * provinciasSpeed;
    this.currentOpacityProvincias = clamp(this.currentOpacityProvincias, 0, 1);
    renderer.setMapLayerOpacity(layerIds.provincias, this.currentOpacityProvincias);
  }

  getOverlayOpacity(): number {
    return this.currentOpacityComunidades;
  }

  getProvinciasOpacity(): number {
    return this.currentOpacityProvincias;
  }

  getThresholds(): { comunidades: number; provincias: number } {
    return {
      comunidades: this.zoomDistanceThresholdComunidades,
      provincias: this.zoomDistanceThresholdProvincias,
    };
  }
}
