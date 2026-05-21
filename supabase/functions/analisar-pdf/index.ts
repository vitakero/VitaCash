import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.39.0'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })
const supabase  = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Gera SHA-256 de um Uint8Array ──────────────────────────────────
async function sha256(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

// ── Prompt para extração financeira ──────────────────────────────
const PROMPT_EXTRACAO = `Você é um especialista em contabilidade brasileira. Analise os documentos financeiros enviados (DRE e/ou Balanço Patrimonial) e extraia os dados estruturados.

Retorne APENAS um JSON válido, sem markdown, sem texto antes ou depois, com esta estrutura exata:

{
  "empresa": "nome da empresa",
  "ano": "ano do exercício mais recente (ex: 2024)",
  "ano_anterior": "ano da coluna anterior (ex: 2023)",
  "setor": "setor estimado com base nos dados (ex: Comércio Atacadista, Serviços, Varejo, Indústria, etc.)",
  "dre": {
    "receita_bruta": 0,
    "receita_bruta_ant": 0,
    "deducoes": 0,
    "receita_liquida": 0,
    "cmv": 0,
    "lucro_bruto": 0,
    "despesas_vendas": 0,
    "despesas_admin": 0,
    "outras_despesas_op": 0,
    "ebit": 0,
    "resultado_financeiro": 0,
    "resultado_antes_tributos": 0,
    "impostos": 0,
    "lucro_liquido": 0,
    "lucro_liquido_ant": 0,
    "ebit_ant": 0
  },
  "balanco": {
    "caixa": 0,
    "contas_a_receber": 0,
    "estoques": 0,
    "outros_ativo_circ": 0,
    "ativo_circulante": 0,
    "ativo_nao_circulante": 0,
    "ativo_total": 0,
    "fornecedores": 0,
    "emprestimos_cp": 0,
    "outros_passivo_circ": 0,
    "passivo_circulante": 0,
    "emprestimos_lp": 0,
    "passivo_nao_circulante": 0,
    "passivo_total": 0,
    "patrimonio_liquido": 0
  }
}

REGRAS IMPORTANTES:
- Todos os valores devem ser números (sem R$, sem pontos de milhar, sem vírgulas — use ponto decimal)
- Custos e despesas devem ser NEGATIVOS (ex: cmv: -36000000)
- Se um campo não existir no documento, use 0
- Deduções incluem impostos sobre vendas (PIS, COFINS, ICMS sobre receita)
- Se DRE e Balanço forem documentos separados, consolide os dois no mesmo JSON
- receita_liquida = receita_bruta + deducoes (deducoes é negativo)
- lucro_bruto = receita_liquida + cmv (cmv é negativo)
- ebit = lucro_bruto + despesas_vendas + despesas_admin + outras_despesas_op (todas negativas)
- resultado_antes_tributos = ebit + resultado_financeiro
- lucro_liquido = resultado_antes_tributos + impostos (impostos é negativo)
- CAMPOS "_ant" (ANO ANTERIOR): DFPs brasileiras têm duas colunas lado a lado — ano atual e ano anterior. Preencha receita_bruta_ant com a Receita Bruta da coluna do ano anterior, lucro_liquido_ant com o Lucro Líquido do ano anterior, ebit_ant com o EBIT/Resultado Operacional do ano anterior. Se não houver coluna anterior, deixe 0.`

// ── Benchmarks por setor ──────────────────────────────────────────
function benchmarksPorSetor(setor: string, dre: Record<string,number>, balanco: Record<string,number>) {
  const s = (setor||'').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
  let margemBrutaSetor = 35, margemOpSetor = 8, margemLiqSetor = 5

  // ── Alimentação & Bebidas ──────────────────────────────────────────
  if      (s.includes('restaurante') || s.includes('lanchonete'))               { margemBrutaSetor=65; margemOpSetor=10; margemLiqSetor=6 }
  else if (s.includes('padaria')     || s.includes('confeitaria'))               { margemBrutaSetor=60; margemOpSetor=8;  margemLiqSetor=4 }
  else if (s.includes('food service')|| s.includes('delivery'))                  { margemBrutaSetor=62; margemOpSetor=9;  margemLiqSetor=5 }
  else if (s.includes('industria de alimento') || s.includes('industria alimentic')) { margemBrutaSetor=32; margemOpSetor=8; margemLiqSetor=5 }
  else if (s.includes('distribuidora de alimento'))                              { margemBrutaSetor=18; margemOpSetor=4;  margemLiqSetor=2 }
  // ── Saúde & Bem-estar ─────────────────────────────────────────────
  else if (s.includes('clinica medic') || s.includes('clinica odontolog') || s.includes('odontolog')) { margemBrutaSetor=55; margemOpSetor=18; margemLiqSetor=12 }
  else if (s.includes('farmacia')    || s.includes('drogaria'))                  { margemBrutaSetor=30; margemOpSetor=6;  margemLiqSetor=4 }
  else if (s.includes('academia')    || s.includes('fitness'))                   { margemBrutaSetor=70; margemOpSetor=15; margemLiqSetor=9 }
  else if (s.includes('estetica'))                                                { margemBrutaSetor=65; margemOpSetor=20; margemLiqSetor=13 }
  else if (s.includes('hospital')    || s.includes('laborator'))                 { margemBrutaSetor=40; margemOpSetor=10; margemLiqSetor=6 }
  // ── Varejo & Moda ─────────────────────────────────────────────────
  else if (s.includes('moda')  || s.includes('vestuario'))                       { margemBrutaSetor=55; margemOpSetor=10; margemLiqSetor=6 }
  else if (s.includes('calcado') || s.includes('acessorio'))                     { margemBrutaSetor=52; margemOpSetor=9;  margemLiqSetor=5 }
  else if (s.includes('eletroeletronico') || s.includes('eletronico'))           { margemBrutaSetor=22; margemOpSetor=5;  margemLiqSetor=3 }
  else if (s.includes('movel') || s.includes('decoracao'))                       { margemBrutaSetor=45; margemOpSetor=8;  margemLiqSetor=5 }
  else if (s.includes('supermercado') || s.includes('mercearia'))                { margemBrutaSetor=22; margemOpSetor=4;  margemLiqSetor=2 }
  // ── Serviços ──────────────────────────────────────────────────────
  else if (s.includes('contabilidade') || s.includes('contabil') || s.includes('consultoria')) { margemBrutaSetor=70; margemOpSetor=22; margemLiqSetor=15 }
  else if (s.includes('agencia') || s.includes('marketing') || s.includes('publicidade'))      { margemBrutaSetor=65; margemOpSetor=15; margemLiqSetor=10 }
  else if (s.includes('educacao') || s.includes('escola') || s.includes('curso'))              { margemBrutaSetor=60; margemOpSetor=18; margemLiqSetor=12 }
  else if (s.includes('salao') || s.includes('barbearia'))                       { margemBrutaSetor=65; margemOpSetor=18; margemLiqSetor=11 }
  else if (s.includes('oficina') || s.includes('mecanica'))                      { margemBrutaSetor=55; margemOpSetor=14; margemLiqSetor=8 }
  // ── Tecnologia ────────────────────────────────────────────────────
  else if (s.includes('saas') || (s.includes('software') && !s.includes('industria'))) { margemBrutaSetor=78; margemOpSetor=25; margemLiqSetor=18 }
  else if (s.includes('ecommerce') || s.includes('marketplace') || s.includes('e-commerce'))  { margemBrutaSetor=35; margemOpSetor=6;  margemLiqSetor=3 }
  else if (s.includes('startup') || s.includes('fintech'))                       { margemBrutaSetor=72; margemOpSetor=15; margemLiqSetor=8 }
  // ── Indústria ─────────────────────────────────────────────────────
  else if (s.includes('textil'))                                                  { margemBrutaSetor=38; margemOpSetor=9;  margemLiqSetor=5 }
  else if (s.includes('metalurgi'))                                               { margemBrutaSetor=30; margemOpSetor=8;  margemLiqSetor=5 }
  else if (s.includes('plastica') || s.includes('quimic'))                       { margemBrutaSetor=35; margemOpSetor=10; margemLiqSetor=6 }
  else if (s.includes('agronegoc') || s.includes('agropecuar') || s.includes('agro') || s.includes('agricul')) { margemBrutaSetor=30; margemOpSetor=8; margemLiqSetor=5 }
  // ── Construção & Imóveis ──────────────────────────────────────────
  else if (s.includes('incorpor') || s.includes('construtora'))                  { margemBrutaSetor=28; margemOpSetor=10; margemLiqSetor=7 }
  else if (s.includes('imobiliar') || s.includes('imobili'))                     { margemBrutaSetor=50; margemOpSetor=20; margemLiqSetor=14 }
  else if (s.includes('reforma') || s.includes('manutencao'))                    { margemBrutaSetor=40; margemOpSetor=12; margemLiqSetor=7 }
  // ── Transporte & Logística ────────────────────────────────────────
  else if (s.includes('transportadora') || s.includes('frete') || s.includes('logistic') || s.includes('transport')) { margemBrutaSetor=25; margemOpSetor=7; margemLiqSetor=4 }
  else if (s.includes('locadora') || s.includes('locacao'))                      { margemBrutaSetor=45; margemOpSetor=15; margemLiqSetor=9 }
  // ── Genéricos (retrocompatibilidade) ─────────────────────────────
  else if (s.includes('atacad') || s.includes('distribui'))                      { margemBrutaSetor=20; margemOpSetor=5;  margemLiqSetor=3 }
  else if (s.includes('varejo') || s.includes('comercio') || s.includes('comercio')) { margemBrutaSetor=35; margemOpSetor=6; margemLiqSetor=3 }
  else if (s.includes('servico') || s.includes('servic'))                        { margemBrutaSetor=60; margemOpSetor=15; margemLiqSetor=10 }
  else if (s.includes('industria') || s.includes('manufactur'))                  { margemBrutaSetor=35; margemOpSetor=10; margemLiqSetor=6 }
  else if (s.includes('construc'))                                                { margemBrutaSetor=25; margemOpSetor=8;  margemLiqSetor=5 }
  else if (s.includes('tecnologia') || s.includes('tech') || s.includes('software')) { margemBrutaSetor=70; margemOpSetor=20; margemLiqSetor=15 }
  else if (s.includes('alimento') || s.includes('alimentac'))                    { margemBrutaSetor=65; margemOpSetor=10; margemLiqSetor=6 }
  else if (s.includes('clinic') || s.includes('saude') || s.includes('medic'))  { margemBrutaSetor=55; margemOpSetor=14; margemLiqSetor=9 }

  const rec = dre.receita_bruta || 1
  const recL = dre.receita_liquida || rec
  const margemBruta = recL > 0 ? ((dre.lucro_bruto / recL) * 100) : 0
  const margemOp    = recL > 0 ? ((dre.ebit / recL) * 100) : 0
  const margemLiq   = recL > 0 ? ((dre.lucro_liquido / recL) * 100) : 0

  // Ciclo de caixa
  const cmvAbs = Math.abs(dre.cmv || 0)
  const pmr = balanco.contas_a_receber > 0 && rec > 0 ? (balanco.contas_a_receber / rec * 365) : 0
  const pme = balanco.estoques > 0 && cmvAbs > 0 ? (balanco.estoques / cmvAbs * 365) : 0
  const pmp = balanco.fornecedores > 0 && cmvAbs > 0 ? (balanco.fornecedores / cmvAbs * 365) : 0
  const ciclo = pmr + pme - pmp

  // ROE
  const roe = balanco.patrimonio_liquido > 0 ? (dre.lucro_liquido / balanco.patrimonio_liquido * 100) : 0

  // Liquidez corrente
  const liquidez = balanco.passivo_circulante !== 0 ? (balanco.ativo_circulante / Math.abs(balanco.passivo_circulante)) : 0

  // EBITDA (estimado — sem depreciação explícita no documento)
  const ebitda = dre.ebit  // sem DA = igual ao EBIT na maioria dos casos sem nota explicativa

  // Endividamento
  const endividamento = balanco.ativo_total > 0 ? (Math.abs(balanco.passivo_total || 0) / balanco.ativo_total * 100) : 0

  // Nota geral (0-10)
  let nota = 5
  if (margemLiq > margemLiqSetor * 1.5) nota += 2
  else if (margemLiq > margemLiqSetor) nota += 1
  else if (margemLiq < 0) nota -= 2
  else if (margemLiq < margemLiqSetor * 0.5) nota -= 1
  if (ciclo < 0) nota += 1
  if (roe > 20) nota += 1
  if (liquidez > 1.5) nota += 0.5
  if (endividamento > 70) nota -= 0.5
  nota = Math.min(10, Math.max(1, nota))

  return {
    margemBruta: +margemBruta.toFixed(1),
    margemOp:    +margemOp.toFixed(1),
    margemLiq:   +margemLiq.toFixed(1),
    pmr:         +pmr.toFixed(0),
    pme:         +pme.toFixed(0),
    pmp:         +pmp.toFixed(0),
    ciclo:       +ciclo.toFixed(0),
    roe:         +roe.toFixed(1),
    liquidez:    +liquidez.toFixed(2),
    ebitda:      +ebitda.toFixed(0),
    endividamento: +endividamento.toFixed(1),
    nota:        +nota.toFixed(1),
    benchmarks: {
      margemBruta: margemBrutaSetor,
      margemOp:    margemOpSetor,
      margemLiq:   margemLiqSetor
    }
  }
}

// ── Handler principal ─────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey'
      }
    })
  }

  try {
    const body = await req.json()
    const { dre_base64, balanco_base64, hash_combo: hashComboClient, user_id, ano, periodo } = body

    if (!dre_base64 || !user_id) {
      return new Response(JSON.stringify({ error: 'dre_base64 e user_id são obrigatórios' }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    // ── 1. Hash recebido do cliente (evita recalcular no servidor) ──
    // Fallback: recalcula se não veio no request (compatibilidade)
    let hashCombo: string
    if (hashComboClient) {
      hashCombo = hashComboClient
    } else {
      const dreBytes  = Uint8Array.from(atob(dre_base64),  c => c.charCodeAt(0))
      const bpBytes   = balanco_base64 ? Uint8Array.from(atob(balanco_base64), c => c.charCodeAt(0)) : null
      const hashDRE   = await sha256(dreBytes)
      const hashBP    = bpBytes ? await sha256(bpBytes) : 'none'
      hashCombo = await sha256(new TextEncoder().encode(hashDRE + hashBP))
    }

    // ── 2. Verificar cache ──────────────────────────────────────
    const { data: cached } = await supabase
      .from('analyses')
      .select('dados_extraidos')
      .eq('hash_combo', hashCombo)
      .not('dados_extraidos', 'is', null)
      .maybeSingle()

    const compOk = cached?.dados_extraidos?.comparativo?.receita_bruta_anterior
    if (cached?.dados_extraidos && compOk) {
      console.log('✅ Cache hit:', hashCombo)
      return new Response(JSON.stringify({ ...cached.dados_extraidos, _hashCombo: hashCombo, cache: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }
    if (cached?.dados_extraidos) {
      console.log('🔄 Cache desatualizado (comparativo ausente/zerado) — re-analisando:', hashCombo)
    }

    // ── 3. Chamar Claude API ────────────────────────────────────
    console.log('🤖 Chamando Claude para análise...')

    // Remove espaços/quebras de linha que invalidam o base64
    const cleanB64 = (s: string) => s.replace(/\s+/g, '')
    const dreClean = cleanB64(dre_base64)
    const bpClean  = balanco_base64 ? cleanB64(balanco_base64) : null

    const content: Anthropic.MessageParam['content'] = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: dreClean }
      } as never
    ]

    if (bpClean) {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: bpClean }
      } as never)
    }

    content.push({ type: 'text', text: PROMPT_EXTRACAO })

    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 4000,
      messages:   [{ role: 'user', content }]
    })

    const rawText = (msg.content[0] as Anthropic.TextBlock).text.trim()
    console.log('🔍 Claude raw (primeiros 800 chars):', rawText.substring(0, 800))

    // Limpa possível markdown residual
    const jsonText = rawText.replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'')
    const extraido = JSON.parse(jsonText)
    console.log('📊 receita_bruta_ant extraída:', extraido.dre?.receita_bruta_ant)

    // ── 4. Calcular indicadores ────────────────────────────────
    const indicadores = benchmarksPorSetor(
      extraido.setor || '',
      extraido.dre   || {},
      extraido.balanco || {}
    )

    const resultado = {
      empresa:     extraido.empresa || 'Empresa',
      ano:         extraido.ano || ano || new Date().getFullYear().toString(),
      ano_anterior: extraido.ano_anterior || null,
      setor:       extraido.setor || 'Empresa',
      dre:         extraido.dre || {},
      balanco:     extraido.balanco || {},
      comparativo: {
        receita_bruta_anterior: extraido.dre?.receita_bruta_ant || 0,
        lucro_liquido_anterior: extraido.dre?.lucro_liquido_ant || 0,
        ebit_anterior:          extraido.dre?.ebit_ant          || 0,
      },
      indicadores,
      _hashCombo:  hashCombo,
      cache: false
    }

    // ── 5. Salvar no Supabase ──────────────────────────────────
    await supabase.from('analyses').upsert({
      user_id,
      year:            resultado.ano,
      period:          periodo || 'Anual',
      hash_combo:      hashCombo,
      dados_extraidos: resultado
    }, { onConflict: 'user_id,year,period' })

    console.log('✅ Análise concluída para:', resultado.empresa)

    return new Response(JSON.stringify(resultado), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })

  } catch (err) {
    console.error('❌ Erro na análise:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
})
