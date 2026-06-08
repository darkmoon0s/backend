-- Insight AI - Production PostgreSQL Schema
-- Multi-tenant architecture for AI Search Visibility & GEO Analytics

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users & Auth
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Organizations (Multi-tenancy)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    billing_plan TEXT DEFAULT 'free', -- free, pro, enterprise
    stripe_customer_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Organization Memberships
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member', -- owner, admin, member
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organization_id, user_id)
);

-- Brands (Entities to track)
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    website_url TEXT,
    industry TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Competitors
CREATE TABLE IF NOT EXISTS competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    website_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Prompts (Queries to run against AI engines)
CREATE TABLE IF NOT EXISTS prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    frequency TEXT DEFAULT 'daily', -- daily, weekly, monthly
    is_active BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI Engines
CREATE TABLE IF NOT EXISTS ai_engines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL, -- ChatGPT, Perplexity, Gemini, Claude
    version TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI Responses
CREATE TABLE IF NOT EXISTS ai_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
    engine_id UUID REFERENCES ai_engines(id) ON DELETE CASCADE,
    raw_content TEXT NOT NULL,
    structured_content JSONB,
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    screenshot_url TEXT
);

-- Mentions (Extracted from responses)
CREATE TABLE IF NOT EXISTS mentions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    response_id UUID REFERENCES ai_responses(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL, -- brand_id or competitor_id
    entity_type TEXT NOT NULL, -- 'brand' or 'competitor'
    sentiment_score FLOAT, -- -1 to 1
    context_snippet TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Citations
CREATE TABLE IF NOT EXISTS citations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    response_id UUID REFERENCES ai_responses(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    domain TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Analytics Snapshots (Aggregated data for charts)
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID REFERENCES brands(id) ON DELETE CASCADE,
    engine_id UUID REFERENCES ai_engines(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    geo_score FLOAT, -- 0 to 100
    share_of_voice FLOAT, -- 0 to 100
    avg_sentiment FLOAT, -- -1 to 1
    total_mentions INTEGER DEFAULT 0,
    total_citations INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(brand_id, engine_id, snapshot_date)
);

-- Background Jobs
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'tracking', 'analysis', 'report_generation'
    status TEXT DEFAULT 'pending', -- pending, running, completed, failed
    payload JSONB,
    result JSONB,
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_responses_prompt_id ON ai_responses(prompt_id);
CREATE INDEX idx_mentions_entity ON mentions(entity_id, entity_type);
CREATE INDEX idx_analytics_brand_date ON analytics_snapshots(brand_id, snapshot_date);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_prompts_org ON prompts(organization_id);
