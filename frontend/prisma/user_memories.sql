CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  bot_route_id text,
  content text NOT NULL,
  memory_type text NOT NULL DEFAULT 'preference',
  importance integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}',
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_memories_user_bot_idx
ON user_memories (user_id, bot_route_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS user_memories_embedding_idx
ON user_memories
USING hnsw (embedding vector_cosine_ops);
