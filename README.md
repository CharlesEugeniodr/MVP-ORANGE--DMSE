# MVP-ORANGE-DMSE — Plataforma Científica de Validação Dimensional

[![Scientific Validation & CI](https://github.com/CharlesEugeniodr/MVP-ORANGE--DMSE/actions/workflows/scientific_validation.yml/badge.svg)](https://github.com/CharlesEugeniodr/MVP-ORANGE--DMSE/actions)
[![Deploy to GitHub Pages](https://github.com/CharlesEugeniodr/MVP-ORANGE--DMSE/actions/workflows/deploy-pages.yml/badge.svg)](https://charleseugeniodr.github.io/mvp-orange-dmse/)

> **Acesso Público:** [https://charleseugeniodr.github.io/mvp-orange-dmse/#/](https://charleseugeniodr.github.io/mvp-orange-dmse/#/)

Plataforma científica do **Orange-DMS** para simulação, validação dimensional e análise comparativa da Malha Octogonal Vetorial Esferoidal, baseada no postulado físico-matemático de vácuo:

$$\frac{\omega \cdot Z_0 \cdot \varepsilon_-}{c} = -1$$

---

## 🏗️ Arquitetura

O MVP é uma **SPA estática** (Single Page Application) deployável diretamente no GitHub Pages, sem backend. O motor científico roda **inteiramente no browser** via JavaScript ES6 Modules.

### Princípios Fundamentais

| Princípio | Implementação |
|-----------|---------------|
| **Parâmetros abertos, motor fechado** | Interface expõe TODOS os parâmetros; motor PDE é caixa-preta; funcionamento interno demonstrado somente no laudo de auditoria |
| **Falsificabilidade Popperiana** | Cada dimensão individualmente testável; dimensões que saturam são explicitamente marcadas como falíveis |
| **Comparativo rigoroso** | Newton, MOND, ΛCDM (NFW) e Orange-DMS testados contra mesmos dados observacionais SPARC |
| **Ingestão de dados** | Upload de CSV/JSON para confrontar predições com dados reais |
| **Métricas de classe mundial** | χ² reduzido, AIC, BIC, Bayes Factor, K-S test, Bootstrap CI 95%, Cohen's d |
| **Auditoria pública** | Motor demonstrado passo a passo no laudo, com hash SHA-256 de integridade |

---

## 📂 Estrutura de Diretórios

```
mvp-orange-dmse/
├── index.html                          # SPA principal (hash router)
├── index.css                           # Design system completo
├── js/
│   ├── app.js                          # Router + estado global
│   ├── engine/
│   │   ├── orange-core.js              # Motor PDE 30D (Verlet, κ adaptativo)
│   │   ├── metrics.js                  # AIC, BIC, χ², RMSE, Bayes Factor
│   │   ├── dimension-validator.js      # Validador individual das 30 dimensões
│   │   └── comparative-models.js       # Newton, MOND, ΛCDM, Orange-DMS
│   ├── data/
│   │   ├── sparc-catalog.js            # Dados SPARC (NGC 3198, NGC 2403, UGC 128)
│   │   ├── data-ingestion.js           # Parser CSV/JSON com validação
│   │   └── apophis-fallback.js         # Dados Apophis 2029 (fallback estático)
│   ├── ui/
│   │   ├── charts.js                   # Wrapper Plotly.js
│   │   ├── dashboard.js                # Painel de simulação
│   │   ├── octagonal-mesh-3d.js        # Malha esferoidal 3D
│   │   ├── dimension-audit.js          # Auditoria dimensional
│   │   ├── comparative-panel.js        # Comparativo de modelos
│   │   ├── ingestion-panel.js          # Ingestão de dados
│   │   └── scientific-report.js        # Gerador de laudo técnico
│   └── utils/
│       ├── statistics.js               # K-S test, Bootstrap CI, Shapiro-Wilk
│       └── export.js                   # Exportação SHA-256, JSON, CSV
├── python/                             # Motor Python original (referência)
│   ├── orange_core.py
│   ├── galaxy_models.py
│   ├── orange_api.py
│   ├── horizons_client.py
│   └── requirements.txt
├── doc/
│   └── paper_draft.tex
├── .github/workflows/
│   ├── scientific_validation.yml       # CI: testes Python
│   └── deploy-pages.yml                # Deploy GitHub Pages
└── README.md
```

---

## 🔬 As 6 Páginas da Plataforma

### 1. ⚡ Simulação da Malha
- Motor PDE 30D com integrador Verlet de 2ª ordem
- Controlador κ adaptativo
- Visualização 3D da malha esferoidal (30 gomos)
- Gráficos de convergência em tempo real

### 2. 🔬 30 Dimensões
- **Validação individual** de cada dimensão com 6 critérios:
  - Convergência, Saturação, Estabilidade, Impacto do Par, Sensibilidade, Falibilidade Cruzada
- Classificação: 🟢 COMPROVADA · 🟡 SATURADA · 🔴 FALÍVEL · ⚪ INDETERMINADA

### 3. 📊 Comparativo
- Newton vs MOND vs ΛCDM (NFW) vs Orange-DMS
- Dados observacionais SPARC com barras de erro
- Métricas comparativas: χ²_red, AIC, BIC, RMSE, R²
- Análise de nuances causais

### 4. 📁 Ingestão de Dados
- Upload de CSV/JSON com auto-detecção de colunas
- Comparação dados reais vs predições do modelo
- RMSE espacial entre importado e simulado

### 5. 📜 Laudo & Auditoria
- 6 testes automatizados de sanidade científica
- Certificado de conformidade com veredito formal
- Motor PDE demonstrado passo a passo (auditoria aberta)
- Hash SHA-256 de integridade

### 6. 📖 Fundamentação Teórica
- Formalismo matemático-físico completo
- Equações PDE, Verlet, Hamiltoniana
- Princípios de falsificabilidade

---

## 🚀 Como Acessar

### GitHub Pages (Público)
Acesse diretamente: [https://charleseugeniodr.github.io/mvp-orange-dmse/#/](https://charleseugeniodr.github.io/mvp-orange-dmse/#/)

### Localmente
Abra `index.html` em qualquer browser moderno (requer servidor HTTP para ES6 modules):
```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

### Motor Python Original (Backend)
```bash
cd python/
pip install -r requirements.txt
python orange_core.py        # Simulação PDE
python galaxy_models.py      # Ajuste SPARC
```

---

## 📜 Compromisso Científico e Ético

> *"Amicus Plato, sed magis amica veritas."*

Este software adota o compromisso irredutível da **transparência metodológica e falseabilidade popperiana**:
- Dimensões que saturam são **explicitamente marcadas como falíveis**
- Não há ajustes de parâmetros *ad-hoc* ocultos
- O motor interno é **demonstrado passo a passo** na auditoria pública
- Todos os resultados incluem **hash SHA-256** de integridade
- Modelos concorrentes (Newton, MOND, ΛCDM) são comparados com as mesmas métricas

---

**Autor:** Charles de Paula Eugênio  
**Licença:** Open-Source Scientific  
**Versão:** 2.0 — Junho 2026
