use crate::state::Workspace;
use crate::wireviz::ErrorSeverity;

pub fn render(ui: &mut egui::Ui, workspace: &Workspace) {
    ui.vertical(|ui| {
        ui.heading("Validation");
        ui.separator();

        if let Some(doc) = workspace.get_active_document() {
            if doc.validation_errors.is_empty() {
                if doc.parsed_harness.is_some() {
                    ui.colored_label(egui::Color32::GREEN, "✓ No validation errors");
                } else {
                    ui.label("Document not yet validated");
                }
            } else {
                ui.label(format!("{} validation issue(s) found:", doc.validation_errors.len()));
                ui.separator();

                egui::ScrollArea::vertical().show(ui, |ui| {
                    for error in &doc.validation_errors {
                        let (icon, color) = match error.severity {
                            ErrorSeverity::Error => ("✗", egui::Color32::RED),
                            ErrorSeverity::Warning => ("⚠", egui::Color32::from_rgb(255, 165, 0)),
                            ErrorSeverity::Info => ("ℹ", egui::Color32::LIGHT_BLUE),
                        };

                        ui.horizontal(|ui| {
                            ui.colored_label(color, icon);

                            let location = if let (Some(line), Some(col)) = (error.line, error.column) {
                                format!("Line {}, Col {}: ", line, col)
                            } else if let Some(line) = error.line {
                                format!("Line {}: ", line)
                            } else {
                                String::new()
                            };

                            ui.label(format!("{}{}", location, error.message));
                        });

                        ui.add_space(4.0);
                    }
                });
            }
        } else {
            ui.label("No document open");
        }
    });
}
