use crate::state::{AppSettings, Workspace};
use crate::ui::{bom, editor, export_dialog, preview, status_bar, toolbar, validation_panel};
use crate::wireviz::{OutputFormat, WireVizRunner};
use std::sync::mpsc::{channel, Receiver, Sender};

pub struct WireVizApp {
    workspace: Workspace,
    wireviz_runner: WireVizRunner,
    settings: AppSettings,
    task_tx: Sender<TaskMessage>,
    task_rx: Receiver<TaskMessage>,
    show_about: bool,
    export_dialog: export_dialog::ExportDialog,
    show_bom_panel: bool,
}

#[derive(Debug)]
pub enum TaskMessage {
    PreviewReady(String, Option<String>), // SVG content, BOM TSV
    PreviewError(String),                  // Error message
    GenerationComplete,
}

impl WireVizApp {
    pub fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        let (task_tx, task_rx) = channel();

        Self {
            workspace: Workspace::new(),
            wireviz_runner: WireVizRunner::new().unwrap_or_else(|e| {
                eprintln!("Warning: WireViz not found: {}", e);
                WireVizRunner::default()
            }),
            settings: AppSettings::load(),
            task_tx,
            task_rx,
            show_about: false,
            export_dialog: export_dialog::ExportDialog::default(),
            show_bom_panel: false,
        }
    }

    fn handle_menu_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("menu_bar").show(ctx, |ui| {
            egui::menu::bar(ui, |ui| {
                ui.menu_button("File", |ui| {
                    if ui.button("New").clicked() {
                        self.workspace.new_document();
                        ui.close_menu();
                    }
                    if ui.button("Open...").clicked() {
                        self.open_file();
                        ui.close_menu();
                    }
                    if ui.button("Save").clicked() {
                        self.save_current_document();
                        ui.close_menu();
                    }
                    if ui.button("Save As...").clicked() {
                        self.save_current_document_as();
                        ui.close_menu();
                    }

                    // Recent files
                    if !self.settings.recent_files.is_empty() {
                        ui.separator();
                        ui.label("Recent Files:");

                        let recent_files = self.settings.recent_files.clone();
                        let mut file_to_open = None;

                        for (idx, path) in recent_files.iter().enumerate() {
                            if idx >= 10 {
                                break;
                            }

                            let filename = path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("Unknown");

                            if ui.button(filename).clicked() {
                                file_to_open = Some(path.clone());
                                ui.close_menu();
                            }
                        }

                        if let Some(path) = file_to_open {
                            if let Err(e) = self.workspace.open_document(path.clone()) {
                                eprintln!("Failed to open file: {}", e);
                                self.settings.remove_recent_file(&path);
                            } else {
                                self.refresh_preview();
                            }
                        }

                        if ui.button("Clear Recent Files").clicked() {
                            self.settings.clear_recent_files();
                            self.settings.save().ok();
                            ui.close_menu();
                        }
                    }

                    ui.separator();
                    if ui.button("Quit").clicked() {
                        self.settings.save().ok();
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                });

                ui.menu_button("Edit", |ui| {
                    if ui.button("Undo").clicked() {
                        ui.close_menu();
                    }
                    if ui.button("Redo").clicked() {
                        ui.close_menu();
                    }
                });

                ui.menu_button("View", |ui| {
                    if ui.button("Refresh Preview").clicked() {
                        self.refresh_preview();
                        ui.close_menu();
                    }

                    ui.separator();

                    let bom_label = if self.show_bom_panel {
                        "Hide BOM Panel"
                    } else {
                        "Show BOM Panel"
                    };

                    if ui.button(bom_label).clicked() {
                        self.show_bom_panel = !self.show_bom_panel;
                        ui.close_menu();
                    }
                });

                ui.menu_button("Export", |ui| {
                    if ui.button("Export Outputs...").clicked() {
                        self.export_dialog.open = true;
                        ui.close_menu();
                    }

                    ui.separator();

                    if ui.button("Export SVG...").clicked() {
                        self.quick_export(&[OutputFormat::Svg]);
                        ui.close_menu();
                    }

                    if ui.button("Export PNG...").clicked() {
                        self.quick_export(&[OutputFormat::Png]);
                        ui.close_menu();
                    }

                    if ui.button("Export BOM (TSV)...").clicked() {
                        self.quick_export(&[OutputFormat::Tsv]);
                        ui.close_menu();
                    }
                });

                ui.menu_button("Help", |ui| {
                    if ui.button("About").clicked() {
                        self.show_about = true;
                        ui.close_menu();
                    }
                });
            });
        });
    }

    fn open_file(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter("YAML", &["yml", "yaml"])
            .pick_file()
        {
            if let Err(e) = self.workspace.open_document(path) {
                eprintln!("Failed to open file: {}", e);
            } else {
                self.refresh_preview();
            }
        }
    }

    fn save_current_document(&mut self) {
        if let Err(e) = self.workspace.save_current_document() {
            eprintln!("Failed to save file: {}", e);
        }
    }

    fn save_current_document_as(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter("YAML", &["yml", "yaml"])
            .save_file()
        {
            if let Err(e) = self.workspace.save_current_document_as(path) {
                eprintln!("Failed to save file: {}", e);
            }
        }
    }

    fn quick_export(&mut self, formats: &[OutputFormat]) {
        if let Some(doc) = self.workspace.get_active_document() {
            if doc.yaml_content.is_empty() {
                return;
            }

            // Ask for output directory
            if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                let yaml_content = doc.yaml_content.clone();
                let runner = self.wireviz_runner.clone();
                let formats = formats.to_vec();
                let output_name = doc.get_title().replace(".yml", "").replace(".yaml", "");

                // Run export synchronously for quick exports
                match runner.generate_outputs(&yaml_content, &formats, Some(&dir), Some(&output_name)) {
                    Ok(_) => {
                        println!("Export successful to: {}", dir.display());
                    }
                    Err(e) => {
                        eprintln!("Export failed: {}", e);
                    }
                }
            }
        }
    }

    fn refresh_preview(&mut self) {
        if let Some(doc) = self.workspace.get_active_document() {
            let yaml_content = doc.yaml_content.clone();
            let tx = self.task_tx.clone();
            let runner = self.wireviz_runner.clone();

            // Spawn background task to generate preview and BOM
            std::thread::spawn(move || {
                match runner.generate_outputs(
                    &yaml_content,
                    &[OutputFormat::Svg, OutputFormat::Tsv],
                    None,
                    None,
                ) {
                    Ok(outputs) => {
                        tx.send(TaskMessage::PreviewReady(
                            outputs.svg.unwrap_or_default(),
                            outputs.bom_tsv,
                        ))
                        .ok();
                    }
                    Err(e) => {
                        tx.send(TaskMessage::PreviewError(e.to_string())).ok();
                    }
                }
            });
        }
    }

    fn check_background_tasks(&mut self) {
        while let Ok(msg) = self.task_rx.try_recv() {
            match msg {
                TaskMessage::PreviewReady(svg, bom) => {
                    if let Some(doc) = self.workspace.get_active_document_mut() {
                        doc.preview_svg = Some(svg);
                        doc.bom_data = bom;
                    }
                }
                TaskMessage::PreviewError(err) => {
                    if let Some(doc) = self.workspace.get_active_document_mut() {
                        doc.last_error = Some(err);
                    }
                }
                TaskMessage::GenerationComplete => {}
            }
        }
    }
}

impl eframe::App for WireVizApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Check for background task completions
        self.check_background_tasks();

        // Validate active document if needed (debounced)
        if let Some(doc) = self.workspace.get_active_document_mut() {
            if doc.should_validate() {
                doc.validate();
                ctx.request_repaint(); // Repaint to show validation results
            }
        }

        // Menu bar
        self.handle_menu_bar(ctx);

        // Toolbar
        toolbar::render(ctx, &mut self.workspace);

        // Main content area - split view
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 0.0;

                // Left panel - YAML Editor
                let available_width = ui.available_width();
                let editor_width = available_width * 0.5;

                ui.allocate_ui(egui::vec2(editor_width, ui.available_height()), |ui| {
                    egui::Frame::none()
                        .fill(ui.style().visuals.extreme_bg_color)
                        .show(ui, |ui| {
                            editor::render(ui, &mut self.workspace);
                        });
                });

                // Separator
                ui.separator();

                // Right panel - Preview
                ui.allocate_ui(egui::vec2(ui.available_width(), ui.available_height()), |ui| {
                    preview::render(ui, &self.workspace);
                });
            });
        });

        // Validation panel (show if there are errors/warnings)
        if let Some(doc) = self.workspace.get_active_document() {
            if !doc.validation_errors.is_empty() {
                egui::TopBottomPanel::bottom("validation_panel")
                    .min_height(100.0)
                    .max_height(200.0)
                    .resizable(true)
                    .show(ctx, |ui| {
                        validation_panel::render(ui, &self.workspace);
                    });
            }
        }

        // BOM panel (optional, toggled via View menu)
        if self.show_bom_panel {
            egui::TopBottomPanel::bottom("bom_panel")
                .min_height(150.0)
                .max_height(400.0)
                .resizable(true)
                .show(ctx, |ui| {
                    bom::render(ui, &self.workspace);
                });
        }

        // Status bar
        egui::TopBottomPanel::bottom("status_bar").show(ctx, |ui| {
            status_bar::render(ui, &self.workspace);
        });

        // Export dialog
        if let Some(action) = self.export_dialog.show(ctx) {
            match action {
                export_dialog::ExportAction::Export => {
                    // Start export
                    self.export_dialog.in_progress = true;
                    // TODO: Implement async export
                }
                export_dialog::ExportAction::Cancel => {
                    self.export_dialog.open = false;
                    self.export_dialog.reset();
                }
            }
        }

        // About dialog
        if self.show_about {
            egui::Window::new("About WireViz GUI")
                .collapsible(false)
                .resizable(false)
                .show(ctx, |ui| {
                    ui.label("WireViz GUI v0.1.0");
                    ui.label("A cross-platform desktop application for WireViz");
                    ui.separator();
                    ui.label("Built with Rust and egui");
                    ui.horizontal(|ui| {
                        if ui.button("Close").clicked() {
                            self.show_about = false;
                        }
                    });
                });
        }
    }
}
