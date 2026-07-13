/**
 * Pequeño helper para compilar/enlazar shaders y cachear uniform locations.
 */
export class ShaderProgram {
  private program: WebGLProgram;
  private uniformCache: Map<string, WebGLUniformLocation | null> = new Map();

  constructor(private gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string) {
    const vs = this.compile(gl.VERTEX_SHADER, vertSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fragSrc);

    const program = gl.createProgram();
    if (!program) throw new Error('No se pudo crear el programa WebGL');

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error(`Error al enlazar el programa: ${info}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  getUniformLocation(name: string): WebGLUniformLocation | null {
    if (this.uniformCache.has(name)) return this.uniformCache.get(name)!;
    const loc = this.gl.getUniformLocation(this.program, name);
    this.uniformCache.set(name, loc);
    return loc;
  }

  setMat4(name: string, mat: Float32Array): void {
    const loc = this.getUniformLocation(name);
    if (loc) this.gl.uniformMatrix4fv(loc, false, mat);
  }

  setVec3(name: string, vec: [number, number, number] | Float32Array): void {
    const loc = this.getUniformLocation(name);
    if (loc) this.gl.uniform3fv(loc, vec);
  }

  setFloat(name: string, v: number): void {
    const loc = this.getUniformLocation(name);
    if (loc) this.gl.uniform1f(loc, v);
  }

  setInt(name: string, v: number): void {
    const loc = this.getUniformLocation(name);
    if (loc) this.gl.uniform1i(loc, v);
  }

  destroy(): void {
    this.gl.deleteProgram(this.program);
  }

  private compile(type: GLenum, src: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('No se pudo crear shader');
    this.gl.shaderSource(shader, src);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Error al compilar shader: ${info}`);
    }
    return shader;
  }
}
