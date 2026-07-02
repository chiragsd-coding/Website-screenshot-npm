-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    api_key TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    tier TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    gateway TEXT DEFAULT 'none',
    customer_id TEXT,
    subscription_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage table
CREATE TABLE IF NOT EXISTS usage (
    api_key TEXT NOT NULL,
    month TEXT NOT NULL, -- Format: YYYY-MM
    count INTEGER DEFAULT 0,
    PRIMARY KEY (api_key, month),
    FOREIGN KEY (api_key) REFERENCES subscriptions(api_key)
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

CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_usage_api_key_month ON usage(api_key, month);
CREATE INDEX IF NOT EXISTS idx_cache_metadata_url_viewport ON cache_metadata(url_hash, viewport);
