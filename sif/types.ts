export const SCHEMA_VERSION = "1.0" as const;
export const SCORECARD_SCHEMA = "role-scorecard.v1" as const;

export const FAILURE_CLASSES = ["CONTRACT_FAIL", "EFFICIENCY_REGRESSION", "ELICITATION_REGRESSION"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const NEXT_ACTIONS = ["RUN_STEP", "REPAIR", "REPLAY", "CERTIFY", "DONE"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const OUTCOME_CLASSES = [
	"autonomous_verified_success",
	"assisted_verified_success",
	"unverified_success",
	"failed",
	"unsafe_invalid",
] as const;
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

export const LAYERS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;
export type Layer = (typeof LAYERS)[number];

export const ETCLOVG = [
	"Execution",
	"Tooling",
	"Context",
	"Lifecycle",
	"Observability",
	"Verification",
	"Governance",
] as const;
export type EtcLayer = (typeof ETCLOVG)[number];

export const DELTA_CLASSES = [
	"control-plane",
	"prompt",
	"validator",
	"install",
	"topology",
	"sif",
	"unknown",
] as const;
export type DeltaClass = (typeof DELTA_CLASSES)[number];

export interface IphLockIdentity {
	commit: string;
	filesSha: string;
}

export interface RepairSpec {
	operator: string;
	layer: EtcLayer;
	anchors: string[];
	regressionSet: string[];
	concern: string;
	evidence: string;
	suggestion: string;
}

export interface PlanStep {
	id: string;
	layer: Layer;
	backend: string;
	oracle: "outcome" | "process" | "both";
	nodes?: number[];
	failures?: string[];
	ablation?: boolean;
	realModels?: boolean;
	passK?: number;
}

export interface IterationState {
	schemaVersion: typeof SCHEMA_VERSION;
	scorecardSchema: typeof SCORECARD_SCHEMA;
	harnessHead: string;
	workingTreeDirty: boolean;
	iphLock: IphLockIdentity;
	delta: {
		files: string[];
		classes: DeltaClass[];
		signature: string;
		unknownFiles?: string[];
	};
	planId: string;
	plan: { steps: PlanStep[] };
	currentStepIndex: number;
	next_required_action: NextAction;
	outcomeClass: OutcomeClass | null;
	stop?: {
		failureClass: FailureClass;
		stepId: string;
		message: string;
		htirPath?: string | null;
		repairSpec: RepairSpec;
	} | null;
	scorecard?: RoleScorecard | null;
	runId?: string | null;
	executedKeys: string[];
	passK?: number;
	deferred?: Array<"L5" | "L6">;
}

export type AgentRole = "M3" | "frontier" | "layer" | "atomic" | "collision" | "review" | "event";

export interface RoleLoop {
	role: AgentRole;
	foundProblem: boolean;
	optimizedTask: boolean;
	finishedEfficiently: boolean;
}

export interface RoleScorecard {
	schema: typeof SCORECARD_SCHEMA;
	loops: RoleLoop[];
	invalidToolCalls: number;
	informationBudgetHeld: boolean;
	scaffoldThickness: number;
}

export type TraceEffect = "none" | "read" | "artifact" | "state" | "mixed" | "unknown";
export type TraceStatus = "success" | "failure" | "timeout" | "blocked" | "started" | "completed" | "message";

export interface TraceStep {
	id: number;
	sourceFile: string;
	role: string;
	status: TraceStatus;
	effect: TraceEffect;
	name?: string;
	isLifecycleCompleted: boolean;
	isMessageOnly: boolean;
	bridgedTool?: string;
	etcLayer: EtcLayer;
	anchor: string;
	model?: string;
	rawType?: string;
	targetState?: string;
	disposition?: string;
	specialistAgentId?: string;
	timestamp?: string;
	callId?: string;
	op?: string;
	intent?: string;
	detail?: string;
}

export interface TraceLink {
	sourceId: number;
	targetId: number;
	kind: "control" | "data";
	relation: "sequence" | "retry" | "delegate" | "validate" | "finalize" | "produces";
}

export interface Htir {
	schemaVersion: "1.0";
	researchRoot?: string;
	activeState?: string;
	steps: TraceStep[];
	links?: TraceLink[];
	pendingToolCalls?: Array<{
		toolName: string;
		callId?: string;
		intent?: string;
		op?: string;
		startedAt?: string;
	}>;
	sessionExits?: Array<{ reason?: string; at?: string; pendingCount: number }>;
}

export interface ImpactSurface {
	match: string;
	layers: Layer[];
	nodes: number[];
	failures: string[];
	ablation: boolean;
	classes: DeltaClass[];
	nodesRequired?: boolean;
}

export interface ImpactResult {
	layers: Layer[];
	nodes: number[];
	failures: string[];
	ablation: boolean;
	classes: DeltaClass[];
	nodesRequired: boolean;
	unknownFiles: string[];
}

export interface LedgerRecord {
	id: string;
	kind: "PASS" | "FAIL" | "REPLAY" | "REJECTED_EVOLUTION";
	at: string;
	harnessHead: string;
	iphLock: IphLockIdentity;
	reuseKey: string;
	step: { layer: Layer; node?: number | null; backend: string };
	failureClass?: FailureClass | null;
	firstFailId?: string | null;
	artifacts?: Record<string, { path: string; sha256: string }>;
	scorecard?: RoleScorecard | null;
	evolutionCandidate?: { operator: string; deleteScaffold?: boolean } | null;
	flawId?: string | null;
	isolatedTrials?: number | null;
}

export interface LedgerIndex {
	schemaVersion: "1.0";
	records: LedgerRecord[];
}
