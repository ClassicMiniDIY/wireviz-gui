use anyhow::Result;
use std::path::PathBuf;
use std::process::Command;

#[derive(Clone)]
pub struct WireVizRunner {
    wireviz_path: Option<PathBuf>,
}

impl Default for WireVizRunner {
    fn default() -> Self {
        Self { wireviz_path: None }
    }
}

impl WireVizRunner {
    pub fn new() -> Result<Self> {
        // Try to find wireviz in PATH
        let wireviz_path = which::which("wireviz").ok();

        if wireviz_path.is_none() {
            eprintln!("Warning: wireviz command not found in PATH");
            eprintln!("Please install WireViz: pip install wireviz");
        }

        Ok(Self { wireviz_path })
    }

    pub fn generate_svg(&self, yaml_content: &str) -> Result<String> {
        if self.wireviz_path.is_none() {
            return Err(anyhow::anyhow!(
                "WireViz not found. Please install it with: pip install wireviz"
            ));
        }

        // Create temp directory
        let temp_dir = std::env::temp_dir().join("wireviz-gui");
        std::fs::create_dir_all(&temp_dir)?;

        // Write YAML to temp file
        let temp_yaml = temp_dir.join("temp.yml");
        std::fs::write(&temp_yaml, yaml_content)?;

        // Run wireviz command
        let output = Command::new(self.wireviz_path.as_ref().unwrap())
            .arg(&temp_yaml)
            .arg("-f")
            .arg("s") // SVG only
            .arg("-o")
            .arg(&temp_dir)
            .arg("-O")
            .arg("output")
            .output()?;

        // Check if command succeeded
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("WireViz error: {}", stderr));
        }

        // Read generated SVG
        let svg_path = temp_dir.join("output.svg");
        if !svg_path.exists() {
            return Err(anyhow::anyhow!("SVG file not generated"));
        }

        let svg_content = std::fs::read_to_string(svg_path)?;
        Ok(svg_content)
    }

    pub fn is_available(&self) -> bool {
        self.wireviz_path.is_some()
    }
}
