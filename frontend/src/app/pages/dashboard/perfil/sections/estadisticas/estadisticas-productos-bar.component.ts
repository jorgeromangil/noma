import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface ProductoBarData {
  name: string;
  clicks: number;
  avgDuration: number; // en ms
}

@Component({
  selector: 'estadisticas-productos-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective],
  template: `
    <div class="estadisticas-bar-glass-wrapper">
      <ng-content select=".bar-chart-title"></ng-content>
      <div style="height: 320px; width: 100%;">
        <canvas baseChart
          [data]="chartData"
          [options]="chartOptions"
          [type]="'bar'">
        </canvas>
      </div>
    </div>
  `,
  styles: [`
    .estadisticas-bar-glass-wrapper {
      background: rgba(39, 39, 39, 0.4);
      border: 0.0625em solid rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border-radius: 24px;
      padding: 1.5rem;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      overflow: visible;
      position: relative;
      z-index: 1;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: stretch;
      align-items: stretch;
    }
  `]
})
export class EstadisticasProductosBarComponent implements OnChanges {
  @Input() productos: ProductoBarData[] = [];
  private chartTooltipProducts: ProductoBarData[] = [];

  public chartData: ChartConfiguration['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Clics en producto',
        backgroundColor: '#5384ee',
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
      },
      {
        data: [],
        label: 'Tiempo medio (s)',
        backgroundColor: '#b44194',
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
      }
    ]
  };

  // Truncar el nombre a 12 caracteres y agregar '...' si es necesario
  private truncateLabel(name: string, max: number = 12): string {
    return name.length > max ? name.slice(0, max) + '…' : name;
  }

  ngOnChanges(_: SimpleChanges): void {
    this.updateChartData();
  }

  private updateChartData(): void {
    // Filtrar productos con al menos 1 clic y ordenar de mayor a menor
    const productosFiltrados = this.productos.filter((p) => p.clicks > 0);
    const productosOrdenados = [...productosFiltrados].sort((a, b) => b.clicks - a.clicks);
    this.chartTooltipProducts = productosOrdenados;
    this.chartData = {
      labels: productosOrdenados.map((p) => this.truncateLabel(p.name)),
      datasets: [
        {
          data: productosOrdenados.map((p) => p.clicks),
          label: 'Clics en producto',
          backgroundColor: '#5384ee',
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
        },
        {
          data: productosOrdenados.map((p) => Math.round(p.avgDuration / 1000)),
          label: 'Tiempo medio (s)',
          backgroundColor: '#b44194',
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
        }
      ]
    };
  }

  chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 14
          },
          color: 'rgba(255,255,255,0.8)',
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 18,
          boxHeight: 18,
        }
      },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items: any) => {
            if (items && items.length > 0) {
              const idx = items[0].dataIndex;
              return this.chartTooltipProducts[idx]?.name || '';
            }
            return '';
          }
        },
        titleFont: {
          family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
          size: 15,
          weight: 700,
        },
        bodyFont: {
          family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
          size: 14,
        },
        footerFont: {
          family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
          size: 13,
        },
      }
    },
    scales: {
      x: {
        ticks: {
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 13,
          },
          color: 'rgba(255,255,255,0.8)',
        }, 
        grid: {
          color: 'rgba(255, 255, 255, 0.03)'
        }
      },
      y: {
        beginAtZero: true,
        ticks: {
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 13,
          },
          color: 'rgba(255,255,255,0.8)',
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.03)'
        }
      }
    }
  };
}
