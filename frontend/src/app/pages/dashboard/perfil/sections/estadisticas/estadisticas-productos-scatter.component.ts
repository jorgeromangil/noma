import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface ProductoScatterData {
  name: string;
  clicks: number;
  avgDuration: number; // en ms
}

@Component({
  selector: 'estadisticas-productos-scatter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseChartDirective],
  template: `
    <div class="estadisticas-bar-glass-wrapper">
      <ng-content select=".scatter-title"></ng-content>
      <div style="height: 320px; width: 100%;">
        <canvas baseChart
          [data]="chartData"
          [options]="chartOptions"
          [type]="'scatter'">
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
export class EstadisticasProductosScatterComponent implements OnChanges {
  @Input() productos: ProductoScatterData[] = [];

  public chartData: ChartConfiguration<'scatter'>['data'] = {
    datasets: [
      {
        label: 'Productos',
        data: [],
        backgroundColor: '#5384ee',
        pointRadius: 7,
        pointHoverRadius: 10,
      }
    ]
  };

  ngOnChanges(_: SimpleChanges): void {
    this.updateChartData();
  }

  private updateChartData(): void {
    this.chartData = {
      datasets: [
        {
          label: 'Productos',
          data: this.productos.filter((p) => p.clicks > 0 && p.avgDuration > 0).map((p) => ({
            x: p.clicks,
            y: Math.round(p.avgDuration / 1000),
            label: p.name
          })),
          backgroundColor: '#5384ee',
          pointRadius: 7,
          pointHoverRadius: 10,
        }
      ]
    };
  }

  chartOptions: ChartConfiguration<'scatter'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const d = ctx.raw;
            return `${d.label}: ${d.x} clics, ${d.y} s`;
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
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Clics',
          color: 'rgba(255,255,255,0.8)',
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 14,
            weight: 400
          }
        },
        ticks: {
          color: 'rgba(255,255,255,0.8)',
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 13,
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.03)'
        }
      },
      y: {
        title: {
          display: true,
          text: 'Tiempo medio (s)',
          color: 'rgba(255,255,255,0.8)',
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 14,
            weight: 400
          }
        },
        ticks: {
          color: 'rgba(255,255,255,0.8)',
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 13,
          }
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.03)'
        }
      }
    }
  };
}
