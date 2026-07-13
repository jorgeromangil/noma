import { BaseColorTexture, Geometry } from '../geometry/geometry';
import { ShaderProgram } from './shader-program';
import { GLBuffer } from './buffer';
import { VertexArray } from './vao';
import { TGestorRecursos, TRecursoTextura, TSharedPtr } from '../resources/resource-manager';

type SharedGpuTextureEntry = {
  texture: WebGLTexture;
  refs: number;
};

type TextureAnisotropyExt = {
  TEXTURE_MAX_ANISOTROPY_EXT: number;
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
};

export class Mesh {
  private static readonly gpuTexturePool = new WeakMap<
    WebGL2RenderingContext,
    Map<string, SharedGpuTextureEntry>
  >();
  private static readonly anisotropyExtPool = new WeakMap<
    WebGL2RenderingContext,
    TextureAnisotropyExt | null
  >();

  private vao: VertexArray;
  private vbo: GLBuffer;
  private ebo: GLBuffer | null = null;
  private baseColorTexture: WebGLTexture | null = null;
  private baseColorTextureResourceId: string | null = null;
  private baseColorTexturePtr: TSharedPtr<TRecursoTextura> | null = null;
  private vertexCount: number;
  private mode: GLenum;

  constructor(
    private gl: WebGL2RenderingContext,
    geometry: Geometry,
    private program: ShaderProgram
  ) {
    this.vao = new VertexArray(gl);
    this.vbo = new GLBuffer(gl, gl.ARRAY_BUFFER);
    this.vertexCount = geometry.vertexCount;
    this.mode = geometry.mode ?? gl.TRIANGLES;

    this.vao.bind();
    this.vbo.setData(geometry.vertices);

    for (const attr of geometry.attributes) {
      this.vao.addAttribute({
        index: attr.index,
        size: attr.size,
        stride: geometry.stride,
        offset: attr.offset
      });
    }

    if (geometry.indices) {
      this.ebo = new GLBuffer(gl, gl.ELEMENT_ARRAY_BUFFER);
      this.ebo.setData(geometry.indices);
      this.vertexCount = geometry.indices.length;
    }

    if (geometry.baseColorTexture) {
      this.baseColorTexturePtr = TGestorRecursos
        .getInstancia()
        .registrarTexturaEnMemoria(geometry.baseColorTexture, 'textura-gltf');
      const textureResource = this.baseColorTexturePtr.get();
      this.baseColorTextureResourceId = textureResource.getNombre();
      this.baseColorTexture = Mesh.acquireSharedTexture(this.gl, textureResource);
    }

    this.vao.unbind();
  }

  draw(): void {
    this.program.use();
    this.vao.bind();
    if (this.ebo) {
      const type = this.eboType();
      this.gl.drawElements(this.mode, this.vertexCount, type, 0);
    } else {
      this.gl.drawArrays(this.mode, 0, this.vertexCount);
    }
    this.vao.unbind();
  }

  destroy(): void {
    this.vbo.destroy();
    this.ebo?.destroy();
    if (this.baseColorTextureResourceId) {
      Mesh.releaseSharedTexture(this.gl, this.baseColorTextureResourceId);
    }
    this.baseColorTexture = null;
    this.baseColorTextureResourceId = null;
    this.baseColorTexturePtr?.release();
    this.baseColorTexturePtr = null;
    this.vao.destroy();
  }

  hasBaseColorTexture(): boolean {
    return !!this.baseColorTexture;
  }

  bindBaseColorTexture(unit: number = 0): void {
    if (!this.baseColorTexture) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.baseColorTexture);
  }

  private eboType(): GLenum {
    if (!this.ebo) return this.gl.UNSIGNED_SHORT;
    const t = this.ebo.getType();
    if (t === 'uint32') return this.gl.UNSIGNED_INT;
    if (t === 'uint16') return this.gl.UNSIGNED_SHORT;
    return this.gl.UNSIGNED_SHORT;
  }

  private static acquireSharedTexture(
    gl: WebGL2RenderingContext,
    textureResource: TRecursoTextura
  ): WebGLTexture | null {
    const resourceId = textureResource.getNombre();
    let contextPool = this.gpuTexturePool.get(gl);
    if (!contextPool) {
      contextPool = new Map<string, SharedGpuTextureEntry>();
      this.gpuTexturePool.set(gl, contextPool);
    }

    const shared = contextPool.get(resourceId);
    if (shared) {
      shared.refs += 1;
      return shared.texture;
    }

    const created = this.createBaseColorTexture(gl, textureResource.obtenerTextura());
    if (!created) return null;

    contextPool.set(resourceId, { texture: created, refs: 1 });
    return created;
  }

  private static releaseSharedTexture(gl: WebGL2RenderingContext, resourceId: string): void {
    const contextPool = this.gpuTexturePool.get(gl);
    if (!contextPool) return;

    const shared = contextPool.get(resourceId);
    if (!shared) return;

    shared.refs -= 1;
    if (shared.refs > 0) return;

    gl.deleteTexture(shared.texture);
    contextPool.delete(resourceId);
    if (contextPool.size === 0) {
      this.gpuTexturePool.delete(gl);
    }
  }

  private static createBaseColorTexture(
    gl: WebGL2RenderingContext,
    tex: BaseColorTexture
  ): WebGLTexture | null {
    const t = gl.createTexture();
    if (!t) return null;
    const wrapS = this.mapWrap(gl, tex.wrapS ?? 10497);
    const wrapT = this.mapWrap(gl, tex.wrapT ?? 10497);

    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      tex.width,
      tex.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      tex.pixels
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    const anisotropyExt = this.getAnisotropyExtension(gl);
    if (anisotropyExt) {
      const maxAnisotropy = Number(
        gl.getParameter(anisotropyExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1
      );
      const preferredAnisotropy = Math.max(1, Math.min(8, maxAnisotropy));
      gl.texParameterf(
        gl.TEXTURE_2D,
        anisotropyExt.TEXTURE_MAX_ANISOTROPY_EXT,
        preferredAnisotropy
      );
    }
    gl.bindTexture(gl.TEXTURE_2D, null);

    return t;
  }

  private static getAnisotropyExtension(
    gl: WebGL2RenderingContext
  ): TextureAnisotropyExt | null {
    const cached = this.anisotropyExtPool.get(gl);
    if (cached !== undefined) return cached;

    const ext = (gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic')) as TextureAnisotropyExt | null;

    this.anisotropyExtPool.set(gl, ext);
    return ext;
  }

  private static mapWrap(gl: WebGL2RenderingContext, wrap: number): GLenum {
    if (wrap === 33071) return gl.CLAMP_TO_EDGE; // CLAMP_TO_EDGE
    if (wrap === 33648) return gl.MIRRORED_REPEAT; // MIRRORED_REPEAT
    return gl.REPEAT;
  }
}
