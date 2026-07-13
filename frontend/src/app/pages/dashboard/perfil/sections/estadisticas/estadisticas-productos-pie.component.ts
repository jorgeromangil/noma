import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface ProductoPieData {
  label: string;
  value: number;
  color?: string;
}

import { CommonModule } from '@angular/common';
@Component({
  selector: 'estadisticas-productos-pie',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, BaseChartDirective],
  template: `
    <div class="glass-wrapper pie-flex-panel">
      <div class="chart-container">
        <canvas baseChart
          [data]="chartData"
          [options]="chartOptions"
          [type]="'pie'">
        </canvas>
      </div>
      <div class="custom-legend">
        <div *ngFor="let d of data; let i = index" class="legend-item">
          <span class="legend-color" [style.background]="d.color || defaultColors[i % defaultColors.length]"></span>
          <span class="legend-label">{{ d.label }}</span>
          <span class="legend-value">{{ d.value }}</span>
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
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      overflow: visible;
      position: relative;
      z-index: 1;
      align-self: stretch;
      flex: 1 1 0;
      display: flex;
      flex-direction: row;
      justify-content: stretch;
      align-items: stretch;
    }
    .pie-flex-panel {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      gap: 1.5rem;
      width: 100%;
    }
    .chart-container {
      position: relative;
      height: 250px;
      width: 100%;
      min-width: 220px;
      max-width: none;
      flex: 2 1 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: height 0.2s, min-width 0.2s;
    }
    .custom-legend {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 300px;
      max-width: 650px;
      width: 100%;
      padding-left: 0.5rem;
      gap: 0.7rem;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.7em;
      background: rgba(255,255,255,0.04);
      border: 0.0625em solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 0.4em 0.8em;
      font-size: 14px;
      color: rgba(255, 255, 255, 0.8);
      font-family: 'Plus Jakarta Sans', 'Inter', Arial, sans-serif;
    }
    .legend-color {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 0.3em;
      box-shadow: 0 1px 4px 0 rgba(0,0,0,0.10);
    }
    .legend-label {
      flex: 1 1 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .legend-value {
      font-weight: 700;
      margin-left: 0.5em;
      color: #bdbdbd;
      font-size: 1.08em;
    }
    @media (max-width: 700px) {
      .pie-flex-panel {
        flex-direction: column;
        gap: 1.2rem;
      }
      .chart-container {
        height: 340px;
        min-height: 220px;
        max-width: 100vw;
      }
      .custom-legend {
        flex-direction: row;
        flex-wrap: wrap;
        min-width: 0;
        max-width: 100vw;
        width: 100%;
        padding-left: 0;
        justify-content: flex-start;
        gap: 0.4rem;
      }
      .legend-item {
        margin-bottom: 0.3em;
        min-width: 90px;
        max-width: 120px;
        font-size: 12px;
        padding: 0.3em 0.5em;
        gap: 0.4em;
      }
      .legend-label {
        max-width: 60px;
      }
      .legend-value {
        font-size: 1em;
      }
    }
  `]
})
export class EstadisticasProductosPieComponent implements OnChanges {
  @Input() data: ProductoPieData[] = [];

  defaultColors = ['#5384ee', '#b44194'];
  public chartData: ChartConfiguration['data'] = {
    labels: [],
    datasets: [
      {
        data: [],
        backgroundColor: [],
        borderWidth: 0
      }
    ]
  };

  ngOnChanges(_: SimpleChanges): void {
    this.updateChartData();
  }

  private updateChartData(): void {
    // Permite color personalizado por segmento
    this.chartData = {
      labels: this.data.map((d) => d.label),
      datasets: [
        {
          data: this.data.map((d) => d.value),
          backgroundColor: this.data.map((d, i) => d.color || this.defaultColors[i % this.defaultColors.length]),
          borderWidth: 0
        }
      ]
    };
  }

  chartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        enabled: true,
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
    }
  };
}
