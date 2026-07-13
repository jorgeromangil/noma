import { InjectionToken } from '@angular/core';
import { GraphicsEnginePort } from './ports/graphics-engine.port';

export const GRAPHICS_ENGINE = new InjectionToken<GraphicsEnginePort>('GRAPHICS_ENGINE');
