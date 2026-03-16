#!/usr/bin/env python3

from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import random
import subprocess
import sys
from pathlib import Path
from typing import Any

import networkx as nx
import numpy as np
from scipy.stats import chi2, norm


REPO_ROOT = Path(__file__).resolve().parents[2]
PARITY_ROOT = REPO_ROOT / "parity"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--oracle-root", default="")
    parser.add_argument("--case-ids-json", required=True)
    return parser.parse_args()


ARGS = parse_args()
ORACLE_ROOT = Path(ARGS.oracle_root).resolve() if ARGS.oracle_root else (REPO_ROOT.parent / "causal-learn").resolve()
sys.path.insert(0, str(ORACLE_ROOT))

import causallearn  # type: ignore
from causallearn.graph.Dag import Dag
from causallearn.graph.GraphNode import GraphNode
from causallearn.score.LocalScoreFunction import local_score_BDeu, local_score_BIC_from_cov
from causallearn.score.LocalScoreFunctionClass import LocalScoreClass
from causallearn.search.ConstraintBased.CDNOD import cdnod
from causallearn.search.ConstraintBased.FCI import fci
from causallearn.search.ConstraintBased.PC import pc
from causallearn.search.FCMBased import lingam
from causallearn.search.FCMBased.lingam import CAMUV
from causallearn.search.HiddenCausal.GIN.GIN import GIN
from causallearn.search.PermutationBased.GRaSP import grasp
from causallearn.search.ScoreBased.ExactSearch import bic_exact_search
from causallearn.search.ScoreBased.GES import ges
from causallearn.utils.DAG2CPDAG import dag2cpdag
from causallearn.utils.PCUtils.BackgroundKnowledge import BackgroundKnowledge
from causallearn.utils.cit import CIT, chisq, fisherz, gsq


def load_json(filename: str) -> dict[str, Any]:
    return json.loads((PARITY_ROOT / filename).read_text())


MANIFESTS = {
    "fixtures": load_json("fixtures.manifest.json"),
    "cases": load_json("cases.manifest.json"),
}
FIXTURE_BY_ID = {entry["id"]: entry for entry in MANIFESTS["fixtures"]["fixtures"]}
CASE_BY_ID = {entry["id"]: entry for entry in MANIFESTS["cases"]["cases"]}
SELECTED_CASE_IDS = set(json.loads(ARGS.case_ids_json))


def git_commit(path: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except Exception:
        return None


def load_txt_matrix(file_path: Path, skip_rows: int = 0) -> np.ndarray:
    return np.loadtxt(file_path, skiprows=skip_rows)


def center_columns(data: np.ndarray) -> np.ndarray:
    return data - data.mean(axis=0, keepdims=True)


def load_fixture_payload(fixture: dict[str, Any]) -> dict[str, Any]:
    if fixture["kind"] == "oracle-dag":
        return {"kind": fixture["kind"], "fixture": fixture}

    if fixture["kind"] == "stacked-context":
        data_parts: list[np.ndarray] = []
        context_parts: list[np.ndarray] = []
        for source in fixture["sources"]:
            rows = load_txt_matrix(REPO_ROOT / source["path"], source.get("skipRows", 0))
            rows = rows[: source.get("sliceRows", rows.shape[0]), :]
            data_parts.append(rows)
            context_parts.append(np.full((rows.shape[0], 1), source["contextValue"]))
        return {
            "kind": fixture["kind"],
            "data": np.vstack(data_parts),
            "context": np.vstack(context_parts),
        }

    if fixture["kind"] == "matrix-file":
        base_root = ORACLE_ROOT if fixture["scope"] == "oracle" else REPO_ROOT
        data = load_txt_matrix(base_root / fixture["path"], fixture.get("skipRows", 0))
        for step in fixture.get("preprocess", []):
            if step == "center-columns":
                data = center_columns(data)
        return {
            "kind": fixture["kind"],
            "data": data,
        }

    raise ValueError(f"Unsupported fixture kind: {fixture['kind']}")


def create_node_labels(count: int) -> list[str]:
    return [f"X{index + 1}" for index in range(count)]


def graph_matrix(graph) -> list[list[int]]:
    return graph.graph.astype(int).tolist()


def graph_output_summary(graph) -> dict[str, Any]:
    return {
        "nodeCount": len(graph.get_nodes()),
        "edgeCount": len(graph.get_graph_edges()),
    }


def node_type_to_string(node_type) -> str:
    return "latent" if str(node_type).endswith("LATENT") else "measured"


def endpoint_to_string(endpoint) -> str:
    endpoint_name = str(endpoint)
    if endpoint_name.endswith("TAIL"):
        return "tail"
    if endpoint_name.endswith("ARROW"):
        return "arrow"
    if endpoint_name.endswith("CIRCLE"):
        return "circle"
    raise ValueError(f"Unsupported endpoint: {endpoint_name}")


def graph_nodes(graph) -> list[dict[str, Any]]:
    return sorted(
        [
            {"id": node.get_name(), "nodeType": node_type_to_string(node.get_node_type())}
            for node in graph.get_nodes()
        ],
        key=lambda entry: entry["id"],
    )


def graph_edges(graph) -> list[dict[str, Any]]:
    edges = []
    for edge in graph.get_graph_edges():
        edges.append(
            {
                "node1": edge.get_node1().get_name(),
                "node2": edge.get_node2().get_name(),
                "endpoint1": endpoint_to_string(edge.get_endpoint1()),
                "endpoint2": endpoint_to_string(edge.get_endpoint2()),
            }
        )
    return sorted(
        edges,
        key=lambda edge: (edge["node1"], edge["node2"], edge["endpoint1"], edge["endpoint2"]),
    )


def normalize_clusters(clusters: Any) -> list[list[int]]:
    output: list[list[int]] = []
    for cluster in clusters:
        output.append(sorted(int(value) for value in cluster))
    return output


def adjacency_matrix_to_jsonable(matrix: np.ndarray) -> list[list[float | None]]:
    rows: list[list[float | None]] = []
    for row in matrix.tolist():
        rows.append([None if value != value else float(value) for value in row])
    return rows


def fisher_z_stats(data: np.ndarray, x: int, y: int, conditioning_set: list[int]) -> dict[str, Any]:
    corr = np.corrcoef(data.T)
    indices = [x, y, *conditioning_set]
    sub_corr = corr[np.ix_(indices, indices)]
    inv = np.linalg.inv(sub_corr)
    r = -inv[0, 1] / math.sqrt(abs(inv[0, 0] * inv[1, 1]))
    if abs(r) >= 1:
        r = (1.0 - np.finfo(float).eps) * np.sign(r)
    fisher_z = 0.5 * math.log((1 + r) / (1 - r))
    statistic = math.sqrt(data.shape[0] - len(conditioning_set) - 3) * abs(fisher_z)
    return {
        "pValue": float(2 * (1 - norm.cdf(abs(statistic)))),
        "statistic": float(statistic),
        "degreesOfFreedom": int(data.shape[0] - len(conditioning_set) - 3),
    }


def encode_discrete_columns(data: np.ndarray) -> tuple[list[np.ndarray], list[int]]:
    columns = []
    cardinalities = []
    for column_index in range(data.shape[1]):
        _, encoded = np.unique(data[:, column_index], return_inverse=True)
        columns.append(encoded)
        cardinalities.append(int(encoded.max()) + 1)
    return columns, cardinalities


def count_2d(x_values: np.ndarray, y_values: np.ndarray, x_cardinality: int, y_cardinality: int) -> np.ndarray:
    table = np.zeros((x_cardinality, y_cardinality))
    for index in range(x_values.shape[0]):
        table[x_values[index], y_values[index]] += 1
    return table


def expected_2d(table: np.ndarray) -> np.ndarray:
    x_totals = table.sum(axis=1, keepdims=True)
    y_totals = table.sum(axis=0, keepdims=True)
    sample_size = table.sum()
    return (x_totals @ y_totals) / sample_size


def statistic_from_tables(observed: np.ndarray, expected: np.ndarray, use_g_square: bool) -> tuple[float, int]:
    statistic = 0.0
    for row_index in range(observed.shape[0]):
        for column_index in range(observed.shape[1]):
            observed_value = observed[row_index, column_index]
            expected_value = expected[row_index, column_index]
            if expected_value == 0:
                continue
            if use_g_square:
                if observed_value != 0:
                    statistic += 2 * observed_value * math.log(observed_value / expected_value)
            else:
                statistic += ((observed_value - expected_value) ** 2) / expected_value
    zero_rows = int(np.sum(np.all(observed == 0, axis=1)))
    zero_columns = int(np.sum(np.all(observed == 0, axis=0)))
    dof = (observed.shape[0] - 1 - zero_rows) * (observed.shape[1] - 1 - zero_columns)
    return float(statistic), int(dof)


def discrete_ci_stats(data: np.ndarray, x: int, y: int, conditioning_set: list[int], use_g_square: bool) -> dict[str, Any]:
    encoded_columns, cardinalities = encode_discrete_columns(data)
    x_values = encoded_columns[x]
    y_values = encoded_columns[y]
    statistic = 0.0
    dof = 0
    if len(conditioning_set) == 0:
        observed = count_2d(x_values, y_values, cardinalities[x], cardinalities[y])
        expected = expected_2d(observed)
        statistic, dof = statistic_from_tables(observed, expected, use_g_square)
    else:
        keys = np.vstack([encoded_columns[index] for index in conditioning_set]).T
        groups = {}
        for row_index, key in enumerate(keys.tolist()):
            groups.setdefault(tuple(key), []).append(row_index)
        for row_indices in groups.values():
            grouped_x = x_values[row_indices]
            grouped_y = y_values[row_indices]
            observed = count_2d(grouped_x, grouped_y, cardinalities[x], cardinalities[y])
            expected = expected_2d(observed)
            delta_stat, delta_dof = statistic_from_tables(observed, expected, use_g_square)
            statistic += delta_stat
            dof += delta_dof
    return {
        "pValue": float(chi2.sf(statistic, dof) if dof > 0 else 1.0),
        "statistic": float(statistic),
        "degreesOfFreedom": int(dof),
    }


def build_background_knowledge(definition: dict[str, Any] | None):
    if not definition:
        return None
    bk = BackgroundKnowledge()
    for from_node, to_node in definition.get("forbidden", []):
        bk.add_forbidden_by_node(GraphNode(from_node), GraphNode(to_node))
    for from_node, to_node in definition.get("required", []):
        bk.add_required_by_node(GraphNode(from_node), GraphNode(to_node))
    return bk


def run_silenced(builder):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        return builder()


def create_case(case_id: str, component_id: str, fixture_id: str, comparison: dict[str, Any], runtime_ms: float, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": case_id,
        "componentId": component_id,
        "fixtureId": fixture_id,
        "comparison": comparison,
        "runtimeMs": round(runtime_ms, 3),
        **payload,
    }


def run_ci_case(case_definition: dict[str, Any], fixture_payload: dict[str, Any]) -> dict[str, Any]:
    data = fixture_payload["data"]
    execution = case_definition["execution"]
    if execution["testId"] == "fisher-z":
        result = fisher_z_stats(data, execution["x"], execution["y"], execution["conditioningSet"])
        p_value = CIT(data, method=fisherz)(
            execution["x"], execution["y"], tuple(execution["conditioningSet"])
        )
    else:
        result = discrete_ci_stats(
            data,
            execution["x"],
            execution["y"],
            execution["conditioningSet"],
            execution["testId"] == "g-square",
        )
        p_value = CIT(data, method=gsq if execution["testId"] == "g-square" else chisq)(
            execution["x"], execution["y"], tuple(execution["conditioningSet"])
        )

    return {
        "input": {
            "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
            "x": execution["x"],
            "y": execution["y"],
            "conditioningSet": execution["conditioningSet"],
        },
        "output": {"metricKind": "ci-test"},
        "result": {
            "pValue": float(p_value),
            "statistic": result["statistic"],
            "degreesOfFreedom": result["degreesOfFreedom"],
        },
    }


def run_score_case(case_definition: dict[str, Any], fixture_payload: dict[str, Any]) -> dict[str, Any]:
    data = fixture_payload["data"]
    execution = case_definition["execution"]
    if execution["scoreId"] == "gaussian-bic-score":
        parameters = {"lambda_value": execution["parameters"]["lambdaValue"]}
        score = LocalScoreClass(data=data, local_score_fun=local_score_BIC_from_cov, parameters=parameters).score(
            execution["node"], execution["parents"]
        )
    elif execution["scoreId"] == "bdeu-score":
        parameters = {
            "sample_prior": execution["parameters"]["samplePrior"],
            "structure_prior": execution["parameters"]["structurePrior"],
            "r_i_map": {index: len(np.unique(np.asarray(data[:, index]))) for index in range(data.shape[1])},
        }
        score = LocalScoreClass(data=data, local_score_fun=local_score_BDeu, parameters=parameters).score(
            execution["node"], execution["parents"]
        )
    else:
        raise ValueError(f"Unsupported score id: {execution['scoreId']}")

    return {
        "input": {
            "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
            "node": execution["node"],
            "parents": execution["parents"],
            "parameters": execution.get("parameters"),
        },
        "output": {"metricKind": "score"},
        "result": {"score": float(score)},
    }


def exact_search_graph_case(data: np.ndarray, execution: dict[str, Any]) -> dict[str, Any]:
    dag_matrix, _stats = bic_exact_search(
        data,
        search_method=execution["options"]["searchMethod"],
        use_path_extension=execution["options"]["usePathExtension"],
        use_k_cycle_heuristic=execution["options"]["useKCycleHeuristic"],
        k=3,
        verbose=False,
    )
    nodes = [GraphNode(f"X{index + 1}") for index in range(dag_matrix.shape[0])]
    dag = Dag(nodes)
    for parent, child in zip(*np.where(dag_matrix == 1)):
        dag.add_directed_edge(nodes[parent], nodes[child])
    cpdag = dag2cpdag(dag)
    return {
        "output": graph_output_summary(cpdag),
        "result": {"graphMatrix": graph_matrix(cpdag)},
    }


def run_graph_case(case_definition: dict[str, Any], fixture_definition: dict[str, Any], fixture_payload: dict[str, Any]) -> dict[str, Any]:
    execution = case_definition["execution"]
    options = execution["options"]
    algorithm_id = execution["algorithmId"]
    has_oracle_dag = fixture_definition["kind"] == "oracle-dag"

    if has_oracle_dag:
        data = np.zeros((1, fixture_definition["observedCount"]))
    else:
        data = fixture_payload["data"]

    if algorithm_id == "pc":
        graph = pc(
            data,
            options["alpha"],
            fisherz if options["ciTest"] == "fisher-z" else chisq if options["ciTest"] == "chi-square" else gsq,
            options["stable"],
            options["ucRule"],
            options["ucPriority"],
            verbose=False,
            show_progress=False,
        )
        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "alpha": options["alpha"],
                "ciTest": options["ciTest"],
                "stable": options["stable"],
                "ucRule": options["ucRule"],
                "ucPriority": options["ucPriority"],
            },
            "output": graph_output_summary(graph.G),
            "result": {"graphMatrix": graph_matrix(graph.G)},
        }

    if algorithm_id == "cdnod":
        graph = cdnod(
            fixture_payload["data"],
            fixture_payload["context"],
            options["alpha"],
            fisherz,
            options["stable"],
            options["ucRule"],
            options["ucPriority"],
            verbose=False,
            show_progress=False,
        )
        return {
            "input": {
                "data": {"rows": int(fixture_payload["data"].shape[0]), "columns": int(fixture_payload["data"].shape[1])},
                "context": {"rows": int(fixture_payload["context"].shape[0]), "columns": int(fixture_payload["context"].shape[1])},
                "alpha": options["alpha"],
                "ciTest": options["ciTest"],
                "stable": options["stable"],
                "ucRule": options["ucRule"],
                "ucPriority": options["ucPriority"],
            },
            "output": graph_output_summary(graph.G),
            "result": {"graphMatrix": graph_matrix(graph.G)},
        }

    if algorithm_id == "fci":
        if options["ciTest"] == "d-separation":
            dag = nx.DiGraph(fixture_definition["edges"])
            bk = build_background_knowledge(options.get("backgroundKnowledge"))
            graph_fci, _edges = run_silenced(
                lambda: fci(
                    data,
                    "d_separation",
                    options["alpha"],
                    verbose=False,
                    show_progress=False,
                    true_dag=dag,
                    background_knowledge=bk,
                )
            )
            input_summary: dict[str, Any] = {
                "observedCount": fixture_definition["observedCount"],
                "totalNodes": fixture_definition["totalNodes"],
                "alpha": options["alpha"],
                "ciTest": options["ciTest"],
            }
            if options.get("backgroundKnowledge"):
                input_summary["backgroundKnowledge"] = options["backgroundKnowledge"]
        else:
            graph_fci, _edges = run_silenced(
                lambda: fci(
                    data,
                    fisherz if options["ciTest"] == "fisher-z" else chisq,
                    options["alpha"],
                    verbose=False,
                    show_progress=False,
                )
            )
            input_summary = {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "alpha": options["alpha"],
                "ciTest": options["ciTest"],
            }
        return {
            "input": input_summary,
            "output": graph_output_summary(graph_fci),
            "result": {"graphMatrix": graph_matrix(graph_fci)},
        }

    if algorithm_id == "ges":
        parameters = None
        if options["score"] == "gaussian-bic-score":
            parameters = {"lambda_value": 2}
        graph_ges = ges(
            data,
            score_func="local_score_BIC" if options["score"] == "gaussian-bic-score" else "local_score_BDeu",
            maxP=None,
            parameters=parameters,
        )["G"]
        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "score": options["score"],
            },
            "output": graph_output_summary(graph_ges),
            "result": {"graphMatrix": graph_matrix(graph_ges)},
        }

    if algorithm_id == "exact-search":
        payload = exact_search_graph_case(data, execution)
        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "score": options["score"],
                "searchMethod": options["searchMethod"],
                "usePathExtension": options["usePathExtension"],
                "useKCycleHeuristic": options["useKCycleHeuristic"],
            },
            **payload,
        }

    if algorithm_id == "grasp":
        def run_one(seed: int) -> dict[str, Any]:
            random.seed(seed)
            np.random.seed(seed)
            graph_grasp = grasp(
                data,
                score_func="local_score_BIC_from_cov",
                depth=options["depth"],
                parameters={"lambda_value": options["lambdaValue"]},
                verbose=False,
                node_names=create_node_labels(data.shape[1]),
            )
            return {
                "seed": seed,
                "graphMatrix": graph_matrix(graph_grasp),
            }

        if "randomSeeds" in options:
            return {
                "input": {
                    "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                    "score": options["score"],
                    "lambdaValue": options["lambdaValue"],
                    "depth": options["depth"],
                    "randomSeeds": options["randomSeeds"],
                },
                "output": {"runCount": len(options["randomSeeds"]), "nodeCount": int(data.shape[1])},
                "result": {"runs": [run_one(seed) for seed in options["randomSeeds"]]},
            }

        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "score": options["score"],
                "lambdaValue": options["lambdaValue"],
                "depth": options["depth"],
                "randomSeed": options["randomSeed"],
            },
            "output": {"nodeCount": int(data.shape[1])},
            "result": run_one(options["randomSeed"]),
        }

    raise ValueError(f"Unsupported graph algorithm: {algorithm_id}")


def run_structured_case(case_definition: dict[str, Any], fixture_payload: dict[str, Any]) -> dict[str, Any]:
    execution = case_definition["execution"]
    options = execution["options"]
    data = fixture_payload["data"]

    if execution["algorithmId"] == "gin":
        graph_gin, causal_order = GIN(data, indep_test_method=options["indepTestMethod"], alpha=options["alpha"])
        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "indepTestMethod": options["indepTestMethod"],
                "alpha": options["alpha"],
            },
            "output": {
                "nodeCount": len(graph_gin.get_nodes()),
                "edgeCount": len(graph_gin.get_graph_edges()),
                "clusterCount": len(causal_order),
            },
            "result": {
                "causalOrder": normalize_clusters(causal_order),
                "graph": {"nodes": graph_nodes(graph_gin), "edges": graph_edges(graph_gin)},
            },
        }

    if execution["algorithmId"] == "cam-uv":
        parents, confounded_pairs = CAMUV.execute(data, options["alpha"], options["maxExplanatoryVars"])
        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "alpha": options["alpha"],
                "maxExplanatoryVars": options["maxExplanatoryVars"],
            },
            "output": {
                "nodeCount": int(data.shape[1]),
                "parentEntryCount": sum(1 for entry in parents if len(entry) > 0),
                "confoundedPairCount": len(confounded_pairs),
            },
            "result": {
                "parents": normalize_clusters(parents),
                "confoundedPairs": normalize_clusters(confounded_pairs),
            },
        }

    if execution["algorithmId"] == "rcd":
        model = lingam.RCD(bw_method=options["bwMethod"], MLHSICR=options["mlhsicr"])
        model.fit(data)
        adjacency = model.adjacency_matrix_
        parents = [[index for index, value in enumerate(row.tolist()) if value == value and abs(value) > 0] for row in adjacency]
        confounded_pairs = []
        for left in range(adjacency.shape[0]):
            for right in range(left + 1, adjacency.shape[1]):
                if np.isnan(adjacency[left, right]) or np.isnan(adjacency[right, left]):
                    confounded_pairs.append([left, right])
        return {
            "input": {
                "data": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
                "maxExplanatoryNum": options["maxExplanatoryNum"],
                "corAlpha": options["corAlpha"],
                "indAlpha": options["indAlpha"],
                "shapiroAlpha": options["shapiroAlpha"],
                "mlhsicr": options["mlhsicr"],
                "bwMethod": options["bwMethod"],
            },
            "output": {
                "nodeCount": int(data.shape[1]),
                "parentEntryCount": sum(1 for entry in parents if len(entry) > 0),
                "confoundedPairCount": len(confounded_pairs),
            },
            "result": {
                "parents": normalize_clusters(parents),
                "ancestors": normalize_clusters(model.ancestors_list_),
                "confoundedPairs": normalize_clusters(confounded_pairs),
                "adjacencyMatrix": adjacency_matrix_to_jsonable(adjacency),
            },
        }

    raise ValueError(f"Unsupported structured algorithm: {execution['algorithmId']}")


def execute_case(case_definition: dict[str, Any]) -> dict[str, Any]:
    import time

    fixture_definition = FIXTURE_BY_ID[case_definition["fixtureId"]]
    fixture_payload = load_fixture_payload(fixture_definition)
    started_at = time.perf_counter()

    if case_definition["execution"]["kind"] == "ci-test":
        payload = run_ci_case(case_definition, fixture_payload)
    elif case_definition["execution"]["kind"] == "score":
        payload = run_score_case(case_definition, fixture_payload)
    elif case_definition["execution"]["kind"] == "graph-algorithm":
        payload = run_graph_case(case_definition, fixture_definition, fixture_payload)
    elif case_definition["execution"]["kind"] == "structured-algorithm":
        payload = run_structured_case(case_definition, fixture_payload)
    else:
        raise ValueError(f"Unsupported execution kind: {case_definition['execution']['kind']}")

    return create_case(
        case_definition["id"],
        case_definition["componentId"],
        case_definition["fixtureId"],
        case_definition["comparison"],
        (time.perf_counter() - started_at) * 1000,
        payload,
    )


def main() -> None:
    selected_cases = [
        CASE_BY_ID[case_id]
        for case_id in sorted(SELECTED_CASE_IDS)
        if case_id in CASE_BY_ID and ARGS.profile in CASE_BY_ID[case_id]["profiles"]
    ]

    payload = {
        "runtime": {
            "pythonVersion": sys.version,
            "oracleRoot": str(ORACLE_ROOT),
            "oracleCommit": git_commit(ORACLE_ROOT),
            "oracleVersion": getattr(causallearn, "__version__", None),
        },
        "cases": [execute_case(case_definition) for case_definition in selected_cases],
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
