import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface BarSimpleData {
  name: string;
  value: number;
}

@Component({
  selector: 'estadisticas-barra-simple',
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
export class EstadisticasBarraSimpleComponent implements OnChanges {
  @Input() data: BarSimpleData[] = [];
  @Input() label: string = 'Cantidad'; // Deprecated, use yLabel
  @Input() color: string = '#5384ee';
  @Input() xLabel: string = '';
  @Input() yLabel: string = '';

  public chartData: ChartConfiguration['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Cantidad',
        backgroundColor: '#5384ee',
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
      }
    ]
  };

  public chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items: any) => {
            if (items && items.length > 0) {
              const idx = items[0].dataIndex;
              return this.data[idx]?.name || '';
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
        },
        title: {
          display: true,
          text: '',
          color: 'rgba(255,255,255,0.8)',
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 14,
            weight: 400
          }
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
          stepSize: 1,
          callback: (value: any) => Math.round(value),
        },
        grid: {
          color: 'rgba(255, 255, 255, 0.03)'
        },
        title: {
          display: true,
          text: '',
          color: 'rgba(255,255,255,0.8)',
          font: {
            family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
            size: 14,
            weight: 400
          }
        }
      }
    }
  };

  private truncateLabel(name: string, max: number = 12): string {
    return name.length > max ? name.slice(0, max) + '…' : name;
  }

  ngOnChanges(_: SimpleChanges): void {
    this.updateChartData();
    this.updateChartOptions();
  }

  private getXAxisTitle(): string {
    if (this.xLabel) return this.xLabel;
    return this.label === 'Productos' ? 'Comunidad autónoma' : 'Hora o día';
  }

  private getYAxisTitle(): string {
    if (this.yLabel) return this.yLabel;
    return this.label;
  }

  private updateChartData(): void {
    this.chartData = {
      labels: this.data.map((d) => this.truncateLabel(d.name)),
      datasets: [
        {
          data: this.data.map((d) => d.value),
          label: this.label,
          backgroundColor: this.color,
          borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
        }
      ]
    };
  }

  private updateChartOptions(): void {
    const xAxisTitle = this.getXAxisTitle();
    const yAxisTitle = this.getYAxisTitle();
    this.chartOptions = {
      ...this.chartOptions,
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
          },
          title: {
            display: true,
            text: xAxisTitle,
            color: 'rgba(255,255,255,0.8)',
            font: {
              family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
              size: 14,
              weight: 400
            }
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
            stepSize: 1,
            callback: (value: any) => Math.round(value),
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.03)'
          },
          title: {
            display: true,
            text: yAxisTitle,
            color: 'rgba(255,255,255,0.8)',
            font: {
              family: 'Plus Jakarta Sans, Inter, Arial, sans-serif',
              size: 14,
              weight: 400
            }
          }
        }
      }
    };
  }
}
