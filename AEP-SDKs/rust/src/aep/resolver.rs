//! Stateless routing of proposals to validator pipelines.
//! @PAD: aep-sdk-resolver
//! @GCDE: gaplune.code.v1

#[derive(Debug, Clone)]
pub struct ResolveRequest {
    pub proposal_type: String,
    pub action: String,
}

#[derive(Debug, Clone)]
pub struct ResolveResult {
    pub pipeline: String,
    pub accepted: bool,
    pub reason: String,
}

pub struct BasicResolver;

impl BasicResolver {
    pub fn resolve(req: &ResolveRequest) -> ResolveResult {
        let pipeline = match req.proposal_type.as_str() {
            "workflow_step" => "workflow",
            "api_call" => "rest-api",
            "event" => "events",
            "iac" => "iac",
            "ui_mutation" => "ui",
            _ => "unknown",
        };
        if pipeline == "unknown" {
            return ResolveResult {
                pipeline: pipeline.into(),
                accepted: false,
                reason: format!("unknown proposal_type {}", req.proposal_type),
            };
        }
        ResolveResult {
            pipeline: pipeline.into(),
            accepted: true,
            reason: format!("routed {}/{}", req.proposal_type, req.action),
        }
    }
}
