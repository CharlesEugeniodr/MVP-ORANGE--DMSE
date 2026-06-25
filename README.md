# MVP-ORANGE--DMSE

[![Scientific Validation & CI](https://github.com/CharlesEugeniodr/MVP-ORANGE--DMSE/actions/workflows/scientific_validation.yml/badge.svg)](https://github.com/CharlesEugeniodr/MVP-ORANGE--DMSE/actions)

Esta é a plataforma científica do **Orange - DMS** (antigo DMSE), desenvolvida para simulação, análise e visualização holográfica 3D da Malha Dimensional Vetorial esferoidal baseada no postulado físico-matemático de vácuo:

$$\frac{\omega \cdot Z_0 \cdot \varepsilon_-}{c} = -1$$

Este projeto possui integração de dados astronômicos observacionais reais, baterias de testes estatísticos automatizados, modelagem de anomalias espaciais reais e infraestrutura conteinerizada para deploy facilitado.

---

## 📂 Estrutura de Diretórios e Componentes

O projeto é dividido nos seguintes módulos principais:

*   **`orange_core.py`**: Motor numérico que integra as equações diferenciais parciais (PDE) hiperbólicas amortecidas por meio de discretização de Verlet de 2ª ordem e controle não-linear adaptativo de $\kappa$.
*   **`galaxy_models.py`**: Modelos de física gravitacional que importam dados observacionais do catálogo **SPARC** (NGC 3198, NGC 2403, UGC 128) e calculam curvas de rotação para Gravidade Newtoniana, MOND e Orange - DMS.
*   **`orange_app.py`**: Painel visual de controle no Streamlit que renderiza a malha dimensional em 3D, plota a convergência temporal das energias, ajusta e compara os dados galácticos com cálculo de $\chi^2$ reduzido e emite Laudos Técnicos automatizados de sanidade física.
*   **`orange_api.py`**: API REST FastAPI para conexões e integrações externas.
*   **`Dockerfile` / `docker-compose.yml`**: Configuração multi-stage Docker para subir o ecossistema de microsserviços de forma isolada.
*   **`.github/workflows/scientific_validation.yml`**: Integração Contínua (CI) com atuação constante no GitHub que compila e testa o código automaticamente a cada push.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
Certifique-se de ter o Python 3.10+ instalado em sua máquina.

### Instalação
No diretório do projeto, instale as dependências:
```bash
pip install -r requirements.txt
```

### Inicialização
Para rodar os serviços locais (Dashboard e API), execute os seguintes comandos:

```bash
# Servidor de API (Porta 8000)
python -m uvicorn orange_api:app --host 0.0.0.0 --port 8000

# Dashboard Interativo (Porta 8501)
python -m streamlit run orange_app.py --server.port 8501 --server.address 0.0.0.0
```

---

## 🐳 Executando via Docker-Compose

Para rodar todo o ambiente em containers isolados:
```bash
docker-compose up --build
```
A API estará exposta em `http://localhost:8000` e o Dashboard em `http://localhost:8501`.

---

## 📜 Compromisso Científico e Ético
Este software é regido pelo compromisso irredutível da transparência metodológica e da falseabilidade empírica, recusando ajustes de parâmetros *ad-hoc* para mascarar desvios de universalidade física, fomentando a discussão aberta e a revisão acadêmica por pares.
