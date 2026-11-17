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
| `DB_PATH` | `./urbanito.db`  | Archivo de la base. Los respaldos van a `respaldos/` junto a él. |

Si el archivo no existe, se crea copiando `semilla/urbanito.db`.

## Despliegue en Railway

1. Cree el servicio desde este repositorio. `railway.json` ya indica
   build `npm run build` y arranque `npm start` (healthcheck en `/urbanito/ping`).
2. **Cree un Volume** y móntelo en el servicio, por ejemplo en `/data`.
3. Defina la variable **`DB_PATH=/data/urbanito.db`**.
   Sin el Volume, la base y los respaldos se pierden en cada redespliegue.
4. Use una sola réplica: la base vive en memoria del proceso y se guarda en el archivo.
