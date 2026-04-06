from fastapi import FastAPI, Depends, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Optional
import json
from datetime import date, datetime, timedelta
import os
import re
import threading
from urllib.parse import urlencode
from urllib.request import urlopen, Request as UrlRequest
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, inspect, text
from sqlalchemy.exc import IntegrityError
from db_models import Base, engine, SessionLocal, User, Location, Asset, AssetType, MaintenanceLog, Incident, ITProject, AdConfig, SecurityFinding, EndpointSecurityPosture, SecurityPolicyConfig, EndpointResourceMetric, NetworkTelemetry, AgentIngestLog, SiemEvent, SiemAlert
from ldap3 import Server, Connection, ALL, SUBTREE, NTLM, SIMPLE

# API FastAPI principale du projet. Elle expose les routes utilisées par le frontend
# pour lire et modifier le parc informatique.
app = FastAPI()

# Configuration CORS minimale pour autoriser l'application React locale à appeler l'API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # ⚠️ change en prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_AD_AUTO_SYNC_STOP = threading.Event()
_AD_AUTO_SYNC_THREAD: Optional[threading.Thread] = None
_ENDPOINT_STATUS_STOP = threading.Event()
_ENDPOINT_STATUS_THREAD: Optional[threading.Thread] = None


def seed_database():
    # Préremplit la base avec quelques données pour rendre l'application testable
    # dès le premier lancement en environnement local.
    db = SessionLocal()
    try:
        default_types = [
            "Ordinateur portable",
            "Imprimante",
            "Serveur",
            "Switch",
            "Écran",
            "Ordinateur fixe",
        ]

        existing_labels = {item.label for item in db.query(AssetType).all()}
        for label in default_types:
            if label not in existing_labels:
                db.add(AssetType(label=label))

        if not db.query(Location).first():
            db.add_all([
                Location(name="Salle Serveurs", building="Bâtiment A", floor="RDC", office="SRV"),
                Location(name="Bureau IT", building="Bâtiment B", floor="1", office="101"),
            ])

        if not db.query(User).first():
            db.add_all([
                User(name="Dupont", firstname="Alice", email="alice.dupont@example.com"),
                User(name="Martin", firstname="Bob", email="bob.martin@example.com"),
            ])

        db.commit()

        if not db.query(Asset).first():
            laptop_type = db.query(AssetType).filter(AssetType.label == "Ordinateur portable").first()
            printer_type = db.query(AssetType).filter(AssetType.label == "Imprimante").first()
            first_user = db.query(User).filter(User.email == "alice.dupont@example.com").first()
            second_user = db.query(User).filter(User.email == "bob.martin@example.com").first()
            first_location = db.query(Location).filter(Location.name == "Salle Serveurs").first()
            second_location = db.query(Location).filter(Location.name == "Bureau IT").first()

            demo_assets = [
                Asset(
                    serial_number="SN12345",
                    model="Dell Latitude 5510",
                    status="En service",
                    type_id=laptop_type.id if laptop_type else None,
                    owner_id=first_user.id if first_user else None,
                    location_id=first_location.id if first_location else None,
                    purchase_date=date(2024, 1, 15),
                    warranty_expiry=date(2027, 1, 15),
                    price=1299.99,
                ),
                Asset(
                    serial_number="SN67890",
                    model="HP LaserJet Pro",
                    status="En maintenance",
                    type_id=printer_type.id if printer_type else None,
                    owner_id=second_user.id if second_user else None,
                    location_id=second_location.id if second_location else None,
                    purchase_date=date(2023, 6, 10),
                    warranty_expiry=date(2026, 6, 10),
                    price=499.0,
                ),
            ]
            db.add_all(demo_assets)
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def startup_event():
    # Crée les tables manquantes puis injecte des données de démonstration.
    Base.metadata.create_all(bind=engine)
    # Migration sécurisée : ajoute la colonne description si elle n'existe pas encore.
    inspector = inspect(engine)
    existing_cols = [c["name"] for c in inspector.get_columns("assets")]
    if "description" not in existing_cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE assets ADD COLUMN description VARCHAR"))
            conn.commit()

    # Migration sécurisée : enrichit endpoint_security_posture pour la détection immédiate.
    posture_cols = [c["name"] for c in inspector.get_columns("endpoint_security_posture")]
    with engine.connect() as conn:
        if "ip_address" not in posture_cols:
            conn.execute(text("ALTER TABLE endpoint_security_posture ADD COLUMN ip_address VARCHAR"))
        if "source" not in posture_cols:
            conn.execute(text("ALTER TABLE endpoint_security_posture ADD COLUMN source VARCHAR DEFAULT 'local_agent'"))
        if "first_seen" not in posture_cols:
            conn.execute(text("ALTER TABLE endpoint_security_posture ADD COLUMN first_seen TIMESTAMP"))
            conn.execute(text("UPDATE endpoint_security_posture SET first_seen = COALESCE(last_seen, CURRENT_TIMESTAMP)"))
        conn.commit()

    ad_config_cols = [c["name"] for c in inspector.get_columns("ad_config")]
    with engine.connect() as conn:
        if "auto_sync_enabled" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN auto_sync_enabled BOOLEAN DEFAULT FALSE"))
        if "sync_interval_minutes" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN sync_interval_minutes INTEGER DEFAULT 60"))
        if "last_auto_sync_at" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN last_auto_sync_at TIMESTAMP"))
        if "last_sync_users_at" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN last_sync_users_at TIMESTAMP"))
        if "last_sync_computers_at" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN last_sync_computers_at TIMESTAMP"))
        if "last_sync_status" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN last_sync_status VARCHAR"))
        if "last_sync_message" not in ad_config_cols:
            conn.execute(text("ALTER TABLE ad_config ADD COLUMN last_sync_message VARCHAR"))
        conn.commit()

    it_project_cols = [c["name"] for c in inspector.get_columns("it_projects")]
    with engine.connect() as conn:
        if "steps_json" not in it_project_cols:
            conn.execute(text("ALTER TABLE it_projects ADD COLUMN steps_json JSON"))
        conn.commit()

    security_policy_cols = [c["name"] for c in inspector.get_columns("security_policy_config")]
    with engine.connect() as conn:
        if "endpoint_offline_after_minutes" not in security_policy_cols:
            conn.execute(text("ALTER TABLE security_policy_config ADD COLUMN endpoint_offline_after_minutes INTEGER DEFAULT 5"))
        if "endpoint_offline_grace_cycles" not in security_policy_cols:
            conn.execute(text("ALTER TABLE security_policy_config ADD COLUMN endpoint_offline_grace_cycles INTEGER DEFAULT 2"))
        conn.commit()

    seed_database()
    _ensure_ad_config_defaults()
    _start_ad_auto_sync_worker()
    _start_endpoint_status_worker()


@app.on_event("shutdown")
def shutdown_event():
    _AD_AUTO_SYNC_STOP.set()
    _ENDPOINT_STATUS_STOP.set()

def get_db():
    # Dépendance FastAPI : ouvre une session SQLAlchemy pour la requête courante
    # puis la ferme systématiquement à la fin du traitement.
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Schémas Pydantic décrivant les données attendues et renvoyées pour les utilisateurs.
class UserBase(BaseModel):
    name: str
    firstname: Optional[str] = None
    email: str

class UserCreate(UserBase):
    pass

class UserResponse(UserBase):
    id: int
    class Config:
        from_attributes = True

# Schémas Pydantic décrivant les lieux physiques du parc.
class LocationBase(BaseModel):
    name: str
    building: Optional[str] = None
    floor: Optional[str] = None
    office: Optional[str] = None

class LocationCreate(LocationBase):
    pass

class LocationResponse(LocationBase):
    id: int
    class Config:
        from_attributes = True


@app.get("/users", response_model=List[UserResponse])
def get_users(db: Session = Depends(get_db)):
    # Retourne la liste brute de tous les utilisateurs enregistrés.
    return db.query(User).all()

@app.post("/users", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    # Crée un utilisateur puis renvoie la ressource persistée avec son identifiant.
    db_user = User(name=user.name, firstname=user.firstname, email=user.email)
    db.add(db_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Un utilisateur avec cet email existe déjà")
    db.refresh(db_user)
    return db_user


@app.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, user: UserCreate, db: Session = Depends(get_db)):
    # Met à jour les informations d'un utilisateur existant.
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    db_user.name = user.name
    db_user.firstname = user.firstname
    db_user.email = user.email
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Un utilisateur avec cet email existe déjà")
    db.refresh(db_user)
    return db_user


@app.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    # Supprime un utilisateur après avoir désassigné ses équipements.
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    # Évite une contrainte FK en retirant l'affectation propriétaire avant suppression.
    db.query(Asset).filter(Asset.owner_id == user_id).update({Asset.owner_id: None})
    db.delete(db_user)
    db.commit()
    return {"success": True}

@app.get("/locations", response_model=List[LocationResponse])
def get_locations(db: Session = Depends(get_db)):
    # Expose tous les lieux pour alimenter les listes de sélection du frontend.
    return db.query(Location).all()

@app.post("/locations", response_model=LocationResponse)
def create_location(location: LocationCreate, db: Session = Depends(get_db)):
    # Crée un nouveau lieu physique à partir du formulaire frontend.
    db_loc = Location(
        name=location.name,
        building=location.building,
        floor=location.floor,
        office=location.office
    )
    db.add(db_loc)
    db.commit()
    db.refresh(db_loc)
    return db_loc


@app.put("/locations/{location_id}", response_model=LocationResponse)
def update_location(location_id: int, location: LocationCreate, db: Session = Depends(get_db)):
    # Met à jour les informations d'un lieu existant.
    db_loc = db.query(Location).filter(Location.id == location_id).first()
    if not db_loc:
        raise HTTPException(status_code=404, detail="Lieu non trouvé")

    db_loc.name = location.name
    db_loc.building = location.building
    db_loc.floor = location.floor
    db_loc.office = location.office
    db.commit()
    db.refresh(db_loc)
    return db_loc


@app.delete("/locations/{location_id}")
def delete_location(location_id: int, db: Session = Depends(get_db)):
    # Supprime un lieu après avoir retiré son affectation sur les équipements.
    db_loc = db.query(Location).filter(Location.id == location_id).first()
    if not db_loc:
        raise HTTPException(status_code=404, detail="Lieu non trouvé")

    db.query(Asset).filter(Asset.location_id == location_id).update({Asset.location_id: None})
    db.delete(db_loc)
    db.commit()
    return {"success": True}


# Schéma de sortie enrichi pour les équipements, avec noms déjà résolus pour l'IHM.
class AssetResponse(BaseModel):
    id: int
    serial_number: str
    model: str
    status: str
    type_label: str
    owner_name: str
    price: float
    location_id: Optional[int] = None
    owner_id: Optional[int] = None
    purchase_date: Optional[date] = None
    warranty_expiry: Optional[date] = None
    description: Optional[str] = None
    power_status: str
    last_activity_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# Schéma d'entrée utilisé lors de la création ou modification d'un équipement.
class AssetCreate(BaseModel):
    serial_number: str
    model: str
    status: str
    type_id: int
    owner_id: Optional[int] = None
    location_id: Optional[int] = None
    purchase_date: Optional[date] = None
    warranty_expiry: Optional[date] = None
    price: Optional[float] = 0.0
    # description est utilisée pour les équipements partagés sans propriétaire dédié.
    description: Optional[str] = None

# Données minimales nécessaires pour tracer une opération de maintenance.
class MaintenanceLogCreate(BaseModel):
    description: str
    cost: float = 0
    performed_by: Optional[str] = None


class IncidentBase(BaseModel):
    title: str
    description: str
    status: str = "Ouvert"
    priority: str = "Moyenne"
    asset_id: Optional[int] = None
    reported_by_user_id: Optional[int] = None


class IncidentCreate(IncidentBase):
    pass


class IncidentResponse(IncidentBase):
    id: int
    created_at: datetime
    resolved_at: Optional[datetime] = None
    asset_label: Optional[str] = None
    reporter_name: Optional[str] = None

    class Config:
        from_attributes = True


class ITProjectBase(BaseModel):
    class ProjectStep(BaseModel):
        label: str
        start_date: date
        end_date: date

    title: str
    status: str = "A faire"
    description: str
    documentation: Optional[str] = None
    owner: Optional[str] = None
    due_date: Optional[date] = None
    steps: List[ProjectStep] = []


class ITProjectCreate(ITProjectBase):
    pass


class ITProjectResponse(ITProjectBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ScannedSoftware(BaseModel):
    name: str
    version: Optional[str] = None
    publisher: Optional[str] = None
    install_date: Optional[str] = None
    license_key: Optional[str] = None


class AssetScanPayload(BaseModel):
    hostname: str
    os: str
    os_version: Optional[str] = None
    ip: Optional[str] = None
    serial_number: str
    model: Optional[str] = None
    mac: Optional[str] = None
    software: List[ScannedSoftware] = []

# Format générique utilisé pour les statistiques consommées par le graphique circulaire.
class StatsResponse(BaseModel):
    name: str
    value: int


class SoftwareInventoryItem(BaseModel):
    name: str
    version: Optional[str] = None
    publisher: Optional[str] = None
    install_date: Optional[str] = None
    license_key: Optional[str] = None
    collection_status: Optional[str] = "detected"
    asset_id: int
    asset_serial_number: str
    asset_model: str


class CveWatchItem(BaseModel):
    cve_id: str
    description: str
    published: Optional[str] = None
    last_modified: Optional[str] = None
    score: Optional[float] = None
    severity: Optional[str] = None
    matched_software: List[str] = []
    source_url: str


class CveWatchResponse(BaseModel):
    generated_at: str
    source: str
    total_recent_cves: int
    matched_count: int
    items: List[CveWatchItem]


class SecurityFindingCreate(BaseModel):
    title: str
    description: str
    severity: str = "Moyenne"
    status: str = "Ouverte"
    target_type: str = "Poste client"
    target_name: str
    cve: Optional[str] = None
    source: Optional[str] = None
    recommendation: Optional[str] = None
    asset_id: Optional[int] = None


class SecurityFindingResponse(SecurityFindingCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EndpointSecurityPosturePayload(BaseModel):
    hostname: str
    serial_number: str
    ip_address: Optional[str] = None
    source: Optional[str] = "local_agent"
    agent_source: Optional[str] = None
    agent_version: Optional[str] = None
    agent_id: Optional[str] = None
    os: Optional[str] = None
    firewall_enabled: bool = False
    defender_enabled: bool = False
    realtime_protection_enabled: bool = False
    bitlocker_enabled: bool = False
    pending_reboot: bool = False


class EndpointSecurityPostureResponse(EndpointSecurityPosturePayload):
    id: int
    first_seen: Optional[datetime] = None
    last_seen: datetime
    asset_id: Optional[int] = None

    class Config:
        from_attributes = True


class SecuritySummaryResponse(BaseModel):
    total_findings: int
    critical_findings: int
    open_findings: int
    monitored_endpoints: int


class UnknownDeviceResponse(BaseModel):
    hostname: str
    serial_number: str
    ip_address: Optional[str] = None
    source: Optional[str] = None
    first_seen: Optional[datetime] = None
    last_seen: datetime


class ResourceMetricPayload(BaseModel):
    serial_number: str
    hostname: str
    source: Optional[str] = "local_agent"
    agent_source: Optional[str] = None
    agent_version: Optional[str] = None
    agent_id: Optional[str] = None
    cpu_percent: Optional[float] = None
    ram_total_gb: Optional[float] = None
    ram_used_gb: Optional[float] = None
    disk_total_gb: Optional[float] = None
    disk_used_gb: Optional[float] = None


class ResourceMetricResponse(ResourceMetricPayload):
    id: int
    asset_id: Optional[int] = None
    last_seen: datetime

    class Config:
        from_attributes = True


class ResourceOverviewItem(BaseModel):
    serial_number: str
    hostname: str
    model: Optional[str] = None
    source: str
    status: str
    cpu_percent: Optional[float] = None
    ram_total_gb: Optional[float] = None
    ram_used_gb: Optional[float] = None
    disk_total_gb: Optional[float] = None
    disk_used_gb: Optional[float] = None
    last_seen: Optional[datetime] = None


class ResourceOverviewResponse(BaseModel):
    generated_at: str
    total_devices: int
    reporting_devices: int
    pending_devices: int
    items: List[ResourceOverviewItem]


class NetworkHostTelemetryPayload(BaseModel):
    serial_number: str
    hostname: str
    ip_address: Optional[str] = None
    source: Optional[str] = "lan_probe"
    agent_source: Optional[str] = None
    agent_version: Optional[str] = None
    agent_id: Optional[str] = None
    open_ports: List[int] = []
    logs: List[str] = []


class NetworkTelemetryIngestPayload(BaseModel):
    hosts: List[NetworkHostTelemetryPayload] = []


class NetworkTelemetryItemResponse(BaseModel):
    serial_number: str
    hostname: str
    ip_address: Optional[str] = None
    source: str
    status: str = "reporting"
    open_ports: List[int] = []
    logs: List[str] = []
    asset_id: Optional[int] = None
    last_seen: Optional[datetime] = None


class NetworkTelemetryOverviewResponse(BaseModel):
    generated_at: str
    total_hosts: int
    hosts_with_open_ports: int
    items: List[NetworkTelemetryItemResponse]


class DualRunComparisonItem(BaseModel):
    metric_type: str
    ps1_received_at: Optional[datetime] = None
    go_received_at: Optional[datetime] = None
    winner: Optional[str] = None
    compared_fields: int
    mismatched_fields: int
    mismatch_keys: List[str] = []


class DualRunComparisonResponse(BaseModel):
    serial_number: str
    generated_at: str
    items: List[DualRunComparisonItem]


class DualRunHealthItem(BaseModel):
    serial_number: str
    last_ps1: Optional[datetime] = None
    last_go: Optional[datetime] = None
    active_source: Optional[str] = None
    ps1_recent: bool = False
    go_recent: bool = False


class DualRunHealthResponse(BaseModel):
    generated_at: str
    active_window_minutes: int
    total_hosts: int
    both_active: int
    ps1_only: int
    go_only: int
    none_recent: int
    items: List[DualRunHealthItem]


_DUAL_RUN_SOURCE_PRIORITY = {
    "ad_sync": 0,
    "inventory": 0,
    "local_agent": 1,
    "lan_probe": 1,
    "ps1": 2,
    "go": 3,
}


def _normalize_agent_source(source: Optional[str], agent_source: Optional[str]) -> str:
    candidate = (agent_source or source or "").strip().lower()
    if "go" in candidate:
        return "go"
    if "ps1" in candidate or "powershell" in candidate:
        return "ps1"
    if candidate in _DUAL_RUN_SOURCE_PRIORITY:
        return candidate
    if candidate:
        return candidate
    return "local_agent"


def _should_replace_consolidated(current_source: Optional[str], incoming_source: Optional[str]) -> bool:
    current_priority = _DUAL_RUN_SOURCE_PRIORITY.get((current_source or "").lower(), 1)
    incoming_priority = _DUAL_RUN_SOURCE_PRIORITY.get((incoming_source or "").lower(), 1)
    return incoming_priority >= current_priority


def _log_agent_ingest(
    db: Session,
    *,
    serial_number: str,
    metric_type: str,
    source: Optional[str],
    agent_source: Optional[str],
    agent_version: Optional[str],
    agent_id: Optional[str],
    payload_json: Dict,
):
    db.add(AgentIngestLog(
        serial_number=serial_number,
        metric_type=metric_type,
        source=source,
        agent_source=agent_source,
        agent_version=agent_version,
        agent_id=agent_id,
        payload_json=payload_json,
    ))


def _dual_run_winner(ps1_ts: Optional[datetime], go_ts: Optional[datetime]) -> Optional[str]:
    if ps1_ts and go_ts:
        return "go" if go_ts >= ps1_ts else "ps1"
    if go_ts:
        return "go"
    if ps1_ts:
        return "ps1"
    return None


class SecurityPolicyResponse(BaseModel):
    stale_endpoint_hours: int
    unmanaged_lan_severity: str
    stale_endpoint_severity: str
    endpoint_offline_after_minutes: int
    endpoint_offline_grace_cycles: int


class SecurityPolicyUpdate(BaseModel):
    stale_endpoint_hours: int
    unmanaged_lan_severity: str
    stale_endpoint_severity: str
    endpoint_offline_after_minutes: Optional[int] = None
    endpoint_offline_grace_cycles: Optional[int] = None


class AdSyncResult(BaseModel):
    success: bool
    created: int
    updated: int
    skipped: int
    message: str


class AdConfigPayload(BaseModel):
    server: Optional[str] = None
    port: int = 636
    use_ssl: bool = True
    bind_user: Optional[str] = None
    bind_password: Optional[str] = None
    base_dn: Optional[str] = None
    users_dn: Optional[str] = None
    computers_dn: Optional[str] = None
    user_filter: Optional[str] = "(&(objectCategory=person)(objectClass=user))"
    computer_filter: Optional[str] = "(&(objectCategory=computer)(objectClass=computer))"
    auto_sync_enabled: Optional[bool] = None
    sync_interval_minutes: Optional[int] = None


class AdConfigResponse(BaseModel):
    server: str
    port: int
    use_ssl: bool
    bind_user: str
    base_dn: str
    users_dn: str
    computers_dn: str
    user_filter: str
    computer_filter: str
    auto_sync_enabled: bool
    sync_interval_minutes: int
    last_auto_sync_at: Optional[datetime] = None
    last_sync_users_at: Optional[datetime] = None
    last_sync_computers_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    last_sync_message: Optional[str] = None
    has_password: bool


class SiemEventResponse(BaseModel):
    id: int
    timestamp: datetime
    source: str
    event_type: str
    severity: str
    host_serial: Optional[str] = None
    host_name: Optional[str] = None
    host_ip: Optional[str] = None
    user_name: Optional[str] = None
    outcome: Optional[str] = None
    message: Optional[str] = None
    payload_json: Optional[Dict] = None

    class Config:
        from_attributes = True


class SiemAlertResponse(BaseModel):
    id: int
    created_at: datetime
    updated_at: datetime
    rule_id: str
    fingerprint: str
    severity: str
    status: str
    host_serial: Optional[str] = None
    host_name: Optional[str] = None
    title: str
    description: str
    evidence_json: Optional[Dict] = None

    class Config:
        from_attributes = True


class SiemAlertUpdate(BaseModel):
    status: str


class SiemTimelineItem(BaseModel):
    timestamp: datetime
    item_type: str
    severity: str
    title: str
    description: str
    source: Optional[str] = None
    status: Optional[str] = None
    event_type: Optional[str] = None
    rule_id: Optional[str] = None
    data: Optional[Dict] = None


class SiemTimelineResponse(BaseModel):
    host_serial: str
    generated_at: str
    total_items: int
    items: List[SiemTimelineItem]


class AuthEventItem(BaseModel):
    record_id: Optional[int] = None
    event_id: int
    timestamp: Optional[datetime] = None
    user_name: Optional[str] = None
    domain: Optional[str] = None
    source_ip: Optional[str] = None
    logon_type: Optional[str] = None
    outcome: Optional[str] = None
    message: Optional[str] = None


class AuthEventsIngestPayload(BaseModel):
    host_serial: str
    host_name: str
    host_ip: Optional[str] = None
    source: Optional[str] = "local_agent"
    events: List[AuthEventItem] = []


class DownloadEventItem(BaseModel):
    path: str
    file_name: str
    size_bytes: Optional[int] = None
    modified_at: Optional[datetime] = None
    user_name: Optional[str] = None


class DownloadEventsIngestPayload(BaseModel):
    host_serial: str
    host_name: str
    host_ip: Optional[str] = None
    source: Optional[str] = "local_agent"
    events: List[DownloadEventItem] = []


class WebConnectionItem(BaseModel):
    remote_ip: str
    remote_port: int
    domain: Optional[str] = None
    process_name: Optional[str] = None
    protocol: Optional[str] = "tcp"


class WebConnectionsIngestPayload(BaseModel):
    host_serial: str
    host_name: str
    host_ip: Optional[str] = None
    source: Optional[str] = "local_agent"
    events: List[WebConnectionItem] = []


class AuthSummaryTopItem(BaseModel):
    key: str
    count: int


class AuthSummaryHourlyItem(BaseModel):
    hour: str
    success: int
    failure: int
    lockout: int


class AuthSummaryResponse(BaseModel):
    generated_at: str
    hours: int
    host_serial: Optional[str] = None
    total_events: int
    success_events: int
    failure_events: int
    lockout_events: int
    unique_users: int
    unique_source_ips: int
    top_failed_users: List[AuthSummaryTopItem]
    top_failed_source_ips: List[AuthSummaryTopItem]
    hourly: List[AuthSummaryHourlyItem]


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ["1", "true", "yes", "on"]


def _emit_siem_event(
    db: Session,
    *,
    source: str,
    event_type: str,
    severity: str,
    timestamp: Optional[datetime] = None,
    host_serial: Optional[str] = None,
    host_name: Optional[str] = None,
    host_ip: Optional[str] = None,
    user_name: Optional[str] = None,
    outcome: Optional[str] = None,
    message: Optional[str] = None,
    payload_json: Optional[Dict] = None,
):
    db.add(SiemEvent(
        timestamp=timestamp or datetime.utcnow(),
        source=source,
        event_type=event_type,
        severity=severity,
        host_serial=host_serial,
        host_name=host_name,
        host_ip=host_ip,
        user_name=user_name,
        outcome=outcome,
        message=message,
        payload_json=payload_json or {},
    ))


def _upsert_siem_alert(
    db: Session,
    *,
    fingerprint: str,
    rule_id: str,
    severity: str,
    host_serial: Optional[str],
    host_name: Optional[str],
    title: str,
    description: str,
    evidence: Dict,
    triggered: bool,
) -> None:
    alert = db.query(SiemAlert).filter(SiemAlert.fingerprint == fingerprint).first()

    if triggered:
        if not alert:
            db.add(SiemAlert(
                fingerprint=fingerprint,
                rule_id=rule_id,
                severity=severity,
                status="Nouvelle",
                host_serial=host_serial,
                host_name=host_name,
                title=title,
                description=description,
                evidence_json=evidence,
            ))
            return
        alert.severity = severity
        alert.host_serial = host_serial
        alert.host_name = host_name
        alert.title = title
        alert.description = description
        alert.evidence_json = evidence
        if alert.status in ["Résolue", "Faux positif"]:
            alert.status = "Nouvelle"
        return

    if alert and alert.status in ["Nouvelle", "En cours"]:
        alert.status = "Résolue"


def _run_siem_rules_for_host(db: Session, serial: str) -> None:
    posture = db.query(EndpointSecurityPosture).filter(EndpointSecurityPosture.serial_number == serial).first()
    network = db.query(NetworkTelemetry).filter(NetworkTelemetry.serial_number == serial).first()

    if posture:
        _upsert_siem_alert(
            db,
            fingerprint=f"defender_disabled:{serial}",
            rule_id="DEFENDER_DISABLED",
            severity="Élevée",
            host_serial=serial,
            host_name=posture.hostname,
            title="Defender désactivé",
            description="L'antivirus Microsoft Defender est désactivé sur l'endpoint.",
            evidence={"defender_enabled": posture.defender_enabled, "source": posture.source},
            triggered=not bool(posture.defender_enabled),
        )

        _upsert_siem_alert(
            db,
            fingerprint=f"bitlocker_disabled:{serial}",
            rule_id="BITLOCKER_DISABLED",
            severity="Moyenne",
            host_serial=serial,
            host_name=posture.hostname,
            title="BitLocker non actif",
            description="Le chiffrement BitLocker n'est pas actif sur le disque système.",
            evidence={"bitlocker_enabled": posture.bitlocker_enabled, "source": posture.source},
            triggered=not bool(posture.bitlocker_enabled),
        )

    if network:
        ports = network.open_ports_json or []
        is_risky = 3389 in ports and 445 in ports
        _upsert_siem_alert(
            db,
            fingerprint=f"rdp_smb_exposed:{serial}",
            rule_id="RDP_SMB_EXPOSED",
            severity="Critique",
            host_serial=serial,
            host_name=network.hostname,
            title="Exposition RDP + SMB",
            description="Les ports RDP (3389) et SMB (445) sont simultanément ouverts.",
            evidence={"open_ports": ports, "source": network.source},
            triggered=is_risky,
        )


def _normalize_auth_outcome(event_id: int, outcome: Optional[str]) -> str:
    normalized = (outcome or "").strip().lower()
    if normalized in ["success", "failure", "lockout"]:
        return normalized
    if event_id == 4624:
        return "success"
    if event_id == 4625:
        return "failure"
    if event_id == 4740:
        return "lockout"
    return "unknown"


def _auth_event_type(outcome: str) -> str:
    if outcome == "success":
        return "auth.logon_success"
    if outcome == "failure":
        return "auth.logon_failure"
    if outcome == "lockout":
        return "auth.account_lockout"
    return "auth.event"


def _auth_severity(outcome: str) -> str:
    if outcome == "lockout":
        return "high"
    if outcome == "failure":
        return "medium"
    return "info"


def _get_ad_settings(db: Optional[Session] = None):
    settings = {
        "server": os.getenv("AD_SERVER", ""),
        "port": int(os.getenv("AD_PORT", "636")),
        "use_ssl": _env_bool("AD_USE_SSL", True),
        "bind_user": os.getenv("AD_BIND_USER", ""),
        "bind_password": os.getenv("AD_BIND_PASSWORD", ""),
        "base_dn": os.getenv("AD_BASE_DN", ""),
        "users_dn": os.getenv("AD_USERS_DN", ""),
        "computers_dn": os.getenv("AD_COMPUTERS_DN", ""),
        "user_filter": os.getenv("AD_USER_FILTER", "(&(objectCategory=person)(objectClass=user))"),
        "computer_filter": os.getenv("AD_COMPUTER_FILTER", "(&(objectCategory=computer)(objectClass=computer))"),
        "auto_sync_enabled": _env_bool("AD_AUTO_SYNC_ENABLED", False),
        "sync_interval_minutes": int(os.getenv("AD_AUTO_SYNC_INTERVAL_MINUTES", "60")),
        "last_auto_sync_at": None,
        "last_sync_users_at": None,
        "last_sync_computers_at": None,
        "last_sync_status": None,
        "last_sync_message": None,
    }

    if db is not None:
        cfg = db.query(AdConfig).filter(AdConfig.id == 1).first()
        if cfg:
            # La config sauvegardée en base surcharge la config environnement si définie.
            settings["server"] = cfg.server or settings["server"]
            settings["port"] = cfg.port or settings["port"]
            settings["use_ssl"] = cfg.use_ssl
            settings["bind_user"] = cfg.bind_user or settings["bind_user"]
            settings["bind_password"] = cfg.bind_password or settings["bind_password"]
            settings["base_dn"] = cfg.base_dn or settings["base_dn"]
            settings["users_dn"] = cfg.users_dn or settings["users_dn"]
            settings["computers_dn"] = cfg.computers_dn or settings["computers_dn"]
            settings["user_filter"] = cfg.user_filter or settings["user_filter"]
            settings["computer_filter"] = cfg.computer_filter or settings["computer_filter"]
            settings["auto_sync_enabled"] = cfg.auto_sync_enabled
            settings["sync_interval_minutes"] = cfg.sync_interval_minutes or settings["sync_interval_minutes"]
            settings["last_auto_sync_at"] = cfg.last_auto_sync_at
            settings["last_sync_users_at"] = cfg.last_sync_users_at
            settings["last_sync_computers_at"] = cfg.last_sync_computers_at
            settings["last_sync_status"] = cfg.last_sync_status
            settings["last_sync_message"] = cfg.last_sync_message

    return settings


def _validate_ad_settings(settings):
    required = ["server", "bind_user", "bind_password", "base_dn"]
    missing = [name for name in required if not settings.get(name)]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Configuration Active Directory incomplète. Variables manquantes: {', '.join(missing)}"
        )


def _ad_connect(settings):
    server = Server(settings["server"], port=settings["port"], use_ssl=settings["use_ssl"], get_info=ALL)

    # Tentative 1: NTLM (classique en environnement AD avec DOMAIN\\user).
    try:
        conn = Connection(
            server,
            user=settings["bind_user"],
            password=settings["bind_password"],
            authentication=NTLM,
            auto_bind=True,
        )
        return conn
    except Exception as exc:
        # Certains environnements OpenSSL/Python ne supportent pas MD4 (NTLM).
        if "MD4" not in str(exc).upper():
            raise

    # Tentative 2: bind SIMPLE (UPN) pour contourner la limite MD4.
    bind_user = settings["bind_user"]
    if "\\" in bind_user:
        domain, username = bind_user.split("\\", 1)
        # Construit le domaine DNS depuis le base_dn (DC=a,DC=b -> a.b), sinon utilise DOMAIN local.
        dc_parts = [part.split("=", 1)[1] for part in settings.get("base_dn", "").split(",") if part.strip().upper().startswith("DC=")]
        dns_domain = ".".join(dc_parts) if dc_parts else f"{domain}.local"
        simple_user = f"{username}@{dns_domain}"
    else:
        simple_user = bind_user

    conn = Connection(
        server,
        user=simple_user,
        password=settings["bind_password"],
        authentication=SIMPLE,
        auto_bind=True,
    )
    return conn


def _ad_paged_search(conn: Connection, *, search_base: str, search_filter: str, attributes: List[str], page_size: int = 200) -> List[Dict]:
    # Utilise la pagination LDAP pour éviter les timeouts et limites serveur
    # lors des synchronisations sur de larges OU/domaines.
    results: List[Dict] = []
    for entry in conn.extend.standard.paged_search(
        search_base=search_base,
        search_filter=search_filter,
        search_scope=SUBTREE,
        attributes=attributes,
        paged_size=max(50, int(page_size)),
        generator=True,
    ):
        if entry.get("type") != "searchResEntry":
            continue
        attrs = entry.get("attributes") or {}
        if isinstance(attrs, dict):
            results.append(attrs)
    return results


def _ensure_ad_config_defaults():
    db = SessionLocal()
    try:
        cfg = db.query(AdConfig).filter(AdConfig.id == 1).first()
        if not cfg:
            cfg = AdConfig(id=1)
            db.add(cfg)
        if cfg.sync_interval_minutes is None or cfg.sync_interval_minutes < 5:
            cfg.sync_interval_minutes = 60
        if cfg.auto_sync_enabled is None:
            cfg.auto_sync_enabled = False
        db.commit()
    finally:
        db.close()


def _mark_ad_sync_status(
    db: Session,
    *,
    status: str,
    message: str,
    update_users_time: bool = False,
    update_computers_time: bool = False,
    update_auto_time: bool = False,
):
    cfg = db.query(AdConfig).filter(AdConfig.id == 1).first()
    if not cfg:
        cfg = AdConfig(id=1)
        db.add(cfg)
    now = datetime.utcnow()
    if update_users_time:
        cfg.last_sync_users_at = now
    if update_computers_time:
        cfg.last_sync_computers_at = now
    if update_auto_time:
        cfg.last_auto_sync_at = now
    cfg.last_sync_status = status
    cfg.last_sync_message = message


def _ad_auto_sync_worker():
    while not _AD_AUTO_SYNC_STOP.is_set():
        wait_seconds = 30
        db = SessionLocal()
        try:
            cfg = db.query(AdConfig).filter(AdConfig.id == 1).first()
            if cfg and cfg.auto_sync_enabled:
                interval = max(5, int(cfg.sync_interval_minutes or 60))
                now = datetime.utcnow()
                is_due = cfg.last_auto_sync_at is None or (now - cfg.last_auto_sync_at) >= timedelta(minutes=interval)

                if is_due:
                    try:
                        users_res = sync_ad_users(db)
                        computers_res = sync_ad_computers(db)
                        _mark_ad_sync_status(
                            db,
                            status="success",
                            message=(
                                f"Sync auto AD OK - Users: +{users_res.created}/~{users_res.updated} "
                                f"- Computers: +{computers_res.created}/~{computers_res.updated}"
                            ),
                            update_auto_time=True,
                        )
                        db.commit()
                    except Exception as exc:
                        db.rollback()
                        _mark_ad_sync_status(
                            db,
                            status="error",
                            message=f"Erreur sync auto AD: {exc}",
                            update_auto_time=True,
                        )
                        db.commit()

                wait_seconds = 30
            else:
                wait_seconds = 30
        finally:
            db.close()

        _AD_AUTO_SYNC_STOP.wait(timeout=wait_seconds)


def _start_ad_auto_sync_worker():
    global _AD_AUTO_SYNC_THREAD
    if _AD_AUTO_SYNC_THREAD and _AD_AUTO_SYNC_THREAD.is_alive():
        return
    _AD_AUTO_SYNC_STOP.clear()
    _AD_AUTO_SYNC_THREAD = threading.Thread(target=_ad_auto_sync_worker, name="ad-auto-sync", daemon=True)
    _AD_AUTO_SYNC_THREAD.start()


def _evaluate_endpoint_online_status(db: Session) -> None:
    policy = _get_or_create_security_policy(db)
    offline_after_minutes = max(1, int(policy.endpoint_offline_after_minutes or 5))
    grace_cycles = max(1, int(policy.endpoint_offline_grace_cycles or 2))
    offline_minutes = offline_after_minutes * grace_cycles
    threshold = datetime.utcnow() - timedelta(minutes=offline_minutes)

    endpoints = db.query(EndpointSecurityPosture).filter(EndpointSecurityPosture.source != "ad_sync").all()
    for endpoint in endpoints:
        serial = (endpoint.serial_number or "").strip()
        if not serial:
            continue

        host_name = endpoint.hostname or serial
        fingerprint = f"endpoint_offline:{serial}"
        existing_alert = db.query(SiemAlert).filter(SiemAlert.fingerprint == fingerprint).first()
        was_offline = bool(existing_alert and existing_alert.status in ["Nouvelle", "En cours"])

        is_offline = endpoint.last_seen is None or endpoint.last_seen < threshold

        if is_offline and not was_offline:
            _emit_siem_event(
                db,
                source=endpoint.source or "local_agent",
                event_type="endpoint.offline",
                severity="medium",
                host_serial=serial,
                host_name=host_name,
                host_ip=endpoint.ip_address,
                outcome="failure",
                message=f"Endpoint non vu depuis plus de {offline_minutes} minutes",
                payload_json={
                    "last_seen": endpoint.last_seen.isoformat() if endpoint.last_seen else None,
                    "offline_threshold_minutes": offline_minutes,
                },
            )

        if (not is_offline) and was_offline:
            _emit_siem_event(
                db,
                source=endpoint.source or "local_agent",
                event_type="endpoint.back_online",
                severity="info",
                host_serial=serial,
                host_name=host_name,
                host_ip=endpoint.ip_address,
                outcome="success",
                message="Endpoint de nouveau joignable",
                payload_json={
                    "last_seen": endpoint.last_seen.isoformat() if endpoint.last_seen else None,
                },
            )

        _upsert_siem_alert(
            db,
            fingerprint=fingerprint,
            rule_id="ENDPOINT_OFFLINE",
            severity="Élevée",
            host_serial=serial,
            host_name=host_name,
            title="Endpoint potentiellement hors tension",
            description=(
                f"Aucune remontée agent depuis environ {offline_minutes} minutes. "
                "Le poste est probablement hors ligne ou l'agent est arrêté."
            ),
            evidence={
                "last_seen": endpoint.last_seen.isoformat() if endpoint.last_seen else None,
                "offline_threshold_minutes": offline_minutes,
                "offline_after_minutes": offline_after_minutes,
                "grace_cycles": grace_cycles,
            },
            triggered=is_offline,
        )


def _endpoint_status_worker():
    while not _ENDPOINT_STATUS_STOP.is_set():
        db = SessionLocal()
        try:
            _evaluate_endpoint_online_status(db)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        _ENDPOINT_STATUS_STOP.wait(timeout=60)


def _start_endpoint_status_worker():
    global _ENDPOINT_STATUS_THREAD
    if _ENDPOINT_STATUS_THREAD and _ENDPOINT_STATUS_THREAD.is_alive():
        return
    _ENDPOINT_STATUS_STOP.clear()
    _ENDPOINT_STATUS_THREAD = threading.Thread(target=_endpoint_status_worker, name="endpoint-status", daemon=True)
    _ENDPOINT_STATUS_THREAD.start()


@app.get("/ad/status")
def ad_status(db: Session = Depends(get_db)):
    # Vérifie la disponibilité de la configuration AD sans exposer le mot de passe.
    settings = _get_ad_settings(db)
    _validate_ad_settings(settings)
    try:
        conn = _ad_connect(settings)
        conn.unbind()
        return {
            "success": True,
            "server": settings["server"],
            "port": settings["port"],
            "use_ssl": settings["use_ssl"],
            "base_dn": settings["base_dn"],
            "message": "Connexion AD OK",
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Connexion AD impossible: {exc}")


@app.get("/ad/config", response_model=AdConfigResponse)
def get_ad_config(db: Session = Depends(get_db)):
    # Retourne la configuration AD courante pour alimenter le formulaire frontend.
    settings = _get_ad_settings(db)
    return AdConfigResponse(
        server=settings["server"] or "",
        port=settings["port"],
        use_ssl=settings["use_ssl"],
        bind_user=settings["bind_user"] or "",
        base_dn=settings["base_dn"] or "",
        users_dn=settings["users_dn"] or "",
        computers_dn=settings["computers_dn"] or "",
        user_filter=settings["user_filter"] or "",
        computer_filter=settings["computer_filter"] or "",
        auto_sync_enabled=bool(settings["auto_sync_enabled"]),
        sync_interval_minutes=max(5, int(settings["sync_interval_minutes"] or 60)),
        last_auto_sync_at=settings.get("last_auto_sync_at"),
        last_sync_users_at=settings.get("last_sync_users_at"),
        last_sync_computers_at=settings.get("last_sync_computers_at"),
        last_sync_status=settings.get("last_sync_status"),
        last_sync_message=settings.get("last_sync_message"),
        has_password=bool(settings["bind_password"]),
    )


@app.put("/ad/config", response_model=AdConfigResponse)
def save_ad_config(payload: AdConfigPayload, db: Session = Depends(get_db)):
    # Sauvegarde (ou met à jour) la configuration AD en base.
    cfg = db.query(AdConfig).filter(AdConfig.id == 1).first()
    if not cfg:
        cfg = AdConfig(id=1)
        db.add(cfg)

    cfg.server = (payload.server or "").strip() if payload.server is not None else cfg.server
    cfg.port = payload.port
    cfg.use_ssl = payload.use_ssl
    cfg.bind_user = (payload.bind_user or "").strip() if payload.bind_user is not None else cfg.bind_user
    if payload.bind_password is not None and payload.bind_password != "":
        cfg.bind_password = payload.bind_password
    cfg.base_dn = (payload.base_dn or "").strip() if payload.base_dn is not None else cfg.base_dn
    cfg.users_dn = (payload.users_dn or "").strip() if payload.users_dn is not None else cfg.users_dn
    cfg.computers_dn = (payload.computers_dn or "").strip() if payload.computers_dn is not None else cfg.computers_dn
    cfg.user_filter = payload.user_filter or cfg.user_filter or "(&(objectCategory=person)(objectClass=user))"
    cfg.computer_filter = payload.computer_filter or cfg.computer_filter or "(&(objectCategory=computer)(objectClass=computer))"
    if payload.auto_sync_enabled is not None:
        cfg.auto_sync_enabled = payload.auto_sync_enabled
    if payload.sync_interval_minutes is not None:
        cfg.sync_interval_minutes = max(5, int(payload.sync_interval_minutes))

    db.commit()
    settings = _get_ad_settings(db)
    return AdConfigResponse(
        server=settings["server"] or "",
        port=settings["port"],
        use_ssl=settings["use_ssl"],
        bind_user=settings["bind_user"] or "",
        base_dn=settings["base_dn"] or "",
        users_dn=settings["users_dn"] or "",
        computers_dn=settings["computers_dn"] or "",
        user_filter=settings["user_filter"] or "",
        computer_filter=settings["computer_filter"] or "",
        auto_sync_enabled=bool(settings["auto_sync_enabled"]),
        sync_interval_minutes=max(5, int(settings["sync_interval_minutes"] or 60)),
        last_auto_sync_at=settings.get("last_auto_sync_at"),
        last_sync_users_at=settings.get("last_sync_users_at"),
        last_sync_computers_at=settings.get("last_sync_computers_at"),
        last_sync_status=settings.get("last_sync_status"),
        last_sync_message=settings.get("last_sync_message"),
        has_password=bool(settings["bind_password"]),
    )


@app.post("/ad/sync/users", response_model=AdSyncResult)
def sync_ad_users(db: Session = Depends(get_db)):
    # Synchronise les utilisateurs Active Directory vers la table users.
    settings = _get_ad_settings(db)
    _validate_ad_settings(settings)

    created = 0
    updated = 0
    skipped = 0

    try:
        conn = _ad_connect(settings)
        search_base = settings["users_dn"] or settings["base_dn"]
        entries = _ad_paged_search(
            conn,
            search_base=search_base,
            search_filter=settings["user_filter"],
            attributes=["mail", "userPrincipalName", "givenName", "sn", "displayName", "sAMAccountName"],
        )

        for data in entries:
            email = (data.get("mail") or [None])[0] if isinstance(data.get("mail"), list) else data.get("mail")
            if not email:
                upn = (data.get("userPrincipalName") or [None])[0] if isinstance(data.get("userPrincipalName"), list) else data.get("userPrincipalName")
                email = upn
            if not email:
                skipped += 1
                continue

            firstname = (data.get("givenName") or [""])[0] if isinstance(data.get("givenName"), list) else (data.get("givenName") or "")
            lastname = (data.get("sn") or [""])[0] if isinstance(data.get("sn"), list) else (data.get("sn") or "")
            display_name = (data.get("displayName") or [""])[0] if isinstance(data.get("displayName"), list) else (data.get("displayName") or "")
            sam = (data.get("sAMAccountName") or [""])[0] if isinstance(data.get("sAMAccountName"), list) else (data.get("sAMAccountName") or "")

            if not lastname:
                lastname = display_name or sam or "UtilisateurAD"

            db_user = db.query(User).filter(User.email == email).first()
            if db_user:
                db_user.name = lastname
                db_user.firstname = firstname or db_user.firstname
                updated += 1
            else:
                db.add(User(name=lastname, firstname=firstname, email=email))
                created += 1

        db.commit()
        _mark_ad_sync_status(
            db,
            status="success",
            message=f"Synchronisation utilisateurs AD terminée (+{created} / ~{updated})",
            update_users_time=True,
        )
        db.commit()
        conn.unbind()
        return AdSyncResult(
            success=True,
            created=created,
            updated=updated,
            skipped=skipped,
            message="Synchronisation utilisateurs AD terminée",
        )
    except HTTPException:
        db.rollback()
        _mark_ad_sync_status(db, status="error", message="Erreur synchronisation utilisateurs AD")
        db.commit()
        raise
    except Exception as exc:
        db.rollback()
        _mark_ad_sync_status(db, status="error", message=f"Erreur synchronisation utilisateurs AD: {exc}")
        db.commit()
        raise HTTPException(status_code=502, detail=f"Erreur synchronisation utilisateurs AD: {exc}")


@app.post("/ad/sync/computers", response_model=AdSyncResult)
def sync_ad_computers(db: Session = Depends(get_db)):
    # Synchronise les ordinateurs AD vers la table assets.
    settings = _get_ad_settings(db)
    _validate_ad_settings(settings)

    created = 0
    updated = 0
    skipped = 0
    synced_serials: List[str] = []

    try:
        computer_type = db.query(AssetType).filter(AssetType.label == "Ordinateur fixe").first()
        if not computer_type:
            computer_type = AssetType(label="Ordinateur fixe")
            db.add(computer_type)
            db.commit()
            db.refresh(computer_type)

        conn = _ad_connect(settings)
        search_base = settings["computers_dn"] or settings["base_dn"]
        entries = _ad_paged_search(
            conn,
            search_base=search_base,
            search_filter=settings["computer_filter"],
            attributes=["name", "dNSHostName", "operatingSystem", "operatingSystemVersion", "distinguishedName"],
        )

        for data in entries:
            name = (data.get("name") or [""])[0] if isinstance(data.get("name"), list) else (data.get("name") or "")
            dns_host = (data.get("dNSHostName") or [""])[0] if isinstance(data.get("dNSHostName"), list) else (data.get("dNSHostName") or "")
            os_name = (data.get("operatingSystem") or [""])[0] if isinstance(data.get("operatingSystem"), list) else (data.get("operatingSystem") or "")

            serial = (dns_host or name or "").strip()
            if not serial:
                skipped += 1
                continue

            model = os_name or "Ordinateur du domaine"
            description = f"Import AD: {name or dns_host}"

            db_asset = db.query(Asset).filter(Asset.serial_number == serial).first()
            if db_asset:
                db_asset.model = model
                db_asset.status = "En service"
                db_asset.type_id = computer_type.id
                db_asset.description = description
                updated += 1
            else:
                db_asset = Asset(
                    serial_number=serial,
                    model=model,
                    status="En service",
                    type_id=computer_type.id,
                    description=description,
                    software_json=[],
                )
                db.add(db_asset)
                created += 1

            db.flush()

            # Crée/met à jour une posture pour les hôtes importés AD afin d'appliquer
            # les mêmes règles automatiques de sécurité que les autres endpoints.
            hostname = (name or dns_host or serial).strip()
            ad_posture = db.query(EndpointSecurityPosture).filter(EndpointSecurityPosture.serial_number == serial).first()
            if not ad_posture:
                ad_posture = EndpointSecurityPosture(serial_number=serial, hostname=hostname)
                db.add(ad_posture)

            ad_posture.hostname = hostname
            ad_posture.ip_address = None
            ad_posture.source = "ad_sync"
            ad_posture.os = os_name or "AD Sync"
            ad_posture.firewall_enabled = False
            ad_posture.defender_enabled = False
            ad_posture.realtime_protection_enabled = False
            ad_posture.bitlocker_enabled = False
            ad_posture.pending_reboot = False
            ad_posture.asset_id = db_asset.id

            ad_metric = db.query(EndpointResourceMetric).filter(EndpointResourceMetric.serial_number == serial).first()
            if not ad_metric:
                ad_metric = EndpointResourceMetric(serial_number=serial, hostname=hostname)
                db.add(ad_metric)
            ad_metric.hostname = hostname
            ad_metric.source = "ad_sync"
            ad_metric.asset_id = db_asset.id

            ad_network = db.query(NetworkTelemetry).filter(NetworkTelemetry.serial_number == serial).first()
            if not ad_network:
                ad_network = NetworkTelemetry(serial_number=serial, hostname=hostname)
                db.add(ad_network)
            ad_network.hostname = hostname
            ad_network.ip_address = None
            ad_network.source = "ad_sync"
            ad_network.open_ports_json = ad_network.open_ports_json or []
            ad_network.logs_json = ad_network.logs_json or []
            ad_network.asset_id = db_asset.id

            synced_serials.append(serial)

        db.commit()

        # Recalcule les constats automatiques pour tous les hôtes AD synchronisés.
        for serial in synced_serials:
            posture = db.query(EndpointSecurityPosture).filter(EndpointSecurityPosture.serial_number == serial).first()
            if posture:
                _generate_findings_from_posture(posture, db)

        _mark_ad_sync_status(
            db,
            status="success",
            message=f"Synchronisation ordinateurs AD terminée (+{created} / ~{updated})",
            update_computers_time=True,
        )
        db.commit()

        conn.unbind()
        return AdSyncResult(
            success=True,
            created=created,
            updated=updated,
            skipped=skipped,
            message="Synchronisation ordinateurs AD terminée",
        )
    except HTTPException:
        db.rollback()
        _mark_ad_sync_status(db, status="error", message="Erreur synchronisation ordinateurs AD")
        db.commit()
        raise
    except Exception as exc:
        db.rollback()
        _mark_ad_sync_status(db, status="error", message=f"Erreur synchronisation ordinateurs AD: {exc}")
        db.commit()
        raise HTTPException(status_code=502, detail=f"Erreur synchronisation ordinateurs AD: {exc}")


@app.post("/assets/scan")
def scan_asset(payload: AssetScanPayload, db: Session = Depends(get_db)):
    # Endpoint d'ingestion utilisé par le script d'inventaire PowerShell.
    serial = (payload.serial_number or "").strip()
    if not serial:
        raise HTTPException(status_code=400, detail="serial_number est obligatoire")

    default_type = db.query(AssetType).filter(AssetType.label == "Ordinateur fixe").first()
    if not default_type:
        default_type = AssetType(label="Ordinateur fixe")
        db.add(default_type)
        db.commit()
        db.refresh(default_type)

    software_data = [
        {
            "name": s.name,
            "version": s.version,
            "publisher": s.publisher,
            "install_date": s.install_date,
            "license_key": s.license_key,
        }
        for s in payload.software
        if s.name
    ]

    db_asset = db.query(Asset).filter(Asset.serial_number == serial).first()
    created = False

    if not db_asset:
        db_asset = Asset(
            serial_number=serial,
            model=payload.model or payload.hostname or "Machine détectée",
            status="En service",
            type_id=default_type.id,
            software_json=software_data,
            description=f"Découvert via inventaire automatisé ({payload.hostname})",
        )
        db.add(db_asset)
        created = True
    else:
        db_asset.model = payload.model or db_asset.model
        db_asset.software_json = software_data
        if payload.hostname:
            db_asset.description = f"Mise à jour inventaire automatisé ({payload.hostname})"

    db.commit()
    db.refresh(db_asset)

    return {
        "success": True,
        "created": created,
        "asset_id": db_asset.id,
        "software_count": len(software_data),
    }


@app.get("/software", response_model=List[SoftwareInventoryItem])
def get_software_inventory(db: Session = Depends(get_db)):
    # Expose une vue aplatie des logiciels détectés, y compris les machines
    # connues (ex: import AD) dont l'inventaire logiciel n'a pas encore été collecté.
    assets = db.query(Asset).all()
    items: List[SoftwareInventoryItem] = []

    for asset in assets:
        software_list = asset.software_json or []
        if not isinstance(software_list, list):
            software_list = []

        if len(software_list) == 0:
            items.append(
                SoftwareInventoryItem(
                    name="Inventaire logiciel en attente",
                    version=None,
                    publisher="Synchronisation AD" if (asset.description or "").startswith("Import AD") else "Agent non exécuté",
                    install_date=None,
                    license_key=None,
                    collection_status="pending",
                    asset_id=asset.id,
                    asset_serial_number=asset.serial_number,
                    asset_model=asset.model,
                )
            )
            continue

        for sw in software_list:
            if not isinstance(sw, dict):
                continue
            name = (sw.get("name") or "").strip()
            if not name:
                continue

            items.append(
                SoftwareInventoryItem(
                    name=name,
                    version=sw.get("version"),
                    publisher=sw.get("publisher"),
                    install_date=sw.get("install_date"),
                    license_key=sw.get("license_key"),
                    collection_status="detected",
                    asset_id=asset.id,
                    asset_serial_number=asset.serial_number,
                    asset_model=asset.model,
                )
            )

    # Tri alphabétique pour une lecture plus stable dans l'IHM.
    items.sort(key=lambda x: (x.asset_serial_number.lower(), x.name.lower()))
    return items


_CVE_CACHE_LOCK = threading.Lock()
_CVE_CACHE = {
    "generated_at": None,
    "items": [],
    "total_recent_cves": 0,
}


def _extract_score_and_severity(cve_payload: dict):
    metrics = cve_payload.get("metrics") or {}
    metric_keys = ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]
    for key in metric_keys:
        values = metrics.get(key) or []
        if not values:
            continue
        metric = values[0] or {}
        cvss = metric.get("cvssData") or {}
        score = cvss.get("baseScore")
        severity = cvss.get("baseSeverity") or metric.get("baseSeverity")
        if score is not None or severity is not None:
            return score, severity
    return None, None


def _fetch_recent_cves_from_nvd(hours: int = 24) -> List[dict]:
    end = datetime.utcnow()
    start = end - timedelta(hours=hours)
    params = {
        "lastModStartDate": start.strftime("%Y-%m-%dT%H:%M:%S.000") + "Z",
        "lastModEndDate": end.strftime("%Y-%m-%dT%H:%M:%S.000") + "Z",
        "resultsPerPage": 200,
    }
    url = "https://services.nvd.nist.gov/rest/json/cves/2.0?" + urlencode(params)
    req = UrlRequest(url, headers={"User-Agent": "it-monitoring-cve-watch/1.0"})
    with urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    vulnerabilities = data.get("vulnerabilities") or []
    return vulnerabilities


def _normalize_product_name(value: str) -> str:
    lowered = (value or "").lower()
    cleaned = re.sub(r"[^a-z0-9 ]+", " ", lowered)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _tokenize_name(value: str) -> List[str]:
    text = _normalize_product_name(value)
    if not text:
        return []
    tokens = []
    stopwords = {
        "microsoft", "windows", "system", "server", "desktop", "runtime",
        "redistributable", "minimum", "additional", "release", "edition",
        "professional", "standard", "evaluation", "user", "workstation",
        "subsystem", "core", "interpreter", "path", "suite", "agent",
    }
    for part in text.split(" "):
        if len(part) < 4:
            continue
        if part.isdigit():
            continue
        if part in stopwords:
            continue
        tokens.append(part)
    return list(dict.fromkeys(tokens))


def _software_aliases(value: str) -> List[str]:
    text = _normalize_product_name(value)
    aliases = {text}

    # Alias courants pour améliorer la corrélation CVE produit/éditeur.
    alias_map = {
        "microsoft edge": ["edge", "microsoft_edge"],
        "google chrome": ["chrome", "google_chrome", "chromium"],
        "docker desktop": ["docker", "docker_desktop"],
        "visual studio code": ["vscode", "visual_studio_code", "code"],
        "python": ["cpython", "python3"],
        "putty": ["putty"],
        "windows server": ["microsoft_windows_server", "windows_server"],
    }

    for key, vals in alias_map.items():
        if key in text:
            aliases.update(vals)

    # Évite les tokens très génériques qui entraînent des faux positifs.
    aliases.update(_tokenize_name(text))
    return [a for a in aliases if a and len(a) >= 3]


def _extract_cpe_products(cve_wrapper: dict) -> List[str]:
    configurations = cve_wrapper.get("configurations") or []
    products = set()

    def walk_nodes(nodes):
        for node in nodes or []:
            for cpe in node.get("cpeMatch") or []:
                criteria = cpe.get("criteria") or ""
                parts = criteria.split(":")
                if len(parts) >= 5:
                    # cpe:2.3:a:vendor:product:version:...
                    product = _normalize_product_name(parts[4].replace("_", " "))
                    if product:
                        products.add(product)
            for child in node.get("children") or []:
                walk_nodes([child])

    for cfg in configurations:
        walk_nodes(cfg.get("nodes") or [])

    return list(products)


def _build_software_profiles(db: Session) -> List[dict]:
    profiles = []
    seen = set()
    assets = db.query(Asset).all()

    for asset in assets:
        software_list = asset.software_json or []
        if isinstance(software_list, list):
            for sw in software_list:
                if not isinstance(sw, dict):
                    continue
                sw_name_raw = (sw.get("name") or "").strip()
                if len(sw_name_raw) < 3:
                    continue

                publisher_raw = (sw.get("publisher") or "").strip()
                key = (sw_name_raw.lower(), publisher_raw.lower())
                if key in seen:
                    continue
                seen.add(key)

                tokens = set(_software_aliases(sw_name_raw))
                tokens.update(_software_aliases(publisher_raw))
                profiles.append({
                    "display": sw_name_raw,
                    "tokens": tokens,
                })

    return profiles


def _match_cve_to_software(cve_wrapper: dict, description: str, profiles: List[dict]) -> List[str]:
    desc_text = _normalize_product_name(description)
    cpe_products = _extract_cpe_products(cve_wrapper)
    cpe_text = " ".join(cpe_products)

    matched = []
    for profile in profiles:
        tokens = profile.get("tokens") or set()
        if not tokens:
            continue

        hit = False
        for token in tokens:
            if len(token) < 3:
                continue
            if token in desc_text or token in cpe_text:
                hit = True
                break

        if hit:
            matched.append(profile.get("display"))
        if len(matched) >= 5:
            break

    return matched


def _build_cve_watch_data(db: Session, hours: int = 24, max_items: int = 100) -> CveWatchResponse:
    software_profiles = _build_software_profiles(db)
    vulnerabilities = _fetch_recent_cves_from_nvd(hours=hours)
    matched_items: List[CveWatchItem] = []

    for vuln in vulnerabilities:
        cve_wrapper = vuln.get("cve") or {}
        cve_id = cve_wrapper.get("id")
        if not cve_id:
            continue

        descriptions = cve_wrapper.get("descriptions") or []
        en_desc = ""
        for desc in descriptions:
            if desc.get("lang") == "en":
                en_desc = desc.get("value") or ""
                break
        if not en_desc and descriptions:
            en_desc = descriptions[0].get("value") or ""

        matched = _match_cve_to_software(cve_wrapper, en_desc, software_profiles)

        if not matched:
            continue

        score, severity = _extract_score_and_severity(cve_wrapper)
        matched_items.append(
            CveWatchItem(
                cve_id=cve_id,
                description=en_desc[:500],
                published=cve_wrapper.get("published"),
                last_modified=cve_wrapper.get("lastModified"),
                score=score,
                severity=severity,
                matched_software=matched,
                source_url=f"https://nvd.nist.gov/vuln/detail/{cve_id}",
            )
        )

    matched_items.sort(key=lambda item: (item.score or 0), reverse=True)
    matched_items = matched_items[:max_items]

    return CveWatchResponse(
        generated_at=datetime.utcnow().isoformat(),
        source="NVD CVE API 2.0",
        total_recent_cves=len(vulnerabilities),
        matched_count=len(matched_items),
        items=matched_items,
    )


@app.get("/cve-watch", response_model=CveWatchResponse)
def get_cve_watch(force_refresh: bool = False, hours: int = 24, db: Session = Depends(get_db)):
    # Veille CVE quasi temps réel avec cache court pour éviter de surcharger l'API NVD.
    if hours < 1 or hours > 168:
        raise HTTPException(status_code=400, detail="hours doit être entre 1 et 168")

    with _CVE_CACHE_LOCK:
        cached_at = _CVE_CACHE.get("generated_at")
        use_cache = False
        if cached_at and not force_refresh:
            try:
                cache_ts = datetime.fromisoformat(cached_at)
                if datetime.utcnow() - cache_ts < timedelta(minutes=5):
                    use_cache = True
            except Exception:
                use_cache = False

        if use_cache:
            return CveWatchResponse(
                generated_at=_CVE_CACHE["generated_at"],
                source="NVD CVE API 2.0",
                total_recent_cves=_CVE_CACHE["total_recent_cves"],
                matched_count=len(_CVE_CACHE["items"]),
                items=[CveWatchItem(**item) for item in _CVE_CACHE["items"]],
            )

        try:
            data = _build_cve_watch_data(db, hours=hours)
        except Exception as exc:
            if _CVE_CACHE.get("generated_at"):
                return CveWatchResponse(
                    generated_at=_CVE_CACHE["generated_at"],
                    source="NVD CVE API 2.0 (cache)",
                    total_recent_cves=_CVE_CACHE["total_recent_cves"],
                    matched_count=len(_CVE_CACHE["items"]),
                    items=[CveWatchItem(**item) for item in _CVE_CACHE["items"]],
                )
            raise HTTPException(status_code=502, detail=f"Impossible de récupérer les CVE: {exc}")

        _CVE_CACHE["generated_at"] = data.generated_at
        _CVE_CACHE["total_recent_cves"] = data.total_recent_cves
        _CVE_CACHE["items"] = [item.dict() for item in data.items]
        return data


@app.post("/cve-watch/refresh", response_model=CveWatchResponse)
def refresh_cve_watch(hours: int = 24, db: Session = Depends(get_db)):
    return get_cve_watch(force_refresh=True, hours=hours, db=db)


def _get_or_create_security_policy(db: Session) -> SecurityPolicyConfig:
    policy = db.query(SecurityPolicyConfig).filter(SecurityPolicyConfig.id == 1).first()
    if not policy:
        policy = SecurityPolicyConfig(
            id=1,
            stale_endpoint_hours=72,
            unmanaged_lan_severity="Moyenne",
            stale_endpoint_severity="Moyenne",
            endpoint_offline_after_minutes=5,
            endpoint_offline_grace_cycles=2,
        )
        db.add(policy)
        db.commit()
        db.refresh(policy)
    if policy.endpoint_offline_after_minutes is None or policy.endpoint_offline_after_minutes < 1:
        policy.endpoint_offline_after_minutes = 5
    if policy.endpoint_offline_grace_cycles is None or policy.endpoint_offline_grace_cycles < 1:
        policy.endpoint_offline_grace_cycles = 2
    return policy


def _generate_stale_endpoint_findings(db: Session, policy: SecurityPolicyConfig):
    # Recalcule les constats automatiques "endpoint non vu" selon le seuil configuré.
    threshold = datetime.utcnow() - timedelta(hours=policy.stale_endpoint_hours)

    db.query(SecurityFinding).filter(
        SecurityFinding.source == "Défense automatique",
        SecurityFinding.title.like("Endpoint non vu depuis%")
    ).delete(synchronize_session=False)

    stale_endpoints = db.query(EndpointSecurityPosture).filter(EndpointSecurityPosture.last_seen < threshold).all()
    for endpoint in stale_endpoints:
        target_type = "LAN" if endpoint.asset_id is None else "Poste client"
        finding = SecurityFinding(
            title=f"Endpoint non vu depuis {policy.stale_endpoint_hours}h : {endpoint.hostname}",
            description="Aucune remontée de posture récente. L'agent est peut-être inactif ou la machine est hors ligne.",
            severity=policy.stale_endpoint_severity,
            status="Ouverte",
            target_type=target_type,
            target_name=endpoint.hostname,
            source="Défense automatique",
            recommendation="Vérifiez la connectivité et relancez l'agent de collecte sur cet endpoint.",
            asset_id=endpoint.asset_id,
        )
        db.add(finding)


def _generate_findings_from_posture(posture: EndpointSecurityPosture, db: Session):
    # Génère automatiquement des findings défensifs basés sur la posture d'un endpoint.
    policy = _get_or_create_security_policy(db)

    db.query(SecurityFinding).filter(
        SecurityFinding.source == "Défense automatique",
        SecurityFinding.target_name == posture.hostname,
        ~SecurityFinding.title.like("Endpoint non vu depuis%")
    ).delete(synchronize_session=False)

    is_network_probe = posture.serial_number.startswith("NET-") or posture.os == "Network Probe"
    target_type = "LAN" if posture.asset_id is None else "Poste client"
    rules = []

    if not is_network_probe:
        if not posture.firewall_enabled:
            rules.append({
                "title": f"Firewall désactivé sur {posture.hostname}",
                "description": "Le pare-feu Windows n'est pas activé. Cela expose le poste à des connexions non autorisées.",
                "severity": "Critique",
                "recommendation": "Activez immédiatement le pare-feu Windows (Windows Defender Firewall).",
            })

        if not posture.defender_enabled:
            rules.append({
                "title": f"Windows Defender désactivé sur {posture.hostname}",
                "description": "L'antivirus Windows Defender n'est pas activé.",
                "severity": "Critique",
                "recommendation": "Activez Windows Defender Antivirus.",
            })

        if not posture.realtime_protection_enabled:
            rules.append({
                "title": f"Protection temps réel désactivée sur {posture.hostname}",
                "description": "La protection temps réel de Windows Defender n'est pas active.",
                "severity": "Élevée",
                "recommendation": "Activez la protection temps réel dans Windows Defender.",
            })

        if not posture.bitlocker_enabled:
            rules.append({
                "title": f"BitLocker non activé sur {posture.hostname}",
                "description": "Le chiffrement de disque BitLocker n'est pas configuré.",
                "severity": "Élevée",
                "recommendation": "Activez BitLocker pour chiffrer le disque dur.",
            })

        if posture.pending_reboot:
            rules.append({
                "title": f"Reboot en attente sur {posture.hostname}",
                "description": "Un redémarrage du système est en attente, probablement suite à des mises à jour.",
                "severity": "Moyenne",
                "recommendation": "Redémarrez le poste dès que possible.",
            })

    if posture.asset_id is None:
        rules.append({
            "title": f"Hôte LAN non rattaché à un asset: {posture.hostname}",
            "description": "Un endpoint est visible sur le LAN mais n'est pas rattaché à un matériel inventorié.",
            "severity": policy.unmanaged_lan_severity,
            "recommendation": "Créer/associer un asset dans l'inventaire et valider la légitimité de cet hôte.",
        })

    for rule in rules:
        db.add(SecurityFinding(
            title=rule["title"],
            description=rule["description"],
            severity=rule["severity"],
            status="Ouverte",
            target_type=target_type,
            target_name=posture.hostname,
            source="Défense automatique",
            recommendation=rule["recommendation"],
            asset_id=posture.asset_id,
        ))

    _generate_stale_endpoint_findings(db, policy)
    db.commit()


@app.get("/security/findings", response_model=List[SecurityFindingResponse])
def get_security_findings(db: Session = Depends(get_db)):
    # Retourne la liste des vulnérabilités/faiblesses suivies dans l'application.
    findings = db.query(SecurityFinding).order_by(SecurityFinding.updated_at.desc(), SecurityFinding.id.desc()).all()
    return findings


@app.post("/security/findings", response_model=SecurityFindingResponse)
def create_security_finding(finding: SecurityFindingCreate, db: Session = Depends(get_db)):
    # Ajoute un constat de sécurité défensif à suivre dans l'application.
    valid_severity = ["Faible", "Moyenne", "Élevée", "Critique"]
    valid_status = ["Ouverte", "En cours", "Corrigée"]
    valid_target_types = ["LAN", "Serveur", "Poste client"]

    if finding.severity not in valid_severity:
        raise HTTPException(status_code=400, detail=f"Sévérité invalide: {finding.severity}")
    if finding.status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {finding.status}")
    if finding.target_type not in valid_target_types:
        raise HTTPException(status_code=400, detail=f"Type de cible invalide: {finding.target_type}")

    db_finding = SecurityFinding(**finding.dict())
    db.add(db_finding)
    db.commit()
    db.refresh(db_finding)
    return db_finding


@app.put("/security/findings/{finding_id}", response_model=SecurityFindingResponse)
def update_security_finding(finding_id: int, status: str, db: Session = Depends(get_db)):
    # Met à jour le statut d'un constat de sécurité.
    valid_status = ["Ouverte", "En cours", "Corrigée"]
    if status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {status}")

    finding = db.query(SecurityFinding).filter(SecurityFinding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Constat non trouvé")

    finding.status = status
    db.commit()
    db.refresh(finding)
    return finding


@app.delete("/security/findings/{finding_id}")
def delete_security_finding(finding_id: int, db: Session = Depends(get_db)):
    # Supprime un constat de sécurité.
    finding = db.query(SecurityFinding).filter(SecurityFinding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Constat non trouvé")

    db.delete(finding)
    db.commit()
    return {"success": True}


@app.get("/security/policy", response_model=SecurityPolicyResponse)
def get_security_policy(db: Session = Depends(get_db)):
    policy = _get_or_create_security_policy(db)
    return SecurityPolicyResponse(
        stale_endpoint_hours=policy.stale_endpoint_hours,
        unmanaged_lan_severity=policy.unmanaged_lan_severity,
        stale_endpoint_severity=policy.stale_endpoint_severity,
        endpoint_offline_after_minutes=policy.endpoint_offline_after_minutes,
        endpoint_offline_grace_cycles=policy.endpoint_offline_grace_cycles,
    )


@app.put("/security/policy", response_model=SecurityPolicyResponse)
def update_security_policy(payload: SecurityPolicyUpdate, db: Session = Depends(get_db)):
    valid_severity = ["Faible", "Moyenne", "Élevée", "Critique"]
    if payload.stale_endpoint_hours < 1 or payload.stale_endpoint_hours > 24 * 30:
        raise HTTPException(status_code=400, detail="stale_endpoint_hours doit être entre 1 et 720")
    if payload.unmanaged_lan_severity not in valid_severity:
        raise HTTPException(status_code=400, detail="unmanaged_lan_severity invalide")
    if payload.stale_endpoint_severity not in valid_severity:
        raise HTTPException(status_code=400, detail="stale_endpoint_severity invalide")
    if payload.endpoint_offline_after_minutes is not None and (payload.endpoint_offline_after_minutes < 1 or payload.endpoint_offline_after_minutes > 60):
        raise HTTPException(status_code=400, detail="endpoint_offline_after_minutes doit être entre 1 et 60")
    if payload.endpoint_offline_grace_cycles is not None and (payload.endpoint_offline_grace_cycles < 1 or payload.endpoint_offline_grace_cycles > 12):
        raise HTTPException(status_code=400, detail="endpoint_offline_grace_cycles doit être entre 1 et 12")

    policy = _get_or_create_security_policy(db)
    policy.stale_endpoint_hours = payload.stale_endpoint_hours
    policy.unmanaged_lan_severity = payload.unmanaged_lan_severity
    policy.stale_endpoint_severity = payload.stale_endpoint_severity
    if payload.endpoint_offline_after_minutes is not None:
        policy.endpoint_offline_after_minutes = payload.endpoint_offline_after_minutes
    if payload.endpoint_offline_grace_cycles is not None:
        policy.endpoint_offline_grace_cycles = payload.endpoint_offline_grace_cycles
    db.commit()
    db.refresh(policy)

    return SecurityPolicyResponse(
        stale_endpoint_hours=policy.stale_endpoint_hours,
        unmanaged_lan_severity=policy.unmanaged_lan_severity,
        stale_endpoint_severity=policy.stale_endpoint_severity,
        endpoint_offline_after_minutes=policy.endpoint_offline_after_minutes,
        endpoint_offline_grace_cycles=policy.endpoint_offline_grace_cycles,
    )


@app.post("/security/recalculate")
def recalculate_security_findings(db: Session = Depends(get_db)):
    posture_items = db.query(EndpointSecurityPosture).all()
    for item in posture_items:
        _generate_findings_from_posture(item, db)
    return {"success": True, "processed": len(posture_items)}


@app.get("/security/posture", response_model=List[EndpointSecurityPostureResponse])
def get_security_posture(db: Session = Depends(get_db)):
    # Expose les derniers états de posture collectés sur les endpoints.
    posture = db.query(EndpointSecurityPosture).order_by(EndpointSecurityPosture.last_seen.desc()).all()
    return posture


@app.get("/network/unknown-devices", response_model=List[UnknownDeviceResponse])
def get_unknown_devices(active_minutes: int = 5, db: Session = Depends(get_db)):
    # Retourne immédiatement les appareils vus sur le réseau mais absents de la base d'assets.
    if active_minutes < 1 or active_minutes > 120:
        raise HTTPException(status_code=400, detail="active_minutes doit être entre 1 et 120")

    threshold = datetime.utcnow() - timedelta(minutes=active_minutes)
    unknown = db.query(EndpointSecurityPosture).filter(
        EndpointSecurityPosture.asset_id.is_(None),
        EndpointSecurityPosture.last_seen >= threshold,
    ).order_by(EndpointSecurityPosture.last_seen.desc()).all()

    return [
        UnknownDeviceResponse(
            hostname=item.hostname,
            serial_number=item.serial_number,
            ip_address=item.ip_address,
            source=item.source,
            first_seen=item.first_seen,
            last_seen=item.last_seen,
        )
        for item in unknown
    ]


@app.post("/metrics/resources", response_model=ResourceMetricResponse)
def upsert_resource_metric(payload: ResourceMetricPayload, db: Session = Depends(get_db)):
    # Enregistre la dernière télémétrie CPU/RAM/Stockage d'un équipement.
    serial = (payload.serial_number or "").strip()
    if not serial:
        raise HTTPException(status_code=400, detail="serial_number est obligatoire")

    asset = db.query(Asset).filter(Asset.serial_number == serial).first()
    metric = db.query(EndpointResourceMetric).filter(EndpointResourceMetric.serial_number == serial).first()
    normalized_source = _normalize_agent_source(payload.source, payload.agent_source)

    _log_agent_ingest(
        db,
        serial_number=serial,
        metric_type="resource_metrics",
        source=payload.source,
        agent_source=normalized_source,
        agent_version=payload.agent_version,
        agent_id=payload.agent_id,
        payload_json=payload.dict(),
    )

    if not metric:
        metric = EndpointResourceMetric(serial_number=serial, hostname=payload.hostname)
        db.add(metric)

    if _should_replace_consolidated(metric.source, normalized_source):
        metric.hostname = payload.hostname
        metric.source = normalized_source
        metric.cpu_percent = payload.cpu_percent
        metric.ram_total_gb = payload.ram_total_gb
        metric.ram_used_gb = payload.ram_used_gb
        metric.disk_total_gb = payload.disk_total_gb
        metric.disk_used_gb = payload.disk_used_gb
        metric.asset_id = asset.id if asset else None

    db.commit()
    db.refresh(metric)
    return metric


@app.get("/metrics/resources", response_model=ResourceOverviewResponse)
def get_resource_metrics(db: Session = Depends(get_db)):
    # Retourne la vue de supervision des ressources pour tous les équipements.
    metrics = db.query(EndpointResourceMetric).all()
    metric_by_serial = {m.serial_number: m for m in metrics}

    items: List[ResourceOverviewItem] = []
    assets = db.query(Asset).all()

    for asset in assets:
        metric = metric_by_serial.get(asset.serial_number)
        if metric:
            items.append(ResourceOverviewItem(
                serial_number=asset.serial_number,
                hostname=metric.hostname or asset.serial_number,
                model=asset.model,
                source=metric.source or "local_agent",
                status="reporting" if metric.cpu_percent is not None or metric.ram_used_gb is not None or metric.disk_used_gb is not None else "pending",
                cpu_percent=metric.cpu_percent,
                ram_total_gb=metric.ram_total_gb,
                ram_used_gb=metric.ram_used_gb,
                disk_total_gb=metric.disk_total_gb,
                disk_used_gb=metric.disk_used_gb,
                last_seen=metric.last_seen,
            ))
        else:
            source = "ad_sync" if (asset.description or "").startswith("Import AD") else "inventory"
            items.append(ResourceOverviewItem(
                serial_number=asset.serial_number,
                hostname=asset.serial_number,
                model=asset.model,
                source=source,
                status="pending",
                cpu_percent=None,
                ram_total_gb=None,
                ram_used_gb=None,
                disk_total_gb=None,
                disk_used_gb=None,
                last_seen=None,
            ))

    reporting = sum(1 for item in items if item.status == "reporting")
    pending = sum(1 for item in items if item.status == "pending")

    return ResourceOverviewResponse(
        generated_at=datetime.utcnow().isoformat(),
        total_devices=len(items),
        reporting_devices=reporting,
        pending_devices=pending,
        items=items,
    )


@app.post("/network/telemetry")
def ingest_network_telemetry(payload: NetworkTelemetryIngestPayload, db: Session = Depends(get_db)):
    # Ingestion des informations réseau: ports ouverts et logs de sonde LAN.
    processed = 0
    kept_history = 0
    touched_serials: set[str] = set()
    for host in payload.hosts:
        serial = (host.serial_number or "").strip()
        if not serial:
            continue

        normalized_source = _normalize_agent_source(host.source, host.agent_source)
        _log_agent_ingest(
            db,
            serial_number=serial,
            metric_type="network_telemetry",
            source=host.source,
            agent_source=normalized_source,
            agent_version=host.agent_version,
            agent_id=host.agent_id,
            payload_json=host.dict(),
        )
        kept_history += 1

        asset = db.query(Asset).filter(Asset.serial_number == serial).first()
        item = db.query(NetworkTelemetry).filter(NetworkTelemetry.serial_number == serial).first()
        if not item:
            item = NetworkTelemetry(serial_number=serial, hostname=host.hostname)
            db.add(item)

        if _should_replace_consolidated(item.source, normalized_source):
            item.hostname = host.hostname
            item.ip_address = host.ip_address
            item.source = normalized_source
            item.open_ports_json = host.open_ports or []
            item.logs_json = host.logs or []
            item.asset_id = asset.id if asset else None
            _emit_siem_event(
                db,
                source=normalized_source,
                event_type="network.telemetry",
                severity="info",
                host_serial=serial,
                host_name=host.hostname,
                host_ip=host.ip_address,
                outcome="success",
                message="Télémétrie réseau reçue",
                payload_json={
                    "open_ports": host.open_ports or [],
                    "log_count": len(host.logs or []),
                },
            )
            touched_serials.add(serial)
        processed += 1

    for serial in touched_serials:
        _run_siem_rules_for_host(db, serial)

    db.commit()
    return {"success": True, "processed": processed, "kept_history": kept_history}


@app.get("/network/ports-logs", response_model=NetworkTelemetryOverviewResponse)
def get_network_ports_logs(db: Session = Depends(get_db)):
    # Vue consolidée de tous les équipements LAN avec ports ouverts et logs.
    items_db = db.query(NetworkTelemetry).order_by(NetworkTelemetry.last_seen.desc()).all()
    item_by_serial: Dict[str, NetworkTelemetryItemResponse] = {}

    for i in items_db:
        open_ports = i.open_ports_json or []
        logs = i.logs_json or []
        status = "reporting" if (len(open_ports) > 0 or len(logs) > 0 or (i.source or "") != "ad_sync") else "pending"
        item_by_serial[i.serial_number] = NetworkTelemetryItemResponse(
            serial_number=i.serial_number,
            hostname=i.hostname,
            ip_address=i.ip_address,
            source=i.source,
            status=status,
            open_ports=open_ports,
            logs=logs,
            asset_id=i.asset_id,
            last_seen=i.last_seen,
        )

    assets = db.query(Asset).all()
    for asset in assets:
        if asset.serial_number in item_by_serial:
            continue
        source = "ad_sync" if (asset.description or "").startswith("Import AD") else "inventory"
        item_by_serial[asset.serial_number] = NetworkTelemetryItemResponse(
            serial_number=asset.serial_number,
            hostname=asset.serial_number,
            ip_address=None,
            source=source,
            status="pending",
            open_ports=[],
            logs=[],
            asset_id=asset.id,
            last_seen=None,
        )

    items = sorted(
        item_by_serial.values(),
        key=lambda item: (
            item.status != "reporting",
            -(item.last_seen.timestamp() if item.last_seen else 0),
            item.hostname.lower(),
        ),
    )
    hosts_with_open_ports = sum(1 for i in items if len(i.open_ports) > 0)
    return NetworkTelemetryOverviewResponse(
        generated_at=datetime.utcnow().isoformat(),
        total_hosts=len(items),
        hosts_with_open_ports=hosts_with_open_ports,
        items=items,
    )


@app.get("/agents/dual-run/compare/{serial_number}", response_model=DualRunComparisonResponse)
def get_dual_run_compare(serial_number: str, db: Session = Depends(get_db)):
    # Compare les derniers payloads PS1 et Go pour chaque type de métrique d'un poste.
    serial = (serial_number or "").strip()
    if not serial:
        raise HTTPException(status_code=400, detail="serial_number est obligatoire")

    rows = db.query(AgentIngestLog).filter(
        AgentIngestLog.serial_number == serial,
        AgentIngestLog.agent_source.in_(["ps1", "go"]),
    ).order_by(AgentIngestLog.received_at.desc()).all()

    latest_by_metric = {}
    for row in rows:
        metric_type = (row.metric_type or "unknown").strip()
        source = (row.agent_source or "").strip().lower()
        if metric_type not in latest_by_metric:
            latest_by_metric[metric_type] = {"ps1": None, "go": None}
        if source in ["ps1", "go"] and latest_by_metric[metric_type][source] is None:
            latest_by_metric[metric_type][source] = row

    items: List[DualRunComparisonItem] = []
    ignored_keys = {"agent_source", "agent_version", "agent_id", "source"}

    for metric_type in sorted(latest_by_metric.keys()):
        ps1_row = latest_by_metric[metric_type]["ps1"]
        go_row = latest_by_metric[metric_type]["go"]

        ps1_payload = ps1_row.payload_json if ps1_row and isinstance(ps1_row.payload_json, dict) else {}
        go_payload = go_row.payload_json if go_row and isinstance(go_row.payload_json, dict) else {}

        common_keys = sorted((set(ps1_payload.keys()) & set(go_payload.keys())) - ignored_keys)
        mismatch_keys = [key for key in common_keys if ps1_payload.get(key) != go_payload.get(key)]

        items.append(DualRunComparisonItem(
            metric_type=metric_type,
            ps1_received_at=ps1_row.received_at if ps1_row else None,
            go_received_at=go_row.received_at if go_row else None,
            winner=_dual_run_winner(ps1_row.received_at if ps1_row else None, go_row.received_at if go_row else None),
            compared_fields=len(common_keys),
            mismatched_fields=len(mismatch_keys),
            mismatch_keys=mismatch_keys,
        ))

    return DualRunComparisonResponse(
        serial_number=serial,
        generated_at=datetime.utcnow().isoformat(),
        items=items,
    )


@app.get("/agents/dual-run/health", response_model=DualRunHealthResponse)
def get_dual_run_health(active_minutes: int = 60, db: Session = Depends(get_db)):
    # Résume la santé dual-run (PS1 vs Go) sur l'ensemble des postes.
    if active_minutes < 1 or active_minutes > 1440:
        raise HTTPException(status_code=400, detail="active_minutes doit être entre 1 et 1440")

    threshold = datetime.utcnow() - timedelta(minutes=active_minutes)
    grouped = db.query(
        AgentIngestLog.serial_number,
        AgentIngestLog.agent_source,
        func.max(AgentIngestLog.received_at).label("last_seen"),
    ).filter(
        AgentIngestLog.agent_source.in_(["ps1", "go"])
    ).group_by(
        AgentIngestLog.serial_number,
        AgentIngestLog.agent_source,
    ).all()

    by_serial: Dict[str, Dict[str, Optional[datetime]]] = {}
    for row in grouped:
        serial = row.serial_number
        source = (row.agent_source or "").lower()
        if serial not in by_serial:
            by_serial[serial] = {"ps1": None, "go": None}
        if source in ["ps1", "go"]:
            by_serial[serial][source] = row.last_seen

    items: List[DualRunHealthItem] = []
    both_active = 0
    ps1_only = 0
    go_only = 0
    none_recent = 0

    for serial in sorted(by_serial.keys()):
        last_ps1 = by_serial[serial].get("ps1")
        last_go = by_serial[serial].get("go")
        ps1_recent = bool(last_ps1 and last_ps1 >= threshold)
        go_recent = bool(last_go and last_go >= threshold)

        if ps1_recent and go_recent:
            both_active += 1
        elif ps1_recent:
            ps1_only += 1
        elif go_recent:
            go_only += 1
        else:
            none_recent += 1

        items.append(DualRunHealthItem(
            serial_number=serial,
            last_ps1=last_ps1,
            last_go=last_go,
            active_source=_dual_run_winner(last_ps1, last_go),
            ps1_recent=ps1_recent,
            go_recent=go_recent,
        ))

    return DualRunHealthResponse(
        generated_at=datetime.utcnow().isoformat(),
        active_window_minutes=active_minutes,
        total_hosts=len(items),
        both_active=both_active,
        ps1_only=ps1_only,
        go_only=go_only,
        none_recent=none_recent,
        items=items,
    )


@app.post("/security/posture", response_model=EndpointSecurityPostureResponse)
def upsert_security_posture(payload: EndpointSecurityPosturePayload, db: Session = Depends(get_db)):
    # Enregistre ou met à jour la posture de sécurité d'un endpoint scanné localement.
    normalized_source = _normalize_agent_source(payload.source, payload.agent_source)
    _log_agent_ingest(
        db,
        serial_number=payload.serial_number,
        metric_type="security_posture",
        source=payload.source,
        agent_source=normalized_source,
        agent_version=payload.agent_version,
        agent_id=payload.agent_id,
        payload_json=payload.dict(),
    )

    asset = db.query(Asset).filter(Asset.serial_number == payload.serial_number).first()
    posture = db.query(EndpointSecurityPosture).filter(EndpointSecurityPosture.serial_number == payload.serial_number).first()

    if not posture:
        posture = EndpointSecurityPosture(serial_number=payload.serial_number, hostname=payload.hostname)
        db.add(posture)
        db.flush()

    if _should_replace_consolidated(posture.source, normalized_source):
        posture.hostname = payload.hostname
        posture.ip_address = payload.ip_address
        posture.source = normalized_source
        posture.os = payload.os
        posture.firewall_enabled = payload.firewall_enabled
        posture.defender_enabled = payload.defender_enabled
        posture.realtime_protection_enabled = payload.realtime_protection_enabled
        posture.bitlocker_enabled = payload.bitlocker_enabled
        posture.pending_reboot = payload.pending_reboot
        posture.asset_id = asset.id if asset else None

        _emit_siem_event(
            db,
            source=normalized_source,
            event_type="endpoint.security_posture",
            severity="info",
            host_serial=payload.serial_number,
            host_name=payload.hostname,
            host_ip=payload.ip_address,
            outcome="success",
            message="Posture de sécurité reçue",
            payload_json={
                "firewall_enabled": payload.firewall_enabled,
                "defender_enabled": payload.defender_enabled,
                "bitlocker_enabled": payload.bitlocker_enabled,
                "pending_reboot": payload.pending_reboot,
            },
        )

        _run_siem_rules_for_host(db, payload.serial_number)

    db.commit()
    db.refresh(posture)

    # Genère automatiquement les findings défensifs basés sur la posture.
    _generate_findings_from_posture(posture, db)

    return posture


@app.get("/security/summary", response_model=SecuritySummaryResponse)
def get_security_summary(db: Session = Depends(get_db)):
    # Fournit des indicateurs synthétiques pour le centre de sécurité.
    total_findings = db.query(SecurityFinding).count()
    critical_findings = db.query(SecurityFinding).filter(SecurityFinding.severity == "Critique").count()
    open_findings = db.query(SecurityFinding).filter(SecurityFinding.status != "Corrigée").count()
    monitored_endpoints = db.query(EndpointSecurityPosture).count()
    return SecuritySummaryResponse(
        total_findings=total_findings,
        critical_findings=critical_findings,
        open_findings=open_findings,
        monitored_endpoints=monitored_endpoints,
    )


@app.get("/siem/events", response_model=List[SiemEventResponse])
def get_siem_events(
    limit: int = 200,
    severity: Optional[str] = None,
    host_serial: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Consultation des événements normalisés (mini-SIEM).
    safe_limit = max(1, min(limit, 1000))
    query = db.query(SiemEvent)
    if severity:
        query = query.filter(func.lower(SiemEvent.severity) == severity.lower())
    if host_serial:
        query = query.filter(SiemEvent.host_serial == host_serial)
    return query.order_by(SiemEvent.timestamp.desc()).limit(safe_limit).all()


@app.post("/siem/auth-events")
def ingest_siem_auth_events(payload: AuthEventsIngestPayload, db: Session = Depends(get_db)):
    # Ingestion des journaux d'authentification (succès/échec/verrouillage).
    if not payload.host_serial.strip():
        raise HTTPException(status_code=400, detail="host_serial est obligatoire")

    source = _normalize_agent_source(payload.source, payload.source)
    processed = 0
    skipped_duplicates = 0
    failures_by_key: Dict[str, int] = {}

    for entry in payload.events:
        outcome = _normalize_auth_outcome(entry.event_id, entry.outcome)
        event_type = _auth_event_type(outcome)
        severity = _auth_severity(outcome)
        if entry.record_id is not None:
            dedupe_message = f"auth_record:{payload.host_serial}:{entry.event_id}:{entry.record_id}"
        else:
            ts_part = entry.timestamp.isoformat() if entry.timestamp else "no_ts"
            user_part = (entry.user_name or "unknown").strip().lower()
            src_part = (entry.source_ip or "unknown").strip().lower()
            dedupe_message = f"auth_fallback:{payload.host_serial}:{entry.event_id}:{ts_part}:{user_part}:{src_part}"

        existing = db.query(SiemEvent).filter(
            SiemEvent.host_serial == payload.host_serial,
            SiemEvent.event_type == event_type,
            SiemEvent.message == dedupe_message,
        ).first()
        if existing:
            skipped_duplicates += 1
            continue

        event_payload = {
            "event_id": entry.event_id,
            "record_id": entry.record_id,
            "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
            "user_name": entry.user_name,
            "domain": entry.domain,
            "source_ip": entry.source_ip,
            "logon_type": entry.logon_type,
            "outcome": outcome,
            "message": entry.message,
        }

        _emit_siem_event(
            db,
            source=source,
            event_type=event_type,
            severity=severity,
            timestamp=entry.timestamp,
            host_serial=payload.host_serial,
            host_name=payload.host_name,
            host_ip=payload.host_ip,
            user_name=entry.user_name,
            outcome=outcome,
            message=dedupe_message,
            payload_json=event_payload,
        )
        processed += 1

        if outcome == "failure":
            actor = (entry.user_name or "unknown").strip().lower()
            src_ip = (entry.source_ip or "unknown").strip().lower()
            key = f"{actor}|{src_ip}"
            failures_by_key[key] = failures_by_key.get(key, 0) + 1

        if outcome == "lockout":
            actor = (entry.user_name or "unknown").strip().lower()
            _upsert_siem_alert(
                db,
                fingerprint=f"auth_lockout:{payload.host_serial}:{actor}",
                rule_id="AUTH_ACCOUNT_LOCKOUT",
                severity="Critique",
                host_serial=payload.host_serial,
                host_name=payload.host_name,
                title="Compte verrouillé détecté",
                description="Un verrouillage de compte a été observé sur cet endpoint.",
                evidence={
                    "user_name": entry.user_name,
                    "source_ip": entry.source_ip,
                    "event_id": entry.event_id,
                },
                triggered=True,
            )

    for key, count in failures_by_key.items():
        if count < 5:
            continue
        actor, src_ip = key.split("|", 1)
        _upsert_siem_alert(
            db,
            fingerprint=f"auth_bruteforce:{payload.host_serial}:{actor}:{src_ip}",
            rule_id="AUTH_BRUTEFORCE_SUSPECTED",
            severity="Élevée",
            host_serial=payload.host_serial,
            host_name=payload.host_name,
            title="Tentatives de connexion en échec répétées",
            description="Au moins 5 échecs d'authentification observés pour le même compte/source.",
            evidence={"user_name": actor, "source_ip": src_ip, "failure_count": count},
            triggered=True,
        )

    db.commit()
    return {"success": True, "processed": processed, "skipped_duplicates": skipped_duplicates}


@app.get("/siem/auth-events", response_model=List[SiemEventResponse])
def get_siem_auth_events(limit: int = 200, host_serial: Optional[str] = None, outcome: Optional[str] = None, hours: Optional[int] = None, db: Session = Depends(get_db)):
    # Consultation ciblée des événements d'authentification.
    safe_limit = max(1, min(limit, 1000))
    query = db.query(SiemEvent).filter(SiemEvent.event_type.like("auth.%"))
    if host_serial:
        query = query.filter(SiemEvent.host_serial == host_serial)
    if outcome:
        query = query.filter(func.lower(SiemEvent.outcome) == outcome.lower())
    if hours is not None:
        safe_hours = max(1, min(hours, 168))
        since = datetime.utcnow() - timedelta(hours=safe_hours)
        query = query.filter(SiemEvent.timestamp >= since)
    return query.order_by(SiemEvent.timestamp.desc()).limit(safe_limit).all()


@app.get("/siem/auth-summary", response_model=AuthSummaryResponse)
def get_siem_auth_summary(hours: int = 24, host_serial: Optional[str] = None, db: Session = Depends(get_db)):
    # Statistiques de connexions/échecs/verrouillages pour monitoring auth.
    safe_hours = max(1, min(hours, 168))
    since = datetime.utcnow() - timedelta(hours=safe_hours)

    query = db.query(SiemEvent).filter(
        SiemEvent.event_type.like("auth.%"),
        SiemEvent.timestamp >= since,
    )
    if host_serial:
        query = query.filter(SiemEvent.host_serial == host_serial)

    events = query.order_by(SiemEvent.timestamp.asc()).all()

    success = 0
    failure = 0
    lockout = 0
    users = set()
    src_ips = set()
    failed_users: Dict[str, int] = {}
    failed_ips: Dict[str, int] = {}

    # Prépare les buckets horaires glissants (dernieres N heures).
    bucket_map: Dict[str, Dict[str, int]] = {}
    for i in range(safe_hours):
        h = (since + timedelta(hours=i)).replace(minute=0, second=0, microsecond=0)
        key = h.isoformat()
        bucket_map[key] = {"success": 0, "failure": 0, "lockout": 0}

    for ev in events:
        outcome = (ev.outcome or "").lower()
        payload = ev.payload_json if isinstance(ev.payload_json, dict) else {}
        user_name = (ev.user_name or payload.get("user_name") or "").strip()
        source_ip = (payload.get("source_ip") or "").strip()

        if user_name:
            users.add(user_name.lower())
        if source_ip and source_ip not in ["-", "::1", "127.0.0.1"]:
            src_ips.add(source_ip)

        if outcome == "success":
            success += 1
        elif outcome == "failure":
            failure += 1
            if user_name:
                key = user_name.lower()
                failed_users[key] = failed_users.get(key, 0) + 1
            if source_ip:
                failed_ips[source_ip] = failed_ips.get(source_ip, 0) + 1
        elif outcome == "lockout":
            lockout += 1

        hour_key = ev.timestamp.replace(minute=0, second=0, microsecond=0).isoformat()
        if hour_key not in bucket_map:
            bucket_map[hour_key] = {"success": 0, "failure": 0, "lockout": 0}

        if outcome == "success":
            bucket_map[hour_key]["success"] += 1
        elif outcome == "failure":
            bucket_map[hour_key]["failure"] += 1
        elif outcome == "lockout":
            bucket_map[hour_key]["lockout"] += 1

    top_users = sorted(failed_users.items(), key=lambda x: x[1], reverse=True)[:10]
    top_ips = sorted(failed_ips.items(), key=lambda x: x[1], reverse=True)[:10]
    hourly_items = [
        AuthSummaryHourlyItem(
            hour=key,
            success=value["success"],
            failure=value["failure"],
            lockout=value["lockout"],
        )
        for key, value in sorted(bucket_map.items(), key=lambda x: x[0])
    ]

    return AuthSummaryResponse(
        generated_at=datetime.utcnow().isoformat(),
        hours=safe_hours,
        host_serial=host_serial,
        total_events=len(events),
        success_events=success,
        failure_events=failure,
        lockout_events=lockout,
        unique_users=len(users),
        unique_source_ips=len(src_ips),
        top_failed_users=[AuthSummaryTopItem(key=k, count=v) for k, v in top_users],
        top_failed_source_ips=[AuthSummaryTopItem(key=k, count=v) for k, v in top_ips],
        hourly=hourly_items,
    )


@app.post("/siem/download-events")
def ingest_siem_download_events(payload: DownloadEventsIngestPayload, db: Session = Depends(get_db)):
    # Ingestion des téléchargements observés localement.
    if not payload.host_serial.strip():
        raise HTTPException(status_code=400, detail="host_serial est obligatoire")

    source = _normalize_agent_source(payload.source, payload.source)
    processed = 0
    for entry in payload.events:
        _emit_siem_event(
            db,
            source=source,
            event_type="file.download",
            severity="info",
            host_serial=payload.host_serial,
            host_name=payload.host_name,
            host_ip=payload.host_ip,
            user_name=entry.user_name,
            outcome="success",
            message=f"download:{entry.path}",
            payload_json={
                "path": entry.path,
                "file_name": entry.file_name,
                "size_bytes": entry.size_bytes,
                "modified_at": entry.modified_at.isoformat() if entry.modified_at else None,
            },
        )
        processed += 1

    db.commit()
    return {"success": True, "processed": processed}


@app.post("/siem/web-events")
def ingest_siem_web_events(payload: WebConnectionsIngestPayload, db: Session = Depends(get_db)):
    # Ingestion des connexions web sortantes (visibilité réseau locale).
    if not payload.host_serial.strip():
        raise HTTPException(status_code=400, detail="host_serial est obligatoire")

    source = _normalize_agent_source(payload.source, payload.source)
    processed = 0
    for entry in payload.events:
        _emit_siem_event(
            db,
            source=source,
            event_type="network.web_connection",
            severity="info",
            host_serial=payload.host_serial,
            host_name=payload.host_name,
            host_ip=payload.host_ip,
            outcome="observed",
            message=f"web:{entry.remote_ip}:{entry.remote_port}",
            payload_json={
                "remote_ip": entry.remote_ip,
                "remote_port": entry.remote_port,
                "domain": entry.domain,
                "process_name": entry.process_name,
                "protocol": entry.protocol,
            },
        )
        processed += 1

    db.commit()
    return {"success": True, "processed": processed}


@app.get("/siem/alerts", response_model=List[SiemAlertResponse])
def get_siem_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    host_serial: Optional[str] = None,
    db: Session = Depends(get_db),
):
    # Liste des alertes de corrélation internes.
    query = db.query(SiemAlert)
    if status:
        query = query.filter(SiemAlert.status == status)
    if severity:
        query = query.filter(func.lower(SiemAlert.severity) == severity.lower())
    if host_serial:
        query = query.filter(SiemAlert.host_serial == host_serial)
    return query.order_by(SiemAlert.updated_at.desc()).all()


@app.patch("/siem/alerts/{alert_id}", response_model=SiemAlertResponse)
def update_siem_alert(alert_id: int, payload: SiemAlertUpdate, db: Session = Depends(get_db)):
    # Met à jour le statut d'une alerte (workflow analyste).
    valid_status = ["Nouvelle", "En cours", "Résolue", "Faux positif"]
    if payload.status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {payload.status}. Valeurs acceptées: {valid_status}")

    alert = db.query(SiemAlert).filter(SiemAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alerte introuvable")

    alert.status = payload.status
    db.commit()
    db.refresh(alert)
    return alert


@app.post("/siem/rules/run")
def run_siem_rules(db: Session = Depends(get_db)):
    # Rejoue les règles SIEM sur les hôtes connus.
    serials = set()
    serials.update([row.serial_number for row in db.query(EndpointSecurityPosture.serial_number).all() if row.serial_number])
    serials.update([row.serial_number for row in db.query(NetworkTelemetry.serial_number).all() if row.serial_number])

    for serial in serials:
        _run_siem_rules_for_host(db, serial)

    db.commit()
    open_alerts = db.query(SiemAlert).filter(SiemAlert.status.in_(["Nouvelle", "En cours"])).count()
    return {"success": True, "hosts_evaluated": len(serials), "open_alerts": open_alerts}


@app.get("/siem/timeline/{host_serial}", response_model=SiemTimelineResponse)
def get_siem_timeline(host_serial: str, limit: int = 300, db: Session = Depends(get_db)):
    # Construit une timeline d'investigation unique pour un host.
    serial = (host_serial or "").strip()
    if not serial:
        raise HTTPException(status_code=400, detail="host_serial est obligatoire")

    safe_limit = max(1, min(limit, 1000))
    events = db.query(SiemEvent).filter(SiemEvent.host_serial == serial).all()
    alerts = db.query(SiemAlert).filter(SiemAlert.host_serial == serial).all()

    items: List[SiemTimelineItem] = []

    for ev in events:
        items.append(SiemTimelineItem(
            timestamp=ev.timestamp,
            item_type="event",
            severity=ev.severity,
            title=ev.event_type,
            description=ev.message or "Événement SIEM",
            source=ev.source,
            event_type=ev.event_type,
            data=ev.payload_json if isinstance(ev.payload_json, dict) else {},
        ))

    for al in alerts:
        items.append(SiemTimelineItem(
            timestamp=al.updated_at or al.created_at,
            item_type="alert",
            severity=al.severity,
            title=al.title,
            description=al.description,
            source="siem_rule",
            status=al.status,
            rule_id=al.rule_id,
            data=al.evidence_json if isinstance(al.evidence_json, dict) else {},
        ))

    items = sorted(items, key=lambda i: i.timestamp, reverse=True)[:safe_limit]

    return SiemTimelineResponse(
        host_serial=serial,
        generated_at=datetime.utcnow().isoformat(),
        total_items=len(items),
        items=items,
    )


@app.get("/incidents", response_model=List[IncidentResponse])
def get_incidents(db: Session = Depends(get_db)):
    # Retourne tous les incidents avec les informations d'affichage utiles à l'IHM.
    incidents = db.query(Incident).options(
        joinedload(Incident.asset),
        joinedload(Incident.reporter)
    ).order_by(Incident.created_at.desc(), Incident.id.desc()).all()

    return [
        IncidentResponse(
            id=inc.id,
            title=inc.title,
            description=inc.description,
            status=inc.status,
            priority=inc.priority,
            asset_id=inc.asset_id,
            reported_by_user_id=inc.reported_by_user_id,
            created_at=inc.created_at,
            resolved_at=inc.resolved_at,
            asset_label=(f"{inc.asset.serial_number} - {inc.asset.model}" if inc.asset else None),
            reporter_name=(f"{inc.reporter.firstname + ' ' if inc.reporter and inc.reporter.firstname else ''}{inc.reporter.name}" if inc.reporter else None),
        )
        for inc in incidents
    ]


@app.post("/incidents", response_model=IncidentResponse)
def create_incident(incident: IncidentCreate, db: Session = Depends(get_db)):
    # Crée un incident puis renvoie la ressource enrichie.
    valid_status = ["Ouvert", "En cours", "Résolu"]
    valid_priority = ["Basse", "Moyenne", "Haute", "Critique"]
    if incident.status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {incident.status}. Valeurs acceptées: {valid_status}")
    if incident.priority not in valid_priority:
        raise HTTPException(status_code=400, detail=f"Priorité invalide: {incident.priority}. Valeurs acceptées: {valid_priority}")

    if incident.asset_id and not db.query(Asset).filter(Asset.id == incident.asset_id).first():
        raise HTTPException(status_code=404, detail="Matériel non trouvé")
    if incident.reported_by_user_id and not db.query(User).filter(User.id == incident.reported_by_user_id).first():
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    db_incident = Incident(
        title=incident.title,
        description=incident.description,
        status=incident.status,
        priority=incident.priority,
        asset_id=incident.asset_id,
        reported_by_user_id=incident.reported_by_user_id,
        resolved_at=datetime.utcnow() if incident.status == "Résolu" else None,
    )
    db.add(db_incident)
    db.commit()
    db.refresh(db_incident)

    asset = db.query(Asset).filter(Asset.id == db_incident.asset_id).first() if db_incident.asset_id else None
    reporter = db.query(User).filter(User.id == db_incident.reported_by_user_id).first() if db_incident.reported_by_user_id else None
    return IncidentResponse(
        id=db_incident.id,
        title=db_incident.title,
        description=db_incident.description,
        status=db_incident.status,
        priority=db_incident.priority,
        asset_id=db_incident.asset_id,
        reported_by_user_id=db_incident.reported_by_user_id,
        created_at=db_incident.created_at,
        resolved_at=db_incident.resolved_at,
        asset_label=(f"{asset.serial_number} - {asset.model}" if asset else None),
        reporter_name=(f"{reporter.firstname + ' ' if reporter and reporter.firstname else ''}{reporter.name}" if reporter else None),
    )


@app.put("/incidents/{incident_id}", response_model=IncidentResponse)
def update_incident(incident_id: int, incident: IncidentCreate, db: Session = Depends(get_db)):
    # Met à jour un incident existant.
    db_incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not db_incident:
        raise HTTPException(status_code=404, detail="Incident non trouvé")

    valid_status = ["Ouvert", "En cours", "Résolu"]
    valid_priority = ["Basse", "Moyenne", "Haute", "Critique"]
    if incident.status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {incident.status}. Valeurs acceptées: {valid_status}")
    if incident.priority not in valid_priority:
        raise HTTPException(status_code=400, detail=f"Priorité invalide: {incident.priority}. Valeurs acceptées: {valid_priority}")

    if incident.asset_id and not db.query(Asset).filter(Asset.id == incident.asset_id).first():
        raise HTTPException(status_code=404, detail="Matériel non trouvé")
    if incident.reported_by_user_id and not db.query(User).filter(User.id == incident.reported_by_user_id).first():
        raise HTTPException(status_code=404, detail="Utilisateur non trouvé")

    previous_status = db_incident.status
    db_incident.title = incident.title
    db_incident.description = incident.description
    db_incident.status = incident.status
    db_incident.priority = incident.priority
    db_incident.asset_id = incident.asset_id
    db_incident.reported_by_user_id = incident.reported_by_user_id

    if incident.status == "Résolu" and previous_status != "Résolu":
        db_incident.resolved_at = datetime.utcnow()
    elif incident.status != "Résolu":
        db_incident.resolved_at = None

    db.commit()
    db.refresh(db_incident)

    asset = db.query(Asset).filter(Asset.id == db_incident.asset_id).first() if db_incident.asset_id else None
    reporter = db.query(User).filter(User.id == db_incident.reported_by_user_id).first() if db_incident.reported_by_user_id else None
    return IncidentResponse(
        id=db_incident.id,
        title=db_incident.title,
        description=db_incident.description,
        status=db_incident.status,
        priority=db_incident.priority,
        asset_id=db_incident.asset_id,
        reported_by_user_id=db_incident.reported_by_user_id,
        created_at=db_incident.created_at,
        resolved_at=db_incident.resolved_at,
        asset_label=(f"{asset.serial_number} - {asset.model}" if asset else None),
        reporter_name=(f"{reporter.firstname + ' ' if reporter and reporter.firstname else ''}{reporter.name}" if reporter else None),
    )


@app.delete("/incidents/{incident_id}")
def delete_incident(incident_id: int, db: Session = Depends(get_db)):
    # Supprime un incident.
    db_incident = db.query(Incident).filter(Incident.id == incident_id).first()
    if not db_incident:
        raise HTTPException(status_code=404, detail="Incident non trouvé")

    db.delete(db_incident)
    db.commit()
    return {"success": True}


@app.get("/it-projects", response_model=List[ITProjectResponse])
def get_it_projects(db: Session = Depends(get_db)):
    # Retourne tous les projets IT recents pour vue Kanban centralisee.
    rows = db.query(ITProject).order_by(ITProject.updated_at.desc(), ITProject.id.desc()).all()
    results = []
    for row in rows:
        raw_steps = row.steps_json or []
        cleaned_steps = []
        for step in raw_steps:
            if not isinstance(step, dict):
                continue
            label = (step.get("label") or "").strip()
            start_date = step.get("start_date")
            end_date = step.get("end_date")
            if not label or not start_date or not end_date:
                continue
            cleaned_steps.append({
                "label": label,
                "start_date": start_date,
                "end_date": end_date,
            })

        results.append(ITProjectResponse(
            id=row.id,
            title=row.title,
            status=row.status,
            description=row.description,
            documentation=row.documentation,
            owner=row.owner,
            due_date=row.due_date,
            steps=cleaned_steps,
            created_at=row.created_at,
            updated_at=row.updated_at,
        ))
    return results


@app.post("/it-projects", response_model=ITProjectResponse)
def create_it_project(payload: ITProjectCreate, db: Session = Depends(get_db)):
    # Cree un projet IT avec son etat, sa description et sa documentation.
    valid_status = ["A faire", "En cours", "Termine"]
    if payload.status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {payload.status}. Valeurs acceptees: {valid_status}")

    cleaned_steps = []
    for step in payload.steps:
        label = (step.label or "").strip()
        if not label:
            continue
        if step.end_date < step.start_date:
            raise HTTPException(status_code=400, detail=f"Etape '{label}': la date de fin doit etre >= a la date de debut")
        cleaned_steps.append({
            "label": label,
            "start_date": step.start_date.isoformat(),
            "end_date": step.end_date.isoformat(),
        })

    project = ITProject(
        title=payload.title.strip(),
        status=payload.status,
        description=payload.description.strip(),
        documentation=(payload.documentation or "").strip() or None,
        owner=(payload.owner or "").strip() or None,
        due_date=payload.due_date,
        steps_json=cleaned_steps,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return ITProjectResponse(
        id=project.id,
        title=project.title,
        status=project.status,
        description=project.description,
        documentation=project.documentation,
        owner=project.owner,
        due_date=project.due_date,
        steps=cleaned_steps,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@app.put("/it-projects/{project_id}", response_model=ITProjectResponse)
def update_it_project(project_id: int, payload: ITProjectCreate, db: Session = Depends(get_db)):
    # Met a jour un projet IT existant.
    valid_status = ["A faire", "En cours", "Termine"]
    if payload.status not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {payload.status}. Valeurs acceptees: {valid_status}")

    project = db.query(ITProject).filter(ITProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projet IT non trouve")

    cleaned_steps = []
    for step in payload.steps:
        label = (step.label or "").strip()
        if not label:
            continue
        if step.end_date < step.start_date:
            raise HTTPException(status_code=400, detail=f"Etape '{label}': la date de fin doit etre >= a la date de debut")
        cleaned_steps.append({
            "label": label,
            "start_date": step.start_date.isoformat(),
            "end_date": step.end_date.isoformat(),
        })

    # Conserve l'historique des etapes existantes: les nouvelles etapes (ou etapes modifiees)
    # avec le meme libelle remplacent l'ancienne version, les autres restent intactes.
    existing_steps = []
    for step in (project.steps_json or []):
        if not isinstance(step, dict):
            continue
        label = (step.get("label") or "").strip()
        start_date = step.get("start_date")
        end_date = step.get("end_date")
        if not label or not start_date or not end_date:
            continue
        existing_steps.append({
            "label": label,
            "start_date": start_date,
            "end_date": end_date,
        })

    existing_by_label = {item["label"].lower(): item for item in existing_steps}
    for item in cleaned_steps:
        existing_by_label[item["label"].lower()] = item

    merged_steps = sorted(
        existing_by_label.values(),
        key=lambda item: (item.get("start_date") or "", item.get("label") or ""),
    )

    project.title = payload.title.strip()
    project.status = payload.status
    project.description = payload.description.strip()
    project.documentation = (payload.documentation or "").strip() or None
    project.owner = (payload.owner or "").strip() or None
    project.due_date = payload.due_date
    project.steps_json = merged_steps

    db.commit()
    db.refresh(project)
    return ITProjectResponse(
        id=project.id,
        title=project.title,
        status=project.status,
        description=project.description,
        documentation=project.documentation,
        owner=project.owner,
        due_date=project.due_date,
        steps=merged_steps,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@app.delete("/it-projects/{project_id}")
def delete_it_project(project_id: int, db: Session = Depends(get_db)):
    # Supprime un projet IT.
    project = db.query(ITProject).filter(ITProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Projet IT non trouve")

    db.delete(project)
    db.commit()
    return {"success": True}



@app.get("/asset_types")
def get_asset_types(db: Session = Depends(get_db)):
    # Renvoie les types disponibles afin d'alimenter les sélecteurs frontend.
    types = db.query(AssetType).all()
    return [{"id": t.id, "label": t.label} for t in types]

@app.get("/assets", response_model=List[AssetResponse])
def get_assets(db: Session = Depends(get_db)):
    # Charge les relations utiles en une fois pour éviter les requêtes SQL répétées.
    assets = db.query(Asset).options(
        joinedload(Asset.asset_type),
        joinedload(Asset.owner)
    ).all()

    posture_last_seen = {
        row.serial_number: row.last_seen
        for row in db.query(EndpointSecurityPosture).all()
        if row.serial_number
    }
    metrics_last_seen = {
        row.serial_number: row.last_seen
        for row in db.query(EndpointResourceMetric).all()
        if row.serial_number
    }
    network_last_seen = {
        row.serial_number: row.last_seen
        for row in db.query(NetworkTelemetry).all()
        if row.serial_number
    }

    online_window_minutes = int(os.getenv("POWER_ONLINE_WINDOW_MINUTES", "15"))
    online_threshold = datetime.utcnow() - timedelta(minutes=max(1, online_window_minutes))

    # La réponse est remodelée pour simplifier l'affichage côté frontend.
    response_items: List[AssetResponse] = []
    for asset in assets:
        seen_candidates = [
            posture_last_seen.get(asset.serial_number),
            metrics_last_seen.get(asset.serial_number),
            network_last_seen.get(asset.serial_number),
        ]
        seen_values = [value for value in seen_candidates if value is not None]
        last_activity = max(seen_values) if seen_values else None
        power_status = "sous_tension" if (last_activity and last_activity >= online_threshold) else "hors_tension"

        response_items.append(AssetResponse(
            id=asset.id,
            serial_number=asset.serial_number,
            model=asset.model,
            status=asset.status,
            type_label=asset.asset_type.label if asset.asset_type else "Inconnu",
            owner_name=asset.owner.name if asset.owner and asset.owner.name else "Non attribué",
            price=asset.price or 0.0,
            location_id=asset.location_id,
            owner_id=asset.owner_id,
            purchase_date=asset.purchase_date,
            warranty_expiry=asset.warranty_expiry,
            description=asset.description,
            power_status=power_status,
            last_activity_at=last_activity,
        ))

    return response_items

@app.post("/assets", response_model=AssetResponse)
def create_asset(asset: AssetCreate, db: Session = Depends(get_db)):
    # On normalise la valeur reçue pour la faire correspondre à l'enum SQL.
    status_clean = asset.status.strip() if asset.status else None
    valid_status = ["En service", "En maintenance", "Stock"]
    if status_clean not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {asset.status}. Valeurs acceptées: {valid_status}")

    # L'équipement est enregistré tel qu'il est saisi depuis la modale d'ajout.
    db_asset = Asset(
        serial_number=asset.serial_number,
        model=asset.model,
        status=status_clean,
        type_id=asset.type_id,
        owner_id=asset.owner_id,
        location_id=asset.location_id,
        purchase_date=asset.purchase_date,
        warranty_expiry=asset.warranty_expiry,
        price=asset.price,
        description=asset.description,
    )
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)

    # Les libellés associés sont rechargés pour renvoyer une réponse complète au frontend.
    asset_type = db.query(AssetType).filter(AssetType.id == db_asset.type_id).first()
    owner = db.query(User).filter(User.id == db_asset.owner_id).first() if db_asset.owner_id else None
    response = AssetResponse(
        id=db_asset.id,
        serial_number=db_asset.serial_number,
        model=db_asset.model,
        status=db_asset.status,
        type_label=asset_type.label if asset_type else "Inconnu",
        owner_name=owner.name if owner and owner.name else "Non attribué",
        price=db_asset.price or 0.0,
        location_id=db_asset.location_id,
        owner_id=db_asset.owner_id,
        purchase_date=db_asset.purchase_date,
        warranty_expiry=db_asset.warranty_expiry,
        description=db_asset.description,
    )
    return response.dict()


@app.put("/assets/{asset_id}", response_model=AssetResponse)
def update_asset(asset_id: int, asset: AssetCreate, db: Session = Depends(get_db)):
    # Met à jour un équipement existant à partir du formulaire d'édition.
    db_asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Matériel non trouvé")

    status_clean = asset.status.strip() if asset.status else None
    valid_status = ["En service", "En maintenance", "Stock"]
    if status_clean not in valid_status:
        raise HTTPException(status_code=400, detail=f"Statut invalide: {asset.status}. Valeurs acceptées: {valid_status}")

    db_asset.serial_number = asset.serial_number
    db_asset.model = asset.model
    db_asset.status = status_clean
    db_asset.type_id = asset.type_id
    db_asset.owner_id = asset.owner_id
    db_asset.location_id = asset.location_id
    db_asset.purchase_date = asset.purchase_date
    db_asset.warranty_expiry = asset.warranty_expiry
    db_asset.price = asset.price
    db_asset.description = asset.description
    db.commit()
    db.refresh(db_asset)

    asset_type = db.query(AssetType).filter(AssetType.id == db_asset.type_id).first()
    owner = db.query(User).filter(User.id == db_asset.owner_id).first() if db_asset.owner_id else None
    return AssetResponse(
        id=db_asset.id,
        serial_number=db_asset.serial_number,
        model=db_asset.model,
        status=db_asset.status,
        type_label=asset_type.label if asset_type else "Inconnu",
        owner_name=owner.name if owner and owner.name else "Non attribué",
        price=db_asset.price or 0.0,
        location_id=db_asset.location_id,
        owner_id=db_asset.owner_id,
        purchase_date=db_asset.purchase_date,
        warranty_expiry=db_asset.warranty_expiry,
        description=db_asset.description,
    )


@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: int, db: Session = Depends(get_db)):
    # Supprime un équipement et ses logs de maintenance associés.
    db_asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not db_asset:
        raise HTTPException(status_code=404, detail="Matériel non trouvé")

    db.delete(db_asset)
    db.commit()
    return {"success": True}

@app.get("/stats/assets-by-type", response_model=List[StatsResponse])
def assets_by_type(db: Session = Depends(get_db)):
    # Agrège le nombre d'équipements par type pour le graphique du tableau de bord.
    results = (
        db.query(AssetType.label, func.count(Asset.id))
        .outerjoin(Asset, Asset.type_id == AssetType.id)
        .group_by(AssetType.label)
        .all()
    )

    return [{"name": label, "value": count} for label, count in results]

@app.post("/maintenance_logs/{asset_id}")
def add_maintenance_log(
    asset_id: int,
    log_data: MaintenanceLogCreate,
    db: Session = Depends(get_db)
):
    # On vérifie d'abord que l'équipement ciblé existe avant d'ajouter un historique.
    asset = db.query(Asset).filter(Asset.id == asset_id).first()

    if not asset:
        raise HTTPException(status_code=404, detail="Matériel non trouvé")

    # Chaque log conserve le descriptif, le coût et l'intervenant éventuel.
    new_log = MaintenanceLog(
        asset_id=asset_id,
        description=log_data.description,
        cost=log_data.cost,
        performed_by=log_data.performed_by
    )

    db.add(new_log)
    db.commit()
    db.refresh(new_log)

    return {"success": True, "id": new_log.id}


@app.get("/maintenance_logs/{asset_id}")
def get_maintenance_logs(asset_id: int, db: Session = Depends(get_db)):
    # Retourne l'historique de maintenance trié du plus récent au plus ancien.
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Matériel non trouvé")

    logs = (
        db.query(MaintenanceLog)
        .filter(MaintenanceLog.asset_id == asset_id)
        .order_by(MaintenanceLog.maintenance_date.desc(), MaintenanceLog.id.desc())
        .all()
    )
    return [
        {
            "id": log.id,
            "maintenance_date": log.maintenance_date,
            "description": log.description,
            "cost": log.cost,
            "performed_by": log.performed_by,
        }
        for log in logs
    ]