# orange_core.py
# Núcleo PDE do Orange - DMS com:
#  - Acoplamento pareado (d, 30-d+1) entre canais ("30D")
#  - Controlador κ adaptativo
#  - Métricas ampliadas (inclui RSS/N)
#  - Rotinas de ablação (30 vs 15 vs 1) e AIC/BIC
#
# Observação: este módulo é autossuficiente. Integração no front (Streamlit/React)
# pode ser feita expondo funções run/ablation via FastAPI/Flask em arquivo separado.

from __future__ import annotations
from dataclasses import dataclass
import time
import numpy as np

Array = np.ndarray

# Constantes físicas do vácuo para consistência dimensional
C_LIGHT = 299792458.0      # m/s
Z0_VACUUM = 376.730313      # Ohms

# ------------------------------
# 1) Parâmetros e estados
# ------------------------------
@dataclass
class DMSEParams:
    grid: tuple[int, int] = (256, 256)   # (H, W)
    n_channels: int = 30                 # use 30 para "30 dimensões"
    dx: float = 1.0                      # passo espacial
    dt: float = 0.02                     # passo temporal
    rho: float = 1.0                     # ρ
    eta: float = 0.1                     # η (dissipação)
    alpha: float = 0.5                   # α (difusão)
    E0: float = 1.0                      # escala para Ẽ = E/E0
    kappa_init: float = 1.0              # κ inicial
    kappa_gain: float = 0.5              # ganho do controlador de κ
    r_rms_target: float = 0.02           # alvo de r_rms
    kappa_min: float = 1e-6
    kappa_max: float = 1e3
    boundary: str = "neumann"            # 'neumann' (reflexivo) ou 'periodic'

    # Acoplamento entre canais
    coupling_strength: float = 0.02      # força de acoplamento (0 desliga)
    pairwise_coupling: bool = True       # True = acoplamento pareado (d, C-1-d)

    # Contagem de parâmetros para AIC/BIC
    # Se None, módulo tenta um chute heurístico.
    k_params: int | None = None

@dataclass
class DMSEState:
    E: Array             # (C,H,W)
    E_prev: Array        # (C,H,W)
    Edot: Array          # (C,H,W)
    omega_tilde: Array   # (C,H,W)
    kappa: float
    step_idx: int = 0

# ------------------------------
# 2) Operadores espaciais
# ------------------------------

def _lap_neumann(u: Array) -> tuple[Array, Array, Array, Array]:
    C, H, W = u.shape
    up = np.empty_like(u); down = np.empty_like(u)
    left = np.empty_like(u); right = np.empty_like(u)
    up[:, 1:] = u[:, :-1];   up[:, :1] = u[:, :1]
    down[:, :-1] = u[:, 1:]; down[:, -1:] = u[:, -1:]
    left[:, :, 1:] = u[:, :, :-1]; left[:, :, :1] = u[:, :, :1]
    right[:, :, :-1] = u[:, :, 1:]; right[:, :, -1:] = u[:, :, -1:]
    return up, down, left, right

def laplacian2d(u: Array, dx: float, boundary: str) -> Array:
    """Laplaciano 2D por canal: u shape (C,H,W)."""
    if boundary == "periodic":
        up   = np.roll(u, -1, axis=1); down = np.roll(u,  1, axis=1)
        left = np.roll(u, -1, axis=2); right = np.roll(u, 1, axis=2)
    else:
        up, down, left, right = _lap_neumann(u)
    return (up + down + left + right - 4.0 * u) / (dx * dx)

# ------------------------------
# 3) Termos do modelo
# ------------------------------

def residual_r(E: Array, omega_tilde: Array, E0: float) -> Array:
    """
    r = (ω * Z0 * ε_-) / c + 1.0
    Onde definimos ε_- = -E/E0 (resistência negativa), simplificando para:
    r = (ω_tilde * Z0 * E / E0) / c - 1.0
    """
    return (omega_tilde * Z0_VACUUM * (E / E0)) / C_LIGHT - 1.0

def nonlinear_attractor(E: Array, omega_tilde: Array, E0: float, kappa: float) -> Array:
    """(κ/E0) * ω̃ * r."""
    r = residual_r(E, omega_tilde, E0)
    return (kappa / E0) * omega_tilde * r

def barrier_grad(E: Array) -> Array:
    """∂V_b/∂E (opcional). Padrão: zero."""
    return 0.0 * E

# --- Acoplamento entre canais ---

def _pair_index_map(n_channels: int) -> np.ndarray:
    """Retorna um vetor pair_idx onde pair_idx[c] = C-1-c (espelhamento)."""
    pair_idx = np.arange(n_channels)[::-1]
    return pair_idx

def cross_channel_coupling(E: Array, strength: float, pairwise: bool) -> Array:
    """
    Retorna termo de acoplamento a ser SOMADO ao lado direito da EOM.
    - pairwise=True  => pareia (d, C-1-d) via target = E[pair_idx].
    - pairwise=False => consenso global (média de canais).
    """
    C = E.shape[0]
    if C == 1 or strength == 0.0:
        return 0.0 * E
    if pairwise:
        pair_idx = _pair_index_map(C)
        target = E[pair_idx, ...]         # (C,H,W), indexação elegante
    else:
        target = E.mean(axis=0, keepdims=True)
    return strength * (target - E)

# ------------------------------
# 4) Núcleo PDE (explícito, 2ª ordem no tempo)
#     ρ E¨ + η E˙ − α ∇²E + NL(E) + dVb/dE + Coupling = 0
# ------------------------------

def pde_step(state: DMSEState, p: DMSEParams) -> DMSEState:
    E, E_prev, Edot, omega = state.E, state.E_prev, state.Edot, state.omega_tilde
    dt, rho, eta, alpha = p.dt, p.rho, p.eta, p.alpha

    lap = laplacian2d(E, p.dx, p.boundary)
    NL  = nonlinear_attractor(E, omega, p.E0, state.kappa)
    Vb  = barrier_grad(E)
    Cpl = cross_channel_coupling(E, p.coupling_strength, p.pairwise_coupling)

    # Discretização tipo Verlet com amortecimento explícito
    force = (-alpha * lap) + NL + Vb + Cpl
    damping = -eta * (E - E_prev) / dt
    E_next = 2.0 * E - E_prev - (dt * dt / rho) * (damping + force)

    Edot_next = (E_next - E) / dt

    return DMSEState(
        E=E_next,
        E_prev=E,
        Edot=Edot_next,
        omega_tilde=omega,
        kappa=state.kappa,
        step_idx=state.step_idx + 1,
    )

# ------------------------------
# 5) Métricas + controlador κ
# ------------------------------
@dataclass
class Metrics:
    r_rms: float
    E_mean: float
    E_min: float
    E_max: float
    tv: float            # variação total média (proxy de suavidade)
    energy_kin: float    # 0.5*rho*||E˙||^2 / N
    energy_grad: float   # 0.5*alpha*||∇E||^2 / N
    rss: float           # soma dos quadrados de r (Residual Sum of Squares)
    N: int               # nº de observações (C*H*W)

def compute_metrics(state: DMSEState, p: DMSEParams) -> Metrics:
    E, Edot, omega = state.E, state.Edot, state.omega_tilde
    C, H, W = E.shape
    N = int(C * H * W)

    r = residual_r(E, omega, p.E0)
    r_rms = float(np.sqrt(np.mean(r * r)))
    rss = float(np.sum(r * r))

    # Gradientes simples (forward) p/ proxy de TV e energia de gradiente
    dEy = np.empty_like(E); dEx = np.empty_like(E)
    dEy[:, 1:] = E[:, 1:] - E[:, :-1]; dEy[:, :1] = 0.0
    dEx[:, :, 1:] = E[:, :, 1:] - E[:, :, :-1]; dEx[:, :, :1] = 0.0
    grad2 = (dEy**2 + dEx**2) / (p.dx * p.dx)

    tv = float(np.mean(np.sqrt(grad2 + 1e-12)))
    energy_kin = 0.5 * p.rho * float(np.sum(Edot * Edot)) / N
    energy_grad = 0.5 * p.alpha * float(np.sum(grad2)) / N

    return Metrics(
        r_rms=r_rms,
        E_mean=float(E.mean()),
        E_min=float(E.min()),
        E_max=float(E.max()),
        tv=tv,
        energy_kin=energy_kin,
        energy_grad=energy_grad,
        rss=rss,
        N=N,
    )

def adapt_kappa(kappa: float, r_rms: float, p: DMSEParams) -> float:
    delta = p.kappa_gain * (p.r_rms_target - r_rms)
    k_new = kappa * (1.0 + delta)
    return float(np.clip(k_new, p.kappa_min, p.kappa_max))


def compute_hamiltonian_energy(state: DMSEState, p: DMSEParams) -> float:
    """
    Calcula a energia hamiltoniana do sistema:
    H = T (cinética) + V_grad (gradiente espacial) + V_NL (potencial não-linear do atrator)
    """
    E, Edot, omega = state.E, state.Edot, state.omega_tilde
    C, H, W = E.shape
    N = int(C * H * W)
    
    # Energia Cinética T = 0.5 * rho * ||Edot||^2
    T = 0.5 * p.rho * np.sum(Edot * Edot)
    
    # Energia de Gradiente V_grad = 0.5 * alpha * ||∇E||^2
    dEy = np.empty_like(E); dEx = np.empty_like(E)
    dEy[:, 1:] = E[:, 1:] - E[:, :-1]; dEy[:, :1] = 0.0
    dEx[:, :, 1:] = E[:, :, 1:] - E[:, :, :-1]; dEx[:, :, :1] = 0.0
    grad2 = (dEy**2 + dEx**2) / (p.dx * p.dx)
    V_grad = 0.5 * p.alpha * np.sum(grad2)
    
    # Potencial não-linear V_NL
    factor1 = (omega * Z0_VACUUM * (E**2)) / (2.0 * C_LIGHT * p.E0)
    V_NL = np.sum((state.kappa / p.E0) * omega * (factor1 - E))
    
    return float((T + V_grad + V_NL) / N)


def check_symplectic_stability(energies: np.ndarray, dt: float, eta: float, rho: float, edot_squared_mean: np.ndarray) -> dict:
    """
    Avalia a estabilidade simplética calculando o desvio em relação ao decaimento teórico de energia.
    dH/dt = -eta * ||Edot||^2 / N
    """
    n_steps = len(energies)
    if n_steps < 10:
        return {"status": "INSUFFICIENT_DATA", "msg": "Dados insuficientes para análise hamiltoniana.", "rel_drift_pct": 0.0}
        
    expected_decay = 0.0
    expected_energies = [energies[0]]
    
    for t in range(1, n_steps):
        # Dissipação no intervalo: -eta * mean(Edot^2) * dt
        diss = -eta * edot_squared_mean[t] * dt
        expected_decay += diss
        expected_energies.append(energies[0] + expected_decay)
        
    expected_energies = np.array(expected_energies)
    
    drift = energies - expected_energies
    max_drift = np.max(np.abs(drift))
    rel_drift = max_drift / max(np.abs(energies[0]), 1e-6)
    
    if rel_drift > 0.20:
        status = "FAIL"
        msg = f"Instabilidade Simplética! Drift de energia residual de {rel_drift*100:.2f}% excede a tolerância de 20%."
    elif rel_drift > 0.05:
        status = "WARNING"
        msg = f"Estabilidade limite: desvio de energia residual acumulada de {rel_drift*100:.2f}%."
    else:
        status = "PASS"
        msg = f"Conservação simplética rigorosa: desvio hamiltoniano de apenas {rel_drift*100:.3f}%."
        
    return {
        "status": status,
        "msg": msg,
        "rel_drift_pct": float(rel_drift * 100),
        "actual_energies": energies.tolist(),
        "expected_energies": expected_energies.tolist()
    }

# ------------------------------
# 6) Engine principal
# ------------------------------
class DMSEngine:
    def __init__(self, params: DMSEParams):
        self.p = params
        self.state: DMSEState | None = None

    def reset(self, seed: int = 0, omega_tilde: Array | None = None, E_init: Array | None = None):
        rng = np.random.default_rng(seed)
        C, (H, W) = self.p.n_channels, self.p.grid

        if E_init is None:
            scale = 0.05 * self.p.E0
            E_init = rng.normal(0.0, scale, size=(C, H, W)).astype(np.float32)

        if omega_tilde is None:
            # Frequência angular na escala física de c/Z0 (~7.95e5 rad/s)
            omega_scale = C_LIGHT / Z0_VACUUM
            omega_tilde = (omega_scale * (1.0 + 0.01 * rng.normal(size=(C, H, W)))).astype(np.float32)

        self.state = DMSEState(
            E=E_init.copy(),
            E_prev=E_init.copy(),
            Edot=np.zeros_like(E_init),
            omega_tilde=omega_tilde.astype(np.float32),
            kappa=self.p.kappa_init,
            step_idx=0,
        )

    def step(self) -> Metrics:
        assert self.state is not None, "Chame reset() antes."
        self.state = pde_step(self.state, self.p)
        m = compute_metrics(self.state, self.p)
        self.state.kappa = adapt_kappa(self.state.kappa, m.r_rms, self.p)
        return m

    def run(self, n_steps: int, callback=None) -> list[Metrics]:
        metrics_log: list[Metrics] = []
        for _ in range(n_steps):
            m = self.step()
            metrics_log.append(m)
            if callback:
                callback(self.state.step_idx, m, self.state)
        return metrics_log

# ------------------------------
# 7) AIC/BIC e ablação
# ------------------------------

def gaussian_loglik_from_rss(rss: float, N: int) -> float:
    eps = 1e-18
    sigma2 = max(rss / max(N, 1), eps)
    return float(-0.5 * N * (np.log(2.0 * np.pi * sigma2) + 1.0))

def estimate_k_params(p: DMSEParams) -> int:
    if p.k_params is not None:
        return int(p.k_params)
    k = 7  # (rho, eta, alpha, E0, kappa_init, kappa_gain, r_rms_target)
    if p.coupling_strength != 0.0:
        k += 1
    if p.pairwise_coupling:
        k += 1
    return k

def aic_bic_from_rss(rss: float, N: int, k_params: int) -> tuple[float, float, float]:
    logL = gaussian_loglik_from_rss(rss, N)
    AIC = 2 * k_params - 2 * logL
    BIC = k_params * np.log(max(N, 1)) - 2 * logL
    return float(AIC), float(BIC), float(logL)

def ablation_compare(base_params: DMSEParams, configs: list[dict], steps: int = 500, seed: int = 42):
    """
    Roda ablação de modelos e retorna lista ordenada por BIC.
    """
    results = []
    for cfg in configs:
        p = DMSEParams(**{**base_params.__dict__, **cfg})
        eng = DMSEngine(p)
        eng.reset(seed=seed)
        rss_total = 0.0
        N_total = 0
        t0 = time.perf_counter()
        for _ in range(steps):
            m = eng.step()
            rss_total += m.rss
            N_total += m.N
        dt = time.perf_counter() - t0
        k = estimate_k_params(p)
        AIC, BIC, logL = aic_bic_from_rss(rss_total, N_total, k)
        results.append({
            "cfg": cfg,
            "AIC": AIC,
            "BIC": BIC,
            "logL": logL,
            "RSS": rss_total,
            "RMSE": float(np.sqrt(rss_total / max(N_total, 1))),
            "N": int(N_total),
            "time_sec": dt,
            "k_params": k,
        })
    results.sort(key=lambda d: d["BIC"]) 
    return results

# ------------------------------
# 8) Protótipo quântico (amplitude encoding 30D -> 5 qubits)
# ------------------------------
class QuantumAmplitudeEncoder:
    """
    Protótipo quântico/quantum-inspired para o Orange - DMS.
    - Codifica vetores de 30D em 5 qubits por amplitude encoding.
    - Fornece um "quantum kernel" K(x,y) = |<psi_x|psi_y>|^2 útil em SVM/otimização.
    - Opcionalmente constrói um circuito Qiskit com initialize(psi) se disponível.
    """
    def __init__(self, n_qubits: int = 5):
        assert n_qubits == 5, "Este protótipo espera 5 qubits (2**5=32)"
        self.n_qubits = n_qubits
        self.dim = 1 << n_qubits  # 32

    def encode(self, v: Array) -> Array:
        v = np.asarray(v, dtype=float).reshape(-1)
        if v.size > self.dim:
            raise ValueError(f"Entrada maior que {self.dim} elementos")
        if v.size < self.dim:
            v = np.pad(v, (0, self.dim - v.size))
        norm = np.linalg.norm(v)
        if norm == 0:
            raise ValueError("Vetor nulo não pode ser codificado")
        psi = (v / norm).astype(np.complex128)
        return psi

    def kernel(self, x: Array, y: Array) -> float:
        psi_x = self.encode(x)
        psi_y = self.encode(y)
        return float(np.abs(np.vdot(psi_x, psi_y)) ** 2)

    def try_qiskit_circuit(self, v: Array):
        try:
            from qiskit import QuantumCircuit
        except Exception:
            return None
        psi = self.encode(v)
        qc = QuantumCircuit(self.n_qubits)
        qc.initialize(psi, list(range(self.n_qubits)))
        return qc

# Exemplo de uso do protótipo quântico
if __name__ == "__main__":
    base = DMSEParams(
        grid=(64, 64),
        n_channels=30,
        dx=1.0, dt=0.02,
        rho=1.0, eta=0.15, alpha=0.6,
        E0=1.0, kappa_init=1.0, kappa_gain=0.5,
        r_rms_target=0.02,
        boundary="neumann",
        coupling_strength=0.02,
        pairwise_coupling=True,
    )

    def cb(i, m, s):
        if i % 50 == 0:
            print(f"step={i:04d}  r_rms={m.r_rms:.4e}  kappa={s.kappa:.3e}  TV={m.tv:.3e}")

    print("Executando simulação de teste básica (64x64, 30 canais)...")
    eng = DMSEngine(base)
    eng.reset(seed=123)
    eng.run(150, callback=cb)

    print("\nExecutando ablação...")
    cfgs = [
        {"n_channels": 30, "coupling_strength": 0.02, "pairwise_coupling": True},
        {"n_channels": 1,  "coupling_strength": 0.0,  "pairwise_coupling": False},
    ]
    results = ablation_compare(base, cfgs, steps=100, seed=123)
    for r in results:
        print(f"CFG: {r['cfg']} -> BIC: {r['BIC']:.2f}, RMSE: {r['RMSE']:.4e}")

    print("\nTestando protótipo quântico...")
    enc = QuantumAmplitudeEncoder()
    v1 = np.random.default_rng(7).normal(size=30)
    v2 = np.random.default_rng(8).normal(size=30)
    print(f"[Quantum] K(v1,v2) = {enc.kernel(v1, v2):.6f}")
    qc = enc.try_qiskit_circuit(v1)
    if qc is None:
        print("[Quantum] Qiskit indisponível; usando backend NumPy (quantum-inspired).")
    else:
        print("[Quantum] Circuito Qiskit gerado (state initialization).")
