from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

# Objet de configuration Alembic, alimenté à partir du fichier alembic.ini.
config = context.config

# Active la configuration de logs standard d'Alembic si un fichier est présent.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Ce metadata sert à l'autogénération des migrations. Il est encore à raccorder
# aux modèles SQLAlchemy du projet.
target_metadata = None

def run_migrations_offline() -> None:
    """Exécute les migrations sans ouvrir de connexion directe à la base."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Exécute les migrations avec une vraie connexion SQLAlchemy."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # La connexion ouverte est injectée dans le contexte Alembic courant.
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
