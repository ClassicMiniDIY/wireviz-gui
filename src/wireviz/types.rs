use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Main WireViz harness structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Harness {
    #[serde(default)]
    pub metadata: HashMap<String, String>,

    #[serde(default)]
    pub options: Options,

    #[serde(default)]
    pub connectors: HashMap<String, Connector>,

    #[serde(default)]
    pub cables: HashMap<String, Cable>,

    #[serde(default)]
    pub connections: Vec<Connection>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub additional_bom_items: Vec<BomItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Options {
    #[serde(default)]
    pub fontname: Option<String>,

    #[serde(default)]
    pub bgcolor: Option<String>,

    #[serde(default)]
    pub bgcolor_node: Option<String>,

    #[serde(default)]
    pub bgcolor_connector: Option<String>,

    #[serde(default)]
    pub bgcolor_cable: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connector {
    #[serde(rename = "type")]
    pub connector_type: Option<String>,

    #[serde(default)]
    pub subtype: Option<String>,

    #[serde(default)]
    pub pincount: Option<usize>,

    #[serde(default)]
    pub pins: Vec<PinDefinition>,

    #[serde(default)]
    pub pinlabels: Vec<String>,

    #[serde(default)]
    pub pincolors: Vec<String>,

    #[serde(default)]
    pub manufacturer: Option<String>,

    #[serde(default)]
    pub mpn: Option<String>,

    #[serde(default)]
    pub pn: Option<String>,

    #[serde(default)]
    pub supplier: Option<String>,

    #[serde(default)]
    pub spn: Option<String>,

    #[serde(default)]
    pub style: Option<String>,

    #[serde(default)]
    pub notes: Option<String>,

    #[serde(default)]
    pub image: Option<ImageSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cable {
    #[serde(rename = "type")]
    pub cable_type: Option<String>,

    #[serde(default)]
    pub gauge: Option<f32>,

    #[serde(default)]
    pub gauge_unit: Option<String>,

    #[serde(default)]
    pub wirecount: Option<usize>,

    #[serde(default)]
    pub colors: Vec<String>,

    #[serde(default)]
    pub color_code: Option<String>,

    #[serde(default)]
    pub wirelabels: Vec<String>,

    #[serde(default)]
    pub length: f32,

    #[serde(default)]
    pub length_unit: Option<String>,

    #[serde(default)]
    pub shield: bool,

    #[serde(default)]
    pub manufacturer: Option<String>,

    #[serde(default)]
    pub mpn: Option<String>,

    #[serde(default)]
    pub pn: Option<String>,

    #[serde(default)]
    pub show_equiv: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PinDefinition {
    Single(usize),
    Range(usize, usize),
    List(Vec<usize>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Connection {
    Simple(Vec<ConnectionPoint>),
    Complex {
        #[serde(flatten)]
        points: HashMap<String, ConnectionPoint>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConnectionPoint {
    Single(String),
    WithPins {
        #[serde(flatten)]
        connector: HashMap<String, PinSpec>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PinSpec {
    Single(usize),
    Range(Vec<usize>),
    Shield(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSpec {
    pub src: String,

    #[serde(default)]
    pub width: Option<u32>,

    #[serde(default)]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BomItem {
    #[serde(rename = "type")]
    pub item_type: Option<String>,

    pub description: String,

    #[serde(default)]
    pub qty: f32,

    #[serde(default)]
    pub unit: Option<String>,

    #[serde(default)]
    pub manufacturer: Option<String>,

    #[serde(default)]
    pub mpn: Option<String>,
}

/// Validation error with location information
#[derive(Debug, Clone)]
pub struct ValidationError {
    pub line: Option<usize>,
    pub column: Option<usize>,
    pub message: String,
    pub severity: ErrorSeverity,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ErrorSeverity {
    Error,
    Warning,
    Info,
}

impl Harness {
    /// Validate the harness structure
    pub fn validate(&self) -> Vec<ValidationError> {
        let mut errors = Vec::new();

        // Validate connectors
        for (name, connector) in &self.connectors {
            if connector.connector_type.is_none() && connector.pincount.is_none() {
                errors.push(ValidationError {
                    line: None,
                    column: None,
                    message: format!("Connector '{}': either 'type' or 'pincount' must be specified", name),
                    severity: ErrorSeverity::Warning,
                });
            }
        }

        // Validate cables
        for (name, cable) in &self.cables {
            if cable.wirecount.is_none() && cable.colors.is_empty() && cable.color_code.is_none() {
                errors.push(ValidationError {
                    line: None,
                    column: None,
                    message: format!("Cable '{}': must specify wirecount, colors, or color_code", name),
                    severity: ErrorSeverity::Error,
                });
            }
        }

        // Validate connections reference valid connectors/cables
        for (idx, _conn) in self.connections.iter().enumerate() {
            // Basic validation - could be expanded
            errors.push(ValidationError {
                line: None,
                column: None,
                message: format!("Connection {}: validation not fully implemented", idx + 1),
                severity: ErrorSeverity::Info,
            });
        }

        errors
    }
}
