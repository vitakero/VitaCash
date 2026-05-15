# 🔑 IDs do Stripe — modo TEST

> ⚠️ Estes IDs são do modo **TEST** do Stripe. Quando migrar pra modo LIVE
> (produção real), você terá que criar novos produtos/payment links e
> atualizar este arquivo OU criar um `IDS-LIVE.md` separado.

## VitaCash Premium

- **Product ID**: `prod_UTTyFkQsZ66xOp`
- **Price ID (R$ 347/mês)**: `price_1TUX0UHkpdynZUBWS1WLFmE4`
- **Payment Link URL**: _(será preenchido na próxima etapa)_

## Onde isso é usado

O **Price ID** acima é o valor que vai no secret `STRIPE_PRICE_PREMIUM` da
Edge Function `stripe-webhook` (Supabase → Edge Functions → Secrets).

## Outros produtos (Pro / Growth)

Já existem no Stripe. Se quiser que o webhook também trate eles automaticamente,
adiciona os Price IDs na função `planoFromPriceId` em `index.ts`.

- **VitaCash PRO** (R$ 197/mês): _ID ainda não copiado_
- **VitaCash Growth** (R$ 97/mês): _ID ainda não copiado_
