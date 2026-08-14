import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { POSITIVE_STATE_SEQUENCE, resolveSkillDir, validateLifecycleState } from "../extensions/iph";

type JsonObject = Record<string, any>;

const gateCompletion: Record<string, string> = {
	scope_locked: "SCOPE_LOCK",
	prior_claims_drained: "PRIOR_CLAIM_DRAIN",
	recent_frontier_complete: "RECENT_FRONTIER",
	literature_registry_valid: "LITERATURE_REGISTER",
	l1_frozen: "L1_FREEZE",
	k_set_selected: "L2_TRIAGE",
	l2_frozen: "LAYER_DECISION",
	architecture_frozen: "LAYER_DECISION",
	k_fulltext_complete: "K_FULLTEXT",
	k_claims_complete: "K_CLAIM_REGISTER",
	output_claims_traced: "OUTPUT_CLAIM_BIND",
	evidence_validated: "EVIDENCE_VALIDATE",
	n0_4_locked: "N0_AUDIT",
};

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function sha256(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(file: string): Promise<JsonObject> {
	return JSON.parse(await readFile(file, "utf8")) as JsonObject;
}

async function writeJson(file: string, value: unknown): Promise<void> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fileSha(root: string, relative: string): Promise<string> {
	return sha256(await readFile(path.join(root, relative)));
}

async function installAndVerifyTheoryWitness(root: string): Promise<void> {
	const script = [
		"#!/usr/bin/env python3",
		"import sys",
		"",
		"CASES = {",
		"    'minimal-positive': ('PASS: x=0 gives x+1=1>0.', 0),",
		"    'nonzero-nuisance': ('PASS: x=2 gives x+1=3>0.', 0),",
		"    'boundary-or-limit': ('PASS: boundary x=0 satisfies the conclusion.', 0),",
		"    'premise-removal': ('FAIL: x=-2 violates x+1>0 when x>=0 is removed.', 1),",
		"    'random-property': ('PASS: exhaustive integer sample x in [0, 10].', 0),",
		"}",
		"",
		"if len(sys.argv) != 2 or sys.argv[1] not in CASES:",
		"    print('usage: theory_witness.py {' + '|'.join(CASES) + '}', file=sys.stderr)",
		"    raise SystemExit(2)",
		"message, exit_code = CASES[sys.argv[1]]",
		"print(message)",
		"raise SystemExit(exit_code)",
		"",
	].join("\n");
	await mkdir(path.join(root, "checks"), { recursive: true });
	await writeFile(path.join(root, "checks", "theory_witness.py"), script);

	const registry = await readJson(path.join(root, "theory_obligation_registry.json"));
	for (const obligation of registry.obligations ?? []) {
		for (const witness of obligation.witnesses ?? []) {
			const command = String(witness.command ?? "").split(" ");
			assert(
				command.length === 3 && command[0] === "python3" && command[1] === "checks/theory_witness.py",
				`unsupported theory witness command: ${witness.command}`,
			);
			const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).arrayBuffer(),
				new Response(child.stderr).text(),
			]);
			const stdoutBytes = new Uint8Array(stdout);
			assert(exitCode === witness.exit_code, `${witness.kind} exit mismatch: ${exitCode} != ${witness.exit_code}; ${stderr}`);
			assert(sha256(stdoutBytes) === witness.output_sha256, `${witness.kind} stdout hash mismatch`);
			const recorded = await readFile(path.join(root, witness.output_file));
			assert(Buffer.from(stdoutBytes).equals(recorded), `${witness.kind} stdout differs from ${witness.output_file}`);
		}
	}
}

function canonicalBundle(entries: JsonObject[]): string {
	const normalized = entries
		.map(entry => ({ path: entry.path, role: entry.role, sha256: entry.sha256 }))
		.sort((left, right) => String(left.path).localeCompare(String(right.path)));
	return sha256(JSON.stringify(normalized));
}

async function repairEpochOneFixture(root: string): Promise<string> {
	const officialPage = "https://proceedings.mlr.press/v235/angelopoulos24a.html";
	const officialPdf = "https://raw.githubusercontent.com/mlresearch/v235/main/assets/angelopoulos24a/angelopoulos24a.pdf";
	const expectedPdfSha = "125fe807fe49dbbb491c2f7d835cf61b17174cfc4fef9f2a974d0d4eb294ddf1";
	const cachePath = process.env.IPH_FIXTURE_PDF_CACHE?.trim();
	let pdfBytes: Uint8Array;
	if (cachePath) {
		pdfBytes = await readFile(path.resolve(cachePath));
	} else {
		const pdfResponse = await fetch(officialPdf);
		assert(pdfResponse.ok, `cannot fetch official PMLR PDF: ${pdfResponse.status}; set IPH_FIXTURE_PDF_CACHE to the pinned PDF for an offline run`);
		pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
	}
	assert(sha256(pdfBytes) === expectedPdfSha, "official PMLR PDF hash drifted; re-verify before updating the fixture pin");
	await writeFile(path.join(root, "literature_archive", "W-0001.pdf"), pdfBytes);
	await writeFile(path.join(root, "literature_archive", "W-0001.txt"), [
		"Official PMLR record snapshot.",
		"",
		"Online conformal prediction with decaying step sizes",
		"Anastasios Nikolas Angelopoulos; Rina Barber; Stephen Bates",
		"Proceedings of the 41st International Conference on Machine Learning, PMLR 235:1616-1630, 2024.",
		"",
		"The official abstract reports an online conformal method with decaying step sizes,",
		"retrospective coverage for arbitrary sequences, and improved time-point behavior",
		"under a stable distribution.",
		"",
		`Source: ${officialPage}`,
		"",
	].join("\n"));
	await installAndVerifyTheoryWitness(root);
	const archivedSha = await fileSha(root, "literature_archive/W-0001.pdf");
	await writeJson(path.join(root, "near_neighbor_registry.json"), {
		schema_version: "2.0",
		current_year: 2026,
		recent_window: {
			start_year: 2024,
			end_year: 2026,
			status: "COMPLETE",
			snapshot_mode: "NEW_SEARCH",
			completed_at: "2026-08-14T00:00:00Z",
			queries: [
				{ database: "PMLR", query: "online conformal prediction decaying step sizes", filters: "2024-2026", hit_count: 1 },
				{ database: "OpenReview", query: '"Online conformal prediction with decaying step sizes"', filters: "2024-2026", hit_count: 1 },
			],
		},
		current_collision_round: 1,
		peer_reviewed_published_count: 1,
		search_mode: "SEARCH_OPEN",
		records: [{
			registry_id: "W-0001",
			canonical_title: "Online conformal prediction with decaying step sizes",
			authors: ["Anastasios Nikolas Angelopoulos", "Rina Barber", "Stephen Bates"],
			year: 2024,
			persistent_ids: { pmlr: "v235/angelopoulos24a" },
			canonical_url: officialPage,
			alternate_urls: ["https://openreview.net/forum?id=2XkRIijUKw"],
			identity_status: "VERIFIED",
			identity_verification_url: officialPage,
			identity_verified_at: "2026-08-14T00:00:00Z",
			search_phase: "RECENT_FRONTIER_PASS",
			importance: "CRITICAL",
			importance_history: [{ importance: "CRITICAL", at: "2026-08-14T00:00:00Z", reason: "direct online update-schedule near neighbor" }],
			reclassifications: [],
			publication_status: "PUBLISHED",
			terminal_rejection_eligibility: "QUALIFIED",
			publication_verification_url: officialPage,
			peer_review_status: "PEER_REVIEWED_PUBLISHED",
			peer_review_verification_url: officialPage,
			download: {
				status: "FULLTEXT_ARCHIVED",
				source_url: officialPdf,
				local_path: "literature_archive/W-0001.pdf",
				sha256: archivedSha,
				downloaded_at: "2026-08-14T00:00:00Z",
				verified_against_metadata: true,
				block_reason: "",
			},
			claim_extraction_status: "COMPLETE",
		}],
	});
	await writeJson(path.join(root, "literature_claim_registry.json"), {
		schema_version: "2.0",
		current_collision_round: 1,
		records: [{
			claim_id: "LC-0001",
			source_registry_id: "W-0001",
			source_artifact_id: "ART-W-0001-PDF-SEC1-1",
			source_artifact_kind: "FULL_ARTICLE_PDF",
			claim_type: "ENABLES",
			normalized_statement: "The registered method updates the online conformal threshold after observing each label, using a time-varying step size.",
			source_excerpt: "where the threshold qt is updated with the rule",
			locator: { section: "1.1 Method and Setup", page: "2", equation: "(4)" },
			conditions: ["online conformal prediction", "arbitrary sequences"],
			scope: "reported properties of the registered 2024 method",
			evidence_level: "E2",
			proof_locator: "",
			verification_status: "VERIFIED_FULLTEXT",
			importance: "CRITICAL",
			discovered_round: 1,
			use_status: "USED",
			used_by_output_claim_ids: ["OC-0001"],
			used_in_collision_ids: [],
			exclusion_reason: "",
		}],
	});
	await writeJson(path.join(root, "frontier_coverage.json"), {
		schema_version: "2.0",
		axes: {
			method_synonyms: ["online conformal prediction", "adaptive conformal inference"],
			target_tasks: ["streaming prediction", "sequential uncertainty quantification"],
			theory_terms: ["arbitrary-sequence coverage", "population quantile estimation"],
			algorithm_structures: ["predict then observe then update", "decaying step size"],
			author_continuations: [{
				edge: "Conformal PID Control for Time Series Prediction (2023) -> Online conformal prediction with decaying step sizes (2024)",
				shared_authors: ["Anastasios Nikolas Angelopoulos"],
			}],
			backward_citations: ["Adaptive Conformal Inference Under Distribution Shift (NeurIPS 2021)"],
			forward_citations: ["No forward-citation work was used as a qualifying identity in this bounded fixture audit."],
			method_lineage: ["adaptive conformal inference -> conformal PID control -> decaying-step online conformal prediction"],
		},
		routes: [
			{ route_id: "pmlr-title-search", route_type: "DISCOVERY", independent: true, details: "Exact-title and method-term search on the official PMLR proceedings index." },
			{ route_id: "openreview-identity-check", route_type: "IDENTITY", independent: true, details: "Independent title/author/version check through the linked OpenReview record." },
		],
	});
	await writeFile(path.join(root, "near_neighbor_url_ledger.csv"), "registry_id,canonical_url,identity_verification_url,publication_verification_url,peer_review_verification_url,status,checked_at,role\nW-0001,https://proceedings.mlr.press/v235/angelopoulos24a.html,https://proceedings.mlr.press/v235/angelopoulos24a.html,https://proceedings.mlr.press/v235/angelopoulos24a.html,https://proceedings.mlr.press/v235/angelopoulos24a.html,VERIFIED,2026-08-14T00:00:00Z,ALL\n");
	await writeJson(path.join(root, "output_claim_support.json"), {
		schema_version: "2.0",
		current_collision_round: 1,
		output_claims: [{
			output_claim_id: "OC-0001",
			statement: "The registered 2024 neighbor updates its online conformal threshold after each observed label using a time-varying step size.",
			output_location: "manuscript.md:9",
			claim_kind: "FACT",
			supporting_claim_ids: ["LC-0001"],
			counter_claim_ids: [],
			inference_type: "DIRECT",
			reasoning: "The archived official PDF states the threshold update in Section 1.1, equation (4).",
			caveats: "This is a literature fact, not proof of the candidate method's novelty or validity.",
			trace_status: "VERIFIED",
		}],
		collision_gate: { prior_round_claims_drained: true, unused_prior_claim_ids: [], checked_at: "2026-08-14T00:00:00Z" },
	});
	const theoryPath = path.join(root, "theory_obligation_registry.json");
	const theory = await readJson(theoryPath);
	for (const obligation of theory.obligations ?? []) {
		for (const witness of obligation.witnesses ?? []) {
			if (witness.kind === "NONZERO_NUISANCE") {
				witness.sensitivity_control = "nuisance=0.25 versus nuisance=0.00 in the named fixture";
			}
			if (witness.kind === "PREMISE_REMOVAL") {
				witness.mechanism = "Removing nonnegativity admits x=-2, so x+1 is negative and the exact claim fails.";
			}
		}
	}
	await writeJson(theoryPath, theory);

	await writeFile(path.join(root, "novelty-audit.md"), [
		"# Novelty Audit — FIXTURE-M",
		"",
		"## 证伪书（falsification ledger）",
		"",
		"- [证伪路径] 直接占据：W-0001 §1.1 Eq. (4) 已直接占据逐标签更新在线 conformal 阈值的方法事实，§2.1 Theorem 1 已直接占据 retrospective coverage；这两项不得作为候选新颖性。",
		"- [证伪路径] 机械归约：W-0001 §1.1 Eq. (4) 与 §2.1 Theorem 1 都没有定义候选的比较器预算对齐和 predict-before-update 评估合同，仅由该文不能机械推出该评估责任。",
		"- [证伪路径] 换名检测：候选只能声称可执行的评估合同，不能把 W-0001 的在线 conformal 方法换名为新算法。",
		"",
		"## N0 评估综合",
		"",
		"| 近邻 ID | 距离 | N0 | 关键观察 |",
		"|---|---|---|---|",
		"| W-0001 | direct method neighbor | N0-4C | §1.1 Eq. (4) / §2.1 Theorem 1 occupy the method and coverage facts, but do not specify the candidate's executable comparator-parity evaluation contract. |",
		"",
		"## N0 裁决",
		"",
		"- novelty_level = N0-4C",
		"- 证伪书完成度：3 条证伪尝试，全部失败",
		"",
	].join("\n"));

	await writeJson(path.join(root, "current_evidence_scope.empty.json"), {
		schema_version: "2.0",
		collision_round: 1,
		fulltext_registry_ids: [],
		atomic_claim_ids: [],
	});
	await writeJson(path.join(root, "current_evidence_scope.json"), {
		schema_version: "2.0",
		collision_round: 1,
		fulltext_registry_ids: ["W-0001"],
		atomic_claim_ids: ["LC-0001"],
	});
	await writeJson(path.join(root, "prior_claim_drain.json"), {
		schema_version: "2.0",
		collision_round: 1,
		prior_round_claims_drained: true,
		items: [],
	});
	await writeFile(path.join(root, "claim-freeze.md"), "# Claim Freeze — epoch 1\n\nFixture exact claims are frozen for node testing.\n");

	const manifestPath = path.join(root, "audit_manifest.json");
	const manifest = await readJson(manifestPath);
	const executableEvidence: Array<[string, string]> = [
		["checks/theory_witness.py", "EXECUTABLE_TEST"],
		["theory_witnesses/minimal_positive.txt", "TEST_OUTPUT"],
		["theory_witnesses/nonzero_nuisance.txt", "TEST_OUTPUT"],
		["theory_witnesses/boundary_or_limit.txt", "TEST_OUTPUT"],
		["theory_witnesses/premise_removal.txt", "TEST_OUTPUT"],
		["theory_witnesses/random_property.txt", "TEST_OUTPUT"],
	];
	for (const [relative, role] of executableEvidence) {
		if (!(manifest.entries ?? []).some((entry: JsonObject) => entry.path === relative)) {
			manifest.entries.push({ path: relative, role, sha256: "" });
		}
	}
	for (const entry of manifest.entries ?? []) entry.sha256 = await fileSha(root, entry.path);
	manifest.claim_bundle_sha256 = canonicalBundle(manifest.entries);
	await writeJson(manifestPath, manifest);

	const auditPath = path.join(root, "independent_audit.json");
	const audit = await readJson(auditPath);
	audit.audited_bundle_sha256 = manifest.claim_bundle_sha256;
	audit.review_answers = {
		data_authenticity: "compute_evidence.json names only synthetic-dev and manuscript.md makes no real-dataset claim.",
		baseline_execution: "baseline_budget.json names B-COMPARATOR-A and test_outputs/online_chronology_pass.json records execution.",
		claim_strength: "claim_inventory.json and manuscript.md use the same bounded algorithm and theorem statements.",
		falsification_attempt: "novelty-audit.md tests occupation, mechanical reduction, and renaming against W-0001 locators.",
	};
	await writeJson(auditPath, audit);
	return manifest.claim_bundle_sha256;
}

async function applyLayeredEvidence(root: string, source: string): Promise<void> {
	const sourceIndex = POSITIVE_STATE_SEQUENCE.indexOf(source as never);
	const claimIndex = POSITIVE_STATE_SEQUENCE.indexOf("K_CLAIM_REGISTER" as never);
	const collisionIndex = POSITIVE_STATE_SEQUENCE.indexOf("SYNTHESIZE_COLLISION" as never);
	const reviewedIndex = POSITIVE_STATE_SEQUENCE.indexOf("DIRECTION_LOCK" as never);
	if (sourceIndex < reviewedIndex) {
		await rm(path.join(root, "independent_audit.json"), { force: true });
		await rm(path.join(root, "review_artifacts"), { recursive: true, force: true });
	} else if (source === "FINAL_VALIDITY_AUDIT") {
		await rm(path.join(root, "review_artifacts", "epoch-2.json"), { force: true });
	}
	if (sourceIndex < claimIndex) {
		await writeJson(path.join(root, "literature_claim_registry.json"), {
			schema_version: "2.0",
			current_collision_round: 1,
			records: [],
		});
		const scope = await readJson(path.join(root, "current_evidence_scope.json"));
		scope.atomic_claim_ids = [];
		await writeJson(path.join(root, "current_evidence_scope.json"), scope);
	}
	if (sourceIndex < collisionIndex) {
		await writeJson(path.join(root, "output_claim_support.json"), {
			schema_version: "2.0",
			current_collision_round: 1,
			output_claims: [],
			collision_gate: { prior_round_claims_drained: true, unused_prior_claim_ids: [], checked_at: "2026-08-14T00:00:00Z" },
		});
		if (sourceIndex >= claimIndex) {
			const claims = await readJson(path.join(root, "literature_claim_registry.json"));
			for (const claim of claims.records ?? []) {
				claim.use_status = "UNUSED";
				claim.used_by_output_claim_ids = [];
			}
			await writeJson(path.join(root, "literature_claim_registry.json"), claims);
		}
	}
	if (sourceIndex < POSITIVE_STATE_SEQUENCE.indexOf("LAYER_DECISION" as never)) {
		const registry = await readJson(path.join(root, "near_neighbor_registry.json"));
		registry.records[0].download = {
			status: "NOT_REQUIRED",
			source_url: "https://proceedings.mlr.press/v235/angelopoulos24a.html",
			local_path: "",
			sha256: "",
			downloaded_at: "",
			verified_against_metadata: false,
			block_reason: "L1/L2 metadata-and-abstract stage; K fulltext retrieval has not begun.",
		};
		await writeJson(path.join(root, "near_neighbor_registry.json"), registry);
		await rm(path.join(root, "literature_archive", "W-0001.pdf"), { force: true });
	}
	if (sourceIndex < claimIndex) {
		const registry = await readJson(path.join(root, "near_neighbor_registry.json"));
		registry.records[0].claim_extraction_status = "NOT_STARTED";
		await writeJson(path.join(root, "near_neighbor_registry.json"), registry);
	}
}

async function createEpochTwo(root: string): Promise<string> {
	const bumpEpoch = (value: any): any => {
		if (Array.isArray(value)) return value.map(bumpEpoch);
		if (!value || typeof value !== "object") return value;
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [
			key,
			key === "validation_epoch" && child === 1 ? 2 : bumpEpoch(child),
		]));
	};
	const epochFiles = [
		"claim_inventory.json",
		"theory_obligation_registry.json",
		"protocol_contract.json",
		"claim_code_trace.json",
		"baseline_budget.json",
	];
	for (const relative of epochFiles) {
		const payload = bumpEpoch(await readJson(path.join(root, relative)));
		await writeJson(path.join(root, "postcompute", relative), payload);
	}

	const roles: Array<[string, string]> = [
		["postcompute/claim_inventory.json", "CLAIM_INVENTORY"],
		["manuscript.md", "MANUSCRIPT"],
		["postcompute/theory_obligation_registry.json", "THEORY_OBLIGATIONS"],
		["postcompute/baseline_budget.json", "BASELINE_CONTRACT"],
		["checks/check_online_chronology.py", "EXECUTABLE_TEST"],
		["postcompute/claim_code_trace.json", "CLAIM_CODE_TRACE"],
		["implementation/online_algorithm.py", "IMPLEMENTATION"],
		["postcompute/protocol_contract.json", "PROTOCOL_CONTRACT"],
		["test_outputs/online_chronology_pass.json", "TEST_OUTPUT"],
		["checks/theory_witness.py", "EXECUTABLE_TEST"],
		["theory_witnesses/minimal_positive.txt", "TEST_OUTPUT"],
		["theory_witnesses/nonzero_nuisance.txt", "TEST_OUTPUT"],
		["theory_witnesses/boundary_or_limit.txt", "TEST_OUTPUT"],
		["theory_witnesses/premise_removal.txt", "TEST_OUTPUT"],
		["theory_witnesses/random_property.txt", "TEST_OUTPUT"],
	];
	const entries = await Promise.all(roles.map(async ([relative, role]) => ({
		path: relative,
		role,
		sha256: await fileSha(root, relative),
	})));
	const bundle = canonicalBundle(entries);
	await writeJson(path.join(root, "postcompute", "audit_manifest.json"), {
		schema_version: "2.0",
		validation_epoch: 2,
		claim_bundle_sha256: bundle,
		entries,
	});

	const audit = await readJson(path.join(root, "independent_audit.json"));
	audit.validation_epoch = 2;
	audit.audited_bundle_sha256 = bundle;
	delete audit.reviewer_agent_id;
	delete audit.reviewer_thread_id;
	delete audit.audited_at;
	await writeJson(path.join(root, "review_artifacts", "epoch-2.json"), audit);
	return bundle;
}

function reached(source: string, completedState: string): boolean {
	return POSITIVE_STATE_SEQUENCE.indexOf(source as never) >= POSITIVE_STATE_SEQUENCE.indexOf(completedState as never);
}

function lifecycleForSource(source: string): JsonObject {
	const validityStates = new Set([
		"CLAIM_FREEZE", "VALIDITY_AUDIT", "INDEPENDENT_REVIEW", "DIRECTION_LOCK",
		"POSTCOMPUTE_CLAIM_FREEZE", "FINAL_VALIDITY_AUDIT", "FINAL_LOCK",
	]);
	const activeStage = source === "COMPUTE" ? "E4" : validityStates.has(source) ? "E3" : "E2";
	return {
		schema_version: "1.0",
		active_stage: activeStage,
		stage_pointers: {
			E0: "workflow_state.json#output_type",
			E1: null,
			E2: "workflow_state.json",
			E3: "workflow_state.json",
			E4: "workflow_state.json#compute_stage",
			E5: null,
			E6: null,
		},
	};
}

async function stateFor(root: string, source: string, epochOneBundle: string, epochTwoBundle: string): Promise<JsonObject> {
	const index = POSITIVE_STATE_SEQUENCE.indexOf(source as never);
	assert(index >= 0 && source !== "COMPLETE", `unsupported source state: ${source}`);
	const target = POSITIVE_STATE_SEQUENCE[index + 1]!;
	const gates: Record<string, boolean> = {};
	for (const [gate, completionState] of Object.entries(gateCompletion)) gates[gate] = reached(source, completionState);
	gates.compute_authorized = reached(source, "COMPUTE");

	const epochTwo = reached(source, "FINAL_VALIDITY_AUDIT");
	const afterN0 = reached(source, "N0_AUDIT");
	let validity = "V0";
	if (reached(source, "VALIDITY_AUDIT")) validity = "V1";
	if (reached(source, "INDEPENDENT_REVIEW")) validity = "V2";
	if (reached(source, "DIRECTION_LOCK")) validity = "V3";
	if (reached(source, "FINAL_LOCK")) validity = "V4";

	const artifacts: JsonObject = {
		scope_lock: "scope_lock.md",
		literature_registry: "near_neighbor_registry.json",
		url_ledger: "near_neighbor_url_ledger.csv",
		claim_registry: "literature_claim_registry.json",
		frontier_coverage: "frontier_coverage.json",
		output_support: "output_claim_support.json",
		literature_archive: "literature_archive",
		current_evidence_scope: reached(source, "K_FULLTEXT") ? "current_evidence_scope.json" : "current_evidence_scope.empty.json",
		hierarchy_status: "hierarchy_status.md",
		l1_card: "l1-card.md",
		k_triage: "l2-triage.md",
		l2_card: "l2-card.md",
		contribution_architecture: "contribution-architecture.md",
		hierarchy_novelty_audit: "novelty-audit.md",
		validation_log: "validation.log",
		claim_inventory: epochTwo ? "postcompute/claim_inventory.json" : "claim_inventory.json",
		audit_manifest: epochTwo ? "postcompute/audit_manifest.json" : "audit_manifest.json",
		theory_obligations: epochTwo ? "postcompute/theory_obligation_registry.json" : "theory_obligation_registry.json",
		protocol_contract: epochTwo ? "postcompute/protocol_contract.json" : "protocol_contract.json",
		claim_code_trace: epochTwo ? "postcompute/claim_code_trace.json" : "claim_code_trace.json",
		baseline_budget: epochTwo ? "postcompute/baseline_budget.json" : "baseline_budget.json",
	};

	const decisionStates = [...new Set(Object.entries(gateCompletion)
		.filter(([gate]) => gates[gate])
		.map(([, completion]) => completion))];
	const start = Date.now() - 120_000;
	const decision_log = decisionStates.map((state, offset) => ({
		at: new Date(start + offset * 1_000).toISOString(),
		state,
		action: `fixture replay completed ${state}`,
	}));

	const hasCurrentReview = reached(source, "DIRECTION_LOCK") && !["FINAL_VALIDITY_AUDIT"].includes(source);
	const auditPath = epochTwo ? "review_artifacts/epoch-2.json" : "independent_audit.json";
	let independentAudit: JsonObject = {};
	if (hasCurrentReview) {
		independentAudit = await readJson(path.join(root, auditPath));
		if (epochTwo) {
			independentAudit.reviewer_agent_id = "fixture-reviewer-epoch-2";
			independentAudit.reviewer_thread_id = "fixture-review-thread-epoch-2";
			independentAudit.audited_at = new Date(Date.now() - 30_000).toISOString();
			await writeJson(path.join(root, auditPath), independentAudit);
		}
		artifacts.independent_audit = auditPath;
	}
	const state: JsonObject = {
		schema_version: "3.0",
		workflow_id: `agent-node-${source.toLowerCase().replaceAll("_", "-")}`,
		updated_at: new Date().toISOString(),
		current_year: 2026,
		recent_window: gates.recent_frontier_complete ? {
			start_year: 2024, end_year: 2026, status: "COMPLETE", snapshot_mode: "NEW_SEARCH",
		} : {
			start_year: 2024, end_year: 2026, status: "INCOMPLETE", snapshot_mode: "NOT_SET",
		},
		output_type: "JOURNAL_ARTICLE",
		contribution_contract: "ONE_MAIN_M",
		active_contribution: reached(source, "K_FULLTEXT") ? "M" : "NONE",
		active_state: source,
		resume_state: source,
		next_required_action: `Complete ${source} and advance exactly once to ${target}.`,
		search_mode: "SEARCH_OPEN",
		compute_stage: reached(source, "POSTCOMPUTE_CLAIM_FREEZE") ? "S4" : source === "COMPUTE" ? "S0" : "NOT_STARTED",
		collision_round: 1,
		blocked_reasons: [],
		novelty_level: afterN0 ? "N0-4C" : "N0-3",
		validity_level: validity,
		claim_profile: "MIXED",
		validation_epoch: epochTwo ? 2 : 1,
		claim_bundle_sha256: reached(source, "VALIDITY_AUDIT") ? (epochTwo ? epochTwoBundle : epochOneBundle) : "",
		independent_audit: independentAudit,
		gates,
		artifacts,
		decision_log,
	};
	if (hasCurrentReview) state.review_artifact_sha256 = await fileSha(root, auditPath);
	if (reached(source, "POSTCOMPUTE_CLAIM_FREEZE")) {
		state.compute_evidence = {
			status: "COMPLETED",
			validation_epoch: 1,
			artifact_path: "compute_evidence.json",
			artifact_sha256: await fileSha(root, "compute_evidence.json"),
		};
	}
	return state;
}

async function main(): Promise<void> {
	const outputRoot = path.resolve(process.argv[2] ?? "/tmp/iph-agent-node-fixtures");
	assert(outputRoot.startsWith("/tmp/") || outputRoot.includes("agent-node-fixtures"), "refusing broad fixture output path");
	const skillDir = resolveSkillDir();
	assert(skillDir, "authoritative IPH skill checkout not found");
	const sourceFixture = path.join(skillDir, "tests", "fixtures", "minimal-valid-v3");
	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(outputRoot, { recursive: true });
	const template = path.join(outputRoot, ".template");
	await cp(sourceFixture, template, { recursive: true });
	await rm(path.join(template, ".workflow_stop.lock"), { force: true });
	const epochOneBundle = await repairEpochOneFixture(template);
	const epochTwoBundle = await createEpochTwo(template);

	const results: JsonObject[] = [];
	for (const source of POSITIVE_STATE_SEQUENCE.slice(0, -1)) {
		const caseRoot = path.join(outputRoot, source.toLowerCase());
		await cp(template, caseRoot, { recursive: true });
		await applyLayeredEvidence(caseRoot, source);
		await writeJson(path.join(caseRoot, "workflow_state.json"), await stateFor(caseRoot, source, epochOneBundle, epochTwoBundle));
		const lifecycle = lifecycleForSource(source);
		assert(validateLifecycleState(lifecycle, lifecycle.active_stage).length === 0, `invalid lifecycle fixture: ${source}`);
		await writeJson(path.join(caseRoot, "lifecycle_state.json"), lifecycle);
		const child = Bun.spawn([
			"python3",
			path.join(skillDir, "scripts", "validate_all.py"),
			"--root", caseRoot,
			"--state", path.join(caseRoot, "workflow_state.json"),
			"--current-year", "2026",
			"--strict-new-checks",
		], { cwd: caseRoot, stdout: "pipe", stderr: "pipe", env: { ...process.env, IPH_NO_LOCK: "1" } });
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		results.push({ source, target: POSITIVE_STATE_SEQUENCE[POSITIVE_STATE_SEQUENCE.indexOf(source) + 1], exitCode, caseRoot });
		if (exitCode !== 0) {
			await writeFile(path.join(caseRoot, "fixture-validation.log"), `${stdout}\n${stderr}`);
			process.stderr.write(`FIXTURE_INVALID ${source} exit=${exitCode} log=${path.join(caseRoot, "fixture-validation.log")}\n`);
		}
	}
	await rm(template, { recursive: true, force: true });
	await writeJson(path.join(outputRoot, "matrix.json"), { generatedAt: new Date().toISOString(), results });
	const invalid = results.filter(result => result.exitCode !== 0);
	process.stdout.write(`fixture_matrix=${invalid.length === 0 ? "READY" : "INVALID"} cases=${results.length} invalid=${invalid.length} root=${outputRoot}\n`);
	if (invalid.length > 0) process.exitCode = 1;
}

await main();
