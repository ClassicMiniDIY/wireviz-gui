use anyhow::Result;
use std::path::PathBuf;
use std::process::Command;

#[derive(Clone)]
pub struct WireVizRunner {
    python_path: Option<PathBuf>,
    wireviz_path: Option<PathBuf>,
    use_bundled: bool,
}

impl Default for WireVizRunner {
    fn default() -> Self {
        Self {
            python_path: None,
            wireviz_path: None,
            use_bundled: false,
        }
    }
}

impl WireVizRunner {
    pub fn new() -> Result<Self> {
        // Try to find bundled Python first
        if let Some((python, wireviz)) = Self::find_bundled_python() {
            eprintln!("Using bundled Python and WireViz");
            return Ok(Self {
                python_path: Some(python),
                wireviz_path: Some(wireviz),
                use_bundled: true,
            });
        }

        // Fall back to system wireviz
        let wireviz_path = which::which("wireviz").ok();

        if wireviz_path.is_none() {
            eprintln!("Warning: wireviz command not found in PATH");
            eprintln!("Please install WireViz: pip install wireviz");
        } else {
            eprintln!("Using system WireViz");
        }

        Ok(Self {
            python_path: None,
            wireviz_path,
            use_bundled: false,
        })
    }

    fn find_bundled_python() -> Option<(PathBuf, PathBuf)> {
        // Get executable directory
        let exe_path = std::env::current_exe().ok()?;
        let exe_dir = exe_path.parent()?;

        // Look for bundled Python in various locations
        let possible_locations = vec![
            // Development build
            exe_dir.join("../../../bundle/python"),
            // Release build
            exe_dir.join("../../bundle/python"),
            // macOS .app bundle
            exe_dir.join("../Resources/python"),
        ];

        for python_dir in possible_locations {
            let python_bin = python_dir.join("bin/python3");
            let wireviz_bin = python_dir.join("bin/wireviz");

            if python_bin.exists() && wireviz_bin.exists() {
                eprintln!("Found bundled Python at: {:?}", python_dir);
                return Some((python_bin, wireviz_bin));
            }
        }

        None
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

        // Build command based on whether we're using bundled or system Python
        let mut cmd = if self.use_bundled {
            // Use bundled Python to run wireviz module
            let mut c = Command::new(self.python_path.as_ref().unwrap());
            c.arg("-m")
             .arg("wireviz");
            c
        } else {
            // Use system wireviz command
            Command::new(self.wireviz_path.as_ref().unwrap())
        };

        // Add wireviz arguments
        let output = cmd
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
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(anyhow::anyhow!(
                "WireViz error:\nStderr: {}\nStdout: {}",
                stderr,
                stdout
            ));
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

    /// Generate multiple output formats at once
    pub fn generate_outputs(
        &self,
        yaml_content: &str,
        formats: &[OutputFormat],
        output_dir: Option<&std::path::Path>,
        output_name: Option<&str>,
    ) -> Result<GenerationOutputs> {
        if self.wireviz_path.is_none() {
            return Err(anyhow::anyhow!(
                "WireViz not found. Please install it with: pip install wireviz"
            ));
        }

        // Create temp or use specified output directory
        let temp_dir = std::env::temp_dir().join("wireviz-gui");
        std::fs::create_dir_all(&temp_dir)?;

        let work_dir = output_dir.unwrap_or(&temp_dir);
        let name = output_name.unwrap_or("output");

        // Write YAML to temp file
        let temp_yaml = temp_dir.join("temp.yml");
        std::fs::write(&temp_yaml, yaml_content)?;

        // Build format string (e.g., "spht" for svg, png, html, tsv)
        let format_str: String = formats.iter().map(|f| f.to_char()).collect();

        // Build command
        let mut cmd = if self.use_bundled {
            let mut c = Command::new(self.python_path.as_ref().unwrap());
            c.arg("-m").arg("wireviz");
            c
        } else {
            Command::new(self.wireviz_path.as_ref().unwrap())
        };

        // Add wireviz arguments
        let output = cmd
            .arg(&temp_yaml)
            .arg("-f")
            .arg(&format_str)
            .arg("-o")
            .arg(work_dir)
            .arg("-O")
            .arg(name)
            .output()?;

        // Check if command succeeded
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(anyhow::anyhow!(
                "WireViz error:\nStderr: {}\nStdout: {}",
                stderr,
                stdout
            ));
        }

        // Read generated files
        let mut outputs = GenerationOutputs::default();

        for format in formats {
            match format {
                OutputFormat::Svg => {
                    let path = work_dir.join(format!("{}.svg", name));
                    if path.exists() {
                        outputs.svg = Some(std::fs::read_to_string(path)?);
                    }
                }
                OutputFormat::Png => {
                    let path = work_dir.join(format!("{}.png", name));
                    if path.exists() {
                        outputs.png_path = Some(path);
                    }
                }
                OutputFormat::Html => {
                    let path = work_dir.join(format!("{}.html", name));
                    if path.exists() {
                        outputs.html = Some(std::fs::read_to_string(path)?);
                    }
                }
                OutputFormat::Tsv => {
                    let path = work_dir.join(format!("{}.bom.tsv", name));
                    if path.exists() {
                        outputs.bom_tsv = Some(std::fs::read_to_string(path)?);
                    }
                }
                OutputFormat::Csv => {
                    let path = work_dir.join(format!("{}.bom.csv", name));
                    if path.exists() {
                        outputs.bom_csv = Some(std::fs::read_to_string(path)?);
                    }
                }
                OutputFormat::Gv => {
                    let path = work_dir.join(format!("{}.gv", name));
                    if path.exists() {
                        outputs.gv = Some(std::fs::read_to_string(path)?);
                    }
                }
                OutputFormat::Pdf => {
                    let path = work_dir.join(format!("{}.pdf", name));
                    if path.exists() {
                        outputs.pdf_path = Some(path);
                    }
                }
            }
        }

        Ok(outputs)
    }
}

/// Output format options
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Svg,
    Png,
    Html,
    Tsv,
    Csv,
    Gv,
    Pdf,
}

impl OutputFormat {
    fn to_char(&self) -> char {
        match self {
            OutputFormat::Svg => 's',
            OutputFormat::Png => 'p',
            OutputFormat::Html => 'h',
            OutputFormat::Tsv => 't',
            OutputFormat::Csv => 'c',
            OutputFormat::Gv => 'g',
            OutputFormat::Pdf => 'P',
        }
    }

    pub fn extension(&self) -> &str {
        match self {
            OutputFormat::Svg => "svg",
            OutputFormat::Png => "png",
            OutputFormat::Html => "html",
            OutputFormat::Tsv => "bom.tsv",
            OutputFormat::Csv => "bom.csv",
            OutputFormat::Gv => "gv",
            OutputFormat::Pdf => "pdf",
        }
    }

    pub fn display_name(&self) -> &str {
        match self {
            OutputFormat::Svg => "SVG",
            OutputFormat::Png => "PNG",
            OutputFormat::Html => "HTML",
            OutputFormat::Tsv => "BOM (TSV)",
            OutputFormat::Csv => "BOM (CSV)",
            OutputFormat::Gv => "GraphViz",
            OutputFormat::Pdf => "PDF",
        }
    }
}

/// Generated outputs from WireViz
#[derive(Debug, Default)]
pub struct GenerationOutputs {
    pub svg: Option<String>,
    pub png_path: Option<PathBuf>,
    pub html: Option<String>,
    pub bom_tsv: Option<String>,
    pub bom_csv: Option<String>,
    pub gv: Option<String>,
    pub pdf_path: Option<PathBuf>,
}
