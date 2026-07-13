import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { buildApiUrl } from '../../../../shared/api-base';

export interface AdminProductsFilters {
  q?: string;
  owner?: string;
  category?: string;
  province?: string;
  status?: 'visible' | 'hidden' | 'all';
  from?: number;
  recordsPerPage?: number;
}

export interface AdminProductOwner {
  uid?: string;
  _id?: string;
  name?: string;
  surname?: string;
  company_name?: string;
  email?: string;
  contact?: string;
  slug?: string;
  image?: string;
  active?: boolean;
  role?: string;
  [key: string]: any;
}

export interface AdminProduct {
  _id?: string;
  uid?: string;
  id?: string;
  name?: string;
  category?: string;
  province?: string;
  active?: boolean;
  media?: string[];
  owner?: AdminProductOwner;
  menuAbierto?: boolean;
  [key: string]: any;
}

export interface AdminProductsResponse {
  ok: boolean;
  msg?: string;
  products: AdminProduct[];
  total?: number;
  page?: {
    from: number;
    recordsPerPage: number;
    total: number;
    page: number;
    totalPages: number;
  };
  facets?: {
    categories?: string[];
    provinces?: string[];
  };
}

export interface ProductMutationResponse {
  ok: boolean;
  msg?: string;
  product?: AdminProduct;
}

@Injectable({
  providedIn: 'root'
})
export class ProductosService {
  private readonly csvDelimiter = ';';

  constructor(private http: HttpClient) {}

  obtenerMisProductos(token: string): Observable<any> {
    const url = buildApiUrl('products/my');
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.get<any>(url, { headers });
  }

  obtenerProductosAdmin(token: string, filters: AdminProductsFilters = {}): Observable<AdminProductsResponse> {
    const url = buildApiUrl('products/admin');
    const headers = new HttpHeaders().set('x-token', token);
    let params = new HttpParams();

    if (filters.q) {
      params = params.set('q', filters.q);
    }

    if (filters.owner) {
      params = params.set('owner', filters.owner);
    }

    if (filters.category) {
      params = params.set('category', filters.category);
    }

    if (filters.province) {
      params = params.set('province', filters.province);
    }

    if (filters.status && filters.status !== 'all') {
      params = params.set('status', filters.status);
    }

    if (typeof filters.from === 'number') {
      params = params.set('from', String(filters.from));
    }

    if (typeof filters.recordsPerPage === 'number') {
      params = params.set('recordsPerPage', String(filters.recordsPerPage));
    }

    return this.http.get<AdminProductsResponse>(url, { headers, params });
  }

  crearProducto(payload: any, token: string): Observable<any> {
    const url = buildApiUrl('products');
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.post(url, payload, { headers });
  }

  actualizarProducto(id: string, payload: any, token: string): Observable<ProductMutationResponse> {
    const url = buildApiUrl(`products/${id}`);
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.put<ProductMutationResponse>(url, payload, { headers });
  }

  eliminarProducto(id: string, token: string): Observable<ProductMutationResponse> {
    const url = buildApiUrl(`products/${id}`);
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.delete<ProductMutationResponse>(url, { headers });
  }

  uploadModel3d(productId: string, file: File, token: string) {
    const url = buildApiUrl(`products/${productId}/model3d`);
    const headers = new HttpHeaders().set('x-token', token);
    const form = new FormData();
    form.append('model', file);
    return this.http.post<any>(url, form, {
      headers,
      reportProgress: true,
      observe: 'events'
    });
  }

  deleteModel3d(productId: string, token: string) {
    const url = buildApiUrl(`products/${productId}/model3d`);
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.delete<any>(url, { headers });
  }

  downloadModel3dFile(productId: string, token: string): Observable<ArrayBuffer> {
    const url = buildApiUrl(`products/${productId}/model3d/file`);
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.get(url, { headers, responseType: 'arraybuffer' });
  }

  obtenerFavoritos(token: string): Observable<any> {
    const url = buildApiUrl('users/favorites');
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.get<any>(url, { headers });
  }

  eliminarFavorito(productId: string, token: string): Observable<any> {
    const url = buildApiUrl(`users/favorites/${productId}`);
    const headers = new HttpHeaders().set('x-token', token);
    return this.http.delete<any>(url, { headers });
  }

  obtenerDatosAbiertos(formato: 'json' | 'csv' = 'json'): Observable<any> {
    const url = buildApiUrl(`products/open-data?format=${formato}`);
    return this.http.get<any>(url);
  }

  descargarDataset(formato: 'json' | 'csv'): Observable<Blob> {
    const url = buildApiUrl(`products/open-data?format=${formato}`);
    const options = { responseType: 'blob' as const };
    return this.http.get(url, options);
  }

  obtenerProductos(): Observable<any> {
    const url = buildApiUrl('products');
    return this.http.get<any>(url);
  }

  comprimirImagen(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event: any) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          const MAX_DIM = 1200;
          // Limitar tanto ancho como alto, y usar Math.floor para evitar floats
          // (floats en canvas.width/height causan errores de Buffer en el backend)
          const scaleFactor = Math.min(1, MAX_DIM / img.width, MAX_DIM / img.height);
          canvas.width = Math.floor(img.width * scaleFactor);
          canvas.height = Math.floor(img.height * scaleFactor);

          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

          // Reducir calidad progresivamente si el base64 resultante es demasiado grande (> 2MB)
          let quality = 0.7;
          let base64 = canvas.toDataURL('image/jpeg', quality);
          while (base64.length > 2 * 1024 * 1024 && quality > 0.1) {
            quality = Math.round((quality - 0.1) * 10) / 10;
            base64 = canvas.toDataURL('image/jpeg', quality);
          }

          resolve(base64);
        };
      };
    });
  }

  mapProductosToOpenData(productos: any[]): any[] {
    return (productos || []).map((p: any) => {
      const coords = Array.isArray(p?.location?.coordinates) ? p.location.coordinates : (p?.coordinates || []);
      return {
        _id: p?._id || p?.uid || '',
        name: p?.name || '',
        description: p?.description || '',
        historia_origen: p?.historia_origen || '',
        importancia_cultural: p?.importancia_cultural || '',
        proceso_elaboracion: p?.proceso_elaboracion || '',
        materias_primas: p?.materias_primas || '',
        tiempo_elaboracion: p?.tiempo_elaboracion || '',
        certificaciones_protecciones: p?.certificaciones_protecciones || '',
        city: p?.city || '',
        province: p?.province || '',
        autonomous_community: p?.autonomous_community || '',
        coordinates: coords,
        longitude: coords.length ? coords[0] : '',
        latitude: coords.length ? coords[1] : ''
      };
    });
  }

  generarCSV(records: any[]): Blob {
    const headers = ['_id', 'name', 'description', 'historia_origen', 'importancia_cultural', 'proceso_elaboracion', 'materias_primas', 'tiempo_elaboracion', 'certificaciones_protecciones', 'province', 'autonomous_community', 'address_text', 'coordinates', 'longitude', 'latitude'];
    const csvRows = [
      `sep=${this.csvDelimiter}`,
      headers.map((header) => this.escapeCsvValue(header)).join(this.csvDelimiter),
      ...records.map((record) => headers.map((key) => {
        if (key === 'coordinates') {
          return this.escapeCsvValue(record.coordinates || []);
        }
        return this.escapeCsvValue(record[key]);
      }).join(this.csvDelimiter))
    ];
    const csvContent = csvRows.join('\r\n');
    const utf16Buffer = this.toUtf16Le(csvContent);
    return new Blob([utf16Buffer], { type: 'text/csv;charset=utf-16le' });
  }

  private escapeCsvValue(value: any): string {
    if (value === null || value === undefined) return '""';

    let stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    stringValue = stringValue.normalize('NFC');
    stringValue = stringValue.replace(/\r?\n|\r/g, ' ');
    const escaped = stringValue.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private toUtf16Le(text: string): ArrayBuffer {
    const normalized = `\uFEFF${text}`;
    const buffer = new ArrayBuffer(normalized.length * 2);
    const view = new DataView(buffer);

    for (let index = 0; index < normalized.length; index += 1) {
      view.setUint16(index * 2, normalized.charCodeAt(index), true);
    }

    return buffer;
  }

  descargarArchivo(blob: Blob, nombre: string) {
    const link = document.createElement('a');
    const blobUrl = window.URL.createObjectURL(blob);
    link.href = blobUrl;
    link.download = nombre;
    link.click();
    window.URL.revokeObjectURL(blobUrl);
  }
}
