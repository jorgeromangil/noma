import { Component, EventEmitter, Input, Output } from '@angular/core';

type EngineType = 'three' | 'opengl';
type ViewMode = '2d' | '3d';

@Component({
  selector: 'app-engine-switch',
  standalone: true,
  templateUrl: './engine-switch.html',
  styleUrl: './engine-switch.css',
})
export class EngineSwitchComponent {
  @Input() engine: EngineType = 'opengl';
  @Input() switching = false;
  @Input() disabled = false;
  @Input() viewMode: ViewMode = '3d';
  @Output() engineChange = new EventEmitter<EngineType>();
  @Output() viewModeChange = new EventEmitter<ViewMode>();

  select(engine: EngineType): void {
    if (this.disabled || this.switching) return;
    if (engine === this.engine) return;
    this.engineChange.emit(engine);
  }

  selectView(mode: ViewMode): void {
    if (this.disabled || this.switching) return;
    if (mode === this.viewMode) return;
    // optimista para que el estado activo se refleje al instante
    this.viewMode = mode;
    this.viewModeChange.emit(mode);
  }
}
