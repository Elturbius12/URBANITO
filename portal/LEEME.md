# Portal ciudadano de URBANITO (estructura, aún no desplegado)

Página web donde el administrado consulta el estado de sus trámites con el usuario y la contraseña que le entrega mesa de partes.

## Cómo funciona
- `servidor.js` (Express) sirve `publico/` y una API mínima. **No abre la base de datos**: reenvía cada consulta al servidor de red de URBANITO (`/urbanito/api`, acciones públicas `portal_*`).
- URBANITO valida la sesión del ciudadano (token propio, distinto al de los trabajadores) y devuelve **solo** sus datos públicos: número, trámite, estado, fechas y departamento actual. Nunca el IUA, el trabajador asignado ni las observaciones internas.
- Credenciales: usuario = nombres + apellidos sin espacios ni tildes; contraseña inicial = iniciales de los nombres + DNI + iniciales de los apellidos. Ejemplo: JULIO FRANCISCO / CRUZ CHOQUEHUANCA, DNI 60062237 → `JULIOFRANCISCOCRUZCHOQUEHUANCA` / `JF60062237CC`.
- Como esa contraseña se deduce de datos conocidos, **el portal obliga a cambiarla en el primer ingreso** (y la nueva no puede contener el DNI). Hay bloqueo de 5 minutos tras 5 intentos fallidos por usuario y un límite de 20 intentos cada 10 minutos por IP.

## Probar en local
1. En la PC servidor, en URBANITO: Configuración › Red y equipo › **Activar conexión en red** (puerto 7301).
2. Registrar un expediente en Mesa de partes con un DNI nuevo y la casilla «crear su acceso al portal ciudadano».
3. En esta carpeta:
   ```
   npm install
   npm run iniciar          # http://localhost:7302
   ```
   Variables opcionales: `URBANITO_URL` (por defecto `http://127.0.0.1:7301`) y `PORT` (por defecto `7302`).

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/ingresar` | `{ usuario, clave }` → `{ token, nombre, debe_cambiar_clave }` |
| POST | `/api/cambiar-clave` | `{ actual, nueva }` con `Authorization: Bearer <token>` |
| GET | `/api/mis-tramites` | trámites del ciudadano autenticado |
| GET | `/api/consulta/:dni` | igual, pero solo acepta el DNI del propio ciudadano |
| POST | `/api/salir` | cierra la sesión |

## Antes de desplegarlo en internet
- Servirlo detrás de HTTPS (proxy inverso) y **no** exponer el puerto 7301 de URBANITO: el portal debe hablar con URBANITO por la red interna.
- Revisar con la Gerencia la regla de contraseña inicial (es predecible) y considerar enviarla por un canal distinto o con un código de un solo uso.
- Configurar en URBANITO (Configuración › Parámetros) la dirección pública del portal: se incluye en el mensaje de WhatsApp.
