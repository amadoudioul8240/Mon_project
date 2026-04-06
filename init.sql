-- Script d'initialisation de la base PostgreSQL utilisé lors du premier déploiement.

-- Création des tables de référence pour les lieux physiques.
CREATE TABLE locations (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    batiment VARCHAR(100) NOT NULL
);

-- Table des utilisateurs pouvant se voir attribuer du matériel.
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100) NOT NULL,
    service VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL
);

-- Catalogue des types d'équipements disponibles dans le parc.
CREATE TABLE asset_types (
    id SERIAL PRIMARY KEY,
    label VARCHAR(100) NOT NULL
);

-- Table principale des équipements avec leurs clés de rattachement.
CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    numero_serie VARCHAR(100) NOT NULL UNIQUE,
    modele VARCHAR(100) NOT NULL,
    statut VARCHAR(50) NOT NULL,
    fk_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
    fk_location INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    fk_type INTEGER REFERENCES asset_types(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Champs complémentaires pour suivre achat, garantie et valeur financière.
ALTER TABLE assets
    ADD COLUMN purchase_date DATE,
    ADD COLUMN warranty_expiry DATE,
    ADD COLUMN price NUMERIC(12,2);

-- Historique des maintenances réalisées sur chaque équipement.
CREATE TABLE maintenance_logs (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
    maintenance_date DATE NOT NULL,
    description TEXT NOT NULL,
    cost NUMERIC(12,2),
    performed_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Jeux de données minimaux pour démarrer l'application avec quelques entrées visibles.
INSERT INTO locations (nom, batiment) VALUES
    ('Salle Serveurs', 'Bâtiment A'),
    ('Bureau IT', 'Bâtiment B');

INSERT INTO users (nom, email) VALUES
    ('Alice Dupont', 'alice.dupont@example.com'),
    ('Bob Martin', 'bob.martin@example.com');

INSERT INTO asset_types (label) VALUES
    ('Ordinateur portable'),
    ('Imprimante'),
    ('Serveur'),
    ('Switch'),
    ('Écran'),
    ('Ordinateur fixe');

INSERT INTO assets (numero_serie, modele, statut, fk_user, fk_location, fk_type) VALUES
    ('SN12345', 'Dell Latitude 5510', 'en service', 1, 1, 1),
    ('SN67890', 'HP LaserJet Pro', 'en maintenance', 2, 2, 2);
