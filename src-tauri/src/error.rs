use serde::Serialize;
use serde_json::Value;
use std::fmt::{Display, Formatter};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn not_configured() -> Self {
        Self::new("AI_NOT_CONFIGURED", "AI 服务尚未配置，请联系管理员。")
    }

    pub fn invalid_provider_response() -> Self {
        Self::new(
            "AI_PROVIDER_INVALID_RESPONSE",
            "AI 服务返回了无法识别的内容，请重试。",
        )
    }

    pub fn provider_unavailable() -> Self {
        Self::new("AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。")
    }
}

impl Display for CommandError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.code)
    }
}

impl std::error::Error for CommandError {}
