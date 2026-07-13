# syncro_abp25
[ABPGC25] Proyecto de Contenidos del grupo Syncro de ABP 2025/26

# Backend API Documentation

## Estructura del Proyecto
```
backend/
├── controllers/     # Lógica de negocio
│   ├── auth.js     # Autenticación
│   ├── users.js    # Gestión de usuarios
│   └── products.js # Gestión de productos
├── database/
│   └── configdb.js # Configuración MongoDB
├── helpers/
│   └── jwt.js      # Generación y gestión de JWT
├── middleware/
│   ├── validate-fields.js # Validación de campos
│   ├── validate-jwt.js    # Validación de token
│   └── validate-role.js   # Validación de roles
├── models/
│   ├── users.js    # Esquema de usuario
│   └── products.js # Esquema de producto
└── routes/
    ├── auth.js     # Rutas de autenticación
    ├── users.js    # Rutas de usuarios
    └── products.js # Rutas de productos
```

## Modelos

### Usuario (User)
```javascript
{
    name: String,       // requerido
    surname: String,    // requerido
    email: String,      // requerido, único
    password: String,   // requerido, hasheado
    image: String,      // opcional
    role: String       // requerido, valores: ['regular', 'artisan', 'admin']
}
```

### Producto (Product)
```javascript
{
    name: String,          // requerido, único
    description: String,   // requerido
    
    // Historia y Patrimonio
    historia_origen: String,         // requerido
    importancia_cultural: String,    // requerido
    
    // Técnicas y Procesos
    proceso_elaboracion: String,     // requerido
    materias_primas: String,         // requerido
    tiempo_elaboracion: String,      // requerido
    
    // Certificaciones (opcional)
    certificaciones_protecciones: String,  // opcional
    
    media: [String],      // requerido, al menos un elemento
    city: String,         // requerido
    address_text: String, // requerido
    owner: ObjectId      // requerido, referencia a User
}
```

## Endpoints

### Autenticación
- **POST /api/login**
  - Body: `{ email, password }`
  - Respuesta: JWT token para autenticación
  - No requiere autenticación

### Usuarios

- **GET /api/users**
  - Lista usuarios (paginado)
  - Query params: `from`, `recordsPerPage`
  - Requiere: JWT
  - Códigos: 200, 500

- **POST /api/users**
  - Crea nuevo usuario
  - Body: `{ name, surname, email, password, role?, image? }`
  - Requiere: JWT (solo admin puede crear otros admin)
  - Códigos: 201, 400 (email duplicado), 403 (no autorizado), 500

- **PUT /api/users/:id**
  - Actualiza usuario existente
  - Body: `{ name?, surname?, email?, role?, image? }`
  - Requiere: JWT (solo propietario o admin)
  - Códigos: 200, 400 (email duplicado), 403 (no autorizado), 404, 500

- **DELETE /api/users/:id**
  - Elimina usuario
  - Requiere: JWT (solo propietario o admin)
  - Códigos: 200, 403 (no autorizado), 404, 500

### Productos

- **GET /api/products**
  - Lista todos los productos (paginado)
  - Query params: `from`, `recordsPerPage`
  - Requiere: JWT
  - Códigos: 200, 403, 500

- **GET /api/products/my**
  - Lista productos del usuario autenticado
  - Requiere: JWT (artisan o admin)
  - Códigos: 200, 403, 500

- **POST /api/products**
  - Crea nuevo producto
  - Body: `{ name, description, historia_origen, importancia_cultural, proceso_elaboracion, materias_primas, tiempo_elaboracion, certificaciones_protecciones?, media[], city, address_text }`
  - Requiere: JWT (artisan o admin)
  - Códigos: 201, 400 (nombre duplicado), 403, 500

- **PUT /api/products/:id**
  - Actualiza producto existente
  - Body: `{ name?, description?, historia_origen?, importancia_cultural?, proceso_elaboracion?, materias_primas?, tiempo_elaboracion?, certificaciones_protecciones?, media[]?, city?, address_text? }`
  - Requiere: JWT (solo propietario o admin)
  - Códigos: 200, 400 (nombre duplicado), 403, 404, 500

- **DELETE /api/products/:id**
  - Elimina producto
  - Requiere: JWT (solo propietario o admin)
  - Códigos: 200, 403, 404, 500

## Roles y Permisos

### Regular
- Puede ver productos
- Puede gestionar su propio perfil

### Artisan
- Todo lo de Regular
- Puede crear productos
- Puede gestionar sus propios productos

### Admin
- Todo lo anterior
- Puede crear otros admin
- Puede gestionar todos los usuarios
- Puede gestionar todos los productos

## Códigos de Estado HTTP

- **200**: OK - Operación exitosa
- **201**: Created - Recurso creado exitosamente
- **400**: Bad Request - Error de validación (email/nombre duplicado, campos inválidos)
- **403**: Forbidden - No autorizado (permisos insuficientes)
- **404**: Not Found - Recurso no encontrado
- **500**: Internal Server Error - Error del servidor

## Autenticación

- Usa JWT (JSON Web Token)
- Token se envía en header `x-token`
- Token incluye `uid` y `role` del usuario
- Duración del token: 12 horas

## Variables de Entorno (.env)
```
PORT=3000
DBCONNECTION=mongodb://...
JWT_SECRET=your-secret-key
```

## Middlewares

### validate-fields
- Valida campos requeridos
- Usa express-validator

### validate-jwt
- Verifica token válido
- Extrae uid y role

### validate-role
- Valida roles permitidos
- Roles: regular, artisan, admin

## Notas de Seguridad

1. Contraseñas:
   - Hasheadas con bcrypt
   - No se permiten en actualizaciones vía API

2. Autenticación:
   - Todos los endpoints (excepto login) requieren JWT
   - Token expira en 12 horas

3. Autorización:
   - Validación de roles en cada operación
   - Propietario o admin para updates/deletes
   - Solo admin puede crear otros admin

4. Validaciones:
   - Email único en usuarios
   - Nombre único en productos
   - Campos requeridos validados
   - Media array requiere al menos un elemento