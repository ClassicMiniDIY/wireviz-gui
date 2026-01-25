use crate::state::Workspace;
use crate::wireviz::Bom;

pub fn render(ui: &mut egui::Ui, workspace: &Workspace) {
    ui.vertical(|ui| {
        ui.horizontal(|ui| {
            ui.heading("Bill of Materials (BOM)");

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("📋 Copy to Clipboard").clicked() {
                    if let Some(doc) = workspace.get_active_document() {
                        if let Some(bom_tsv) = &doc.bom_data {
                            ui.ctx().copy_text(bom_tsv.clone());
                        }
                    }
                }

                if ui.button("💾 Export CSV...").clicked() {
                    // TODO: Implement CSV export
                }
            });
        });

        ui.separator();

        if let Some(doc) = workspace.get_active_document() {
            if let Some(bom_tsv) = &doc.bom_data {
                match Bom::from_tsv(bom_tsv) {
                    Ok(bom) => {
                        if bom.items.is_empty() {
                            ui.label("No BOM items");
                        } else {
                            ui.label(format!("{} items", bom.item_count()));
                            ui.separator();

                            // Create scrollable table
                            egui::ScrollArea::both().show(ui, |ui| {
                                use egui_extras::{Column, TableBuilder};

                                TableBuilder::new(ui)
                                    .striped(true)
                                    .resizable(true)
                                    .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
                                    .column(Column::initial(40.0).at_least(30.0)) // ID
                                    .column(Column::initial(200.0).at_least(100.0)) // Description
                                    .column(Column::initial(50.0).at_least(40.0)) // Qty
                                    .column(Column::initial(50.0).at_least(40.0)) // Unit
                                    .column(Column::initial(100.0).at_least(80.0)) // Designators
                                    .column(Column::initial(120.0).at_least(80.0)) // Manufacturer
                                    .column(Column::initial(120.0).at_least(80.0)) // MPN
                                    .header(20.0, |mut header| {
                                        header.col(|ui| {
                                            ui.strong("ID");
                                        });
                                        header.col(|ui| {
                                            ui.strong("Description");
                                        });
                                        header.col(|ui| {
                                            ui.strong("Qty");
                                        });
                                        header.col(|ui| {
                                            ui.strong("Unit");
                                        });
                                        header.col(|ui| {
                                            ui.strong("Designators");
                                        });
                                        header.col(|ui| {
                                            ui.strong("Manufacturer");
                                        });
                                        header.col(|ui| {
                                            ui.strong("MPN");
                                        });
                                    })
                                    .body(|mut body| {
                                        for item in &bom.items {
                                            body.row(18.0, |mut row| {
                                                row.col(|ui| {
                                                    ui.label(&item.id);
                                                });
                                                row.col(|ui| {
                                                    ui.label(&item.description);
                                                });
                                                row.col(|ui| {
                                                    ui.label(&item.qty);
                                                });
                                                row.col(|ui| {
                                                    ui.label(&item.unit);
                                                });
                                                row.col(|ui| {
                                                    ui.label(&item.designators);
                                                });
                                                row.col(|ui| {
                                                    ui.label(&item.manufacturer);
                                                });
                                                row.col(|ui| {
                                                    ui.label(&item.mpn);
                                                });
                                            });
                                        }
                                    });
                            });
                        }
                    }
                    Err(e) => {
                        ui.colored_label(egui::Color32::RED, format!("Error parsing BOM: {}", e));
                    }
                }
            } else {
                ui.centered_and_justified(|ui| {
                    ui.label("No BOM available. Generate preview first (View > Refresh Preview).");
                });
            }
        } else {
            ui.centered_and_justified(|ui| {
                ui.label("No document open");
            });
        }
    });
}
