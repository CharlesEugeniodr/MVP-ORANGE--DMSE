# orange_api.py — FastAPI para expor o Orange - DMS
# Endpoints: /health, /run, /ablation, /quantum/kernel, /quantum/circuit
# Requer: orange_core.py no mesmo diretório

from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import time

# Import do núcleo
import orange_core as core

DMSEParams = core.DMSEParams
DMSEngine = core.DMSEngine
ablation_compare = core.ablation_compare
QuantumAmplitudeEncoder = getattr(core, "QuantumAmplitudeEncoder", None)

app = FastAPI(title="Orange - DMS API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# Schemas
# -----------------------------
class RunRequest(BaseModel):
    params: Optional[Dict[str, Any]] = Field(default=None, description="Overrides para DMSEParams")
    steps: int = Field(default=500, ge=1)
    seed: int = Field(default=42)
    log_every: int = Field(default=0, ge=0, description="Se >0 retorna série r_rms a cada N passos")


class RunResponse(BaseModel):
    elapsed_sec: float
    final: Dict[str, Any]
    r_rms_series: Optional[List[float]] = None
    kappa_series: Optional[List[float]] = None


class AblationRequest(BaseModel):
    base_params: Optional[Dict[str, Any]] = None
    configs: List[Dict[str, Any]]
    steps: int = Field(default=300, ge=1)
    seed: int = Field(default=42)


class AblationResponseItem(BaseModel):
    cfg: Dict[str, Any]
    AIC: float
    BIC: float
    logL: float
    RSS: float
    RMSE: float
    N: int
    time_sec: float
    k_params: int


class AblationResponse(BaseModel):
    items: List[AblationResponseItem]


class QuantumKernelRequest(BaseModel):
    v1: List[float] = Field(..., description="Vetor de até 30 componentes")
    v2: List[float] = Field(..., description="Vetor de até 30 componentes")


class QuantumKernelResponse(BaseModel):
    kernel: float


class QuantumCircuitRequest(BaseModel):
    v: List[float] = Field(..., description="Vetor de até 30 componentes")


class QuantumCircuitResponse(BaseModel):
    qasm: Optional[str]
    message: str


# -----------------------------
# Utils
# -----------------------------
def _build_params(overrides: Optional[Dict[str, Any]]) -> DMSEParams:
    if overrides is None:
        return DMSEParams()
    # filtra apenas campos existentes em DMSEParams
    valid = {k: v for k, v in overrides.items() if k in DMSEParams().__dict__}
    return DMSEParams(**{**DMSEParams().__dict__, **valid})


# -----------------------------
# Endpoints
# -----------------------------
@app.get("/health")
def health():
    return {"status": "ok", "core": "orange_core"}


@app.post("/run", response_model=RunResponse)
def run_dmse(req: RunRequest):
    p = _build_params(req.params)
    eng = DMSEngine(p)
    eng.reset(seed=req.seed)
    r_series: List[float] = []
    k_series: List[float] = []

    t0 = time.perf_counter()
    m = None
    for i in range(req.steps):
        m = eng.step()
        if req.log_every and (i % req.log_every == 0):
            r_series.append(m.r_rms)
            k_series.append(eng.state.kappa)
    elapsed = time.perf_counter() - t0

    # coleta final
    if m is None:
        # Se 0 passos (mas schema ge=1)
        m = core.compute_metrics(eng.state, p)

    final = {
        "step": eng.state.step_idx,
        "kappa": eng.state.kappa,
        "r_rms": float(m.r_rms),
        "RSS": float(m.rss),
        "RMSE": float((m.rss / max(m.N, 1)) ** 0.5),
        "E_mean": float(m.E_mean),
        "E_min": float(m.E_min),
        "E_max": float(m.E_max),
        "TV": float(m.tv),
        "energy_kin": float(m.energy_kin),
        "energy_grad": float(m.energy_grad),
        "N": int(m.N),
        "params": p.__dict__,
    }

    return RunResponse(
        elapsed_sec=elapsed,
        final=final,
        r_rms_series=r_series or None,
        kappa_series=k_series or None,
    )


@app.post("/ablation", response_model=AblationResponse)
def ablation(req: AblationRequest):
    base = _build_params(req.base_params)
    items_raw = ablation_compare(base, req.configs, steps=req.steps, seed=req.seed)
    items = [AblationResponseItem(**x) for x in items_raw]
    return AblationResponse(items=items)


@app.post("/quantum/kernel", response_model=QuantumKernelResponse)
def quantum_kernel(req: QuantumKernelRequest):
    if QuantumAmplitudeEncoder is None:
        # fallback local
        enc_dim = 32
        import numpy as np
        def _enc(v):
            v = np.asarray(v, dtype=float).reshape(-1)
            if v.size < enc_dim:
                v = np.pad(v, (0, enc_dim - v.size))
            v = v[:enc_dim]
            n = np.linalg.norm(v)
            if n == 0:
                raise ValueError("Vetor nulo")
            return v / n
        psi1 = _enc(req.v1); psi2 = _enc(req.v2)
        kernel = float(abs(np.vdot(psi1, psi2)) ** 2)
        return QuantumKernelResponse(kernel=kernel)

    enc = QuantumAmplitudeEncoder()
    k = enc.kernel(req.v1, req.v2)
    return QuantumKernelResponse(kernel=k)


@app.post("/quantum/circuit", response_model=QuantumCircuitResponse)
def quantum_circuit(req: QuantumCircuitRequest):
    if QuantumAmplitudeEncoder is None:
        return QuantumCircuitResponse(qasm=None, message="Protótipo quântico indisponível no núcleo.")
    enc = QuantumAmplitudeEncoder()
    qc = enc.try_qiskit_circuit(req.v)
    if qc is None:
        return QuantumCircuitResponse(qasm=None, message="Qiskit não disponível; use apenas o kernel NumPy.")
    try:
        qasm = qc.qasm()
    except Exception:
        try:
            qasm = qc.qasm(formatted=True)
        except Exception:
            qasm = None
    return QuantumCircuitResponse(qasm=qasm, message="Circuito gerado.")


# Como rodar:
# uvicorn orange_api:app --reload --host 0.0.0.0 --port 8000
