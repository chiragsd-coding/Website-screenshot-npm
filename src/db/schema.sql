-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT,
    owner_id TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE,
    tier TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    gateway_customer_id TEXT,
    gateway_subscription_id TEXT,
    current_period_end DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage Logs table
CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    api_key_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    url TEXT,
    viewport TEXT,
    status_code INTEGER,
    response_time INTEGER,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);

-- Cache Metadata table
CREATE TABLE IF NOT EXISTS cache_metadata (
    id TEXT PRIMARY KEY,
    url_hash TEXT NOT NULL,
    viewport TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key_id ON usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_cache_metadata_url_viewport ON cache_metadata(url_hash, viewport);
