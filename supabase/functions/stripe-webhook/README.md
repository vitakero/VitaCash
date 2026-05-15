# 🔌 Stripe Webhook — Ativação automática do Premium

Esta Edge Function ativa o plano Premium automaticamente quando um cliente paga via Payment Link do Stripe (e renova/cancela conforme os eventos do Stripe).

---

## 📋 Fluxo final (depois de tudo configurado)

```
1. Cliente paga no link buy.stripe.com/xxx
2. Stripe processa o pagamento (~5s)
3. Stripe chama esta Edge Function
4. Função verifica assinatura → atualiza profiles.current_plan = 'premium'
5. Cliente atualiza a página → Premium ativo

VOCÊ NÃO FAZ NADA.
```

---

## ⚙️ Setup completo (faz 1 vez, dura pra sempre)

Tempo total: **~45 minutos** divididos em 4 fases.

### **FASE 1 — Criar Product + Price + Payment Link no Stripe** (10 min)

1. Acessa **https://dashboard.stripe.com**
2. Verifica se está no modo **TEST** (toggle no canto superior direito) — vamos testar antes de ligar o modo real
3. Menu lateral → **Catalog** → **Products** → **+ Create product**
   - Name: `VitaCash Premium`
   - Description: `Plano Premium — empresas ilimitadas + relatórios PDF + suporte prioritário`
4. Em **Pricing**:
   - Type: **Recurring**
   - Price: `R$ 347,00`
   - Billing period: **Monthly** (ou Yearly se preferir cobrar anual à vista)
5. **Save product**
6. **IMPORTANTE: copia o Price ID** que aparece (algo tipo `price_1ABC...xyz`). Você vai precisar daqui a pouco. Salva num bloco de notas.
7. Volta no menu → **Payment Links** → **+ New**
   - Produto: seleciona `VitaCash Premium`
   - Marca: **"Collect customer's email address"** ✅
   - Marca: **"Show link to customer"** ✅ (gera o thank-you page)
8. **Create link** → copia a URL (`buy.stripe.com/...`) e salva. **Essa é a URL que você manda no WhatsApp.**

---

### **FASE 2 — Pegar a Service Role Key do Supabase** (2 min)

A Edge Function precisa de uma chave especial pra mexer no banco.

1. Acessa **https://supabase.com/dashboard**
2. Seleciona o projeto **VitaCash**
3. Menu lateral → **Project Settings** (engrenagem) → **API**
4. Procura **`service_role`** → clica em **Reveal** → **copia o token** (começa com `eyJ...`)
5. **Guarda essa chave em local seguro.** Não é pra colocar no código nem no GitHub.

> ⚠️ **NUNCA** exponha essa chave no frontend (index.html). Ela só pode viver dentro de Edge Functions ou outro servidor seguro.

---

### **FASE 3 — Deploy da Edge Function no Supabase** (10 min)

1. **https://supabase.com/dashboard** → projeto VitaCash
2. Menu lateral → **Edge Functions**
3. Clica **+ Deploy a new function** (ou **Create a new function**)
4. Nome da função: **`stripe-webhook`** (exatamente esse nome, importante)
5. Marca **"Verify JWT with legacy secret"** como **DESABILITADO** (importante! O Stripe não envia JWT, ele envia signature própria)
6. Cola TODO o conteúdo do arquivo `index.ts` (deste diretório) no editor
7. Clica em **Deploy**

✅ Função deployada! Anota a URL que apareceu — algo tipo:
```
https://asrecwsocneepipvfymx.supabase.co/functions/v1/stripe-webhook
```

---

### **FASE 4 — Configurar variáveis de ambiente (secrets)** (5 min)

A função precisa de 5 segredos pra funcionar. Vamos configurar no Supabase.

1. No mesmo Dashboard do Supabase → **Edge Functions** → **stripe-webhook** → aba **Secrets** (ou **Settings**)
2. Adiciona cada um destes (clique em **+ Add new secret** pra cada):

| Nome | Valor | De onde pega |
|------|-------|--------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` | Stripe Dashboard → Developers → API Keys → "Secret key" |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Vamos pegar na próxima sub-etapa (Fase 5) |
| `STRIPE_PRICE_PREMIUM` | `price_...` | Price ID que você copiou na Fase 1 passo 6 |
| `SUPABASE_URL` | `https://asrecwsocneepipvfymx.supabase.co` | Já é a URL do seu projeto |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Service Role Key que pegou na Fase 2 |

**Salva tudo.** O `STRIPE_WEBHOOK_SECRET` ainda não temos — vamos pegar agora.

---

### **FASE 5 — Configurar o webhook no Stripe** (5 min)

Agora dizemos pro Stripe "quando alguém pagar, chama essa URL".

1. **Stripe Dashboard** → **Developers** → **Webhooks** → **+ Add endpoint**
2. **Endpoint URL**: cola a URL da Edge Function (Fase 3 final):
   ```
   https://asrecwsocneepipvfymx.supabase.co/functions/v1/stripe-webhook
   ```
3. **Events to send** → seleciona estes 3:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.deleted`
4. **Add endpoint**
5. Na tela do webhook recém-criado, procura **"Signing secret"** → clica em **Reveal** → copia o valor (começa com `whsec_...`)
6. Volta no Supabase → **Edge Functions** → **stripe-webhook** → **Secrets**
7. Edita `STRIPE_WEBHOOK_SECRET` e cola o valor `whsec_...`
8. **Save**

✅ Tudo conectado!

---

### **FASE 6 — Teste com pagamento fake** (10 min)

Antes de ativar pra clientes reais, vamos testar:

1. **Stripe Dashboard** → certifica que tá em modo **TEST**
2. Abre o Payment Link `buy.stripe.com/...` que você criou na Fase 1
3. Preenche:
   - Email: usa um email que tenha cadastro no VitaCash (ou crie uma conta teste)
   - Cartão de teste: `4242 4242 4242 4242`
   - Validade: qualquer data no futuro (ex: `12/30`)
   - CVC: `123`
4. Confirma o pagamento
5. **Verifica se funcionou:**
   - Stripe Dashboard → Developers → Webhooks → clica no webhook → aba **Events** → deve aparecer `checkout.session.completed` com status `200 OK`
   - Supabase Dashboard → SQL Editor:
     ```sql
     SELECT email, current_plan, subscription_status, current_period_end
     FROM profiles
     WHERE email = 'email-que-usou@teste.com';
     ```
     → `current_plan` deve estar `premium`

Se deu certo: **🎉 funcionando!**

---

### **FASE 7 — Ligar modo LIVE (produção)** (5 min)

Quando estiver tudo testado e ok:

1. **Stripe Dashboard** → troca o toggle pra modo **LIVE** (canto superior direito)
2. Repete a **Fase 1** (cria Product + Price + Payment Link **no modo live** — modos test e live são separados!)
3. Repete a **Fase 5** (cria webhook **no modo live** apontando pra mesma URL)
4. Atualiza no Supabase os secrets:
   - `STRIPE_SECRET_KEY` → agora `sk_live_...`
   - `STRIPE_WEBHOOK_SECRET` → agora o `whsec_...` do webhook live
   - `STRIPE_PRICE_PREMIUM` → agora o `price_...` do produto live
5. Pronto, **pode mandar o novo link de pagamento (live) pros clientes**.

---

## 🚨 Solução de problemas

**"Webhook signature verification failed"**
→ O `STRIPE_WEBHOOK_SECRET` está errado. Vai no Stripe → Webhook → Reveal signing secret e re-copia.

**Cliente paga mas plano não ativa**
→ Verifica se o email do cliente no Stripe é EXATAMENTE igual ao email cadastrado no VitaCash (sem maiúscula vs minúscula, sem espaços). O código já lowercaseia, mas se o cliente cadastrou com email diferente do que pagou, não vai bater.

**Quer ver os logs do webhook**
→ Supabase Dashboard → Edge Functions → stripe-webhook → aba **Logs**. Mostra tudo que o `console.log` da função imprimiu.

---

## 🔄 Manutenção futura

- Se mudar o preço do Premium, cria novo Price no Stripe e atualiza `STRIPE_PRICE_PREMIUM` no Supabase
- Se quiser que este webhook também trate Pro/Growth, adiciona os price IDs e estende a função `planoFromPriceId` no `index.ts`
- O modo test do Stripe é gratuito e separado do live — use sempre antes de mexer em produção

---

**Pronto. Quando precisar fazer alterações, é só editar o `index.ts` e reupload no Dashboard do Supabase.**
