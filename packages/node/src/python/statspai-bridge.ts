/** Versioned, JSON-only bridge to the curated public StatsPAI API. */
export const STATSPAI_BRIDGE_SOURCE = String.raw`
import contextlib
import hashlib
import importlib.metadata
import io
import json
import math
import platform
import sys
import warnings

SUPPORTED_VERSION = "1.39.5"

class DiscardOutput(io.TextIOBase):
    def write(self, text):
        return len(text)

    def flush(self):
        pass

class BridgeError(Exception):
    def __init__(self, code, message, recovery_hint=None):
        super().__init__(message)
        self.code = code
        self.recovery_hint = recovery_hint

def require(condition, message, code="INVALID_INPUT"):
    if not condition:
        raise BridgeError(code, message)

def diagnostic(code, message, status="inconclusive", severity="warning", details=None):
    result = {"code": code, "status": status, "severity": severity, "message": message}
    if details is not None:
        result["details"] = details
    return result

def clean(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if hasattr(value, "item") and getattr(value, "ndim", 1) == 0:
        return clean(value.item())
    if hasattr(value, "to_dict"):
        return clean(value.to_dict())
    if hasattr(value, "tolist"):
        return clean(value.tolist())
    return str(value)[:2000]

def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

def scalar(value, label):
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise BridgeError("INVALID_BACKEND_RESULT", label + " is not numeric")
    require(math.isfinite(out), label + " is not finite", "INVALID_BACKEND_RESULT")
    return out

def estimate(request, sp, np, pd):
    require(isinstance(request, dict), "input must be an object")
    method = request.get("method")
    fields = {
        "dml-plr": {"outcome", "treatment", "covariates", "folds", "seed", "foldIds"},
        "cs-did": {"outcome", "unit", "time", "group"},
        "iv-2sls": {"outcome", "treatment", "covariates", "instruments"},
        "rd-sharp": {"outcome", "running", "cutoff", "bandwidth", "biasBandwidth"},
    }
    require(method in fields, "Unsupported estimation method")
    require(not (set(request) - fields[method] - {"method", "data"}), "Unsupported method options")
    data = request.get("data")
    require(isinstance(data, dict) and set(data) == {"columns", "rows"}, "data must contain columns and rows")
    columns, rows = data["columns"], data["rows"]
    require(isinstance(columns, list) and len(columns) > 0, "columns must be a nonempty array")
    require(all(isinstance(c, str) and c for c in columns), "Column names must be nonempty strings")
    require(len(set(columns)) == len(columns), "Column names must be unique")
    require(isinstance(rows, list) and len(rows) >= 4, "At least four observations are required")
    require(all(isinstance(r, list) and len(r) == len(columns) for r in rows), "All rows must match columns")
    require(all(numeric(v) for r in rows for v in r), "All data must be finite numeric values; missing rows are never dropped")
    names = {name: "c" + str(index) for index, name in enumerate(columns)}
    frame = pd.DataFrame(rows, columns=list(names.values()), dtype=float)
    n = len(frame)

    def column(key):
        value = request.get(key)
        require(isinstance(value, str) and value in names, key + " must name a data column")
        return names[value]

    def column_list(key, required=False):
        value = request.get(key, [])
        require(isinstance(value, list) and all(isinstance(v, str) and v in names for v in value), key + " must contain column names")
        require(len(value) == len(set(value)), key + " must not contain duplicate names")
        require(not required or bool(value), key + " must not be empty")
        return [names[v] for v in value]

    def distinct(roles):
        require(len(roles) == len(set(roles)), "Outcome, treatment, controls, instruments and design columns must be distinct")

    def full_rank(matrix, label):
        require(matrix.shape[0] > matrix.shape[1], label + " needs more observations than columns")
        require(np.linalg.matrix_rank(matrix) == matrix.shape[1], label + " is rank deficient")

    y = column("outcome")
    diagnostics = []
    details = {}
    if method == "dml-plr":
        d, x = column("treatment"), column_list("covariates", True)
        distinct([y, d] + x)
        folds, seed = request.get("folds", 5), request.get("seed", 0)
        require(isinstance(folds, int) and not isinstance(folds, bool) and 2 <= folds <= n, "folds must be an integer between 2 and sample size")
        require(isinstance(seed, int) and not isinstance(seed, bool) and 0 <= seed <= 4294967295, "seed must be an unsigned 32-bit integer")
        supplied = request.get("foldIds")
        if supplied is None:
            from sklearn.model_selection import KFold
            fold_ids = np.empty(n, dtype=int)
            for label, (_, test) in enumerate(KFold(folds, shuffle=True, random_state=seed).split(frame)):
                fold_ids[test] = label
        else:
            require(isinstance(supplied, list) and len(supplied) == n and all(isinstance(v, int) and not isinstance(v, bool) for v in supplied), "foldIds must contain one integer per observation")
            require(set(supplied) == set(range(folds)), "foldIds must use every integer from 0 through folds - 1")
            fold_ids = np.asarray(supplied, dtype=int)
        design = np.column_stack([np.ones(n), frame[x].to_numpy()])
        for label in range(folds):
            train = fold_ids != label
            full_rank(design[train], "DML nuisance training design")
        full_rank(np.column_stack([design, frame[d].to_numpy()]), "DML treatment design")
        fit = sp.dml(frame, y=y, treat=d, covariates=x, model="plr", ml_g="linear", ml_m="linear", n_folds=folds, n_rep=1, alpha=0.05, random_state=seed, fold_indices=fold_ids, score="partialling out")
        estimand = "theta"
        details = {"model": "plr", "score": "partialling out", "outcomeLearner": "LinearRegression", "treatmentLearner": "LinearRegression", "folds": folds, "repetitions": 1, "seed": seed, "foldSource": "provided" if supplied is not None else "sklearn-KFold", "foldAssignmentSha256": hashlib.sha256(json.dumps(fold_ids.tolist(), separators=(",", ":")).encode("utf-8")).hexdigest(), "nuisanceDiagnostics": clean(fit.model_info.get("diagnostics", {})), "inference": "iid orthogonal-score normal approximation"}
        diagnostics.append(diagnostic("PLR_ESTIMAND", "PLR estimates a partially linear coefficient theta; it is not a general ATE under heterogeneous treatment effects. Linear nuisance regressions require adequate specification.", "not_run", "info"))
    elif method == "iv-2sls":
        d, x, z = column("treatment"), column_list("covariates"), column_list("instruments", True)
        distinct([y, d] + x + z)
        exog = np.column_stack([np.ones(n), frame[x].to_numpy()])
        structural = np.column_stack([exog, frame[d].to_numpy()])
        instruments = np.column_stack([exog, frame[z].to_numpy()])
        full_rank(structural, "IV structural design")
        full_rank(instruments, "IV instrument design")
        full_rank(instruments @ np.linalg.lstsq(instruments, structural, rcond=None)[0], "IV projected design")
        formula = y + " ~ " + " + ".join(x + ["(" + d + " ~ " + " + ".join(z) + ")"])
        fit = sp.iv(formula=formula, data=frame, method="2sls", robust="hc1", small=True, alpha=0.05)
        require(not fit.model_info.get("omitted_instruments"), "Backend omitted instruments", "INVALID_BACKEND_RESULT")
        interval = fit.conf_int(alpha=0.05).loc[d].to_numpy()
        effect, se, pvalue = fit.params[d], fit.std_errors[d], fit.pvalues[d]
        sample_size = fit.data_info.get("nobs")
        estimand = "iv-coefficient"
        stage = clean(fit.model_info.get("first_stage", []))
        first_f = fit.model_info.get("first_stage_f")
        if first_f is None or not math.isfinite(float(first_f)):
            raise BridgeError("FIRST_STAGE_UNAVAILABLE", "A finite first-stage F diagnostic is required for this curated 2SLS path", "Use a design with an identified, nondegenerate first stage and inspect weak-IV robust inference outside this adapter.")
        if first_f < 10:
            raise BridgeError("WEAK_INSTRUMENTS", "HC1 first-stage F is below the adapter eligibility threshold of 10; ordinary 2SLS Wald inference was withheld", "Use weak-instrument robust inference, such as Anderson-Rubin confidence sets, outside this curated adapter. F >= 10 does not guarantee instrument strength or validity.")
        details = {"method": "2sls", "covariance": "HC1", "smallSample": True, "inference": "Student t", "degreesOfFreedom": clean(fit.data_info.get("df_resid")), "firstStage": stage, "firstStageF": clean(first_f), "numberOfInstruments": len(z), "firstStageStatistic": "HC1 robust Wald F for excluded instruments conditional on exogenous controls", "firstStageEligibilityThreshold": 10}
        diagnostics.append(diagnostic("IV_FIRST_STAGE", "First-stage F is a screening diagnostic; exclusion and instrument exogeneity are not tested by it. Weak instruments invalidate ordinary 2SLS Wald inference.", "inconclusive" if first_f is None else ("failed" if first_f < 10 else "passed"), "warning" if first_f is None or first_f < 10 else "info", {"fStatistic": clean(first_f), "screeningThreshold": 10}))
    elif method == "cs-did":
        unit, time, group = column("unit"), column("time"), column("group")
        distinct([y, unit, time, group])
        require(not frame.duplicated([unit, time]).any(), "CS-DiD requires unique unit/time observations")
        periods = sorted(frame[time].unique().tolist())
        require(len(periods) >= 2 and all(v == int(v) and v > 0 for v in periods), "CS-DiD requires positive integer periods")
        by_unit = frame.groupby(unit)
        require(bool((by_unit[time].nunique() == len(periods)).all()), "CS-DiD requires a balanced panel")
        require(bool((by_unit[group].nunique() == 1).all()), "Treatment cohort must be constant within unit")
        cohorts = by_unit[group].first()
        require(bool((cohorts == 0).any()), "CS-DiD requires never-treated units with cohort 0")
        treated = sorted(v for v in cohorts.unique().tolist() if v != 0)
        require(bool(treated) and all(v in periods[1:] for v in treated), "Treated cohorts must have an observed pre-treatment period and treatment period")
        require(all(int((cohorts == v).sum()) >= 2 for v in [0] + treated), "Every cohort including never-treated needs at least two units")
        fit = sp.callaway_santanna(frame, y=y, g=group, t=time, i=unit, x=None, estimator="reg", control_group="nevertreated", base_period="universal", anticipation=0, alpha=0.05, panel=True, allow_unbalanced_panel=False, bstrap=False, cband=False)
        require(not fit.model_info.get("dropped_gt_cells") and not fit.model_info.get("comparison_only_cohorts"), "Backend omitted CS-DiD cohorts or cells", "INVALID_BACKEND_RESULT")
        cells = fit.detail
        expected_post = {(g, t) for g in treated for t in periods if t >= g}
        actual_post = {(float(r["group"]), float(r["time"])) for r in cells.to_dict("records") if r["time"] >= r["group"]}
        require(expected_post == actual_post, "Backend omitted post-treatment ATT cells", "INVALID_BACKEND_RESULT")
        require(np.isfinite(cells[["att", "se"]].to_numpy()).all(), "Non-finite CS-DiD cell estimate or standard error", "INVALID_BACKEND_RESULT")
        estimand = "att"
        details = {"aggregation": "simple: cohort-size weighted post-treatment ATT(g,t) cells", "controlGroup": "nevertreated", "basePeriod": "universal", "estimator": "reg", "anticipation": 0, "numberOfUnits": len(cohorts), "numberOfPeriods": len(periods), "numberOfCohorts": len(treated), "cohortSizes": {str(int(g)): int((cohorts == g).sum()) for g in [0] + treated}, "groupTimeEffects": clean(cells.to_dict("records")), "eventStudy": clean(fit.model_info["event_study"].to_dict("records")), "inference": "unit influence-function analytic normal approximation, including estimated cohort-share uncertainty", "pretrendTest": clean(fit.model_info.get("pretrend_test"))}
        diagnostics.append(diagnostic("CS_PARALLEL_TRENDS", "Identification requires untreated parallel trends against never-treated units, no anticipation, absorbing treatment, and no interference. Pre-trend tests do not establish these assumptions.", "not_run", "info"))
    else:
        running = column("running")
        distinct([y, running])
        cutoff, bandwidth = request.get("cutoff", 0), request.get("bandwidth")
        bias_bandwidth = request.get("biasBandwidth", bandwidth)
        require(numeric(cutoff), "cutoff must be finite")
        require(numeric(bandwidth) and bandwidth > 0 and numeric(bias_bandwidth) and bias_bandwidth > 0, "bandwidth and biasBandwidth must be positive finite scalars")
        centered = frame[running].to_numpy() - cutoff
        for side in [centered < 0, centered >= 0]:
            for width, order in [(bandwidth, 1), (bias_bandwidth, 2)]:
                local = centered[side & (np.abs(centered) < width)] / width
                full_rank(np.vander(local, N=order + 1, increasing=True), "RD local polynomial design")
        fit = sp.rdrobust(frame, y=y, x=running, c=cutoff, fuzzy=None, deriv=0, p=1, q=2, kernel="triangular", bwselect="mserd", h=bandwidth, b=bias_bandwidth, vce="hc1", alpha=0.05, engine="ols", manipulation_test=False)
        require(not fit.model_info.get("cct_delegation") and not fit.model_info.get("legacy_fallbacks"), "RD backend changed or degraded the requested configuration", "INVALID_BACKEND_RESULT")
        estimand = "rd-local-effect"
        details = {"cutoff": cutoff, "bandwidth": bandwidth, "biasBandwidth": bias_bandwidth, "polynomialOrder": 1, "biasPolynomialOrder": 2, "kernel": "triangular", "covariance": "HC1", "backend": "native", "inference": "robust bias-corrected normal approximation", "conventional": clean(fit.model_info["conventional"]), "robust": clean(fit.model_info["robust"]), "effectiveSampleLeft": int(fit.model_info["n_effective_left"]), "effectiveSampleRight": int(fit.model_info["n_effective_right"]), "massPoints": clean(fit.model_info.get("masspoints"))}
        diagnostics.append(diagnostic("RD_MANIPULATION_TEST", "Density/manipulation testing was not run. Sharp RD requires treatment assigned at the cutoff and continuity of potential outcomes; the supplied bandwidths are user choices.", "not_run", "info"))

    if method != "iv-2sls":
        effect, se, interval, pvalue, sample_size = fit.estimate, fit.se, fit.ci, fit.pvalue, fit.n_obs
    require(sample_size == n, "Backend changed the estimation sample", "INVALID_BACKEND_RESULT")
    effect, se = scalar(effect, "estimate"), scalar(se, "standard error")
    require(se > 0, "Degenerate standard error; ordinary inference is unavailable", "INVALID_BACKEND_RESULT")
    lower, upper = scalar(interval[0], "CI lower bound"), scalar(interval[1], "CI upper bound")
    require(lower <= effect <= upper, "Inconsistent confidence interval", "INVALID_BACKEND_RESULT")
    if pvalue is not None:
        pvalue = scalar(pvalue, "p-value")
        require(0 <= pvalue <= 1, "Invalid p-value", "INVALID_BACKEND_RESULT")
    for name in ["violations", "degradations", "runtime_warnings"]:
        try:
            value = getattr(fit, name, None)
            value = value() if callable(value) else value
            if value:
                diagnostics.append(diagnostic("STATSPAI_" + name.upper(), "StatsPAI reported " + name, "failed" if name == "violations" else "inconclusive", details={"items": clean(value)}))
        except Exception as exc:
            diagnostics.append(diagnostic("STATSPAI_DIAGNOSTIC_UNAVAILABLE", "Could not read " + name + ": " + str(exc)[:500], "not_run"))
    return {"estimand": estimand, "estimate": effect, "standardError": se, "confidenceInterval": {"lower": lower, "upper": upper, "level": 0.95}, "pValue": pvalue, "sampleSize": n, "details": details, "diagnostics": diagnostics}

def main():
    request = json.load(sys.stdin)
    require(isinstance(request, dict) and request.get("protocolVersion") == 1, "Unsupported bridge protocol", "PROTOCOL_ERROR")
    operation = request.get("operation")
    require(operation in ("probe", "estimate"), "Unsupported bridge operation", "PROTOCOL_ERROR")
    import statspai as sp
    import numpy as np
    import pandas as pd
    import scipy
    import sklearn
    dependencies = {name: importlib.metadata.version(name) for name in ("numpy", "pandas", "scipy", "scikit-learn", "statsmodels", "linearmodels")}
    backend = {"name": "statspai", "version": str(sp.__version__), "pythonVersion": platform.python_version(), "dependencies": dependencies}
    response = {"protocolVersion": 1, "ok": True, "backend": backend}
    if operation == "estimate":
        require(backend["version"] == SUPPORTED_VERSION, "Supported StatsPAI version is " + SUPPORTED_VERSION + "; installed version is " + backend["version"], "UNSUPPORTED_BACKEND_VERSION")
        response["result"] = estimate(request.get("input"), sp, np, pd)
    return response

caught = []
warning_count = 0

def capture_warning(message, category, filename, lineno, file=None, line=None):
    global warning_count
    warning_count += 1
    if len(caught) < 50:
        caught.append((str(message)[:2000], category.__name__))

try:
    # Imported libraries and native estimators occasionally print. stdout is the protocol only.
    with contextlib.redirect_stdout(DiscardOutput()), warnings.catch_warnings():
        warnings.simplefilter("always")
        warnings.showwarning = capture_warning
        response = main()
    if "result" in response:
        for message, category in caught:
            response["result"]["diagnostics"].append(diagnostic("STATSPAI_RUNTIME_WARNING", message, details={"category": category}))
        if warning_count > 50:
            response["result"]["diagnostics"].append(diagnostic("STATSPAI_WARNINGS_TRUNCATED", "Additional backend warnings were truncated", details={"count": warning_count - 50}))
except Exception as exc:
    code = getattr(exc, "code", None)
    if isinstance(exc, (ImportError, importlib.metadata.PackageNotFoundError)):
        code = "BACKEND_UNAVAILABLE"
    elif isinstance(exc, (json.JSONDecodeError, UnicodeError)):
        code = "PROTOCOL_ERROR"
    error = {"code": str(code or "BACKEND_ERROR"), "message": str(exc)[:4000]}
    hint = getattr(exc, "recovery_hint", None)
    if hint:
        error["recoveryHint"] = str(hint)[:2000]
    response = {"protocolVersion": 1, "ok": False, "error": error}
sys.stdout.write(json.dumps(response, allow_nan=False, separators=(",", ":")))
`;
