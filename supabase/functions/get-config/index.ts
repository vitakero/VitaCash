import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }
  })

  // Verifica JWT do usuário
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return new Response(JSON.stringify({ error: 'Não autenticado' }), {
    status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: { user }, error } = await sb.auth.getUser(jwt)
  if (error || !user) return new Response(JSON.stringify({ error: 'Token inválido' }), {
    status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })

  // Retorna a chave Anthropic que está nos Secrets do Supabase
  return new Response(JSON.stringify({ k: Deno.env.get('ANTHROPIC_API_KEY') || '' }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
