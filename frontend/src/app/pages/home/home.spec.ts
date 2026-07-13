import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { HomeComponent } from './home';
import { MotorGraficoFacade } from './engine/motor-grafico-facade';
import { MapProductLite, MapProductsCacheService } from '../../services/map-products-cache.service';
import { MapProductDetailsHydrationService } from '../../services/map-product-details-hydration.service';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  let engineFacade: jasmine.SpyObj<MotorGraficoFacade>;
  let mapProductsCacheService: jasmine.SpyObj<MapProductsCacheService>;
  let mapProductDetailsHydrationService: jasmine.SpyObj<MapProductDetailsHydrationService>;

  afterEach(() => {
    fixture?.destroy();
  });

  beforeEach(async () => {
    engineFacade = jasmine.createSpyObj<MotorGraficoFacade>('MotorGraficoFacade', [
      'initEngine',
      'destroy',
      'setLocations',
      'startHomeIntro',
      'getPinManager',
      'getModalManager',
      'changeEngine',
      'setViewMode'
    ]);
    engineFacade.initEngine.and.returnValue(Promise.resolve());
    engineFacade.changeEngine.and.returnValue(Promise.resolve());
    engineFacade.getPinManager.and.returnValue({
      onHoverChange: () => undefined,
      onClusterHoverChange: () => undefined,
      clearHover: () => undefined
    } as any);
    engineFacade.getModalManager.and.returnValue({
      show: () => undefined,
      hide: () => undefined
    } as any);

    mapProductsCacheService = jasmine.createSpyObj<MapProductsCacheService>('MapProductsCacheService', [
      'getProductsForHome',
      'revalidateCache'
    ]);
    mapProductsCacheService.getProductsForHome.and.returnValue(
      of([
        {
          id: 'prod-1',
          name: 'Queso',
          category: 'Alimentación',
          lat: 38.34,
          lng: -0.48,
          thumbnail: 'https://example.com/queso.jpg',
          has3D: true
        }
      ] satisfies MapProductLite[])
    );
    mapProductsCacheService.revalidateCache.and.returnValue(of({ products: [], changed: false }));

    mapProductDetailsHydrationService = jasmine.createSpyObj<MapProductDetailsHydrationService>('MapProductDetailsHydrationService', [
      'startHydration',
      'getHydratedProduct',
      'getOrFetchPriorityProduct',
      'clear'
    ]);
    mapProductDetailsHydrationService.getHydratedProduct.and.returnValue(null);

    TestBed.overrideComponent(HomeComponent, {
      set: {
        template: '<div #mapContainer></div>'
      }
    });

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, HomeComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MotorGraficoFacade,
          useValue: engineFacade
        },
        {
          provide: MapProductsCacheService,
          useValue: mapProductsCacheService
        },
        {
          provide: MapProductDetailsHydrationService,
          useValue: mapProductDetailsHydrationService
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load map products from the shared cache service', async () => {
    const products$ = new Subject<MapProductLite[]>();
    mapProductsCacheService.getProductsForHome.and.returnValue(products$.asObservable());

    fixture.detectChanges();

    expect(mapProductsCacheService.getProductsForHome).toHaveBeenCalled();
    expect(component.statusMessage).toBe('Cargando mapa...');

    products$.next([
      {
        id: 'prod-1',
        name: 'Queso',
        category: 'Alimentación',
        lat: 38.34,
        lng: -0.48,
        thumbnail: 'https://example.com/queso.jpg',
        has3D: true
      }
    ]);
    products$.complete();

    await fixture.whenStable();

    expect(engineFacade.initEngine).toHaveBeenCalled();
    expect(engineFacade.startHomeIntro).toHaveBeenCalled();
    expect(mapProductDetailsHydrationService.startHydration).toHaveBeenCalledWith(['prod-1']);
    expect(mapProductsCacheService.revalidateCache).toHaveBeenCalled();
    expect(component.statusMessage).toContain('productos en el mapa');
  });
});
