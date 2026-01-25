use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const MAX_RECENT_FILES: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub recent_files: Vec<PathBuf>,

    #[serde(default)]
    pub window_width: Option<f32>,

    #[serde(default)]
    pub window_height: Option<f32>,

    #[serde(default = "default_auto_validate")]
    pub auto_validate: bool,

    #[serde(default = "default_validation_debounce")]
    pub validation_debounce_ms: u64,
}

fn default_auto_validate() -> bool {
    true
}

fn default_validation_debounce() -> u64 {
    500
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            recent_files: Vec::new(),
            window_width: None,
            window_height: None,
            auto_validate: true,
            validation_debounce_ms: 500,
        }
    }
}

impl AppSettings {
    /// Load settings from disk
    pub fn load() -> Self {
        let config_dir = match dirs::config_dir() {
            Some(dir) => dir.join("wireviz-gui"),
            None => return Self::default(),
        };

        let settings_path = config_dir.join("settings.json");

        if let Ok(contents) = std::fs::read_to_string(&settings_path) {
            serde_json::from_str(&contents).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    /// Save settings to disk
    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let config_dir = dirs::config_dir()
            .ok_or("Could not find config directory")?
            .join("wireviz-gui");

        std::fs::create_dir_all(&config_dir)?;

        let settings_path = config_dir.join("settings.json");
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(settings_path, json)?;

        Ok(())
    }

    /// Add a file to recent files list
    pub fn add_recent_file(&mut self, path: PathBuf) {
        // Remove if already exists
        self.recent_files.retain(|p| p != &path);

        // Add to front
        self.recent_files.insert(0, path);

        // Limit size
        self.recent_files.truncate(MAX_RECENT_FILES);
    }

    /// Remove a file from recent files
    pub fn remove_recent_file(&mut self, path: &PathBuf) {
        self.recent_files.retain(|p| p != path);
    }

    /// Clear all recent files
    pub fn clear_recent_files(&mut self) {
        self.recent_files.clear();
    }
}
