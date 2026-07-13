import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { ApplicationConfig, Injectable, NgZone, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, PLATFORM_ID } from '@angular/core';
import { IMAGE_CONFIG } from '@angular/common';
import { provideRouter, RouterStateSnapshot, TitleStrategy, withInMemoryScrolling } from '@angular/router';
import { provideClientHydration, Title, withEventReplay } from '@angular/platform-browser';
import { provideHttpClient, withFetch, HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthInterceptor } from './layouts/auth-layout/auth.interceptor';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes'; 
import { GRAPHICS_ENGINE } from './pages/home/engine/engine.token';
import { SwitchableGraphicsEngineAdapter } from './pages/home/engine/adapters/switchable-graphics-engine.adapter';
import { environment } from '../environments/environment';

@Injectable()
class NomaTitleStrategy extends TitleStrategy {
  constructor(private readonly titleService: Title) {
    super();
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    this.titleService.setTitle(routeTitle ? `Noma - ${routeTitle}` : 'Noma');
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // `ng serve` renders the app client-side, so enabling hydration in development
    // only produces NG0505 warnings because there is no SSR payload to hydrate.
    ...(environment.production ? [provideClientHydration(withEventReplay())] : []),
    provideAnimations(),
    {
      provide: IMAGE_CONFIG,
      useValue: {
        disableImageSizeWarning: true
      }
    },
    
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useClass: NomaTitleStrategy },
    
    provideHttpClient(withFetch()),
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    provideCharts(withDefaultRegisterables()),
    {
      provide: GRAPHICS_ENGINE,
      useFactory: (ngZone: NgZone, platformId: Object) => new SwitchableGraphicsEngineAdapter(ngZone, platformId),
      deps: [NgZone, PLATFORM_ID]
    }
  ]
};
