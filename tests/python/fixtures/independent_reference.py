"""Independent analytical acceptance references, using NumPy/SciPy only.

No StatsPAI, sklearn, linearmodels or estimator implementation is imported.
These are small matrix definitions of the curated estimands and sandwich
variances, not a second production adapter. Input and output are JSON.
"""
import json
import sys

import numpy as np
from scipy.stats import norm, t as student_t


def finish(estimate, se, df=None):
    distribution = norm if df is None else student_t(df)
    critical = distribution.ppf(0.975)
    return {
        "estimate": float(estimate),
        "standardError": float(se),
        "confidenceInterval": {
            "lower": float(estimate - critical * se),
            "upper": float(estimate + critical * se),
            "level": 0.95,
        },
        "pValue": float(2 * distribution.sf(abs(estimate / se))),
    }


def reference(spec):
    data = np.asarray(spec["data"]["rows"], dtype=float)
    names = {name: i for i, name in enumerate(spec["data"]["columns"])}
    col = lambda key: data[:, names[spec[key]]]
    cols = lambda key: data[:, [names[c] for c in spec.get(key, [])]]
    n = len(data)
    y = col("outcome")
    method = spec["method"]

    if method == "dml-plr":
        design = np.column_stack((np.ones(n), cols("covariates")))
        folds = np.asarray(spec["foldIds"])
        y_resid, d_resid = np.empty(n), np.empty(n)
        for fold in np.unique(folds):
            train, test = folds != fold, folds == fold
            # OLS fitted on the complement, evaluated only in the held-out fold.
            y_resid[test] = y[test] - design[test] @ np.linalg.lstsq(
                design[train], y[train], rcond=None)[0]
            d_resid[test] = col("treatment")[test] - design[test] @ np.linalg.lstsq(
                design[train], col("treatment")[train], rcond=None)[0]
        denominator = d_resid @ d_resid
        theta = (d_resid @ y_resid) / denominator
        score = d_resid * (y_resid - theta * d_resid)
        return finish(theta, np.linalg.norm(score) / denominator)

    if method == "iv-2sls":
        x = np.column_stack((np.ones(n), cols("covariates"), col("treatment")))
        z = np.column_stack((np.ones(n), cols("covariates"), cols("instruments")))
        projected_x = z @ np.linalg.lstsq(z, x, rcond=None)[0]
        beta = np.linalg.lstsq(projected_x, y, rcond=None)[0]
        residuals = y - x @ beta
        bread = np.linalg.inv(projected_x.T @ projected_x)
        influence = (projected_x * residuals[:, None]) @ bread
        covariance = influence.T @ influence * n / (n - x.shape[1])
        return finish(beta[-1], np.sqrt(covariance[-1, -1]), n - x.shape[1])

    if method == "cs-did":
        ids = np.unique(col("unit"))
        periods = np.unique(col("time"))
        unit_col, time_col, group_col = col("unit"), col("time"), col("group")
        groups = np.array([group_col[unit_col == unit][0] for unit in ids])
        panel = np.array([[y[(unit_col == unit) & (time_col == time)][0]
                           for time in periods] for unit in ids])
        total = len(ids)
        controls = groups == 0
        cells, cell_if, shares, share_if = [], [], [], []
        for group in np.unique(groups[groups > 0]):
            treated = groups == group
            base = np.flatnonzero(periods == group - 1)[0]
            for post in np.flatnonzero(periods >= group):
                delta = panel[:, post] - panel[:, base]
                mean_g, mean_0 = delta[treated].mean(), delta[controls].mean()
                cells.append(mean_g - mean_0)
                cell_if.append(treated * (delta - mean_g) / treated.mean()
                               - controls * (delta - mean_0) / controls.mean())
                shares.append(treated.mean())
                share_if.append(treated.astype(float) - treated.mean())
        cells, shares = np.asarray(cells), np.asarray(shares)
        shares_if = np.asarray(share_if).T
        denominator = shares.sum()
        weights = shares / denominator
        # Ratio delta method for estimated cohort shares, repeated per post cell.
        weights_if = (shares_if - np.outer(shares_if.sum(axis=1), weights)) / denominator
        unit_if = np.asarray(cell_if).T @ weights + weights_if @ cells
        result = finish(weights @ cells, np.linalg.norm(unit_if) / total)
        result["groupTimeEffects"] = cells.tolist()
        result["withoutShareUncertaintySE"] = float(
            np.linalg.norm(np.asarray(cell_if).T @ weights) / total)
        return result

    if method == "rd-sharp":
        running = col("running") - spec.get("cutoff", 0)
        h, b = spec["bandwidth"], spec.get("biasBandwidth", spec["bandwidth"])
        values, variances = [], []
        conventional = []
        for side in (running < 0, running >= 0):
            keep = side & (abs(running) < max(h, b))
            x, target = running[keep], y[keep]
            linear = np.column_stack((np.ones(len(x)), x))
            quadratic = np.column_stack((linear, x * x))
            wh = np.maximum(1 - abs(x) / h, 0)
            wb = np.maximum(1 - abs(x) / b, 0)
            # Each intercept is a linear functional of the observed outcomes.
            intercept_weights = np.linalg.solve(linear.T @ (wh[:, None] * linear),
                                                (linear.T * wh))[0]
            quadratic_operator = np.linalg.solve(quadratic.T @ (wb[:, None] * quadratic),
                                                  (quadratic.T * wb))
            curvature_weights = quadratic_operator[2]
            # Remove local-linear curvature bias, retaining its sampling noise.
            corrected_weights = intercept_weights - (intercept_weights @ (x * x)) * curvature_weights
            residual = target - quadratic @ (quadratic_operator @ target)
            values.append(corrected_weights @ target)
            variances.append(np.sum((corrected_weights * residual) ** 2) * len(x) / (len(x) - 3))
            conventional.append(intercept_weights @ target)
        result = finish(values[1] - values[0], np.sqrt(sum(variances)))
        result["conventionalEstimate"] = float(conventional[1] - conventional[0])
        return result

    raise ValueError("Unsupported reference method")


print(json.dumps([reference(spec) for spec in json.load(sys.stdin)]))
