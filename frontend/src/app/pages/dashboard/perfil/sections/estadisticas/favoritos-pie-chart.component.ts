import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

export interface PieFavoritosData {
  label: string;
  value: number;
  color?: string;
}

@Component({
  selector: 'favoritos-pie-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  template: `
    <div class="glass-wrapper pie-flex-panel">
      <div class="chart-container">
        <canvas baseChart
          [data]="pieData()"
          [options]="pieOptions"
          [type]="'doughnut'">
        </canvas>
        <div class="chart-center-text">
          <span class="total-number">{{ total() }}</span>
          <span class="total-label">CLICS</span>
        </div>
      </div>
      <div class="custom-legend">
        <div *ngFor="let d of data; let i = index" class="legend-item">
          <span class="legend-color" [style.background]="pieColors[i % pieColors.length]"></span>
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
      min-width: 0;
      max-width: none;
      flex: 2 1 0;
      display: flex;
      align-items: center;
      justify-content: center;
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
    .chart-center-text {
      position: absolute;
      top: 50%;
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
    @media (max-width: 700px) {
      .pie-flex-panel {
        flex-direction: column;
        gap: 1.5rem;
      }
      .custom-legend {
        flex-direction: row;
        flex-wrap: wrap;
        min-width: 0;
        max-width: none;
        padding-left: 0;
        justify-content: flex-start;
      }
      .legend-item {
        margin-bottom: 0.5em;
      }
    }
  `]
})
export class FavoritosPieChartComponent {
  private _data = signal<PieFavoritosData[]>([]);

  @Input() set data(val: PieFavoritosData[]) { this._data.set(val || []); }
  get data() { return this._data(); }

  public total = computed(() => this._data().reduce((acc, d) => acc + d.value, 0));

  public pieColors = ['#5384ee', '#b44194'];
  public pieData = computed<ChartConfiguration<'doughnut'>['data']>(() => ({
    labels: this._data().map(d => d.label),
    datasets: [{
      data: this._data().map(d => d.value),
      backgroundColor: this.pieColors.slice(0, this._data().length),
      hoverOffset: 30,
      borderWidth: 0,
      cutout: '60%', // Más pequeño el anillo
      spacing: 0
    }]
  }));

  public pieOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: 20 // Más espacio alrededor del anillo
    },
    plugins: {
      legend: {
        display: false
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
              const idx = items[0].dataIndex;
              return this.data[idx]?.label || '';
            }
            return '';
          },
          label: (item: any) => {
            const idx = item.dataIndex;
            const value = this.data[idx]?.value ?? 0;
            return `Favoritos: ${value}`;
          }
        }
      }
    }
  };
}
