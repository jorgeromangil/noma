import { Component, Input, computed, signal } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

@Component({
  selector: 'estadisticas-pie-chart',
  standalone: true,
  imports: [BaseChartDirective],
  template: `
    <div class="glass-wrapper">
      <div class="chart-container">
        <canvas baseChart
          [data]="pieData()"
          [options]="pieOptions"
          [type]="'doughnut'">
        </canvas>
        <div class="chart-center-text">
          <span class="total-number">{{ total() }}</span>
          <span class="total-label">TOTAL</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .glass-wrapper {
      background: rgba(39, 39, 39, 0.4);
      border: 0.0625em solid rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 24px;
      padding: 1.5rem;
    }

    .chart-container {
      position: relative;
      height: 300px;
      width: 100%;
    }

    .chart-center-text {
      position: absolute;
      top: 40%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
    }

    .total-number {
      color: white;
      font-size: 1.8rem;
      font-weight: 700;
      line-height: 1;
      font-family: 'Plus Jakarta Sans', 'Inter', Arial, sans-serif;
    }

    .total-label {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.65rem;
      letter-spacing: 2px;
      margin-top: 4px;
      font-family: 'Plus Jakarta Sans', 'Inter', Arial, sans-serif;
    }
  `]
})
export class EstadisticasPieChartComponent {
  // Para compatibilidad con admin: acepta 'data' como input
  @Input() data: { label: string, value: number, color?: string }[] = [];
  @Input() title?: string;

  // Para compatibilidad con artesano: visibles/ocultos
  private _visibles = signal(0);
  private _ocultos = signal(0);
  @Input() set visibles(val: number) { this._visibles.set(val); }
  @Input() set ocultos(val: number) { this._ocultos.set(val); }
  get visibles() { return this._visibles(); }
  get ocultos() { return this._ocultos(); }

  // Calcula el total para ambos modos
  public total = computed(() => {
    if (this.data && this.data.length) {
      return this.data.reduce((acc, d) => acc + (d.value || 0), 0);
    }
    return this._visibles() + this._ocultos();
  });

  // Configura los datos para ambos modos
  public pieData = computed<ChartConfiguration<'doughnut'>['data']>(() => {
    if (this.data && this.data.length) {
      return {
        labels: this.data.map(d => d.label),
        datasets: [{
          data: this.data.map(d => d.value),
          backgroundColor: this.data.map(d => d.color || '#f83d3a'),
          hoverOffset: 40,
          borderWidth: 0,
          cutout: '60%'
        }]
      };
    }
    return {
      labels: ['Visibles', 'Ocultos'],
      datasets: [{
        data: [this._visibles(), this._ocultos()],
        backgroundColor: [
          '#3b82f6',
          '#b44194'
        ],
        hoverOffset: 40,
        borderWidth: 0,
        cutout: '60%'
      }]
    };
  });

  public pieOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: 20 // Más espacio alrededor del anillo
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: 'rgba(255, 255, 255, 0.8)',
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 30,
          font: { size: 14, family: 'Plus Jakarta Sans, Inter, Arial, sans-serif' }
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        cornerRadius: 8,
        padding: 10,
        titleFont: {
          family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
          size: 15,
          weight: 700,
        },
        bodyFont: {
          family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
          size: 14,
        },
        callbacks: {
          title: (items: any) => {
            if (items && items.length > 0) {
              return items[0].label || '';
            }
            return '';
          },
          label: (item: any) => {
            const value = item.parsed ?? 0;
            return `Cantidad: ${value}`;
          }
        }
      }
    }
  };
}