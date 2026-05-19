-- Tabela de configuração privada (só admin lê via service role)
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Nenhum usuário comum pode ler
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Ninguém acessa" ON app_config;
CREATE POLICY "Ninguém acessa" ON app_config FOR ALL USING (false);
