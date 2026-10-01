# PGX · Cliente interactivo de PostgreSQL

Programa de consola con menús (flechas + Enter) para explorar y consultar PostgreSQL.

## Instalación

```bash
pnpm install
cp .env.example .env     # edita host, usuario, clave, etc.
pnpm start
```

Para usarlo como comando global `pgx` desde cualquier carpeta:

```bash
pnpm link --global
pgx
```

(En ese caso define las variables en tu shell, o deja un `.env` en la carpeta donde lo ejecutes.)

## Variables de entorno

| Variable        | Descripción                         | Por defecto |
|-----------------|-------------------------------------|-------------|
| `PGHOST`        | Servidor                            | localhost   |
| `PGPORT`        | Puerto                              | 5432        |
| `PGUSER`        | Usuario                             | postgres    |
| `PGPASSWORD`    | Clave                               | —           |
| `PGDATABASE`    | Base de datos inicial               | postgres    |
| `PGSSL`         | `true` para activar SSL             | desactivado |
| `PGX_MAX_ROWS`  | Máx. filas mostradas en un SELECT   | 500         |
| `PGX_ASCII`     | `1` para usar solo `+ - \|`         | desactivado |

## Uso

- **Listar bases de datos**: todas las bases del servidor, con propietario y tamaño.
- **Usar una base de datos (USE)**: cambia la conexión a otra base.
- **Listar tablas**: tablas y vistas de la base actual.
- **Describir una tabla**: columnas, tipo, nulos, default y clave primaria.
- **Ejecutar SQL**: consola SQL. Termina con `;` (o línea vacía). `exit` o `\q` para volver.
  - `SELECT` (y todo lo que devuelva filas) → tabla con cuadrícula.
  - `INSERT` / `UPDATE` / `DELETE` / DDL → `✔ OK`.
