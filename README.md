# WireViz GUI

A cross-platform desktop GUI application for [WireViz](https://github.com/wireviz/WireViz) - the cable and wiring harness documentation tool.

## Features (MVP - Phase 1)

- ✅ YAML text editor with code highlighting
- ✅ Real-time diagram preview
- ✅ File operations (New, Open, Save, Save As)
- ✅ Multi-document support with tabs
- ✅ Status bar with file status
- ✅ SVG preview generation via WireViz CLI
- 🚧 Image rendering (currently shows SVG as text)

## Prerequisites

- **Rust**: Install from [rustup.rs](https://rustup.rs/)
- **WireViz**: Install via pip:
  ```bash
  pip install wireviz
  ```
- **GraphViz**: Required by WireViz
  - macOS: `brew install graphviz`
  - Linux: `sudo apt install graphviz`
  - Windows: Download from [graphviz.org](https://graphviz.org/download/)

## Installation

```bash
git clone https://github.com/wireviz/wireviz-gui
cd wireviz-gui
cargo build --release
```

## Usage

### Run from source:
```bash
cargo run
```

### Run the compiled binary:
```bash
./target/release/wireviz-gui
```

### Workflow:
1. **File > New** - Create a new harness
2. Edit YAML in the left panel
3. **View > Refresh Preview** - Generate diagram
4. **File > Save** - Save your work

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

### Phase 1: MVP (Current)
- [x] Basic UI with YAML editor
- [x] WireViz CLI integration
- [x] File operations
- [x] SVG preview (text-based)

### Phase 2: Python Bundling
- [ ] Bundle Python runtime
- [ ] Bundle WireViz package
- [ ] Platform-specific installers

### Phase 3: Enhanced Editing
- [ ] Syntax validation
- [ ] Error highlighting
- [ ] Auto-completion
- [ ] Find/replace

### Phase 4: BOM & Export
- [ ] BOM table viewer
- [ ] Export dialog (multiple formats)
- [ ] Image rendering in preview

### Phase 5: Visual Enhancements
- [ ] Zoom/pan controls
- [ ] Click-to-highlight
- [ ] Dark mode toggle
- [ ] Keyboard shortcuts

### Phase 6: Advanced Features
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
