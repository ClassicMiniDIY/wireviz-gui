use crate::state::Workspace;

pub fn render(ui: &mut egui::Ui, workspace: &mut Workspace) {
    ui.vertical(|ui| {
        ui.heading("YAML Editor");
        ui.separator();

        if let Some(doc) = workspace.get_active_document_mut() {
            egui::ScrollArea::vertical().show(ui, |ui| {
                let text_edit = egui::TextEdit::multiline(&mut doc.yaml_content)
                    .code_editor()
                    .desired_width(f32::INFINITY)
                    .desired_rows(40)
                    .lock_focus(true);

                if text_edit.show(ui).response.changed() {
                    doc.mark_dirty();
                }
            });
        } else {
            ui.centered_and_justified(|ui| {
                ui.label("No document open. Use File > New or File > Open to get started.");
            });
        }
    });
}
