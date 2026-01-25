use crate::state::Workspace;

pub fn render(ui: &mut egui::Ui, workspace: &Workspace) {
    ui.horizontal(|ui| {
        if let Some(doc) = workspace.get_active_document() {
            // Show file status
            if doc.last_error.is_some() {
                ui.colored_label(egui::Color32::RED, "✗ Error");
            } else if doc.preview_svg.is_some() {
                ui.colored_label(egui::Color32::GREEN, "✓ Valid");
            } else {
                ui.label("○ Not validated");
            }

            ui.separator();

            // Show file path
            if let Some(path) = &doc.path {
                ui.label(path.display().to_string());
            } else {
                ui.label("untitled");
            }

            ui.separator();

            // Show dirty status
            if doc.dirty {
                ui.label("Modified");
            } else {
                ui.label("Saved");
            }
        } else {
            ui.label("No document open");
        }

        // Right-aligned info
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label("WireViz GUI v0.1.0");
        });
    });
}
