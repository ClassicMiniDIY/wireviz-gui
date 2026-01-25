use crate::state::Workspace;

pub fn render(ctx: &egui::Context, workspace: &mut Workspace) {
    egui::TopBottomPanel::top("toolbar").show(ctx, |ui| {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 8.0;

            // Document tabs - collect data first to avoid borrow conflicts
            let doc_data: Vec<(usize, String, bool)> = workspace
                .get_documents()
                .iter()
                .map(|doc| {
                    let is_active = workspace
                        .get_active_document()
                        .map(|d| d.id == doc.id)
                        .unwrap_or(false);
                    (doc.id, doc.get_display_title(), is_active)
                })
                .collect();

            let mut clicked_id = None;
            for (id, title, is_active) in doc_data {
                let button = egui::Button::new(title).selected(is_active);
                if ui.add(button).clicked() {
                    clicked_id = Some(id);
                }
            }

            if let Some(id) = clicked_id {
                workspace.set_active_document(id);
            }
        });
    });
}
