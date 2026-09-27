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
cp .env.example .env    # rellena OPENROUTER_API_KEY y SERVICE_PORT
docker compose up --build -d
```

Abre <http://127.0.0.1:8000> (o el puerto que hayas puesto en `SERVICE_PORT`).
`compose.yaml` pasa `.env` al contenedor; la imagen no contiene la clave. Para
parar: `docker compose down`.

## Despliegue en el aula (ikasten)

Cada estudiante tiene una cuenta `studentNN` en `ssh.ikasten.dev`, un puerto de
servicio `81NN` y el hostname `studentNN.ikasten.dev`. El contenedor publica
solo en `127.0.0.1:81NN` y nginx se encarga de HTTPS. Sustituye `NN` por tu
número (por ejemplo `12`).

**1. Copia el proyecto al servidor** (desde tu equipo, con tu clave):

```sh
cd /ruta/al/proyecto
COPYFILE_DISABLE=1 tar czf - --exclude='.git' --exclude='.venv' \
  --exclude='.copilot-state' --exclude='__pycache__' --exclude='.env' \
  --exclude='original.ipynb' . |
  ssh -i ./studentNN_ed25519 studentNN@ssh.ikasten.dev \
    'mkdir -p ~/agente && tar xzf - -C ~/agente'
```

`.env` se excluye a propósito: la clave se queda en tu equipo y se crea en el
servidor en el paso siguiente.

**2. Crea el `.env` en el servidor**:

```sh
ssh -i ./studentNN_ed25519 studentNN@ssh.ikasten.dev
cd ~/agente
cp .env.example .env
nano .env
```

Rellena `OPENROUTER_API_KEY` con tu clave y `SERVICE_PORT` con tu puerto `81NN`.

**3. Levanta el servicio**:

```sh
docker compose up -d --build
docker compose ps
curl -sS http://127.0.0.1:81NN/api/health    # {"status":"ok"}
```

**4. Publica el hostname** (una sola vez, pide la contraseña de sudo):

```sh
sudo register-service --hostname studentNN.ikasten.dev --port 81NN
```

Ya está: <https://studentNN.ikasten.dev>

Para actualizar el código: repite el paso 1 y luego `docker compose up -d --build`.
