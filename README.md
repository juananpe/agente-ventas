# Agente simple de ventas

Extraído de la sección **Agente simple de ventas** de `original.ipynb`.
Incluye `sales_data.db`, descargada desde el enlace del notebook.

## Ejecutar

Requiere Python 3.11 o posterior. El entorno virtual ya está instalado en
`/tmp/agente/.venv` en este equipo.

```sh
cd /tmp/agente
./.venv/bin/python agente_ventas.py
```

También admite una pregunta única:

```sh
./.venv/bin/python agente_ventas.py --pregunta "¿Cuál es el top 5 de tiendas por ventas totales?"
```

Usa OpenRouter con el modelo `deepseek/deepseek-v4.1-flash`. La clave está en
`.env`, con permisos de lectura solo para tu usuario; ese archivo está excluido
de Git. En otra instalación, copia `.env.example` a `.env` y sustituye el valor
de `OPENROUTER_API_KEY`. También acepta la variable de entorno si está definida.
El agente carga `.env` al arrancar y no depende del llavero ni de macOS.
Puedes elegir otro modelo con `--modelo ID_DEL_MODELO`.

Para reconstruir el entorno:

```sh
python3.13 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
```

El SDK descargará su runtime nativo automáticamente en el primer arranque.
La base SQLite se abre en modo de solo lectura y se devuelven como máximo
100 filas por consulta.

## Aplicación web

Arranque local (usa el mismo `.env` y la misma base de datos):

```sh
cd /tmp/agente
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/uvicorn web_app:app --host 127.0.0.1 --port 8000
```

Abre <http://127.0.0.1:8000>. La interfaz está hecha con JavaScript y CSS sin
frameworks. Cada conversación mantiene el contexto en una sesión del agente
en memoria del servidor; "Nueva conversación" la elimina. Las sesiones se
pierden al reiniciar el servidor. Se admite un máximo de 100 sesiones activas
por proceso. Para desplegar varios procesos se necesitaría un almacén de
sesiones compartido.

Con Docker:

```sh
docker compose up --build -d
```

Abre <http://127.0.0.1:8000>. `compose.yaml` pasa `.env` al contenedor; la
imagen no contiene la clave. Para parar: `docker compose down`.
