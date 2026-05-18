-- Adiciona colunas de IA na tabela analyses (se ainda não existirem)

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS hash_combo      TEXT,
  ADD COLUMN IF NOT EXISTS dados_extraidos JSONB;

-- Índice para busca rápida por hash (cache)
CREATE INDEX IF NOT EXISTS idx_analyses_hash_combo ON analyses(hash_combo);

-- Tabela criada do zero se não existir
CREATE TABLE IF NOT EXISTS analyses (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  year             TEXT NOT NULL,
  period           TEXT NOT NULL DEFAULT 'Anual',
  filename_dre     TEXT,
  filename_balanco TEXT,
  hash_combo       TEXT,
  dados_extraidos  JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, year, period)
);

-- RLS
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário vê apenas suas análises" ON analyses;
CREATE POLICY "Usuário vê apenas suas análises"
  ON analyses FOR ALL
  USING (auth.uid() = user_id);
