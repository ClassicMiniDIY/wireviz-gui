# WireViz GUI

A cross-platform desktop GUI application for [WireViz](https://github.com/wireviz/WireViz) - the cable and wiring harness documentation tool.

## Features

### Phase 1 (MVP) - ✅ Complete

- ✅ YAML text editor with code highlighting
- ✅ Real-time diagram preview
- ✅ File operations (New, Open, Save, Save As)
- ✅ Multi-document support with tabs
- ✅ Status bar with file status
- ✅ SVG preview generation via WireViz CLI

### Phase 2 (Python Bundling) - ✅ Complete

- ✅ Automatic Python virtual environment creation during build
- ✅ WireViz bundled with release builds
- ✅ Smart Python detection (bundled → system fallback)
- ✅ macOS .app bundle generation

### Phase 3 (Enhanced Editing) - ✅ Complete

- ✅ Real-time YAML validation (debounced 500ms)
- ✅ WireViz-specific semantic validation
- ✅ Error/warning display panel with line numbers
- ✅ Settings persistence across sessions
- ✅ Recent files menu (last 10 files)
- ✅ Enhanced status bar with error counts

### Phase 4 (BOM & Export) - ✅ Complete

- ✅ BOM table viewer with sortable columns
- ✅ Copy BOM to clipboard (TSV format)
- ✅ Export dialog with multi-format selection
- ✅ Quick export menu (SVG, PNG, BOM)
- ✅ Enhanced WireVizRunner supporting all output formats
- ✅ Toggle BOM panel via View menu
- 🚧 Image rendering in preview (shows SVG as text for now)

## Prerequisites

### For Building from Source

- **Rust**: Install from [rustup.rs](https://rustup.rs/)
- **Python 3.8+**: Required for creating bundled venv (macOS: `brew install python3`)
- **GraphViz**: Required by WireViz
  - macOS: `brew install graphviz`
  - Linux: `sudo apt install graphviz`
  - Windows: Download from [graphviz.org](https://graphviz.org/download/)

### For Running Pre-built .app (macOS)

- **GraphViz only**: `brew install graphviz`
- Python and WireViz are bundled automatically!

## Installation

### Quick Setup (Recommended)

Run the setup script to install dependencies:

```bash
git clone https://github.com/wireviz/wireviz-gui
cd wireviz-gui
./setup.sh
```

### Manual Build

```bash
git clone https://github.com/wireviz/wireviz-gui
cd wireviz-gui

# Development build (fast, requires system WireViz)
cargo build

# Release build (slower, bundles Python + WireViz automatically)
cargo build --release

# Create macOS .app bundle
cargo bundle --release
```

## Usage

### Run from source (development)

```bash
cargo run
```

Note: Development builds require WireViz installed: `pip install wireviz`

### Run the compiled binary

```bash
./target/release/wireviz-gui
```

### Run the macOS .app bundle

```bash
# Option 1: Double-click in Finder
open "target/release/bundle/osx/WireViz GUI.app"

# Option 2: From terminal
./target/release/bundle/osx/WireViz\ GUI.app/Contents/MacOS/wireviz-gui
```

### Workflow

1. **File > New** - Create a new harness
2. Edit YAML in the left panel
3. **View > Refresh Preview** - Generate diagram and BOM
4. **View > Show BOM Panel** - View bill of materials
5. **Export > Export SVG...** - Quick export (or use Export Outputs for multiple formats)
6. **File > Save** - Save your work

## How Python Bundling Works

### Development Builds (`cargo build`)

- **Fast**: No Python bundling
- **Requires**: System WireViz (`pip install wireviz`)
- **Use case**: Rapid iteration during development

### Release Builds (`cargo build --release`)

- **Automatic**: Creates Python venv in `target/release/bundle/python/`
- **Self-contained**: Installs WireViz + dependencies into venv
- **Smart detection**: Uses bundled Python, falls back to system if missing
- **Portable**: Can be distributed with the app

### App Bundles (`cargo bundle --release`)

- **macOS**: Creates `.app` bundle with embedded Python
- **Relocatable**: Can be moved anywhere or distributed
- **User-friendly**: Double-click to run, no setup required

## Project Structure

```
wireviz-gui/
├── src/
│   ├── main.rs              # Application entry point
│   ├── app.rs               # Main app state and logic
│   ├── state/               # Document and workspace management
│   ├── ui/                  # UI components (editor, preview, toolbar, status bar)
│   ├── wireviz/             # WireViz CLI integration
│   └── utils/               # Utilities (SVG renderer, etc.)
├── Cargo.toml               # Rust dependencies
└── README.md                # This file
```

## Development

### Build for development:
```bash
cargo build
```

### Run with logging:
```bash
RUST_LOG=debug cargo run
```

### Format code:
```bash
cargo fmt
```

### Run linter:
```bash
cargo clippy
```

## Roadmap

### Phase 1: MVP - ✅ Complete

- [x] Basic UI with YAML editor
- [x] WireViz CLI integration
- [x] File operations
- [x] SVG preview (text-based)

### Phase 2: Python Bundling - ✅ Complete

- [x] Bundle Python runtime
- [x] Bundle WireViz package
- [x] Platform-specific installers (macOS .app)

### Phase 3: Enhanced Editing - ✅ Complete

- [x] Syntax validation
- [x] Error highlighting
- [x] Recent files menu
- [x] Settings persistence

### Phase 4: BOM & Export - ✅ Complete

- [x] BOM table viewer
- [x] Export dialog (multiple formats)
- [x] Copy BOM to clipboard
- [x] Quick export menu

### Phase 5: Visual Enhancements (Next)

- [ ] Zoom/pan controls
- [ ] Click-to-highlight
- [ ] Dark mode toggle
- [ ] Keyboard shortcuts
- [ ] Image rendering in preview

### Phase 6: Advanced Features (Future)

- [ ] Visual forms for editing
- [ ] Template library
- [ ] Drag-and-drop connection editor

## License

GPL-3.0 (same as WireViz)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Credits

- Built with [egui](https://github.com/emilk/egui) - immediate mode GUI framework
- Powered by [WireViz](https://github.com/wireviz/WireViz) - the amazing cable documentation tool
