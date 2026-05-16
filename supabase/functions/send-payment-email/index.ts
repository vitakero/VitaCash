import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ADMIN_EMAILS = ['caroseu2018@gmail.com']
const RESEND_KEY        = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SVC_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // 1. Valida JWT
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ error: 'Authorization obrigatorio' }, 401)

    const sbAuth = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
      global: { headers: { Authorization: auth } },
    })
    const { data: { user }, error: userErr } = await sbAuth.auth.getUser()
    if (userErr || !user) return json({ error: 'Sessao invalida' }, 401)

    // 2. Confirma admin
    if (!ADMIN_EMAILS.includes((user.email ?? '').toLowerCase()))
      return json({ error: 'Acesso restrito' }, 403)

    // 3. Lê body
    const body = await req.json().catch(() => ({}))
    const nomeCliente  = String(body.nome  ?? '').trim()
    const emailCliente = String(body.email ?? '').trim().toLowerCase()

    if (!nomeCliente || !emailCliente)
      return json({ error: 'Nome e email sao obrigatorios' }, 400)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCliente))
      return json({ error: 'Email invalido' }, 400)

    // 4. Envia via Resend
    const primeiroNome  = nomeCliente.split(' ')[0]
    const linkPagamento = 'https://vita-cash.vercel.app/?plano=premium'

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'VitaCash <onboarding@resend.dev>',
        to:      [emailCliente],
        subject: `${primeiroNome}, seu link Premium VitaCash`,
        html:    montarEmail(primeiroNome, linkPagamento),
      }),
    })

    if (!resendRes.ok) {
      const err = await resendRes.text()
      console.error('Resend error:', err)
      return json({ error: 'Falha ao enviar email', detail: err }, 500)
    }

    const resendData = await resendRes.json()
    console.log(`Link Premium enviado: ${emailCliente} resend_id=${resendData.id}`)

    // 5. Log no banco (best-effort)
    try {
      await createClient(SUPABASE_URL, SUPABASE_SVC_KEY)
        .from('payment_emails_log')
        .insert({
          admin_email:   user.email,
          cliente_nome:  nomeCliente,
          cliente_email: emailCliente,
          sent_at:       new Date().toISOString(),
          resend_id:     resendData.id,
        })
    } catch (e) {
      console.warn('Log nao salvo (tabela pode nao existir):', e)
    }

    return json({ ok: true, sent_to: emailCliente, resend_id: resendData.id }, 200)
  } catch (err) {
    console.error('Erro inesperado:', err)
    return json({ error: err.message ?? 'Erro interno' }, 500)
  }
})

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function montarEmail(nome: string, link: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Seu link Premium VitaCash</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:48px 0;">
<tr><td align="center">
  <table width="540" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

    <tr>
      <td style="background:linear-gradient(135deg,#155f47 0%,#1a7a5e 50%,#1d9e75 100%);padding:36px 36px 32px;text-align:center;">
        <div style="font-size:26px;font-weight:800;letter-spacing:-.3px;margin-bottom:8px;">
          <span style="color:#ffffff;">Vita</span><span style="color:#4ade80;">Cash</span>
        </div>
        <div style="font-size:9px;font-weight:700;color:#4ade80;letter-spacing:2.5px;text-transform:uppercase;">Diagnóstico Financeiro Inteligente</div>
      </td>
    </tr>

    <tr>
      <td style="padding:36px 36px 28px;">
        <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#111827;">Olá, ${nome}!</p>
        <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.7;">
          Conforme combinamos, segue o link para ativar sua assinatura
          <strong style="color:#1d9e75;">Premium do VitaCash</strong>.
        </p>

        <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
          <tr>
            <td style="background:linear-gradient(135deg,#f0fdf7 0%,#ecfdf5 100%);border:1px solid #a7f3d0;border-radius:10px;padding:20px 24px;">
              <div style="font-size:10px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Plano selecionado</div>
              <div style="font-size:26px;font-weight:800;color:#064e3b;letter-spacing:-.3px;margin-bottom:4px;">PREMIUM</div>
              <div style="font-size:13px;color:#6b7280;">R$ 347/mês &nbsp;·&nbsp; Cancele quando quiser</div>
            </td>
          </tr>
        </table>

        <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
          <tr>
            <td align="center">
              <a href="${link}" style="display:inline-block;background:#1d9e75;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:16px 40px;border-radius:8px;letter-spacing:-.1px;box-shadow:0 4px 14px rgba(29,158,117,.35);">
                Ativar Premium agora →
              </a>
            </td>
          </tr>
        </table>

        <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:14px;">Como funciona</div>
        <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
          <tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;"><span style="font-size:12px;font-weight:700;color:#059669;">1</span></td>
              <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;">Clique no botão acima</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;"><span style="font-size:12px;font-weight:700;color:#059669;">2</span></td>
              <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;">Faça login ou cadastro rápido (se ainda não tem conta)</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;"><span style="font-size:12px;font-weight:700;color:#059669;">3</span></td>
              <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;">Finalize o pagamento (cartão, PIX ou boleto)</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:12px 0;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="width:28px;height:28px;background:#ecfdf5;border-radius:50%;text-align:center;vertical-align:middle;"><span style="font-size:12px;font-weight:700;color:#059669;">4</span></td>
              <td style="padding-left:12px;font-size:13px;color:#374151;line-height:1.5;"><strong style="color:#111827;">Premium ativa automaticamente</strong> — você já pode usar todas as funcionalidades</td>
            </tr></table>
          </td></tr>
        </table>

        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;">
              <p style="margin:0;font-size:12px;color:#64748b;line-height:1.7;">Dúvidas? Basta responder este e-mail — nossa equipe está disponível para ajudar.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 36px 28px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Este e-mail foi enviado porque você manifestou interesse no Premium VitaCash.</p>
        <p style="margin:0;font-size:11px;color:#cbd5e1;">© 2026 VitaCash &nbsp;·&nbsp; <a href="https://vita-cash.vercel.app" style="color:#94a3b8;text-decoration:none;">vita-cash.vercel.app</a></p>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`
}
