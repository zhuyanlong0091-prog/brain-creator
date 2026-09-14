export type PostconditionVerification = {
  status: "confirmed" | "not-confirmed" | "unavailable";
  actualResult?: string;
  evidenceRefs?: string[];
  reason?: string;
  checkedAt?: string;
};

export type PostconditionVerificationInput = {
  systemId: string;
  requirementSuiteRunId?: string;
  caseSuiteId?: string;
  executableCaseId?: string;
  caseNo?: string;
  actionKey: string;
  actionSemantic: string;
  entityReference?: string;
  postcondition: string;
};

export type ExecutionPostconditionVerifier = (
  input: PostconditionVerificationInput
) => Promise<PostconditionVerification>;
