use crate::state::{Document, Workspace};
use crate::ui::{editor, preview, status_bar, toolbar};
use crate::wireviz::WireVizRunner;
use std::sync::mpsc::{channel, Receiver, Sender};

pub struct WireVizApp {
    workspace: Workspace,
    wireviz_runner: WireVizRunner,
    task_tx: Sender<TaskMessage>,
    task_rx: Receiver<TaskMessage>,
    show_about: bool,
}

#[derive(Debug)]
pub enum TaskMessage {
    PreviewReady(String),       // SVG content
    PreviewError(String),        // Error message
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
            task_tx,
            task_rx,
            show_about: false,
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
                    ui.separator();
                    if ui.button("Quit").clicked() {
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

    fn refresh_preview(&mut self) {
        if let Some(doc) = self.workspace.get_active_document() {
            let yaml_content = doc.yaml_content.clone();
            let tx = self.task_tx.clone();
            let runner = self.wireviz_runner.clone();

            // Spawn background task to generate preview
            std::thread::spawn(move || {
                match runner.generate_svg(&yaml_content) {
                    Ok(svg) => {
                        tx.send(TaskMessage::PreviewReady(svg)).ok();
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
                TaskMessage::PreviewReady(svg) => {
                    if let Some(doc) = self.workspace.get_active_document_mut() {
                        doc.preview_svg = Some(svg);
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

        // Status bar
        egui::TopBottomPanel::bottom("status_bar").show(ctx, |ui| {
            status_bar::render(ui, &self.workspace);
        });

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
