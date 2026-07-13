## OpenGL Engine Structure

- `camera/`: camara base, navegacion, controles y transiciones de rotacion.
- `animation/`: entidad `TAnimacion`, clips por frames, materiales, mallas multiples y gestion temporal.
- `geometry/`: primitivas, carga GLTF/GLB y utilidades geometricas.
- `math/`: operaciones vectoriales, cuaterniones y matrices reutilizables.
- `overlays/`: pins, etiquetas de ciudades y capas administrativas.
- `rendering/`: renderer WebGL, shader program, buffers, VAO y meshes.
- `resources/`: cache y ciclo de vida de recursos compartidos: mallas, texturas, materiales y shaders.
- `scene/`: grafo de escena y nodos base del motor.

Shaders runtime:
- `public/engine/opengl/shaders/`: fuentes GLSL cargadas con `TGestorRecursos` via `fetch`.

Regla practica: si un modulo mezcla logica de varias carpetas, se queda donde viva su responsabilidad principal.
