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
