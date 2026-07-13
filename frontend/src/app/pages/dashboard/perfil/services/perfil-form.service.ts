import { Injectable } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Injectable({
  providedIn: 'root'
})
export class PerfilFormService {

  constructor(private fb: FormBuilder) {}

  crearPerfilForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50), Validators.pattern(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+/)]],
      surname: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50), Validators.pattern(/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\s]+/)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.minLength(6), Validators.maxLength(100)]],
      company_name: ['', [Validators.minLength(2), Validators.maxLength(100)]],
      description: ['', [Validators.minLength(10), Validators.maxLength(500)]],
      address_text: ['', [Validators.minLength(5), Validators.maxLength(200)]],
      contact: ['', [Validators.pattern(/[0-9+\s()-]{9,15}/)]],
      province: ['', [Validators.minLength(2), Validators.maxLength(50)]]
    });
  }

  crearProductoForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      description: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(50)]],
      resumen: ['', [Validators.required, Validators.minLength(50), Validators.maxLength(300)]],
      category: ['Otros', [Validators.required]],
      historia_origen: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(1000)]],
      importancia_cultural: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(1000)]],
      proceso_elaboracion: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(1000)]],
      materias_primas: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(1000)]],
      tiempo_elaboracion: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(500)]],
      certificaciones_protecciones: ['Sin certificación'],
      address_text: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(200)]],
      province: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      media: [[]]
    });
  }

  aplicarValidadoresArtesano(form: FormGroup, esArtesano: boolean) {
    const artisanControls = ['company_name', 'description', 'address_text', 'contact', 'province'];
    artisanControls.forEach(ctrl => {
      const control = form.get(ctrl);
      if (!control) return;
      const baseValidators = (ctrl === 'company_name') ? [Validators.minLength(2), Validators.maxLength(100)]
        : ctrl === 'description' ? [Validators.minLength(10), Validators.maxLength(500)]
        : ctrl === 'address_text' ? [Validators.minLength(5), Validators.maxLength(200)]
        : ctrl === 'contact' ? [Validators.pattern(/[0-9+\s()-]{9,15}/)]
        : [Validators.minLength(2), Validators.maxLength(50)];
      control.setValidators(esArtesano ? [Validators.required, ...baseValidators] : baseValidators);
      control.updateValueAndValidity({ emitEvent: false });
    });
  }

  rellenarPerfilForm(form: FormGroup, usuario: any) {
    form.patchValue({
      name: usuario.name || '',
      surname: usuario.surname || '',
      email: usuario.email || '',
      password: '',
      company_name: usuario.company_name || '',
      description: usuario.description || '',
      address_text: usuario.address_text || '',
      contact: usuario.contact || '',
      province: usuario.province || ''
    });

    const esArtesano = usuario?.role === 'artisan';
    this.aplicarValidadoresArtesano(form, !!esArtesano);

    form.markAsPristine();
    form.markAsUntouched();
  }

  construirPayloadActualizacion(formValue: any, imagenBase64?: string): any {
    const data = { ...formValue };
    if (!data.password) delete data.password;
    if (imagenBase64) {
      data.image = imagenBase64;
    }
    return data;
  }
}
