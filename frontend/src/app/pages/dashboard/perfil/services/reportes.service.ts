import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { buildApiUrl } from '../../../../shared/api-base';

@Injectable({
  providedIn: 'root'
})
export class ReportesService {

  constructor(private http: HttpClient) {}

  obtenerProductosReportados(
    token: string,
    page: number = 1,
    limit: number = 10,
    status?: string,
    sortBy: string = 'last_reported_at',
    sortOrder: 'asc' | 'desc' = 'desc',
    includeInactive: boolean = false
  ): Observable<any> {
    const url = buildApiUrl('products/reports/admin');
    const headers = new HttpHeaders().set('x-token', token);
    
    let params: any = {
      page: page.toString(),
      limit: limit.toString(),
      sortBy,
      sortOrder
    };

    if (includeInactive) {
      params.includeInactive = 'true';
    }

    if (status) {
      params.status = status;
    }

    return this.http.get<any>(url, { headers, params });
  }

  actualizarEstadoReporte(
    token: string,
    productId: string,
    status: 'pending' | 'dismissed' | 'actioned'
  ): Observable<any> {
    const url = buildApiUrl(`products/${productId}/report-status`);
    const headers = new HttpHeaders().set('x-token', token);

    return this.http.put<any>(url, { status }, { headers });
  }
}
