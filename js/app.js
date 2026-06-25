/**
 * app.js — Orange-DMSE SPA Router & Application Controller
 * Manages hash-based routing, engine lifecycle, and inter-component communication.
 */

// ── Engine Imports ──
import { DEFAULT_PARAMS, DMSEngine, computeHamiltonianEnergy } from './engine/orange-core.js';
import { SPARC_CATALOG } from './data/sparc-catalog.js';
import { DimensionValidator } from './engine/dimension-validator.js';
import * as Metrics from './engine/metrics.js';
import * as ComparativeModels from './engine/comparative-models.js';
import { DataIngestion } from './data/data-ingestion.js';
import { getApophisComparison } from './data/apophis-fallback.js';
import * as Statistics from './utils/statistics.js';
import * as ExportUtils from './utils/export.js';

// ── UI Imports ──
import { ChartManager } from './ui/charts.js';
import { DashboardPanel } from './ui/dashboard.js';
import { OctagonalMesh3D } from './ui/octagonal-mesh-3d.js';
import { DimensionAuditPanel } from './ui/dimension-audit.js';
import { ComparativePanel } from './ui/comparative-panel.js';
import { IngestionPanel } from './ui/ingestion-panel.js';
import { ScientificReportPanel } from './ui/scientific-report.js';

// ══════════════════════════════════════════
// DMSEParams helper — creates a params object
// from defaults + overrides
// ══════════════════════════════════════════
function DMSEParams(overrides = {}) {
    return { ...DEFAULT_PARAMS, ...overrides };
}

// ══════════════════════════════════════════
// Application State
// ══════════════════════════════════════════
const AppState = {
    engine: null,
    params: DMSEParams(),
    metricsHistory: [],
    hamiltonianHistory: [],
    edot2MeanHistory: [],
    simulationRunning: false,
    simulationSteps: 0,
    validationResults: null,
    importedData: null,
    currentRoute: 'dashboard',

    // Comparative params
    orangeParams: { gamma: 1.5, Rs: 8.0, beta: 1.0 },
    selectedGalaxy: 'NGC_3198',
    gammaPerGalaxy: { NGC_3198: 1.5, NGC_2403: 1.3, UGC_128: 4.8 }
};

// Expose to global for component access
window.AppState = AppState;
window.DMSEParams = DMSEParams;
window.DEFAULT_PARAMS = DEFAULT_PARAMS;
window.SPARC_CATALOG = SPARC_CATALOG;
window.Metrics = Metrics;
window.ComparativeModels = ComparativeModels;
window.Statistics = Statistics;
window.ExportUtils = ExportUtils;
window.DimensionValidator = DimensionValidator;
window.DataIngestion = DataIngestion;
window.getApophisComparison = getApophisComparison;
window.ChartManager = ChartManager;

// ══════════════════════════════════════════
// Route Definitions
// ══════════════════════════════════════════
const ROUTES = {
    dashboard: {
        title: 'Simulação da Malha Octogonal',
        subtitle: 'Motor PDE 30D com integrador Verlet de 2ª ordem e controlador κ adaptativo',
        render: renderDashboard
    },
    dimensions: {
        title: '30 Dimensões da Malha Octogonal',
        subtitle: 'Validação individual com falsificabilidade: convergência, saturação, falibilidade cruzada',
        render: renderDimensions
    },
    compare: {
        title: 'Análise Comparativa de Modelos',
        subtitle: 'Newton · MOND · ΛCDM (NFW) · Orange-DMS contra dados observacionais SPARC',
        render: renderCompare
    },
    ingest: {
        title: 'Ingestão de Dados Externos',
        subtitle: 'Importe dados observacionais em CSV/JSON para testagem comparativa com o modelo preditivo',
        render: renderIngest
    },
    audit: {
        title: 'Laudo Técnico & Auditoria Pública',
        subtitle: 'Motor fechado, auditoria aberta — certificação de conformidade com transparência total',
        render: renderAudit
    },
    theory: {
        title: 'Fundamentação Teórica',
        subtitle: 'Formalismo matemático-físico da Malha Dimensional Vetorial Esferoidal',
        render: renderTheory
    }
};

// ══════════════════════════════════════════
// Router
// ══════════════════════════════════════════
function getRoute() {
    const hash = window.location.hash.replace('#/', '').replace('#', '');
    return hash || 'dashboard';
}

function navigateTo(route) {
    window.location.hash = `#/${route}`;
}

function handleRoute() {
    const route = getRoute();
    const routeConfig = ROUTES[route];

    if (!routeConfig) {
        navigateTo('dashboard');
        return;
    }

    AppState.currentRoute = route;

    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.route === route);
    });

    // Render page
    const content = document.getElementById('app-content');
    content.innerHTML = '';

    // Page header
    const header = document.createElement('div');
    header.className = 'page-header animate-fade-in';
    header.innerHTML = `
        <h1 class="page-title">${routeConfig.title}</h1>
        <p class="page-subtitle">${routeConfig.subtitle}</p>
    `;
    content.appendChild(header);

    // Page content
    const pageContainer = document.createElement('div');
    pageContainer.className = 'page-content animate-fade-in';
    pageContainer.id = 'page-container';
    content.appendChild(pageContainer);

    routeConfig.render(pageContainer);

    // Close mobile sidebar
    document.getElementById('sidebar')?.classList.remove('open');
}

// ══════════════════════════════════════════
// Engine Management
// ══════════════════════════════════════════
function updateEngineStatus(status, text) {
    const statusEl = document.getElementById('engine-status');
    if (!statusEl) return;
    const dot = statusEl.querySelector('.status-dot');
    const label = statusEl.querySelector('.status-text');
    if (dot) dot.className = `status-dot status-${status}`;
    if (label) label.textContent = text;
}

function createEngine(paramsOverrides) {
    AppState.params = DMSEParams(paramsOverrides);
    AppState.engine = new DMSEngine(AppState.params);
    AppState.engine.reset(123);
    AppState.metricsHistory = [];
    AppState.hamiltonianHistory = [];
    AppState.edot2MeanHistory = [];
    AppState.simulationSteps = 0;
    updateEngineStatus('idle', 'Motor Pronto');
}

async function runSimulation(steps, onProgress) {
    if (!AppState.engine) {
        createEngine(AppState.params);
    }

    AppState.simulationRunning = true;
    updateEngineStatus('running', 'Simulando...');

    const batchSize = 10;

    for (let i = 0; i < steps; i += batchSize) {
        const end = Math.min(i + batchSize, steps);
        for (let j = i; j < end; j++) {
            const m = AppState.engine.step();
            AppState.metricsHistory.push(m);

            // Hamiltonian (already tracked inside engine)
            const hLen = AppState.engine.H_history.length;
            if (hLen > 0) {
                AppState.hamiltonianHistory.push(AppState.engine.H_history[hLen - 1]);
            }

            // Edot² mean estimate from kinetic energy
            let totalEkin = 0;
            for (let d = 0; d < m.E_kin.length; d++) {
                totalEkin += m.E_kin[d];
            }
            AppState.edot2MeanHistory.push(totalEkin / m.E_kin.length);

            AppState.simulationSteps++;
        }

        if (onProgress) {
            const lastM = AppState.metricsHistory[AppState.metricsHistory.length - 1];
            onProgress(Math.min((i + batchSize) / steps, 1.0), lastM);
        }
        await new Promise(r => setTimeout(r, 0));
    }

    AppState.simulationRunning = false;
    updateEngineStatus('idle', `Motor: ${AppState.simulationSteps} passos`);
}

window.createEngine = createEngine;
window.runSimulation = runSimulation;
window.updateEngineStatus = updateEngineStatus;

// ══════════════════════════════════════════
// Page Renderers
// ══════════════════════════════════════════

function renderDashboard(container) {
    const panel = new DashboardPanel(container);
    panel.render(AppState);
}

function renderDimensions(container) {
    const panel = new DimensionAuditPanel(container);

    if (AppState.validationResults) {
        panel.render(AppState.validationResults);
    } else {
        const startSection = document.createElement('div');
        startSection.className = 'panel';
        startSection.innerHTML = `
            <div style="text-align:center; padding: 48px;">
                <h3 style="margin-bottom: 16px;">🔬 Validação Dimensional Aguardando Execução</h3>
                <p style="color: var(--text-secondary); margin-bottom: 24px; max-width: 700px; margin-left: auto; margin-right: auto;">
                    Este módulo testa individualmente cada uma das 30 dimensões da malha octogonal com 6 critérios de falsificabilidade popperiana.
                    Cada dimensão será classificada como:
                    <span class="status-badge status-proven">🟢 COMPROVADA</span>
                    <span class="status-badge status-saturated">🟡 SATURADA</span>
                    <span class="status-badge status-fallible">🔴 FALÍVEL</span> ou
                    <span class="status-badge status-indeterminate">⚪ INDETERMINADA</span>
                </p>
                <button id="btn-run-validation" class="btn btn-primary" style="font-size: 1rem; padding: 12px 32px;">
                    🔬 Executar Validação Completa das 30 Dimensões
                </button>
                <div id="validation-progress" style="margin-top: 24px; display:none; max-width: 500px; margin-left: auto; margin-right: auto;">
                    <div class="progress-bar"><div class="progress-fill" id="val-progress-fill" style="width:0%"></div></div>
                    <p id="val-progress-text" style="color: var(--text-tertiary); font-size: 0.85rem;"></p>
                </div>
            </div>
        `;
        container.appendChild(startSection);

        document.getElementById('btn-run-validation')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-run-validation');
            btn.disabled = true;
            btn.textContent = '⏳ Validando...';
            const progressDiv = document.getElementById('validation-progress');
            if (progressDiv) progressDiv.style.display = 'block';

            try {
                const validator = new DimensionValidator();
                AppState.validationResults = await validator.validateAll(
                    AppState.params,
                    200,
                    123,
                    (progress, dim) => {
                        const fill = document.getElementById('val-progress-fill');
                        const text = document.getElementById('val-progress-text');
                        if (fill) fill.style.width = `${progress * 100}%`;
                        if (text) text.textContent = `Testando dimensão ${dim + 1}/30...`;
                    }
                );

                container.innerHTML = '';
                const auditPanel = new DimensionAuditPanel(container);
                auditPanel.render(AppState.validationResults);
            } catch (e) {
                console.error('Validation error:', e);
                if (btn) btn.textContent = '❌ Erro na validação';
                const text = document.getElementById('val-progress-text');
                if (text) text.textContent = `Erro: ${e.message}`;
            }
        });
    }
}

function renderCompare(container) {
    const panel = new ComparativePanel(container);
    panel.render(AppState);
}

function renderIngest(container) {
    const panel = new IngestionPanel(container);
    panel.render(AppState);
}

function renderAudit(container) {
    const panel = new ScientificReportPanel(container);
    panel.render(AppState);
}

function renderTheory(container) {
    container.innerHTML = `
        <div class="theory-content">
            <div class="section">
                <h3>1. O Postulado Fundamental</h3>
                <p>A projeção e estabilização de cada dimensão espacial obedece à condição vetorial do vácuo:</p>
                <div class="equation-block">$$\\frac{\\omega \\cdot Z_0 \\cdot \\varepsilon_-}{c} = -1$$</div>
                <p>Onde:</p>
                <ul style="color: var(--text-secondary); margin-left: 1.5rem; margin-bottom: 16px;">
                    <li><strong>ω</strong> — frequência angular da dimensão projetada (rad/s)</li>
                    <li><strong>Z₀ ≈ 376.73 Ω</strong> — impedância do vácuo</li>
                    <li><strong>ε₋ = −E/E₀</strong> — tensor de resistência negativa vetorial</li>
                    <li><strong>c = 299.792.458 m/s</strong> — velocidade da luz</li>
                </ul>
                <p>Quando esse balanço vetorial se equilibra em exatamente −1, a dimensão atinge estabilidade estática e se comporta como uma dimensão real observável.</p>
            </div>

            <div class="section">
                <h3>2. A Geometria da Laranja (Spheroidal Mesh)</h3>
                <p>A malha vetorial dimensional funciona de forma análoga a uma <strong>laranja fatiada em 30 gomos</strong>:</p>
                <ul style="color: var(--text-secondary); margin-left: 1.5rem; margin-bottom: 16px;">
                    <li>O espaço tridimensional convencional serve como a casca (envelope de confinamento)</li>
                    <li>As dimensões internas (canais do sistema PDE) são os gomos seccionados</li>
                    <li>Através do <strong>acoplamento pareado</strong> (d acoplada com 30−d+1), canais opostos ressonam em equilíbrio conjugado</li>
                </ul>
            </div>

            <div class="section">
                <h3>3. A Dinâmica PDE do Sistema</h3>
                <p>A evolução de campo eletrodinâmico é modelada pela equação diferencial parcial hiperbólica amortecida por canal c:</p>
                <div class="equation-block">$$\\rho \\frac{\\partial^2 E_c}{\\partial t^2} + \\eta \\frac{\\partial E_c}{\\partial t} - \\alpha \\nabla^2 E_c + \\frac{\\kappa}{E_0} \\omega_c r_c + \\text{Coupling}(E_c) = 0$$</div>
                <p>Onde o resíduo adimensional r<sub>c</sub> é definido como:</p>
                <div class="equation-block">$$r_c = \\frac{\\omega_c \\cdot Z_0 \\cdot E_c}{c \\cdot E_0} - 1$$</div>
                <p>A integração temporal usa o método <strong>Verlet de 2ª ordem</strong> com amortecimento explícito:</p>
                <div class="equation-block">$$E_{t+dt} = 2E_t - E_{t-dt} - \\frac{dt^2}{\\rho} \\left( \\eta \\dot{E}_t + \\mathbf{F}_t \\right)$$</div>
            </div>

            <div class="section">
                <h3>4. Controlador κ Adaptativo</h3>
                <p>O coeficiente de acoplamento não-linear κ é ajustado adaptativamente a cada passo temporal:</p>
                <div class="equation-block">$$\\kappa_{t+1} = \\kappa_t \\cdot \\left(1 + g \\cdot (r_{\\text{rms}} - r_{\\text{target}})\\right)$$</div>
                <p>Este mecanismo de feedback garante que o sistema convergirá para o estado de equilíbrio vetorial sem necessidade de ajuste manual.</p>
            </div>

            <div class="section">
                <h3>5. Conservação Hamiltoniana</h3>
                <p>A energia total do sistema é monitorada para auditoria simplética:</p>
                <div class="equation-block">$$H = \\sum_d \\left[ \\frac{1}{2}\\rho \\|\\dot{E}_d\\|^2 + \\frac{1}{2}\\alpha \\|\\nabla E_d\\|^2 \\right]$$</div>
                <p>O desvio relativo do Hamiltoniano ao longo do tempo indica o grau de conservação simplética do integrador.</p>
            </div>

            <div class="section">
                <h3>6. Falsificabilidade e Rigor Científico</h3>
                <p>Este modelo adota os seguintes princípios de falsificabilidade popperiana:</p>
                <ul style="color: var(--text-secondary); margin-left: 1.5rem;">
                    <li><strong>Cada dimensão é individualmente testável</strong> — dimensões que saturam ou divergem são marcadas como falíveis</li>
                    <li><strong>Comparação contra modelos estabelecidos</strong> — Newton, MOND e ΛCDM usando mesmos dados e métricas</li>
                    <li><strong>Ingestão de dados externos</strong> — qualquer dataset pode ser importado para confrontar as predições</li>
                    <li><strong>Métricas de classe mundial</strong> — χ² reduzido, AIC, BIC, Bayes Factor, K-S test, Bootstrap CI 95%, Cohen's d</li>
                    <li><strong>Auditoria pública</strong> — o motor interno é demonstrado passo a passo no laudo técnico</li>
                    <li><strong>Parâmetros abertos, motor fechado</strong> — não há ajuste ad-hoc oculto</li>
                </ul>
            </div>

            <div class="section">
                <h3>7. Métricas Estatísticas de Validação</h3>
                <div class="panel" style="margin-top: 16px;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Métrica</th>
                                <th>Descrição</th>
                                <th>Uso</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr><td>χ² reduzido</td><td>Goodness-of-fit normalizado por DoF</td><td>Comparação modelo vs dados</td></tr>
                            <tr><td>AIC (Akaike)</td><td>Critério de informação com penalidade paramétrica</td><td>Seleção de modelo</td></tr>
                            <tr><td>BIC (Bayesian)</td><td>AIC com penalidade log(N) mais severa</td><td>Seleção conservadora</td></tr>
                            <tr><td>Bayes Factor</td><td>Razão de evidências entre 2 modelos</td><td>Comparação direta</td></tr>
                            <tr><td>K-S test</td><td>Kolmogorov-Smirnov para distribuição de resíduos</td><td>Normalidade dos erros</td></tr>
                            <tr><td>Bootstrap CI 95%</td><td>Intervalo de confiança não-paramétrico</td><td>Incerteza dos estimadores</td></tr>
                            <tr><td>Cohen's d</td><td>Tamanho do efeito padronizado</td><td>Significância prática</td></tr>
                            <tr><td>R² ajustado</td><td>Coeficiente de determinação ajustado</td><td>Variância explicada</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="section">
                <div class="certificate cert-pass" style="margin-top: 32px;">
                    <p style="font-style:italic; color: var(--text-secondary); text-align: center; font-size: 1.05rem;">
                        <em>"Amicus Plato, sed magis amica veritas"</em><br>
                        <span style="font-size: 0.8rem; color: var(--text-tertiary);">Platão é meu amigo, mas a verdade é ainda mais minha amiga.</span>
                    </p>
                    <div class="certificate-meta">
                        <strong>Charles de Paula Eugênio</strong> — Autor da Teoria da Malha Dimensional<br>
                        Registro Científico Open-Source • 2026
                    </div>
                </div>
            </div>
        </div>
    `;

    // Re-render MathJax
    if (window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([container]).catch(() => {});
    }
}

// ══════════════════════════════════════════
// Initialization
// ══════════════════════════════════════════
function init() {
    // Initialize engine with defaults
    createEngine();

    // Setup routing
    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // Mobile menu
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('open');
    });

    // Close sidebar on overlay click (mobile)
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const menuBtn = document.getElementById('mobile-menu-btn');
        if (window.innerWidth <= 768 && sidebar?.classList.contains('open')) {
            if (!sidebar.contains(e.target) && !menuBtn?.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        }
    });

    // Listen for engine events
    window.addEventListener('params-change', (e) => {
        if (e.detail) {
            createEngine(e.detail);
        }
    });

    // Hide loading screen
    const loading = document.getElementById('loading-screen');
    if (loading) loading.classList.add('hidden');

    console.log('[Orange-DMSE] Plataforma v2.0 inicializada com sucesso.');
    console.log('[Orange-DMSE] Motor PDE: 30 canais, grid', AppState.params.grid, ', Verlet 2ª ordem');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
