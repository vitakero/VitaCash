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
  "ano": "ano do exercício (ex: 2023)",
  "setor": "setor estimado com base nos dados (ex: Comércio Atacadista, Serviços, Varejo, Indústria, etc.)",
  "dre": {
    "receita_bruta": 0,
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
    "lucro_liquido": 0
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
- lucro_liquido = resultado_antes_tributos + impostos (impostos é negativo)`

// ── Benchmarks por setor ──────────────────────────────────────────
function benchmarksPorSetor(setor: string, dre: Record<string,number>, balanco: Record<string,number>) {
  const s = (setor||'').toLowerCase()
  let margemBrutaSetor = 30, margemOpSetor = 8, margemLiqSetor = 5

  if (s.includes('atacad')) { margemBrutaSetor = 20; margemOpSetor = 5; margemLiqSetor = 3 }
  else if (s.includes('varejo') || s.includes('comércio')) { margemBrutaSetor = 35; margemOpSetor = 6; margemLiqSetor = 3 }
  else if (s.includes('serviço') || s.includes('servico')) { margemBrutaSetor = 60; margemOpSetor = 15; margemLiqSetor = 10 }
  else if (s.includes('indústria') || s.includes('industria')) { margemBrutaSetor = 35; margemOpSetor = 10; margemLiqSetor = 6 }
  else if (s.includes('construção') || s.includes('construcao')) { margemBrutaSetor = 25; margemOpSetor = 8; margemLiqSetor = 5 }
  else if (s.includes('tecnologia') || s.includes('tech') || s.includes('software')) { margemBrutaSetor = 70; margemOpSetor = 20; margemLiqSetor = 15 }

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

    if (cached?.dados_extraidos) {
      console.log('✅ Cache hit:', hashCombo)
      return new Response(JSON.stringify({ ...cached.dados_extraidos, _hashCombo: hashCombo, cache: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
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
      max_tokens: 2000,
      messages:   [{ role: 'user', content }]
    })

    const rawText = (msg.content[0] as Anthropic.TextBlock).text.trim()

    // Limpa possível markdown residual
    const jsonText = rawText.replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'')
    const extraido = JSON.parse(jsonText)

    // ── 4. Calcular indicadores ────────────────────────────────
    const indicadores = benchmarksPorSetor(
      extraido.setor || '',
      extraido.dre   || {},
      extraido.balanco || {}
    )

    const resultado = {
      empresa:     extraido.empresa || 'Empresa',
      ano:         extraido.ano || ano || new Date().getFullYear().toString(),
      setor:       extraido.setor || 'Empresa',
      dre:         extraido.dre || {},
      balanco:     extraido.balanco || {},
      indicadores,
      _hashCombo:  hashCombo,
      cache: false
    }

    // ── 5. Segunda chamada Claude: recomendações personalizadas ──
    console.log('🎯 Gerando recomendações personalizadas...')
    const ind = resultado.indicadores
    const bm  = resultado.indicadores.benchmarks || {}
    const dreR = resultado.dre
    const balR = resultado.balanco

    const PROMPT_RECOMENDACOES = `Você é um consultor financeiro sênior especializado em empresas brasileiras do setor ${resultado.setor}.

Analise os dados financeiros abaixo e gere exatamente 4 recomendações de ação priorizadas, do mais urgente/crítico para o mais estratégico.

EMPRESA: ${resultado.empresa}
SETOR: ${resultado.setor}
ANO: ${resultado.ano}

INDICADORES REAIS:
- Receita bruta: R$ ${dreR.receita_bruta?.toLocaleString('pt-BR')}
- Receita líquida: R$ ${dreR.receita_liquida?.toLocaleString('pt-BR')}
- CMV: R$ ${dreR.cmv?.toLocaleString('pt-BR')} (${ind.margemBruta ? (100 - ind.margemBruta).toFixed(1) : '?'}% da receita líquida)
- Lucro bruto: R$ ${dreR.lucro_bruto?.toLocaleString('pt-BR')}
- Despesas de vendas: R$ ${dreR.despesas_vendas?.toLocaleString('pt-BR')}
- Despesas administrativas: R$ ${dreR.despesas_admin?.toLocaleString('pt-BR')}
- EBIT: R$ ${dreR.ebit?.toLocaleString('pt-BR')}
- Resultado financeiro: R$ ${dreR.resultado_financeiro?.toLocaleString('pt-BR')}
- Lucro líquido: R$ ${dreR.lucro_liquido?.toLocaleString('pt-BR')}

INDICADORES CALCULADOS vs BENCHMARK DO SETOR (${resultado.setor}):
- Margem bruta: ${ind.margemBruta}% | Benchmark: ${bm.margemBruta}%
- Margem operacional: ${ind.margemOp}% | Benchmark: ${bm.margemOp}%
- Margem líquida: ${ind.margemLiq}% | Benchmark: ${bm.margemLiq}%
- ROE: ${ind.roe}% | Referência: Selic 15% a.a.
- Endividamento: ${ind.endividamento}%
- Cobertura de juros: ${ind.ebitda > 0 && dreR.resultado_financeiro ? (Math.abs(dreR.ebit) / Math.abs(dreR.resultado_financeiro)).toFixed(1) : 'N/A'}x
- Liquidez corrente: ${ind.liquidez}x
- PMR (prazo médio recebimento): ${ind.pmr} dias
- PME (prazo médio estoque): ${ind.pme} dias
- PMP (prazo médio pagamento): ${ind.pmp} dias
- Ciclo de caixa: ${ind.ciclo} dias
- ROE: ${ind.roe}%

BALANÇO:
- Caixa: R$ ${balR.caixa?.toLocaleString('pt-BR')}
- Contas a receber: R$ ${balR.contas_a_receber?.toLocaleString('pt-BR')}
- Estoques: R$ ${balR.estoques?.toLocaleString('pt-BR')}
- Ativo total: R$ ${balR.ativo_total?.toLocaleString('pt-BR')}
- Empréstimos CP: R$ ${balR.emprestimos_cp?.toLocaleString('pt-BR')}
- Empréstimos LP: R$ ${balR.emprestimos_lp?.toLocaleString('pt-BR')}
- Patrimônio líquido: R$ ${balR.patrimonio_liquido?.toLocaleString('pt-BR')}

Retorne APENAS um JSON válido, sem markdown, com esta estrutura exata:
{
  "potencial_realista": 0,
  "potencial_descricao": "frase curta explicando o potencial ex: redução de 3pp nas despesas de vendas + melhora no ciclo de caixa",
  "recomendacoes": [
    {
      "tipo": "ruim",
      "titulo": "título específico com o maior problema identificado e impacto em R$",
      "ind_val": "métrica principal ex: margem op. 4,6%",
      "ind_media": "meta: acima de 8%",
      "chip": "Comece por aqui",
      "acoes_titulo": "3 ações para recuperar R$ X/ano",
      "acoes": [
        {"titulo": "ação específica e concreta", "desc": "descrição detalhada com números reais desta empresa", "impacto": "alto"},
        {"titulo": "ação específica e concreta", "desc": "descrição detalhada com números reais desta empresa", "impacto": "alto"},
        {"titulo": "ação específica e concreta", "desc": "descrição detalhada com números reais desta empresa", "impacto": "medio"}
      ],
      "impacto_estimado": "Impacto estimado: +R$ X/ano de lucro líquido a mais",
      "potencial": "parágrafo explicativo com os números reais desta empresa, comparação com benchmark e o que muda se executar as ações",
      "cta": "Ver como executar essa redução"
    }
  ]
}

REGRAS CRÍTICAS:
- Seja ESPECÍFICO para o setor ${resultado.setor} — considere as dinâmicas reais desse mercado
- Use os valores reais em R$ em TODOS os textos — nunca valores genéricos
- Ordene do problema mais crítico para o menos crítico
- Se um indicador estiver BOM vs benchmark, reconheça como ponto forte e explique como ampliar — não invente problema onde não há
- O "tipo" deve ser "ruim" para problemas e "bom" para pontos fortes
- Para o chip use: "Comece por aqui" (1º card crítico), "Prioridade alta" (2º crítico), "Ponto forte" (cards positivos)
- Cada recomendação deve ser diferente — nunca repita a mesma lógica
- Considere o ciclo de caixa, sazonalidade e dinâmicas específicas do setor ao dar conselhos
- "potencial_realista" deve ser um número em reais (sem R$) representando o ganho REALISTA e CONSERVADOR que a empresa consegue em 12 meses executando as ações — NÃO o máximo teórico. Considere: o que é operacionalmente viável, o que o setor permite, e evite somar itens que se sobrepõem. Seja honesto — é melhor subestimar e surpreender do que prometer o impossível`

    let recomendacoes = null
    try {
      const msgRec = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 4000,
        messages: [{ role: 'user', content: PROMPT_RECOMENDACOES }]
      })
      const rawRec = (msgRec.content[0] as Anthropic.TextBlock).text.trim()
      const jsonRec = rawRec.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      const parsedRec = JSON.parse(jsonRec)
      recomendacoes = parsedRec.recomendacoes
      const potencialRealista = parsedRec.potencial_realista || null
      const potencialDescricao = parsedRec.potencial_descricao || null
      console.log('✅ Recomendações geradas:', recomendacoes?.length, '| Potencial realista: R$', potencialRealista)
      resultado = { ...resultado, recomendacoes, potencial_realista: potencialRealista, potencial_descricao: potencialDescricao }
    } catch (err) {
      console.error('⚠️ Erro nas recomendações (não crítico):', err)
      resultado = { ...resultado, recomendacoes: null }
    }

    // ── 6. Salvar no Supabase ──────────────────────────────────
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
