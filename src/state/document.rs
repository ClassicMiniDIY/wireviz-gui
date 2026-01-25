use crate::wireviz::{Harness, ValidationError};
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct Document {
    pub id: usize,
    pub path: Option<PathBuf>,
    pub yaml_content: String,
    pub preview_svg: Option<String>,
    pub bom_data: Option<String>,
    pub dirty: bool,
    pub last_error: Option<String>,
    pub parsed_harness: Option<Harness>,
    pub validation_errors: Vec<ValidationError>,
    pub last_validation: Option<Instant>,
    pub needs_validation: bool,
}

impl Document {
    pub fn new(id: usize) -> Self {
        Self {
            id,
            path: None,
            yaml_content: String::new(),
            preview_svg: None,
            bom_data: None,
            dirty: false,
            last_error: None,
            parsed_harness: None,
            validation_errors: Vec::new(),
            last_validation: None,
            needs_validation: true,
        }
    }

    pub fn from_file(id: usize, path: PathBuf, content: String) -> Self {
        let mut doc = Self {
            id,
            path: Some(path),
            yaml_content: content,
            preview_svg: None,
            bom_data: None,
            dirty: false,
            last_error: None,
            parsed_harness: None,
            validation_errors: Vec::new(),
            last_validation: None,
            needs_validation: true,
        };
        doc.validate();
        doc
    }

    pub fn get_title(&self) -> String {
        if let Some(path) = &self.path {
            path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("untitled")
                .to_string()
        } else {
            "untitled".to_string()
        }
    }

    pub fn get_display_title(&self) -> String {
        let mut title = self.get_title();
        if self.dirty {
            title.push('*');
        }
        title
    }

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
        self.needs_validation = true;
    }

    pub fn mark_clean(&mut self) {
        self.dirty = false;
    }

    /// Validate YAML and update validation errors
    pub fn validate(&mut self) {
        self.validation_errors.clear();

        // Try to parse as YAML
        match serde_yaml::from_str::<Harness>(&self.yaml_content) {
            Ok(harness) => {
                // Successfully parsed
                self.parsed_harness = Some(harness.clone());
                self.last_error = None;

                // Run WireViz-specific validation
                let errors = harness.validate();
                self.validation_errors = errors;
            }
            Err(e) => {
                // YAML parse error
                self.parsed_harness = None;
                self.last_error = Some(format!("YAML error: {}", e));

                // Try to extract line/column from error
                let (line, column) = if let Some(loc) = e.location() {
                    (Some(loc.line()), Some(loc.column()))
                } else {
                    (None, None)
                };

                self.validation_errors.push(ValidationError {
                    line,
                    column,
                    message: format!("YAML syntax error: {}", e),
                    severity: crate::wireviz::ErrorSeverity::Error,
                });
            }
        }

        self.last_validation = Some(Instant::now());
        self.needs_validation = false;
    }

    /// Check if validation should run (debounced)
    pub fn should_validate(&self) -> bool {
        if !self.needs_validation {
            return false;
        }

        // Debounce: only validate if it's been 500ms since last validation
        if let Some(last) = self.last_validation {
            last.elapsed().as_millis() > 500
        } else {
            true
        }
    }

    /// Get error count
    pub fn error_count(&self) -> usize {
        self.validation_errors
            .iter()
            .filter(|e| matches!(e.severity, crate::wireviz::ErrorSeverity::Error))
            .count()
    }

    /// Get warning count
    pub fn warning_count(&self) -> usize {
        self.validation_errors
            .iter()
            .filter(|e| matches!(e.severity, crate::wireviz::ErrorSeverity::Warning))
            .count()
    }
}
