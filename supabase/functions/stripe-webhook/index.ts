// ════════════════════════════════════════════════════════════════════
//  STRIPE WEBHOOK — Ativação automática do plano Premium (e renovação)
// ════════════════════════════════════════════════════════════════════
//
// Esta Edge Function escuta eventos do Stripe e:
//   - Ativa o plano (ex: Premium) quando o cliente paga via Payment Link
//   - Renova automaticamente quando o Stripe cobra mensalmente
//   - Cancela quando a subscription é deletada (cliente cancelou ou
//     pagamento falhou várias vezes)
//
// Eventos tratados:
//   - checkout.session.completed  → primeira ativação
//   - invoice.paid                → renovação mensal/anual
//   - customer.subscription.deleted → cancelamento
//
// Pré-requisitos (variáveis de ambiente no Supabase):
//   STRIPE_SECRET_KEY        → sk_test_xxx (test) ou sk_live_xxx (prod)
//   STRIPE_WEBHOOK_SECRET    → whsec_xxx (do webhook no Stripe Dashboard)
//   STRIPE_PRICE_PREMIUM     → price_xxx (price ID do Premium criado no Stripe)
//   SUPABASE_URL             → https://asrecwsocneepipvfymx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY → service role key (Project Settings → API)
//
// Veja README.md neste diretório para setup completo passo a passo.
// ════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const STRIPE_PRICE_PREMIUM = Deno.env.get('STRIPE_PRICE_PREMIUM') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Mapeia price_id → nome do plano. Adicione outros price IDs se quiser que
// este webhook também trate Pro, Growth, etc.
function planoFromPriceId(priceId: string): string | null {
  if (priceId === STRIPE_PRICE_PREMIUM) return 'premium';
  return null;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  // 1. VERIFICA ASSINATURA — garante que o request veio mesmo do Stripe
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Assinatura inválida:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`📨 Evento recebido: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      // ─────────────────────────────────────────────────────────────
      // PAGAMENTO INICIAL — cliente acabou de comprar via Payment Link
      // ─────────────────────────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
        if (!email) {
          throw new Error('Email não encontrado na sessão de checkout');
        }

        // Identifica qual plano foi comprado pelo price_id
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        const priceId = lineItems.data[0]?.price?.id;
        if (!priceId) {
          console.log('⚠️  Line items sem price_id — ignorando');
          break;
        }

        const plano = planoFromPriceId(priceId);
        if (!plano) {
          console.log(`⚠️  Price ${priceId} não mapeado pra nenhum plano — ignorando`);
          break;
        }

        // Calcula período: 1 ano à frente se não tiver subscription
        const subscriptionId = session.subscription as string | null;
        let periodEnd: string;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        } else {
          const d = new Date();
          d.setFullYear(d.getFullYear() + 1);
          periodEnd = d.toISOString();
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            current_plan: plano,
            subscription_status: 'active',
            current_period_end: periodEnd,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
          })
          .eq('email', email);

        if (error) throw error;
        console.log(`✅ Plano ${plano} ATIVADO para ${email}`);
        break;
      }

      // ─────────────────────────────────────────────────────────────
      // RENOVAÇÃO — Stripe cobrou de novo (mês/ano seguinte)
      // ─────────────────────────────────────────────────────────────
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const priceId = invoice.lines.data[0]?.price?.id;
        if (!priceId) break;

        const plano = planoFromPriceId(priceId);
        if (!plano) break;

        // Pega novo período da subscription
        let periodEnd: string | null = null;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
          periodEnd = new Date(sub.current_period_end * 1000).toISOString();
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            current_plan: plano,
            subscription_status: 'active',
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId);

        if (error) throw error;
        console.log(`🔄 Plano ${plano} RENOVADO para customer ${customerId} até ${periodEnd}`);
        break;
      }

      // ─────────────────────────────────────────────────────────────
      // CANCELAMENTO — cliente cancelou ou cartão falhou várias vezes
      // ─────────────────────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const { error } = await supabase
          .from('profiles')
          .update({
            current_plan: 'starter',
            subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId);

        if (error) throw error;
        console.log(`❌ Subscription CANCELADA para customer ${customerId} — voltou pra starter`);
        break;
      }

      default:
        console.log(`ℹ️  Evento ${event.type} não tratado (ok, ignorando)`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('💥 Erro processando webhook:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
