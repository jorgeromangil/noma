import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProductosService } from './productos.service';
import { buildApiUrl } from '../../../../shared/api-base';

describe('ProductosService', () => {
  let service: ProductosService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProductosService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(ProductosService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should download the model3d file as arraybuffer using the authenticated endpoint', () => {
    const productId = '507f1f77bcf86cd799439011';
    const token = 'test-token';
    const expected = new ArrayBuffer(8);
    let received: ArrayBuffer | undefined;

    service.downloadModel3dFile(productId, token).subscribe((buffer) => {
      received = buffer;
    });

    const req = httpMock.expectOne(buildApiUrl(`products/${productId}/model3d/file`));
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('arraybuffer');
    expect(req.request.headers.get('x-token')).toBe(token);

    req.flush(expected);

    expect(received).toBe(expected);
  });
});
