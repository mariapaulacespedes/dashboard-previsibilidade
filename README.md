# Quando fica pronto? — Dashboard de Previsibilidade

Dashboard web que responde à pergunta mais frequente de qualquer stakeholder — **"Quando fica pronto?"** — usando **métricas de fluxo** e **simulação Monte Carlo** no lugar de estimativas.

🔗 **Demo:** _[cole aqui o link da Vercel]_

![Captura de tela do dashboard](docs/screenshot.png)
<!-- Salve uma captura de tela em docs/screenshot.png para a imagem acima aparecer. -->

---

## O problema

Times ágeis gastam horas estimando (story points, planning poker, horas) e mesmo assim erram prazos. A estimativa responde "quanto esforço eu acho que isso dá", mas quem pergunta quer saber **quando** vai receber — e o prazo real depende muito mais de filas, bloqueios e trabalho em paralelo do que do esforço.

O resultado costuma ser uma data única, sem margem de erro, tratada como promessa.

## A solução

Usar o que o time **já entregou** para prever o que ele **vai entregar**:

- As **métricas de fluxo** mostram como o trabalho realmente anda (ritmo, tempo por item, itens parados).
- A **simulação Monte Carlo** transforma esse histórico em previsões com **nível de confiança**: em vez de "fica pronto dia 20", dizemos "com 85% de confiança, fica pronto até dia 27".

Tudo roda no navegador, com dados sintéticos de 3 times fictícios.

## Como usar

**Abrir no computador:** baixe a pasta e dê dois cliques em `index.html`. Não precisa instalar nada (só de internet, para carregar a biblioteca de gráficos Chart.js).

**Publicar na Vercel:** crie um projeto na Vercel apontando para este repositório e aceite as opções padrão. Não há etapa de build nem configuração — é um site estático.

**No dashboard:**

1. Escolha um time (ou "Todos os times") no filtro do topo.
2. Leia os gráficos de cima para baixo; abaixo de cada um há uma frase sobre o que ele mostra e que decisão apoia.
3. Na seção Monte Carlo, digite quantos itens faltam **ou** escolha uma data-alvo.
4. O botão **EN / PT** alterna o idioma.

### Estrutura dos arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | A página |
| `css/style.css` | A aparência |
| `js/app.js` | Os cálculos e os gráficos |
| `js/i18n.js` | Todos os textos, em português e inglês |
| `data/itens.csv` | Os dados (formato parecido com uma exportação do Jira) |
| `data/itens.js` | Cópia do CSV embutida no site (ver nota abaixo) |
| `tools/gerar-dados.js` | Script que gera os dados sintéticos |

> **Por que existe uma cópia dos dados em `.js`?** Por segurança, os navegadores não deixam uma página aberta com dois cliques ler arquivos vizinhos como o CSV. A cópia embutida faz o dashboard funcionar tanto com dois cliques quanto publicado. Para gerar os dados de novo (precisa de Node.js): `node tools/gerar-dados.js`.

### Sobre os dados

**Todos os dados são fictícios.** Os times (App Mobile, Produtos, Jornada do Cliente), os itens e as datas foram gerados por um script e não representam nenhuma empresa. São cerca de 460 itens em 6 meses, com colunas `id, time, tipo, data_inicio, data_fim, status`, e imperfeições propositais: semanas ruins (feriado, incidente, congelamento de release), bugs que demoram mais e itens travados em andamento.

O dashboard trata **01/11/2026** como "hoje" (a data da foto dos dados), para que o exemplo não envelheça.

## As métricas

### 1. Throughput semanal
**O que é:** quantos itens foram concluídos em cada semana (segunda a domingo). A linha é a média móvel de 4 semanas, que suaviza os altos e baixos e mostra a tendência.
**Decisão que apoia:** o ritmo está estável o bastante para prever? Uma queda sustentada pede investigação antes de qualquer nova promessa de data.

### 2. Cycle time
**O que é:** quantos dias corridos cada item levou do início ao fim (contando o dia de início e o de fim). Cada ponto do gráfico é um item. As linhas são percentis: o **P85**, por exemplo, é o prazo dentro do qual 85% dos itens ficaram prontos.
**Decisão que apoia:** que prazo combinar para um item individual. "85% dos nossos itens ficam prontos em até 14 dias" é um acordo de nível de serviço baseado em dados.

### 3. Aging WIP
**O que é:** para cada item ainda em andamento, há quantos dias ele está aberto. Os itens que já passaram do P85 do histórico aparecem em vermelho com ⚠.
**Decisão que apoia:** onde agir **hoje**. É a única métrica que olha para o trabalho que ainda pode ser salvo: item envelhecido é pauta de daily (está bloqueado? é grande demais? falta foco?).

### 4. Distribuição por tipo
**O que é:** a proporção de Histórias, Bugs e Débito Técnico, com o cycle time típico (P50) e o conservador (P85) de cada tipo.
**Decisão que apoia:** como dividir a capacidade entre valor novo, correções e saúde técnica. Se bugs ocupam muito espaço e demoram mais, vale investir em prevenção.

### 5. Monte Carlo
**O que é:** o computador simula o futuro 10.000 vezes. Em cada simulação ele sorteia semanas do histórico real de throughput e soma as entregas.

- **"Quando terminamos X itens?"** — sorteia semanas até a soma chegar em X e anota quanto tempo levou. Ordenando as 10.000 respostas, a data que cobre 85% delas é a previsão com 85% de confiança.
- **"Quantos itens até a data Y?"** — sorteia uma semana do histórico para cada semana que falta até a data e soma. O número que 85% das simulações igualaram ou superaram é a quantidade com 85% de confiança.

O histograma mostra todas as respostas possíveis e a frequência de cada uma.

## Por que Monte Carlo é melhor que estimativa

| Estimativa tradicional | Monte Carlo com throughput |
|---|---|
| Baseada em opinião sobre o esforço | Baseada no que o time realmente entregou |
| Uma data única, sem margem de erro | Um intervalo com nível de confiança (50%, 85%, 95%) |
| Ignora filas, bloqueios e interrupções | Já inclui tudo isso, porque está embutido no histórico |
| Exige horas de reunião para estimar item a item | Só precisa de datas de início e fim, que a ferramenta já registra |
| Otimista por natureza (planejamos o cenário ideal) | Inclui as semanas ruins que de fato aconteceram |
| Vira promessa e gera cobrança | Abre uma conversa sobre risco: "quanta certeza você precisa?" |

**Limites honestos:** a simulação supõe que o futuro próximo se parece com o passado recente. Se o time mudar de tamanho, de contexto ou de tipo de trabalho, o histórico deixa de representar o futuro — por isso o dashboard permite escolher quantas semanas de histórico usar. E ela conta itens, sem distinguir tamanho: funciona melhor quando os itens são fatiados de forma parecida.

## Construído com IA

Este projeto foi construído com o **[Claude Code](https://claude.com/claude-code)**, assistente de programação da Anthropic. Eu não programo; o código foi escrito pela IA a partir das minhas definições.

**Meu papel:**

- **Definição do problema** — escolher a pergunta "Quando fica pronto?" e o público (stakeholders e times ágeis).
- **Escolha das métricas** — decidir quais métricas de fluxo entram, como cada uma deve ser lida e que decisão apoia.
- **Regras do dado** — especificar os times, os tipos de item e as imperfeições realistas que os dados deveriam ter.
- **Validação dos resultados** — conferir os números do dashboard contra o CSV e verificar se as previsões fazem sentido.

**Papel da IA:** escrever o HTML, CSS e JavaScript, gerar os dados sintéticos e explicar cada cálculo em linguagem simples.

## Autor

_[Seu nome] — [LinkedIn] — [e-mail ou outro contato]_

---

## English summary

**When will it be done?** is a static dashboard (HTML, CSS, JavaScript + Chart.js, no backend, no build) that answers the most common stakeholder question using **flow metrics** and **Monte Carlo simulation** instead of estimates.

- **Metrics:** weekly throughput with moving average, cycle time scatterplot with 50th/85th/95th percentiles, aging work in progress, and work item type distribution — all filterable by team.
- **Forecasts:** 10,000 Monte Carlo runs based on historical throughput answer "When will X items be done?" (dates at 50%, 85% and 95% confidence) and "How many items by date Y?" (count at 85% confidence).
- **Data:** fully synthetic — three fictional teams, six months of Jira-style items. No real company data.
- **Usage:** open `index.html`, or deploy to Vercel with default settings. Use the EN/PT button to switch language.
- **Built with AI:** the code was written with Claude Code. My role was defining the problem, choosing the metrics and validating the results.
