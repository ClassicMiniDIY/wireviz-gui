use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let out_dir = env::var("OUT_DIR").unwrap();
    let profile = env::var("PROFILE").unwrap();

    println!("cargo:warning=Building for target OS: {}", target_os);
    println!("cargo:warning=Build profile: {}", profile);

    // Only bundle Python for release builds to speed up development
    if profile == "release" {
        match target_os.as_str() {
            "macos" => bundle_macos(&out_dir),
            "linux" => bundle_linux(&out_dir),
            "windows" => bundle_windows(&out_dir),
            _ => println!("cargo:warning=Unsupported platform for bundling: {}", target_os),
        }
    } else {
        println!("cargo:warning=Skipping Python bundling for debug build");
        println!("cargo:warning=Install WireViz manually: pip install wireviz");
    }
}

fn bundle_macos(out_dir: &str) {
    println!("cargo:warning=Starting macOS Python bundling...");

    let bundle_dir = Path::new(out_dir).join("../../..").join("bundle");
    fs::create_dir_all(&bundle_dir).ok();

    // Check if we already have a bundled Python
    let python_dir = bundle_dir.join("python");
    if python_dir.exists() {
        println!("cargo:warning=Bundled Python already exists, skipping download");
        install_wireviz_macos(&python_dir);
        return;
    }

    println!("cargo:warning=Bundled Python not found, attempting to create standalone environment...");

    // Strategy: Use system Python to create a relocatable venv
    create_relocatable_venv(&bundle_dir);
}

fn create_relocatable_venv(bundle_dir: &Path) {
    let python_dir = bundle_dir.join("python");

    // Find system Python 3
    let python_cmd = find_system_python();

    if python_cmd.is_none() {
        println!("cargo:warning=Could not find Python 3. Please install Python 3.8+");
        println!("cargo:warning=Visit https://www.python.org/downloads/");
        return;
    }

    let python = python_cmd.unwrap();
    println!("cargo:warning=Using Python: {}", python);

    // Create virtual environment
    println!("cargo:warning=Creating virtual environment...");
    let status = Command::new(&python)
        .args(["-m", "venv", python_dir.to_str().unwrap()])
        .status();

    if status.is_err() || !status.unwrap().success() {
        println!("cargo:warning=Failed to create virtual environment");
        return;
    }

    // Install WireViz into the venv
    install_wireviz_macos(&python_dir);

    println!("cargo:warning=Python bundling complete!");
}

fn find_system_python() -> Option<String> {
    // Try common Python 3 commands
    for cmd in &["python3.11", "python3.10", "python3.9", "python3.8", "python3", "python"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout);
                if version.contains("Python 3") {
                    println!("cargo:warning=Found {}: {}", cmd, version.trim());
                    return Some(cmd.to_string());
                }
            }
        }
    }
    None
}

fn install_wireviz_macos(python_dir: &Path) {
    let pip = python_dir.join("bin/pip");

    if !pip.exists() {
        println!("cargo:warning=pip not found at {:?}", pip);
        return;
    }

    println!("cargo:warning=Installing WireViz...");
    let status = Command::new(&pip)
        .args(["install", "--upgrade", "wireviz"])
        .status();

    if let Ok(status) = status {
        if status.success() {
            println!("cargo:warning=WireViz installed successfully!");
        } else {
            println!("cargo:warning=Failed to install WireViz");
        }
    } else {
        println!("cargo:warning=Failed to run pip");
    }

    // Also install GraphViz Python package (helps with path detection)
    println!("cargo:warning=Installing graphviz package...");
    Command::new(&pip)
        .args(["install", "--upgrade", "graphviz"])
        .status()
        .ok();
}

fn bundle_linux(_out_dir: &str) {
    println!("cargo:warning=Linux bundling not yet implemented");
    println!("cargo:warning=Install WireViz manually: pip install wireviz");
}

fn bundle_windows(_out_dir: &str) {
    println!("cargo:warning=Windows bundling not yet implemented");
    println!("cargo:warning=Install WireViz manually: pip install wireviz");
}
