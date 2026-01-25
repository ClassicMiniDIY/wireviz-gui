use crate::state::Workspace;

pub fn render(ui: &mut egui::Ui, workspace: &Workspace) {
    ui.vertical(|ui| {
        ui.heading("Preview");
        ui.separator();

        if let Some(doc) = workspace.get_active_document() {
            if let Some(svg_content) = &doc.preview_svg {
                // For now, show SVG as text
                // TODO: Implement actual SVG rendering with resvg
                egui::ScrollArea::both().show(ui, |ui| {
                    ui.label(format!("SVG Preview ({} bytes)", svg_content.len()));
                    ui.separator();
                    ui.label("SVG rendering will be implemented in the next step.");
                    ui.label("For now, showing raw SVG:");
                    ui.separator();
                    ui.code(svg_content);
                });
            } else if let Some(error) = &doc.last_error {
                ui.centered_and_justified(|ui| {
                    ui.colored_label(egui::Color32::RED, "Error generating preview:");
                    ui.label(error);
                });
            } else {
                ui.centered_and_justified(|ui| {
                    ui.label("No preview available. Click View > Refresh Preview to generate.");
                });
            }
        } else {
            ui.centered_and_justified(|ui| {
                ui.label("No document open");
            });
        }
    });
}
