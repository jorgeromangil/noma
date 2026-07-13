/**
 * Wrapper sencillo de WebGLBuffer para VBO/IBO.
 */
export class GLBuffer {
  private dataType: 'uint16' | 'uint32' | 'float' | 'unknown' = 'unknown';

  constructor(
    private gl: WebGL2RenderingContext,
    private target: GLenum,
    private usage: GLenum = gl.STATIC_DRAW,
    private handle: WebGLBuffer | null = gl.createBuffer()
  ) {
    if (!this.handle) throw new Error('No se pudo crear WebGLBuffer');
  }

  bind(): void {
    this.gl.bindBuffer(this.target, this.handle);
  }

  unbind(): void {
    this.gl.bindBuffer(this.target, null);
  }

  // Aceptamos ArrayBufferLike para evitar incompatibilidades de tipos (SharedArrayBuffer)
  setData(data: ArrayBufferView | ArrayBuffer | ArrayBufferLike): void {
    this.bind();
    // guardamos tipo para drawElements
    if (data instanceof Uint32Array) this.dataType = 'uint32';
    else if (data instanceof Uint16Array) this.dataType = 'uint16';
    else if (data instanceof Float32Array) this.dataType = 'float';
    else this.dataType = 'unknown';
    this.gl.bufferData(this.target, data as ArrayBufferView | ArrayBuffer, this.usage);
  }

  destroy(): void {
    if (this.handle) {
      this.gl.deleteBuffer(this.handle);
      this.handle = null;
    }
  }

  getType(): 'uint16' | 'uint32' | 'float' | 'unknown' {
    return this.dataType;
  }
}
