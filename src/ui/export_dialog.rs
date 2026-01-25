use crate::wireviz::OutputFormat;
use std::path::PathBuf;

pub struct ExportDialog {
    pub open: bool,
    pub formats: Vec<OutputFormat>,
    pub output_dir: Option<PathBuf>,
    pub output_name: String,
    pub in_progress: bool,
    pub error: Option<String>,
}

impl Default for ExportDialog {
    fn default() -> Self {
        Self {
            open: false,
            formats: vec![OutputFormat::Svg, OutputFormat::Png, OutputFormat::Tsv],
            output_dir: None,
            output_name: String::from("output"),
            in_progress: false,
            error: None,
        }
    }
}

impl ExportDialog {
    pub fn show(&mut self, ctx: &egui::Context) -> Option<ExportAction> {
        let mut action = None;

        if self.open {
            egui::Window::new("Export Outputs")
                .collapsible(false)
                .resizable(false)
                .show(ctx, |ui| {
                    ui.heading("Export WireViz Outputs");
                    ui.separator();

                    // Output directory selection
                    ui.horizontal(|ui| {
                        ui.label("Output Directory:");
                        if let Some(dir) = &self.output_dir {
                            ui.label(dir.display().to_string());
                        } else {
                            ui.label("(Current directory)");
                        }

                        if ui.button("Browse...").clicked() {
                            if let Some(dir) = rfd::FileDialog::new().pick_folder() {
                                self.output_dir = Some(dir);
                            }
                        }
                    });

                    ui.add_space(10.0);

                    // Output name
                    ui.horizontal(|ui| {
                        ui.label("Output Name:");
                        ui.text_edit_singleline(&mut self.output_name);
                    });

                    ui.add_space(10.0);

                    // Format selection
                    ui.label("Select output formats:");
                    ui.separator();

                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Svg), "SVG (Scalable Vector Graphics)");
                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Png), "PNG (Raster Image)");
                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Html), "HTML (Web Page)");
                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Tsv), "TSV (BOM - Tab Separated)");
                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Csv), "CSV (BOM - Comma Separated)");
                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Gv), "GraphViz (DOT source)");
                    ui.checkbox(&mut self.formats.contains(&OutputFormat::Pdf), "PDF (Portable Document)");

                    // Handle checkbox changes
                    let all_formats = [
                        OutputFormat::Svg,
                        OutputFormat::Png,
                        OutputFormat::Html,
                        OutputFormat::Tsv,
                        OutputFormat::Csv,
                        OutputFormat::Gv,
                        OutputFormat::Pdf,
                    ];

                    for format in all_formats {
                        let checked = self.formats.contains(&format);
                        if ui.checkbox(&mut checked.clone(), format.display_name()).changed() {
                            if checked && !self.formats.contains(&format) {
                                self.formats.push(format);
                            } else if !checked {
                                self.formats.retain(|f| f != &format);
                            }
                        }
                    }

                    ui.add_space(10.0);

                    // Error display
                    if let Some(error) = &self.error {
                        ui.colored_label(egui::Color32::RED, format!("Error: {}", error));
                        ui.add_space(5.0);
                    }

                    // Progress indicator
                    if self.in_progress {
                        ui.spinner();
                        ui.label("Exporting...");
                    }

                    ui.add_space(10.0);

                    // Buttons
                    ui.horizontal(|ui| {
                        if ui
                            .add_enabled(!self.in_progress && !self.formats.is_empty(), egui::Button::new("Export"))
                            .clicked()
                        {
                            action = Some(ExportAction::Export);
                        }

                        if ui.add_enabled(!self.in_progress, egui::Button::new("Cancel")).clicked() {
                            action = Some(ExportAction::Cancel);
                        }
                    });
                });
        }

        action
    }

    pub fn reset(&mut self) {
        self.error = None;
        self.in_progress = false;
    }
}

#[derive(Debug)]
pub enum ExportAction {
    Export,
    Cancel,
}
