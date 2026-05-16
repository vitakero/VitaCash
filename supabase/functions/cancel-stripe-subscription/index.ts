// ════════════════════════════════════════════════════════════════════
//  CANCEL STRIPE SUBSCRIPTION — chamada antes de excluir conta
// ════════════════════════════════════════════════════════════════════
//
//  Quando o cliente clica "Excluir conta" no VitaCash, o frontend chama
//  esta função PRIMEIRO. Ela:
//    1. Identifica o usuário pelo JWT (segurança)
//    2. Lê o stripe_subscription_id do profile dele
//    3. Cancela a subscription no Stripe (cancel_immediately)
//    4. O webhook customer.subscription.deleted vai disparar e atualizar
//       o profile pra current_plan='starter' (mas como o profile vai ser
//       deletado em seguida, não importa)
//
//  Pré-requisitos (mesmas variáveis de ambiente do stripe-webhook):
//    STRIPE_SECRET_KEY        → sk_test_xxx ou sk_live_xxx
//    SUPABASE_URL             → auto-injected
//    SUPABASE_SERVICE_ROLE_KEY → auto-injected
// ════════════════════════════════════════════════════════════════════

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
})

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// CORS pra permitir chamadas do app (browser)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Valida o JWT do usuário (Authorization: Bearer xxx)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization header obrigatório' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Cliente com o token do usuário (verifica autenticação)
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida ou expirada' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Lê o stripe_subscription_id do profile (cliente service-role pra
    //    contornar RLS, pois vamos deletar tudo em seguida mesmo)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('stripe_subscription_id, stripe_customer_id, current_plan, subscription_status')
      .eq('id', user.id)
      .single()

    if (profileErr || !profile) {
      console.warn(`Profile não encontrado pra user ${user.id}:`, profileErr?.message)
      // Não bloqueia exclusão — apenas retorna que não havia subscription
      return new Response(JSON.stringify({ canceled: false, reason: 'profile-not-found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Se não tem subscription, retorna ok (cliente starter, sem nada pra cancelar)
    if (!profile.stripe_subscription_id) {
      console.log(`User ${user.id} sem subscription Stripe — nada a cancelar`)
      return new Response(JSON.stringify({ canceled: false, reason: 'no-subscription' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Cancela a subscription no Stripe (imediatamente, não no fim do período)
    try {
      const canceled = await stripe.subscriptions.cancel(profile.stripe_subscription_id)
      console.log(`✅ Subscription ${profile.stripe_subscription_id} cancelada (user ${user.id}, plan ${profile.current_plan})`)
      return new Response(JSON.stringify({
        canceled: true,
        subscription_id: canceled.id,
        status: canceled.status,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (stripeErr: any) {
      // Subscription já cancelada/inexistente no Stripe não é erro fatal
      const isAlreadyGone = stripeErr.code === 'resource_missing' || stripeErr.statusCode === 404
      if (isAlreadyGone) {
        console.log(`Subscription ${profile.stripe_subscription_id} já não existe no Stripe`)
        return new Response(JSON.stringify({ canceled: false, reason: 'already-gone' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      console.error('Erro ao cancelar no Stripe:', stripeErr.message)
      return new Response(JSON.stringify({ error: stripeErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (err: any) {
    console.error('Erro inesperado:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
