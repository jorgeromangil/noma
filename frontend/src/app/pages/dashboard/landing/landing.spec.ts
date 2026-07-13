import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { LandingComponent } from './landing';
import { buildApiUrl } from '../../../shared/api-base';
import { MapProductsCacheService } from '../../../services/map-products-cache.service';

describe('LandingComponent', () => {
  let component: LandingComponent;
  let fixture: ComponentFixture<LandingComponent>;
  let httpMock: HttpTestingController;
  let mapProductsCacheService: jasmine.SpyObj<MapProductsCacheService>;

  beforeEach(async () => {
    mapProductsCacheService = jasmine.createSpyObj<MapProductsCacheService>('MapProductsCacheService', [
      'warmUpCache'
    ]);
    mapProductsCacheService.warmUpCache.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, LandingComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MapProductsCacheService,
          useValue: mapProductsCacheService
        }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LandingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    httpMock.expectOne(buildApiUrl('public/stats')).flush({
      ok: true,
      stats: {
        artisans: 10,
        products: 20,
        categories: 5
      }
    });
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should warm up the map products cache on init', () => {
    expect(mapProductsCacheService.warmUpCache).toHaveBeenCalled();
  });
});
