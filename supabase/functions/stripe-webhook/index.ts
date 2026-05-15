import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const PLAN_MAP: Record<string, string> = {
  'price_1TUWo3HkpdynZUBW6AVGmLeu': 'growth',
  'price_1TUWxWHkpdynZUBW2DLLEnlE': 'pro',
  'price_1TUX0UHkpdynZUBWS1WLFmE4': 'premium',
}

const PLAN_PRICE: Record<string, string> = {
  'growth':  'R$ 97/mês',
  'pro':     'R$ 197/mês',
  'premium': 'R$ 347/mês',
}

// ────────────────────────────────────────────────────────────────────
// Encontra o user_id no Supabase a partir da subscription
// 1º) tenta metadata.supabase_uid (vem do embedded checkout)
// 2º) fallback: busca pelo email do customer no Stripe (Payment Link)
// ────────────────────────────────────────────────────────────────────
async function findUserId(sub: Stripe.Subscription): Promise<string | null> {
  const uid = sub.metadata?.supabase_uid
  if (uid) return uid

  // Fallback: busca o email do customer e procura no profiles
  if (typeof sub.customer === 'string') {
    try {
      const customer = await stripe.customers.retrieve(sub.customer)
      if ('email' in customer && customer.email) {
        const email = customer.email.toLowerCase()
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .single()
        if (profile?.id) {
          console.log(`Fallback por email: ${email} → uid=${profile.id}`)
          return profile.id
        } else {
          console.warn(`Email ${email} pagou mas não tem cadastro no VitaCash`)
        }
      }
    } catch (err) {
      console.error('Erro buscando customer no Stripe:', err.message)
    }
  }
  return null
}

async function enviarEmailBoasVindas(email: string, nome: string, plano: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) { console.warn('RESEND_API_KEY não configurada'); return }

  const planoNome  = plano.toUpperCase()
  const planoPrico = PLAN_PRICE[plano] ?? ''

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bem-vindo ao VitaCash</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 0;">
<tr><td align="center">

  <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

    <!-- HEADER -->
    <tr>
      <td style="background:linear-gradient(135deg,#155f47 0%,#1a7a5e 50%,#1d9e75 100%);padding:36px 36px 32px;text-align:center;">
        <div style="font-size:26px;font-weight:800;letter-spacing:-.3px;margin-bottom:8px;">
          <span style="color:#ffffff;">Vita</span><span style="color:#4ade80;">Cash</span>
        </div>
        <div style="font-size:9px;font-weight:700;color:#4ade80;letter-spacing:2.5px;text-transform:uppercase;">Diagnóstico Financeiro Inteligente</div>
      </td>
    </tr>

    <!-- CORPO -->
    <tr>
      <td style="padding:36px 36px 28px;">

        <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111827;">Bem-vindo ao VitaCash, ${nome}!</p>
        <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.7;">Sua assinatura está ativa. Você já pode usar o diagnóstico financeiro mais completo do mercado.</p>

        <!-- Plano card -->
        <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
          <tr>
            <td style="background:linear-gradient(135deg,#f0fdf7 0%,#ecfdf5 100%);border:1px solid #a7f3d0;border-radius:10px;padding:20px 24px;box-shadow:0 2px 8px rgba(29,158,117,.08);">
              <div style="font-size:10px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Seu plano ativo</div>
              <div style="font-size:26px;font-weight:800;color:#064e3b;letter-spacing:-.3px;margin-bottom:4px;">${planoNome}</div>
              <div style="font-size:13px;color:#6b7280;">${planoPrico}</div>
            </td>
          </tr>
        </table>

        <!-- Passos -->
        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:14px;">O que fazer agora</div>
        <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
          <tr>
            <td style="padding:13px 0;border-bottom:1px solid #f1f5f9;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:12px;font-weight:700;color:#059669;">1</span>
                </td>
                <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;">Acesse o painel e clique em <strong style="color:#111827;">Nova análise</strong></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:13px 0;border-bottom:1px solid #f1f5f9;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:12px;font-weight:700;color:#059669;">2</span>
                </td>
                <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;">Faça upload da sua <strong style="color:#111827;">DRE</strong> e <strong style="color:#111827;">Balanço Patrimonial</strong></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:13px 0;">
              <table cellpadding="0" cellspacing="0"><tr>
                <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;">
                  <span style="font-size:12px;font-weight:700;color:#059669;">3</span>
                </td>
                <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;">Receba seu <strong style="color:#111827;">diagnóstico financeiro completo</strong> em segundos</td>
              </tr></table>
            </td>
          </tr>
        </table>

        <!-- Botão -->
        <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
          <tr>
            <td align="center">
              <a href="https://vita-cash.vercel.app" style="display:inline-block;background:#1d9e75;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:-.1px;box-shadow:0 4px 14px rgba(29,158,117,.35);">Acessar meu painel →</a>
            </td>
          </tr>
        </table>

        <!-- Info box -->
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.7;">Dúvidas? Basta responder este e-mail — nossa equipe está disponível para ajudar.</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>

    <!-- FOOTER -->
    <tr>
      <td style="padding:20px 36px 28px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Este e-mail foi enviado porque você assinou o VitaCash.</p>
        <p style="margin:0;font-size:11px;color:#cbd5e1;">© 2026 VitaCash &nbsp;·&nbsp; <a href="https://vita-cash.vercel.app" style="color:#94a3b8;text-decoration:none;">vita-cash.vercel.app</a></p>
      </td>
    </tr>

  </table>

</td></tr>
</table>

</body>
</html>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'VitaCash <onboarding@resend.dev>',
      to: [email],
      subject: `Bem-vindo ao VitaCash ${planoNome}! 🎉`,
      html,
    }),
  })

  if (res.ok) {
    console.log(`Email de boas-vindas enviado para ${email}`)
  } else {
    const err = await res.text()
    console.error(`Erro ao enviar email: ${err}`)
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event

  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature inválida:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  try {
    switch (event.type) {

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const priceId = sub.items.data[0]?.price.id
        const plan = PLAN_MAP[priceId] ?? 'starter'
        const isNova = event.type === 'customer.subscription.created'

        // Identifica o user: metadata primeiro, depois email do customer
        const uid = await findUserId(sub)

        console.log(`Evento: ${event.type} | uid=${uid} | plan=${plan} | status=${sub.status}`)

        if (uid) {
          const customerId = typeof sub.customer === 'string' ? sub.customer : null

          const { error } = await supabase.from('profiles').update({
            subscription_status: sub.status,
            current_plan: plan,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null,
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
          }).eq('id', uid)
          if (error) console.error('Erro ao atualizar profiles:', error)
          else console.log(`Assinatura atualizada: uid=${uid} status=${sub.status} plan=${plan}`)

          if (isNova && plan !== 'starter') {
            const { data: profile, error: profileErr } = await supabase
              .from('profiles')
              .select('email, full_name')
              .eq('id', uid)
              .single()
            console.log(`Profile: email=${profile?.email} erro=${JSON.stringify(profileErr)}`)
            if (profile?.email) {
              const nome = profile.full_name?.split(' ')[0] || 'Cliente'
              await enviarEmailBoasVindas(profile.email, nome, plan)
            } else {
              console.warn('Email não encontrado no perfil.')
            }
          }
        } else {
          console.warn(`Pagamento recebido mas user não identificado. customer=${sub.customer}`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const uid = await findUserId(sub)

        if (uid) {
          await supabase.from('profiles').update({
            subscription_status: 'canceled',
            current_plan: 'starter',
            current_period_end: null,
          }).eq('id', uid)
          console.log(`Assinatura cancelada: uid=${uid}`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          await supabase.from('profiles').update({
            subscription_status: 'past_due',
          }).eq('id', profile.id)
          console.log(`Pagamento falhou: customer=${customerId}`)
        }
        break
      }

      default:
        console.log(`Evento ignorado: ${event.type}`)
    }
  } catch (err) {
    console.error('Erro no handler:', err)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
