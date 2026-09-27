# Agente simple de ventas

Extraído de la sección **Agente simple de ventas** de `original.ipynb`.
Incluye `sales_data.db`, descargada desde el enlace del notebook.

El repositorio es <https://github.com/juananpe/agente-ventas>. La aplicación web
y los ficheros de Docker están en la rama **`codex/web`**.

## Requisitos

- Git
- Python 3.11 o posterior (probado con 3.13)
- Docker (solo para el despliegue)
- Una clave de OpenRouter

## Puesta en marcha en tu equipo

Clona el repositorio:

```sh
git clone -b codex/web https://github.com/juananpe/agente-ventas.git
cd agente-ventas
```

Crea el entorno virtual:

```sh
python3 -m venv .venv
```

Instala las dependencias (macOS y Linux):

```sh
./.venv/bin/python -m pip install -r requirements.txt
```

En Windows (PowerShell):

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
```

Crea tu `.env` a partir de la plantilla:

```sh
cp .env.example .env
```

En Windows, `copy .env.example .env`. Rellena los dos valores:

```
OPENROUTER_API_KEY=tu_clave_de_openrouter
SERVICE_PORT=8000
```

`.env` está excluido de Git: cada persona usa su propia clave. En local,
`SERVICE_PORT` es el puerto en el que escucharás; en el servidor del aula es tu
puerto `81NN`.

### Agente de línea de comandos

macOS y Linux:

```sh
./.venv/bin/python agente_ventas.py
```

Windows:

```powershell
.venv\Scripts\python agente_ventas.py
```

También admite una pregunta única:

```sh
./.venv/bin/python agente_ventas.py --pregunta "¿Cuál es el top 5 de tiendas por ventas totales?"
```

Usa OpenRouter con el modelo `deepseek/deepseek-v4.1-flash`; puedes elegir otro
con `--modelo ID_DEL_MODELO`. El SDK descargará su runtime nativo
automáticamente en el primer arranque. La base SQLite se abre en modo de solo
lectura y se devuelven como máximo 100 filas por consulta.

### Aplicación web

macOS y Linux:

```sh
./.venv/bin/uvicorn web_app:app --host 127.0.0.1 --port 8000
```

Windows:

```powershell
.venv\Scripts\uvicorn web_app:app --host 127.0.0.1 --port 8000
```

Abre <http://127.0.0.1:8000>. La interfaz está hecha con JavaScript y CSS sin
frameworks. Cada conversación mantiene el contexto en una sesión del agente en
memoria del servidor; "Nueva conversación" la elimina. Las sesiones se pierden
al reiniciar el servidor. Se admite un máximo de 100 sesiones activas por
proceso. Para desplegar varios procesos se necesitaría un almacén de sesiones
compartido.

Con Docker (escucha en el puerto que hayas puesto en `SERVICE_PORT`):

```sh
docker compose up --build -d
```

`compose.yaml` pasa `.env` al contenedor; la imagen no contiene la clave. Para
parar: `docker compose down`.

## Despliegue en el servidor del aula (ikasten)

Cada estudiante tiene:

- una cuenta `studentNN` en `ssh.ikasten.dev`,
- un puerto de servicio `81NN` (`student01` → `8101`, `student12` → `8112`),
- el hostname `studentNN.ikasten.dev`, publicado con HTTPS.

El contenedor publica solo en `127.0.0.1:81NN` y nginx se encarga del resto, así
que no hay que abrir nada más. Sustituye `NN` por tu número y `81NN` por tu
puerto en todos los comandos.

El código no se copia desde tu equipo: se clona directamente en el servidor.

**1. Entra en el servidor** con tu clave:

```sh
ssh -i ./studentNN_ed25519 studentNN@ssh.ikasten.dev
```

**2. Clona el repositorio**:

```sh
git clone -b codex/web https://github.com/juananpe/agente-ventas.git
cd agente-ventas
```

**3. Crea el `.env`** con tu clave y tu puerto:

```sh
cp .env.example .env
nano .env
```

```
OPENROUTER_API_KEY=tu_clave_de_openrouter
SERVICE_PORT=81NN
```

**4. Levanta el servicio**:

```sh
docker compose up -d --build
```

**5. Comprueba que el contenedor está sano** antes de publicarlo:

```sh
docker ps
```

Tiene que aparecer `(healthy)` en la columna STATUS:

```
CONTAINER ID   IMAGE        COMMAND                  CREATED          STATUS                    PORTS                      NAMES
3990e1f3d35e   agente-web   "uvicorn web_app:app…"   15 minutes ago   Up 15 minutes (healthy)   127.0.0.1:8112->8000/tcp   agente-web-1
```

Si pone `(health: starting)`, espera unos segundos y repite `docker ps`. No
sigas hasta ver `(healthy)`.

**6. Publica el hostname** (una sola vez):

```sh
sudo -n register-service --hostname studentNN.ikasten.dev --port 81NN
```

La opción `-n` hace que sudo no se quede esperando una contraseña: esta cuenta
tiene permiso para ejecutar `register-service` sin ella. La primera vez se pide
un certificado a Let's Encrypt, así que tarda unos segundos. La salida termina
con:

```
Registered: https://student12.ikasten.dev -> 127.0.0.1:8112
```

Ya está: <https://studentNN.ikasten.dev>

### Actualizar el código

```sh
cd ~/agente-ventas
git pull
docker compose up -d --build
```

### Parar el servicio

```sh
docker compose down
```
