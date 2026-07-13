/**
 * Wrapper de VAO con configuración explícita de atributos.
 */
export class VertexArray {
  private vao: WebGLVertexArrayObject;

  constructor(private gl: WebGL2RenderingContext) {
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('No se pudo crear VAO');
    this.vao = vao;
  }

  bind(): void {
    this.gl.bindVertexArray(this.vao);
  }

  unbind(): void {
    this.gl.bindVertexArray(null);
  }

  addAttribute(options: {
    index: number;
    size: number;
    type?: GLenum;
    normalized?: boolean;
    stride?: number;
    offset?: number;
  }): void {
    const { index, size, type = this.gl.FLOAT, normalized = false, stride = 0, offset = 0 } = options;
    this.gl.enableVertexAttribArray(index);
    this.gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
  }

  destroy(): void {
    this.gl.deleteVertexArray(this.vao);
  }
}
