

from sqlalchemy.orm import declarative_base

# Base déclarative commune à tous les modèles SQLAlchemy du projet.
Base = declarative_base()

from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Float, Date, DateTime, Enum, JSON, Boolean
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime, date
import os

# L'URL de connexion est lue depuis l'environnement pour rester compatible
# avec Docker, le local et les pipelines CI/CD.
DATABASE_URL = os.getenv("DATABASE_URL")

# Le moteur ouvre les connexions et la session factory est utilisée par FastAPI.
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class AssetType(Base):
    # Table de référence contenant les catégories d'équipements disponibles.
    __tablename__ = "asset_types"
    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False, unique=True)

    assets = relationship("Asset", back_populates="asset_type")


class Location(Base):
    # Un lieu correspond à un emplacement physique dans lequel un matériel peut être affecté.
    __tablename__ = "locations"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    building = Column(String, nullable=True)
    floor = Column(String, nullable=True)
    office = Column(String, nullable=True)

    assets = relationship("Asset", back_populates="location")


class User(Base):
    # Un utilisateur représente le propriétaire ou le détenteur d'un équipement.
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    firstname = Column(String, nullable=True)
    email = Column(String, unique=True, nullable=False, index=True)


    assets = relationship("Asset", back_populates="owner")
    incidents = relationship("Incident", back_populates="reporter")


class Asset(Base):
    # La table principale du parc : chaque ligne décrit un actif informatique.
    __tablename__ = "assets"
    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, unique=True, index=True, nullable=False)
    model = Column(String, nullable=False)
    status = Column(
        Enum("En service", "En maintenance", "Stock", name="status_enum"),
        nullable=False
    )
    # description est utilisée pour les équipements partagés (serveur, écran, imprimante, switch, routeur).
    description = Column(String, nullable=True)
    type_id = Column(Integer, ForeignKey("asset_types.id"), index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), index=True)
    purchase_date = Column(Date)
    warranty_expiry = Column(Date)
    price = Column(Float, default=0.0)
    software_json = Column(JSON, nullable=True)
    asset_type = relationship("AssetType", back_populates="assets")
    owner = relationship("User", back_populates="assets")
    location = relationship("Location", back_populates="assets")
    maintenance_logs = relationship(
        "MaintenanceLog",
        back_populates="asset",
        cascade="all, delete-orphan"
    )
    incidents = relationship(
        "Incident",
        back_populates="asset",
        cascade="all, delete-orphan"
    )


class MaintenanceLog(Base):
    # Historique des interventions réalisées sur un équipement donné.
    __tablename__ = "maintenance_logs"
    id = Column(Integer, primary_key=True, index=True)

    asset_id = Column(Integer, ForeignKey("assets.id"), index=True)

    maintenance_date = Column(Date, default=date.today)
    description = Column(String, nullable=False)
    cost = Column(Float, default=0.0)
    performed_by = Column(String)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    asset = relationship("Asset", back_populates="maintenance_logs")


class Incident(Base):
    # Incident métier lié à un équipement, avec suivi d'état et priorité.
    __tablename__ = "incidents"
    id = Column(Integer, primary_key=True, index=True)

    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    status = Column(
        Enum("Ouvert", "En cours", "Résolu", name="incident_status_enum"),
        nullable=False,
        default="Ouvert"
    )
    priority = Column(
        Enum("Basse", "Moyenne", "Haute", "Critique", name="incident_priority_enum"),
        nullable=False,
        default="Moyenne"
    )

    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True, index=True)
    reported_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    asset = relationship("Asset", back_populates="incidents")
    reporter = relationship("User", back_populates="incidents")


class ITProject(Base):
    # Pilotage des projets IT avec etat, description et documentation centralisee.
    __tablename__ = "it_projects"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="A faire", index=True)
    description = Column(String, nullable=False)
    documentation = Column(String, nullable=True)
    owner = Column(String, nullable=True)
    due_date = Column(Date, nullable=True)
    # Liste d'etapes du projet: [{label, start_date, end_date}].
    steps_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AdConfig(Base):
    # Configuration de connexion Active Directory (paramètres administrables via l'IHM).
    __tablename__ = "ad_config"

    id = Column(Integer, primary_key=True, default=1)
    server = Column(String, nullable=True)
    port = Column(Integer, nullable=False, default=636)
    use_ssl = Column(Boolean, nullable=False, default=True)
    bind_user = Column(String, nullable=True)
    bind_password = Column(String, nullable=True)
    base_dn = Column(String, nullable=True)
    users_dn = Column(String, nullable=True)
    computers_dn = Column(String, nullable=True)
    user_filter = Column(String, nullable=True)
    computer_filter = Column(String, nullable=True)
    auto_sync_enabled = Column(Boolean, nullable=False, default=False)
    sync_interval_minutes = Column(Integer, nullable=False, default=60)
    last_auto_sync_at = Column(DateTime, nullable=True)
    last_sync_users_at = Column(DateTime, nullable=True)
    last_sync_computers_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String, nullable=True)
    last_sync_message = Column(String, nullable=True)


class SecurityFinding(Base):
    # Vulnérabilité ou faiblesse détectée sur un poste, serveur ou segment LAN.
    __tablename__ = "security_findings"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    severity = Column(
        Enum("Faible", "Moyenne", "Élevée", "Critique", name="security_severity_enum"),
        nullable=False,
        default="Moyenne"
    )
    status = Column(
        Enum("Ouverte", "En cours", "Corrigée", name="security_status_enum"),
        nullable=False,
        default="Ouverte"
    )
    target_type = Column(
        Enum("LAN", "Serveur", "Poste client", name="security_target_type_enum"),
        nullable=False,
        default="Poste client"
    )
    target_name = Column(String, nullable=False)
    cve = Column(String, nullable=True)
    source = Column(String, nullable=True)
    recommendation = Column(String, nullable=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    asset = relationship("Asset")


class EndpointSecurityPosture(Base):
    # Instantané de posture de sécurité d'un poste/serveur collecté de façon défensive.
    __tablename__ = "endpoint_security_posture"

    id = Column(Integer, primary_key=True, index=True)
    hostname = Column(String, nullable=False, index=True)
    serial_number = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True, index=True)
    source = Column(String, nullable=False, default="local_agent")
    os = Column(String, nullable=True)
    firewall_enabled = Column(Boolean, nullable=False, default=False)
    defender_enabled = Column(Boolean, nullable=False, default=False)
    realtime_protection_enabled = Column(Boolean, nullable=False, default=False)
    bitlocker_enabled = Column(Boolean, nullable=False, default=False)
    pending_reboot = Column(Boolean, nullable=False, default=False)
    first_seen = Column(DateTime, default=datetime.utcnow)
    last_seen = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True, index=True)

    asset = relationship("Asset")


class SecurityPolicyConfig(Base):
    # Configuration des règles automatiques de sécurité (seuils et sévérités).
    __tablename__ = "security_policy_config"

    id = Column(Integer, primary_key=True, default=1)
    stale_endpoint_hours = Column(Integer, nullable=False, default=72)
    unmanaged_lan_severity = Column(
        Enum("Faible", "Moyenne", "Élevée", "Critique", name="security_policy_severity_enum"),
        nullable=False,
        default="Moyenne"
    )
    stale_endpoint_severity = Column(
        Enum("Faible", "Moyenne", "Élevée", "Critique", name="security_policy_stale_severity_enum"),
        nullable=False,
        default="Moyenne"
    )
    endpoint_offline_after_minutes = Column(Integer, nullable=False, default=5)
    endpoint_offline_grace_cycles = Column(Integer, nullable=False, default=2)


class NetworkTelemetry(Base):
    # Dernier état réseau observé par appareil: ports ouverts et logs de sonde.
    __tablename__ = "network_telemetry"

    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, nullable=False, index=True, unique=True)
    hostname = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True, index=True)
    source = Column(String, nullable=False, default="lan_probe")
    open_ports_json = Column(JSON, nullable=True)
    logs_json = Column(JSON, nullable=True)
    last_seen = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True, index=True)

    asset = relationship("Asset")


class EndpointResourceMetric(Base):
    # Dernier snapshot de performance (CPU/RAM/stockage) par équipement.
    __tablename__ = "endpoint_resource_metrics"

    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, nullable=False, index=True)
    hostname = Column(String, nullable=False, index=True)
    source = Column(String, nullable=False, default="local_agent")
    cpu_percent = Column(Float, nullable=True)
    ram_total_gb = Column(Float, nullable=True)
    ram_used_gb = Column(Float, nullable=True)
    disk_total_gb = Column(Float, nullable=True)
    disk_used_gb = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    last_seen = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=True, index=True)

    asset = relationship("Asset")


class AgentIngestLog(Base):
    # Historique brut des ingestions d'agents (mode dual-run: ps1 + go).
    __tablename__ = "agent_ingest_logs"

    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, nullable=False, index=True)
    metric_type = Column(String, nullable=False, index=True)
    source = Column(String, nullable=True, index=True)
    agent_source = Column(String, nullable=True, index=True)
    agent_version = Column(String, nullable=True)
    agent_id = Column(String, nullable=True, index=True)
    payload_json = Column(JSON, nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow, index=True)


class SiemEvent(Base):
    # Journal normalisé des événements de sécurité et de télémétrie.
    __tablename__ = "siem_events"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    source = Column(String, nullable=False, default="local_agent", index=True)
    event_type = Column(String, nullable=False, index=True)
    severity = Column(String, nullable=False, default="info", index=True)
    host_serial = Column(String, nullable=True, index=True)
    host_name = Column(String, nullable=True, index=True)
    host_ip = Column(String, nullable=True, index=True)
    user_name = Column(String, nullable=True, index=True)
    outcome = Column(String, nullable=True, index=True)
    message = Column(String, nullable=True)
    payload_json = Column(JSON, nullable=True)


class SiemAlert(Base):
    # Alerte opérationnelle générée par règles internes (mini-SIEM).
    __tablename__ = "siem_alerts"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    rule_id = Column(String, nullable=False, index=True)
    fingerprint = Column(String, nullable=False, unique=True, index=True)
    severity = Column(String, nullable=False, default="Moyenne", index=True)
    status = Column(
        Enum("Nouvelle", "En cours", "Résolue", "Faux positif", name="siem_alert_status_enum"),
        nullable=False,
        default="Nouvelle",
        index=True,
    )
    host_serial = Column(String, nullable=True, index=True)
    host_name = Column(String, nullable=True, index=True)
    title = Column(String, nullable=False)
    description = Column(String, nullable=False)
    evidence_json = Column(JSON, nullable=True)


class SecurityJob(Base):
    # File de jobs défensifs asynchrones pour les contrôles de sécurité autorisés.
    __tablename__ = "security_jobs"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    started_at = Column(DateTime, nullable=True, index=True)
    completed_at = Column(DateTime, nullable=True, index=True)
    job_type = Column(String, nullable=False, index=True)
    status = Column(
        Enum("queued", "running", "completed", "failed", "cancelled", name="security_job_status_enum"),
        nullable=False,
        default="queued",
        index=True,
    )
    cancel_requested = Column(Boolean, nullable=False, default=False, index=True)
    requested_by = Column(String, nullable=True, index=True)
    target_scope = Column(String, nullable=True, index=True)
    parameters_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    logs_json = Column(JSON, nullable=True)
    error_message = Column(String, nullable=True)