
import { Component, ChangeDetectorRef, Inject, OnDestroy, OnInit, Renderer2 } from '@angular/core';
import { Navbar } from '../../../../commons/navbar/navbar';
import { Footer } from '../../../../commons/footer/footer';
import { RouterLink } from '@angular/router';
import { CommonModule, DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { buildApiUrl } from '../../../../shared/api-base';

@Component({
  selector: 'app-datos-abiertos',
  standalone: true,
  imports: [Navbar, Footer, RouterLink, CommonModule],
  templateUrl: './datos-abiertos.html',
  styleUrls: ['../../../legal/privacy-policy/privacy-policy.css', './datos-abiertos.css']
})
export class DatosAbiertos implements OnInit, OnDestroy {
  private readonly csvDelimiter = ';';
  datosAbiertosLoading = false;
  datosAbiertosError = '';
  datasetPreview: any[] = [];
  datasetKeys: string[] = [];
  datasetMeta: any = null;
  organizationLd?: SafeHtml;
  repositoryLd?: SafeHtml;
  showLicenseModal = false;
  private datasetCompletoCache: any[] = [];
  private pendingFormat: 'csv' | 'json' | 'stats-csv' | 'stats-json' = 'csv';
  statsData: any[] = [];
  mostrarTodasFilas = false;

  constructor(
    private renderer: Renderer2,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    @Inject(DOCUMENT) private document: Document
  ) {
    this.buildJsonLd();
    this.cargarDatosAbiertos();
    this.cargarEstadisticasUsoReal();
  }

  ngOnInit(): void {
    this.renderer.addClass(this.document.body, 'legal-page');
  }

  ngOnDestroy(): void {
    this.renderer.removeClass(this.document.body, 'legal-page');
  }

  cargarDatosAbiertos() {
    this.datosAbiertosLoading = true;
    this.datosAbiertosError = '';
    const url = buildApiUrl('products/open-data?format=json');
    this.http.get<any>(url).subscribe({
      next: (resp) => {
        this.datasetMeta = resp.dataset;
        this.datasetCompletoCache = resp.records || [];
        // Solo mostrar los campos requeridos en la tabla
        this.datasetPreview = (this.datasetCompletoCache || []).map((r: any) => ({
          name: r.name || '',
          description: r.description || '',
          owner: (r.owner && (r.owner.company_name || r.owner.companyName || r.owner.name || r.owner.surname)) || r.owner || '',
          province: r.province || ''
        }));
        this.datosAbiertosLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando datos abiertos', err);
        this.cargarDatosAbiertosFallback();
      }
    });
  }

  get filasPreview() {
    if (this.mostrarTodasFilas) return this.datasetPreview;
    return this.datasetPreview.slice(0, 4);
  }

  verMasFilas() {
    this.mostrarTodasFilas = true;
  }

  solicitarDescarga(formato: 'csv' | 'json' | 'stats-csv' | 'stats-json') {
    this.pendingFormat = formato;
    this.showLicenseModal = true;
  }

  confirmarDescarga() {
    const formato = this.pendingFormat || 'csv';
    this.showLicenseModal = false;
    if (formato === 'stats-csv') {
      this.descargarEstadisticasCSV();
    } else if (formato === 'stats-json') {
      this.descargarEstadisticasJSON();
    } else {
      this.descargarDataset(formato);
    }
  }

  // Exportar estadísticas de uso en JSON
  descargarEstadisticasJSON() {
    if (!this.statsData.length) {
      this.datosAbiertosError = 'No hay estadísticas para exportar.';
      this.cdr.detectChanges();
      return;
    }
    const blob = new Blob([JSON.stringify({ ok: true, records: this.statsData }, null, 2)], { type: 'application/json' });
    this.dispararDescarga(blob, 'estadisticas-uso-syncro.json');
  }

  cancelarDescarga() {
    this.showLicenseModal = false;
  }

  descargarDataset(formato: 'csv' | 'json') {
    const url = buildApiUrl(`products/open-data?format=json`); // Siempre pedimos JSON para controlar los campos
    this.http.get<any>(url).subscribe({
      next: (resp) => {
        // Usar los mismos campos que en la tabla
        const records = Array.isArray(resp.records) ? resp.records : [];
        const datos = (records || []).map((r: any) => ({
          name: r.name || '',
          description: r.description || '',
          owner: (r.owner && (r.owner.company_name || r.owner.companyName || r.owner.name || r.owner.surname)) || r.owner || '',
          province: r.province || ''
        }));
        if (formato === 'json') {
          const blob = new Blob([JSON.stringify({ ok: true, records: datos }, null, 2)], { type: 'application/json' });
          this.dispararDescarga(blob, 'productos-open-data.json');
        } else {
          const encabezados = ['Nombre', 'Descripción', 'Compañía/Taller', 'Provincia'];
          const csvRecords = datos.map((row: any) => ({
            [encabezados[0]]: row.name,
            [encabezados[1]]: row.description,
            [encabezados[2]]: row.owner,
            [encabezados[3]]: row.province
          }));
          const blob = this.buildExcelCsvBlob(encabezados, csvRecords);
          this.dispararDescarga(blob, 'productos-open-data.csv');
        }
      },
      error: (err) => {
        console.error('Error descargando dataset', err);
        this.descargarDatasetFallback(formato);
      }
    });
  }

  private cargarDatosAbiertosFallback() {
    const url = buildApiUrl('products');
    this.http.get<any>(url).subscribe({
      next: (resp) => {
        const records = Array.isArray(resp.products) ? resp.products : Array.isArray(resp) ? resp : [];
        this.datasetCompletoCache = records;
        this.datasetMeta = this.datasetMeta || {
          name: 'Productos artesanos Syncro - Datos abiertos',
          description: 'Listado abierto de productos con identificador, descripción, procedencia y coordenadas geográficas.',
          license: 'CC BY 4.0',
          formats: ['json', 'csv'],
          createdAt: '2024-09-01',
          lastUpdated: new Date().toISOString(),
          updateFrequency: 'Mensual',
          languages: ['es'],
          notes: 'Datos obtenidos directamente de /api/products.'
        };
        // Solo mostrar los campos requeridos en la tabla
        this.datasetPreview = (records || []).map((r: any) => ({
          name: r.name || '',
          description: r.description || '',
          owner: (r.owner && (r.owner.company_name || r.owner.companyName || r.owner.name || r.owner.surname)) || r.owner || '',
          province: r.province || ''
        }));
        this.datosAbiertosError = '';
        this.datosAbiertosLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error fallback datos abiertos', err);
        this.datosAbiertosError = err?.error?.msg || 'No se pudo cargar el dataset.';
        this.datosAbiertosLoading = false;
        this.cdr.detectChanges();
      }
    });
  }
  // Devuelve todas las claves únicas de un array de objetos
  private getAllKeys(arr: any[]): string[] {
    const keySet = new Set<string>();
    arr.forEach(obj => Object.keys(obj).forEach(k => keySet.add(k)));
    return Array.from(keySet);
  }

  private descargarDatasetFallback(formato: 'csv' | 'json') {
    const url = buildApiUrl('products');
    this.http.get<any>(url).subscribe({
      next: (resp) => {
        // Usar todos los productos tal como vienen de la base de datos
        const records = Array.isArray(resp.products) ? resp.products : Array.isArray(resp) ? resp : [];
        if (formato === 'csv') {
          if (!records.length) {
            this.datosAbiertosError = 'No hay datos para exportar.';
            this.cdr.detectChanges();
            return;
          }
          // Obtener todos los campos únicos de todos los productos
          const allKeys: string[] = Array.from(new Set(records.flatMap((prod: any) => Object.keys(prod))));
          const blob = this.buildExcelCsvBlob(allKeys, records);
          this.dispararDescarga(blob, 'productos-open-data.csv');
        } else {
          // Exportar el array completo tal cual
          const blob = new Blob([JSON.stringify({ ok: true, records }, null, 2)], { type: 'application/json' });
          this.dispararDescarga(blob, 'productos-open-data.json');
        }
      },
      error: (err) => {
        console.error('Error descargando dataset (fallback)', err);
        this.datosAbiertosError = err?.error?.msg || 'No se pudo descargar el dataset.';
        this.cdr.detectChanges();
      }
    });
  }

  private dispararDescarga(blob: Blob, nombre: string) {
    const link = document.createElement('a');
    const blobUrl = window.URL.createObjectURL(blob);
    link.href = blobUrl;
    link.download = nombre;
    link.click();
    window.URL.revokeObjectURL(blobUrl);
  }

  private mapProductosToOpenData(productos: any[]): any[] {
    return (productos || []).map((p: any) => {
      const coords = Array.isArray(p?.location?.coordinates) ? p.location.coordinates : (p?.coordinates || []);
      return {
        _id: p?._id || p?.uid || '',
        name: p?.name || '',
        description: p?.description || '',
        product_info: p?.product_info || '',
        city: p?.city || '',
        address_text: p?.address_text || '',
        coordinates: coords,
        longitude: coords.length ? coords[0] : '',
        latitude: coords.length ? coords[1] : ''
      };
    });
  }

  private buildJsonLd() {
    const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'https://syncro-abp.example';
    const organization = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Grupo Syncro ABP 2025/26',
      url: origin,
      email: 'info@syncro-abp.local',
      sameAs: [ `${origin}/home` ]
    };
    const dataCatalog = {
      '@context': 'https://schema.org',
      '@type': 'DataCatalog',
      name: 'Repositorio de datos abiertos Syncro',
      url: `${origin}/datos-abiertos`,
      description: 'Repositorio de datasets abiertos del proyecto Syncro ABP 2025/26.',
      publisher: { '@type': 'Organization', name: 'Grupo Syncro ABP 2025/26' },
      dataset: [
        {
          '@type': 'Dataset',
          name: 'Productos artesanos Syncro - Datos abiertos',
          description: 'Listado de productos con identificador, descripción, procedencia y coordenadas geográficas.',
          license: 'https://creativecommons.org/licenses/by/4.0/',
          creator: { '@type': 'Organization', name: 'Grupo Syncro ABP 2025/26' },
          dateCreated: '2024-09-01',
          dateModified: new Date().toISOString(),
          inLanguage: 'es',
          distribution: [
            { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${origin}/api/products/open-data?format=csv`, name: 'Productos abiertos (CSV)' },
            { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${origin}/api/products/open-data?format=json`, name: 'Productos abiertos (JSON)' }
          ]
        },
        {
          '@type': 'Dataset',
          name: 'Estadísticas de uso Syncro',
          description: 'Estadísticas de uso de la plataforma Syncro ABP 2025/26: descargas, consultas, actividad.',
          license: 'https://creativecommons.org/licenses/by/4.0/',
          creator: { '@type': 'Organization', name: 'Grupo Syncro ABP 2025/26' },
          dateCreated: '2024-09-01',
          dateModified: new Date().toISOString(),
          inLanguage: 'es',
          distribution: [
            { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${origin}/api/products/open-data?format=stats-csv`, name: 'Estadísticas de uso (CSV)' }
          ]
        }
      ]
    };
    this.organizationLd = this.sanitizer.bypassSecurityTrustHtml(JSON.stringify(organization, null, 2));
    this.repositoryLd = this.sanitizer.bypassSecurityTrustHtml(JSON.stringify(dataCatalog, null, 2));

  }

  // Cargar estadísticas de uso reales
  cargarEstadisticasUsoReal() {
    const url = buildApiUrl('products/usage-stats');
    this.http.get<any>(url).subscribe({
      next: (resp) => {
        this.statsData = Array.isArray(resp.stats) ? resp.stats : [];
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando estadísticas de uso', err);
        this.statsData = [];
        this.cdr.detectChanges();
      }
    });
  }

  // Exportar estadísticas de uso en CSV
  descargarEstadisticasCSV() {
    if (!this.statsData.length) {
      this.datosAbiertosError = 'No hay estadísticas para exportar.';
      this.cdr.detectChanges();
      return;
    }
    const allKeys: string[] = Array.from(new Set(this.statsData.flatMap((stat: any) => Object.keys(stat))));
    const blob = this.buildExcelCsvBlob(allKeys, this.statsData);
    this.dispararDescarga(blob, 'estadisticas-uso-syncro.csv');
  }

  private buildExcelCsvBlob(headers: string[], records: any[]): Blob {
    const rows = [
      `sep=${this.csvDelimiter}`,
      headers.map((header) => this.escapeCsvValue(header)).join(this.csvDelimiter),
      ...records.map((record: any) => {
        return headers
          .map((key: string) => this.escapeCsvValue(record?.[key]))
          .join(this.csvDelimiter);
      })
    ];

    const content = rows.join('\r\n');
    const utf16Buffer = this.toUtf16Le(content);
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

}

