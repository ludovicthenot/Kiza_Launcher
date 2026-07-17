use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    pub action_hint: Option<String>,
}

impl AppError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        recoverable: bool,
        action_hint: Option<impl Into<String>>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
            action_hint: action_hint.map(Into::into),
        }
    }

    pub fn auth(message: impl Into<String>, action_hint: impl Into<String>) -> Self {
        Self::new("auth_error", message, true, Some(action_hint))
    }

    pub fn config(message: impl Into<String>, action_hint: impl Into<String>) -> Self {
        Self::new("config_error", message, true, Some(action_hint))
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::new(
            "network_error",
            message,
            true,
            Some("Check the internet connection, then retry the validation."),
        )
    }

    pub fn external_api(
        code: impl Into<String>,
        message: impl Into<String>,
        recoverable: bool,
    ) -> Self {
        Self::new(
            code,
            message,
            recoverable,
            Some("Check the API key and try again."),
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self::new(
            "internal_error",
            value,
            true,
            Some("Try again or check the diagnostics."),
        )
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self::from(value.to_string())
    }
}
