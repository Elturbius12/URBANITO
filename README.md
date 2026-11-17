# URBANITO (aplicación web)

Servidor Node (`servidor.js`) que sirve la interfaz (build de Vite en `dist/`) y la API
(`/urbanito/api`, `/urbanito/importar`, `/urbanito/excel`, `/urbanito/respaldo`,
`/urbanito/restaurar`, `/urbanito/ping`). La base es SQLite (sql.js) en un archivo.

## Local

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

## Variables de entorno

| Variable  | Por defecto      | Uso                                                        |
|-----------|------------------|------------------------------------------------------------|
| `PORT`    | `3000`           | Puerto HTTP (Railway lo define solo).                      |
| `DB_PATH` | `./semilla/urbanito.db` | Archivo de la base. Los respaldos van a `respaldos/` junto a él. |

**No hace falta copiar la base a mano:** si el archivo de `DB_PATH` no existe, el servidor lo crea
automáticamente copiando `semilla/urbanito.db` (igual que hacía la versión de escritorio).

## Despliegue en Railway

1. Cree el servicio desde este repositorio. `railway.json` usa Nixpacks (que ejecuta
   `npm run build`) y arranca con `npm start`.
2. **Cree un Volume** y móntelo en el servicio, por ejemplo en `/data`.
3. Defina la variable **`DB_PATH=/data/urbanito.db`**.
   Sin el Volume, la base y los respaldos se pierden en cada redespliegue.
4. Use una sola réplica: la base vive en memoria del proceso y se guarda en el archivo.
