#!/usr/bin/env python3

from __future__ import annotations

import contextlib
import io
import json
import random
import sys
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CAUSAL_LEARN_ROOT = ROOT.parent / "causal-learn"
sys.path.insert(0, str(CAUSAL_LEARN_ROOT))

from causallearn.graph.Dag import Dag
from causallearn.graph.Endpoint import Endpoint
from causallearn.graph.GraphNode import GraphNode
from causallearn.graph.NodeType import NodeType
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
from causallearn.utils.cit import chisq, fisherz, gsq


FIXTURE_ROOT = ROOT / "fixtures" / "causal-learn" / "TestData"


def load_txt_matrix(filename: str, skip_rows: int = 0) -> np.ndarray:
    return np.loadtxt(FIXTURE_ROOT / filename, skiprows=skip_rows)


def node_type_to_string(node_type: NodeType) -> str:
    if node_type == NodeType.LATENT:
        return "latent"
    return "measured"


def endpoint_to_string(endpoint: Endpoint) -> str:
    if endpoint == Endpoint.TAIL:
        return "tail"
    if endpoint == Endpoint.ARROW:
        return "arrow"
    if endpoint == Endpoint.CIRCLE:
        return "circle"
    raise ValueError(f"Unsupported endpoint: {endpoint}")


def graph_edges(graph) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
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


def graph_nodes(graph) -> list[dict[str, Any]]:
    return sorted(
        [
            {
                "id": node.get_name(),
                "nodeType": node_type_to_string(node.get_node_type()),
            }
            for node in graph.get_nodes()
        ],
        key=lambda node: node["id"],
    )


def graph_matrix(graph) -> list[list[int]]:
    return graph.graph.astype(int).tolist()


def graph_output_summary(graph) -> dict[str, Any]:
    return {
        "nodeCount": len(graph.get_nodes()),
        "edgeCount": len(graph.get_graph_edges()),
    }


def normalize_clusters(clusters: list[list[int]] | tuple[tuple[int, ...], ...] | Any) -> list[list[int]]:
    normalized: list[list[int]] = []
    for cluster in clusters:
        normalized.append(sorted(int(value) for value in cluster))
    return normalized


def center_columns(data: np.ndarray) -> np.ndarray:
    return data - data.mean(axis=0, keepdims=True)


def adjacency_matrix_to_jsonable(matrix: np.ndarray) -> list[list[float | None]]:
    result: list[list[float | None]] = []
    for row in matrix.tolist():
        result.append([None if value != value else float(value) for value in row])
    return result


def rcd_parents_from_matrix(matrix: np.ndarray) -> list[list[int]]:
    parents: list[list[int]] = []
    for row in matrix:
        parent_indices = [
            index
            for index, value in enumerate(row.tolist())
            if value == value and abs(value) > 0
        ]
        parents.append(parent_indices)
    return parents


def rcd_confounders_from_matrix(matrix: np.ndarray) -> list[list[int]]:
    pairs: list[list[int]] = []
    for left in range(matrix.shape[0]):
        for right in range(left + 1, matrix.shape[1]):
            if np.isnan(matrix[left, right]) or np.isnan(matrix[right, left]):
                pairs.append([left, right])
    return pairs


def run_silenced(builder):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        return builder()


def make_case(case_id: str, algorithm: str, input_summary: dict[str, Any], output_summary: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": case_id,
        "algorithm": algorithm,
        "input": input_summary,
        "output": output_summary,
        "result": result,
    }


def append_case(cases: list[dict[str, Any]], case_id: str, builder) -> None:
    try:
        cases.append(builder())
    except Exception as error:
        raise RuntimeError(f"Failed while building comparison case '{case_id}'") from error


def exact_search_case(
    data_exact: np.ndarray,
    search_method: str,
    use_path_extension: bool,
    use_k_cycle_heuristic: bool,
) -> dict[str, Any]:
    dag_matrix, stats = bic_exact_search(
        data_exact,
        search_method=search_method,
        use_path_extension=use_path_extension,
        use_k_cycle_heuristic=use_k_cycle_heuristic,
        k=3,
        verbose=False,
    )
    node_count = dag_matrix.shape[0]
    nodes = [GraphNode(f"X{index + 1}") for index in range(node_count)]
    dag = Dag(nodes)
    for parent, child in zip(*np.where(dag_matrix == 1)):
        dag.add_directed_edge(nodes[parent], nodes[child])
    cpdag = dag2cpdag(dag)
    return make_case(
        f"exactsearch.simulated_gaussian.{search_method}",
        "exact-search",
        {
            "data": {"rows": int(data_exact.shape[0]), "columns": int(data_exact.shape[1])},
            "searchMethod": search_method,
            "usePathExtension": use_path_extension,
            "useKCycleHeuristic": use_k_cycle_heuristic,
            "k": 3,
            "centerColumns": True,
        },
        graph_output_summary(cpdag),
        {"graphMatrix": graph_matrix(cpdag)},
    )


def run_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []

    data_pc_sim = load_txt_matrix("test_pc_simulated_linear_gaussian_data.txt", 1)
    append_case(
        cases,
        "pc.simulated_gaussian.default",
        lambda: (
            lambda cg_pc_sim: make_case(
                "pc.simulated_gaussian.default",
                "pc",
                {
                    "data": {"rows": int(data_pc_sim.shape[0]), "columns": int(data_pc_sim.shape[1])},
                    "alpha": 0.05,
                    "ciTest": "fisherz",
                    "stable": True,
                    "ucRule": 0,
                    "ucPriority": 2,
                },
                graph_output_summary(cg_pc_sim.G),
                {"graphMatrix": graph_matrix(cg_pc_sim.G)},
            )
        )(pc(data_pc_sim, 0.05, fisherz, True, 0, 2, verbose=False, show_progress=False))
    )

    data_linear_10 = load_txt_matrix("data_linear_10.txt", 1)
    for uc_rule, uc_priority in ((0, 0), (0, 1), (0, 2), (0, 3), (0, 4), (1, -1), (2, -1)):
        append_case(
            cases,
            f"pc.linear10.fisherz.{uc_rule}.{uc_priority}",
            lambda uc_rule=uc_rule, uc_priority=uc_priority: (
                lambda cg: make_case(
                    f"pc.linear10.fisherz.{uc_rule}.{uc_priority}",
                    "pc",
                    {
                        "data": {"rows": int(data_linear_10.shape[0]), "columns": int(data_linear_10.shape[1])},
                        "alpha": 0.05,
                        "ciTest": "fisherz",
                        "stable": True,
                        "ucRule": uc_rule,
                        "ucPriority": uc_priority,
                    },
                    graph_output_summary(cg.G),
                    {"graphMatrix": graph_matrix(cg.G)},
                )
            )(pc(data_linear_10, 0.05, fisherz, True, uc_rule, uc_priority, verbose=False, show_progress=False))
        )

    data_discrete_10 = load_txt_matrix("data_discrete_10.txt", 1)
    for name, indep_test in (("chisq", chisq), ("gsq", gsq)):
        append_case(
            cases,
            f"pc.discrete10.{name}.0.-1",
            lambda name=name, indep_test=indep_test: (
                lambda cg: make_case(
                    f"pc.discrete10.{name}.0.-1",
                    "pc",
                    {
                        "data": {"rows": int(data_discrete_10.shape[0]), "columns": int(data_discrete_10.shape[1])},
                        "alpha": 0.05,
                        "ciTest": name,
                        "stable": True,
                        "ucRule": 0,
                        "ucPriority": -1,
                    },
                    graph_output_summary(cg.G),
                    {"graphMatrix": graph_matrix(cg.G)},
                )
            )(pc(data_discrete_10, 0.05, indep_test, True, 0, -1, verbose=False, show_progress=False))
        )

    domain1 = load_txt_matrix("data_linear_1.txt", 1)[:100, :]
    domain2 = load_txt_matrix("data_linear_2.txt", 1)[:100, :]
    domain3 = load_txt_matrix("data_linear_3.txt", 1)[:100, :]
    domain_data = np.concatenate((domain1, domain2, domain3))
    context = np.concatenate(
        (
            np.ones((domain1.shape[0], 1)),
            2 * np.ones((domain2.shape[0], 1)),
            3 * np.ones((domain3.shape[0], 1)),
        )
    )
    append_case(
        cases,
        "cdnod.domain123.fisherz.0.2",
        lambda: (
            lambda cg_cdnod: make_case(
                "cdnod.domain123.fisherz.0.2",
                "cdnod",
                {
                    "data": {"rows": int(domain_data.shape[0]), "columns": int(domain_data.shape[1])},
                    "context": {"rows": int(context.shape[0]), "columns": int(context.shape[1])},
                    "alpha": 0.05,
                    "ciTest": "fisherz",
                    "stable": True,
                    "ucRule": 0,
                    "ucPriority": 2,
                },
                graph_output_summary(cg_cdnod.G),
                {"graphMatrix": graph_matrix(cg_cdnod.G)},
            )
        )(cdnod(domain_data, context, 0.05, fisherz, True, 0, 2, verbose=False, show_progress=False))
    )

    append_case(
        cases,
        "fci.linear10.fisherz",
        lambda: (
            lambda graph_fci, _edges: make_case(
                "fci.linear10.fisherz",
                "fci",
                {
                    "data": {"rows": int(data_linear_10.shape[0]), "columns": int(data_linear_10.shape[1])},
                    "alpha": 0.05,
                    "ciTest": "fisherz",
                },
                graph_output_summary(graph_fci),
                {"graphMatrix": graph_matrix(graph_fci)},
            )
        )(*run_silenced(lambda: fci(data_linear_10, fisherz, 0.05, verbose=False, show_progress=False)))
    )

    append_case(
        cases,
        "ges.linear10.bic",
        lambda: (
            lambda res_ges_linear: make_case(
                "ges.linear10.bic",
                "ges",
                {
                    "data": {"rows": int(data_linear_10.shape[0]), "columns": int(data_linear_10.shape[1])},
                    "score": "local_score_BIC",
                    "maxParents": None,
                },
                graph_output_summary(res_ges_linear["G"]),
                {"graphMatrix": graph_matrix(res_ges_linear["G"])},
            )
        )(ges(data_linear_10, score_func="local_score_BIC", maxP=None, parameters=None))
    )

    data_ges_sim = load_txt_matrix("test_ges_simulated_linear_gaussian_data.txt")
    append_case(
        cases,
        "ges.simulated_gaussian.bic",
        lambda: (
            lambda res_ges_sim: make_case(
                "ges.simulated_gaussian.bic",
                "ges",
                {
                    "data": {"rows": int(data_ges_sim.shape[0]), "columns": int(data_ges_sim.shape[1])},
                    "score": "local_score_BIC",
                    "maxParents": None,
                },
                graph_output_summary(res_ges_sim["G"]),
                {"graphMatrix": graph_matrix(res_ges_sim["G"])},
            )
        )(ges(data_ges_sim, score_func="local_score_BIC", maxP=None, parameters=None))
    )

    append_case(
        cases,
        "ges.discrete10.bdeu",
        lambda: (
            lambda res_ges_discrete: make_case(
                "ges.discrete10.bdeu",
                "ges",
                {
                    "data": {"rows": int(data_discrete_10.shape[0]), "columns": int(data_discrete_10.shape[1])},
                    "score": "local_score_BDeu",
                    "maxParents": None,
                },
                graph_output_summary(res_ges_discrete["G"]),
                {"graphMatrix": graph_matrix(res_ges_discrete["G"])},
            )
        )(ges(data_discrete_10, score_func="local_score_BDeu", maxP=None, parameters=None))
    )

    data_exact = center_columns(load_txt_matrix("test_exact_search_simulated_linear_gaussian_data.txt"))
    for search_method, use_path_extension, use_k_cycle_heuristic in (
        ("astar", True, True),
        ("dp", False, False),
    ):
        append_case(
            cases,
            f"exactsearch.simulated_gaussian.{search_method}",
            lambda search_method=search_method, use_path_extension=use_path_extension, use_k_cycle_heuristic=use_k_cycle_heuristic: exact_search_case(
                data_exact,
                search_method,
                use_path_extension,
                use_k_cycle_heuristic,
            )
        )

    data_grasp = load_txt_matrix("test_grasp_seed123_data.txt")
    random.seed(123)
    np.random.seed(123)
    append_case(
        cases,
        "grasp.seed123",
        lambda: (
            lambda graph_grasp: make_case(
                "grasp.seed123",
                "grasp",
                {
                    "data": {"rows": int(data_grasp.shape[0]), "columns": int(data_grasp.shape[1])},
                    "score": "local_score_BIC_from_cov",
                    "depth": 1,
                    "lambdaValue": 4,
                    "randomSeed": 123,
                },
                graph_output_summary(graph_grasp),
                {"graphMatrix": graph_matrix(graph_grasp)},
            )
        )(
            grasp(
                data_grasp,
                score_func="local_score_BIC_from_cov",
                depth=1,
                parameters={"lambda_value": 4},
                verbose=False,
                node_names=[f"X{index + 1}" for index in range(data_grasp.shape[1])],
            )
        )
    )

    for case_index in (1, 2, 3):
        data_gin = load_txt_matrix(f"test_gin_case{case_index}_data.txt")
        for indep_test_method in ("hsic", "kci"):
            append_case(
                cases,
                f"gin.case{case_index}.{indep_test_method}",
                lambda case_index=case_index, indep_test_method=indep_test_method, data_gin=data_gin: (
                    lambda gin_result: make_case(
                        f"gin.case{case_index}.{indep_test_method}",
                        "gin",
                        {
                            "data": {"rows": int(data_gin.shape[0]), "columns": int(data_gin.shape[1])},
                            "indepTestMethod": indep_test_method,
                            "alpha": 0.05,
                        },
                        {
                            "nodeCount": len(gin_result[0].get_nodes()),
                            "edgeCount": len(gin_result[0].get_graph_edges()),
                            "clusterCount": len(gin_result[1]),
                        },
                        {
                            "causalOrder": normalize_clusters(gin_result[1]),
                            "graph": {
                                "nodes": graph_nodes(gin_result[0]),
                                "edges": graph_edges(gin_result[0]),
                            },
                        },
                    )
                )(GIN(data_gin, indep_test_method=indep_test_method, alpha=0.05))
            )

    data_camuv = load_txt_matrix("test_camuv_seed42_data.txt")
    append_case(
        cases,
        "camuv.seed42",
        lambda: (
            lambda camuv_result: make_case(
                "camuv.seed42",
                "cam-uv",
                {
                    "data": {"rows": int(data_camuv.shape[0]), "columns": int(data_camuv.shape[1])},
                    "alpha": 0.01,
                    "maxExplanatoryVars": 3,
                },
                {
                    "nodeCount": int(data_camuv.shape[1]),
                    "parentEntryCount": sum(1 for entry in camuv_result[0] if len(entry) > 0),
                    "confoundedPairCount": len(camuv_result[1]),
                },
                {
                    "parents": normalize_clusters(camuv_result[0]),
                    "confoundedPairs": normalize_clusters(camuv_result[1]),
                },
            )
        )(CAMUV.execute(data_camuv, 0.01, 3))
    )

    data_rcd = load_txt_matrix("test_rcd_seed100_data.txt")
    for mlhsicr in (False, True):
        for bw_method in ("mdbs", "scott", "silverman"):
            suffix = ".mlhsicr" if mlhsicr else ""
            append_case(
                cases,
                f"rcd.seed100.{bw_method}{suffix}",
                lambda bw_method=bw_method, mlhsicr=mlhsicr, suffix=suffix: (
                    lambda model_rcd: (
                        lambda adjacency_rcd: make_case(
                            f"rcd.seed100.{bw_method}{suffix}",
                            "rcd",
                            {
                                "data": {"rows": int(data_rcd.shape[0]), "columns": int(data_rcd.shape[1])},
                                "maxExplanatoryNum": 2,
                                "corAlpha": 0.01,
                                "indAlpha": 0.01,
                                "shapiroAlpha": 0.01,
                                "mlhsicr": mlhsicr,
                                "bwMethod": bw_method,
                            },
                            {
                                "nodeCount": int(data_rcd.shape[1]),
                                "parentEntryCount": sum(1 for entry in rcd_parents_from_matrix(adjacency_rcd) if len(entry) > 0),
                                "confoundedPairCount": len(rcd_confounders_from_matrix(adjacency_rcd)),
                            },
                            {
                                "parents": rcd_parents_from_matrix(adjacency_rcd),
                                "ancestors": normalize_clusters(model_rcd.ancestors_list_),
                                "confoundedPairs": rcd_confounders_from_matrix(adjacency_rcd),
                                "adjacencyMatrix": adjacency_matrix_to_jsonable(adjacency_rcd),
                            },
                        )
                    )(model_rcd.adjacency_matrix_)
                )((lambda model: (model.fit(data_rcd), model)[1])(lingam.RCD(bw_method=bw_method, MLHSICR=mlhsicr)))
            )

    return cases


def main() -> None:
    payload = {
        "runtime": {
            "pythonVersion": sys.version,
            "causalLearnRoot": str(CAUSAL_LEARN_ROOT),
        },
        "cases": run_cases(),
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
